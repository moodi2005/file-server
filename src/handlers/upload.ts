import busboy from "busboy";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import http from "http";
import path from "path";
import { pipeline } from "stream/promises";
import mime from "mime";
import { config } from "../config.js";
import { verifyAccess } from "../access.js";
import { getFilesDb } from "../db.js";
import { enqueue } from "../queue.js";
import {
  checkDailyQuota,
  checkDiskSpace,
  quotaSubject,
  recordUpload,
  wouldExceedDailyQuota,
} from "../quota.js";
import {
  allocateBucket,
  absoluteBlobPath,
  buildRelPath,
  makeFileId,
  safeExtension,
  tmpPath,
  yearMonth,
} from "../paths.js";
import { errMeta, log } from "../log.js";
import { sendJson, sendText } from "./respond.js";

/**
 * Header values are always strings, so the old `Boolean(header)` test returned
 * true for the string "false" — every one of these flags was permanently on and
 * could not be turned off.
 */
const parseBool = (v: unknown): boolean => v === "true" || v === "1";

const parseLevel = (v: unknown): number | null => {
  if (v === undefined || v === "") return 5;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n;
};

interface StagedFile {
  tmp: string;
  originalName: string;
  ext: string;
  size: number;
  sha256: string;
}

export const handleUpload = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> => {
  const access = await verifyAccess(
    (req.headers.token as string) ?? "",
    config.access.partUpload,
    true
  );
  if (!access.ok) {
    // Drain, or the client keeps pushing a body nobody reads and the socket
    // sits half-open until it times out.
    req.resume();
    return sendJson(res, access.status, access.body);
  }

  const subject = quotaSubject(access.user);

  // Checked before a single byte of the body is read: rejecting a 100MB upload
  // after receiving it wastes the bandwidth and the disk write that the guard
  // exists to prevent.
  for (const verdict of [await checkDiskSpace(), checkDailyQuota(subject)]) {
    if (!verdict.ok) {
      req.resume();
      return sendJson(res, verdict.status, {
        message: verdict.message,
        error: verdict.error,
      });
    }
  }

  const level = parseLevel(req.headers.level);
  if (level === null) {
    req.resume();
    return sendJson(res, 400, {
      message: "level must be a number between 0 and 10",
      error: "BAD_REQUEST",
    });
  }

  const wantCompress = parseBool(req.headers.compress);
  const wantWebp = parseBool(req.headers.webp);
  const wantResize = parseBool(req.headers.resize);

  const staged: StagedFile[] = [];
  const pending: Promise<void>[] = [];
  // Held in an object because the assignments happen inside busboy callbacks;
  // a plain `let` gets narrowed to null by control-flow analysis.
  const state: { failure: { status: number; message: string } | null } = {
    failure: null,
  };

  const bb = busboy({
    headers: req.headers,
    defParamCharset: "utf8",
    limits: {
      fileSize: config.maxFileSize,
      // Previously unbounded: one request could carry unlimited files and fill
      // the disk while respecting the per-file cap.
      files: config.maxFilesPerRequest,
    },
  });

  bb.on("file", (_name, stream, info) => {
    const task = (async () => {
      const tmp = tmpPath("up");
      const hash = crypto.createHash("sha256");
      let size = 0;
      let tooLarge = false;

      stream.on("limit", () => {
        tooLarge = true;
      });
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        hash.update(chunk);
      });

      try {
        await pipeline(stream, fs.createWriteStream(tmp));
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        state.failure ??= { status: 500, message: "Upload failed" };
        log.error("upload_stream_failed", errMeta(err));
        return;
      }

      if (tooLarge) {
        await fsp.unlink(tmp).catch(() => {});
        state.failure ??= {
          status: 413,
          message: `File exceeds maximum allowed size of ${config.maxFileSize} bytes`,
        };
        return;
      }

      staged.push({
        tmp,
        originalName: info.filename || "unnamed",
        ext: safeExtension(info.filename || ""),
        size,
        sha256: hash.digest("hex"),
      });
    })();

    pending.push(task);
  });

  bb.on("filesLimit", () => {
    state.failure ??= {
      status: 400,
      message: `At most ${config.maxFilesPerRequest} files per request`,
    };
  });

  const finished = new Promise<void>((resolve, reject) => {
    bb.on("close", resolve);
    bb.on("error", reject);
  });

  try {
    req.pipe(bb);
    await finished;
    await Promise.all(pending);
  } catch (err) {
    log.error("upload_parse_failed", errMeta(err));
    await Promise.allSettled(staged.map((f) => fsp.unlink(f.tmp)));
    return sendText(res, 400, "Malformed upload");
  }

  // Nothing staged has a database row yet, so bailing out here leaves no trace
  // beyond tmp files the sweeper collects.
  if (state.failure) {
    await Promise.allSettled(staged.map((f) => fsp.unlink(f.tmp)));
    return sendJson(res, state.failure.status, {
      message: state.failure.message,
      error: "UPLOAD_REJECTED",
    });
  }

  if (staged.length === 0) {
    return sendJson(res, 400, { message: "No file in request", error: "BAD_REQUEST" });
  }

  // The size is only known now that the stream has ended. Files are still in
  // tmp/ with no rows behind them, so refusing here costs nothing.
  const stagedBytes = staged.reduce((sum, f) => sum + f.size, 0);
  const budget = wouldExceedDailyQuota(subject, stagedBytes);
  if (!budget.ok) {
    await Promise.allSettled(staged.map((f) => fsp.unlink(f.tmp)));
    return sendJson(res, budget.status, {
      message: budget.message,
      error: budget.error,
    });
  }

  const db = getFilesDb();
  const insert = db.prepare(
    `INSERT INTO files
       (id, original_name, rel_path, mime, size, sha256, created_at, legacy)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  );

  const results: string[] = [];
  let storedBytes = 0;

  for (const file of staged) {
    const now = new Date();
    const fileId = makeFileId(now);
    const bucket = allocateBucket(yearMonth(now));
    const relPath = buildRelPath(now, bucket, fileId, file.ext);
    const abs = absoluteBlobPath(relPath);

    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      // tmp/ and blobs/ share a volume, so this is an atomic publish: the file
      // is either absent or complete, never half-written.
      await fsp.rename(file.tmp, abs);
    } catch (err) {
      await fsp.unlink(file.tmp).catch(() => {});
      log.error("upload_publish_failed", { relPath, ...errMeta(err) });
      continue;
    }

    const contentType =
      mime.getType(file.originalName) ?? "application/octet-stream";

    insert.run(
      fileId,
      file.originalName,
      relPath,
      contentType,
      file.size,
      file.sha256,
      now.getTime()
    );

    if (
      (wantCompress || wantWebp) &&
      (config.compressibleFormats as readonly string[]).includes(file.ext)
    ) {
      enqueue(fileId, "compress", { level, resize: wantResize, webp: wantWebp });
    }

    // One string per file, which is the whole contract: it carries the id that
    // addresses the file and the display name the caller's list shows, so a
    // single column on their side is enough.
    results.push(`${fileId}/${encodeURIComponent(file.originalName)}`);
    storedBytes += file.size;
    log.info("file_stored", { fileId, relPath, size: file.size });
  }

  if (results.length === 0) {
    return sendJson(res, 500, { message: "Upload failed", error: "STORE_FAILED" });
  }

  // Counted only for files that actually landed, so a failed publish does not
  // consume the day's budget.
  recordUpload(subject, results.length, storedBytes);

  // Only files that are on disk with a row behind them get reported. The old
  // version pushed names into the response before the write finished, so a
  // failed write still handed the client a link to nothing.
  sendJson(res, 200, results);
};
