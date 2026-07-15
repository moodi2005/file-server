import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import sharp from "sharp";
import { getFilesDb, FileRow } from "./db.js";
import { absoluteBlobPath, tmpPath } from "./paths.js";
import { log } from "./log.js";

export interface CompressParams {
  level: number;
  resize: boolean;
  webp: boolean;
}

const hashFile = async (abs: string): Promise<string> => {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(abs), hash);
  return hash.digest("hex");
};

/** Higher level = smaller output. Only downscales when resize was asked for. */
const targetSize = (level: number): number => {
  if (level >= 8) return 200;
  if (level >= 7) return 400;
  if (level >= 5) return 600;
  return 800;
};

const applyFormat = (
  pipeline: sharp.Sharp,
  format: string,
  level: number
): sharp.Sharp | null => {
  const quality = level > 3 ? 80 : 100;

  switch (format) {
    case "webp":
      return pipeline.webp({ quality, force: true });
    case "png":
      return pipeline.png({
        compressionLevel: Math.min(9, Math.max(0, Math.round(level))),
        quality,
        progressive: true,
        force: true,
      });
    case "jpg":
    case "jpeg":
      return pipeline.jpeg({ quality, progressive: true, force: true });
    default:
      return null;
  }
};

/**
 * Compresses a stored file in place and drops the original.
 *
 * sharp refuses to read and write the same path ("Cannot use same file for
 * input and output"), which is why the previous version failed on every single
 * request. Output goes to tmp/ and is renamed in — which also means a download
 * racing the job sees either the old file or the new one, never a partial.
 *
 * Step order is load-bearing. New file, then database, then unlink: a crash
 * between any two steps leaves the row pointing at a file that exists. The
 * reverse order can lose the file outright.
 */
export const runCompression = async (
  fileId: string,
  params: CompressParams
): Promise<void> => {
  const db = getFilesDb();
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as
    | FileRow
    | undefined;

  if (!row) {
    log.warn("compress_file_missing", { fileId });
    return;
  }

  const sourceAbs = absoluteBlobPath(row.rel_path);
  const sourceFormat = path.extname(row.rel_path).slice(1).toLowerCase();
  const outFormat = params.webp ? "webp" : sourceFormat;

  let pipeline = sharp(sourceAbs, { failOn: "none" });

  // resize before format settings — sharp applies the pipeline in order.
  if (params.resize) {
    const size = targetSize(params.level);
    pipeline = pipeline.resize(size, size, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const configured = applyFormat(pipeline, outFormat, params.level);
  if (!configured) {
    log.warn("compress_unsupported_format", { fileId, format: outFormat });
    return;
  }

  const tmpOut = `${tmpPath("cmp")}.${outFormat}`;
  await configured.toFile(tmpOut);

  const newRelPath =
    outFormat === sourceFormat
      ? row.rel_path
      : row.rel_path.replace(/\.[^.]+$/, `.${outFormat}`);
  const newAbs = absoluteBlobPath(newRelPath);

  try {
    // Same volume as tmp/ by construction, so this is an atomic swap.
    await fsp.rename(tmpOut, newAbs);
  } catch (err) {
    await fsp.unlink(tmpOut).catch(() => {});
    throw err;
  }

  const stat = await fsp.stat(newAbs);
  // Compression rewrote the bytes, so the stored hash now describes a file that
  // no longer exists. It is the download ETag, so leaving it stale would have
  // browsers serve the pre-compression image from cache forever.
  const sha256 = await hashFile(newAbs);

  db.prepare(
    "UPDATE files SET rel_path = ?, size = ?, mime = ?, sha256 = ? WHERE id = ?"
  ).run(
    newRelPath,
    stat.size,
    `image/${outFormat === "jpg" ? "jpeg" : outFormat}`,
    sha256,
    fileId
  );

  // Only now is the original unreferenced. If this fails the file is merely
  // orphaned on disk, which costs space and nothing else.
  if (newRelPath !== row.rel_path) {
    await fsp.unlink(sourceAbs).catch((err) => {
      log.warn("compress_original_unlink_failed", {
        fileId,
        path: row.rel_path,
        err: String(err),
      });
    });
  }

  log.info("compress_done", {
    fileId,
    from: row.rel_path,
    to: newRelPath,
    sizeBefore: row.size,
    sizeAfter: stat.size,
  });
};
