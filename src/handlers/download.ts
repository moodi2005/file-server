import fs from "fs";
import http from "http";
import path from "path";
import { config } from "../config.js";
import { verifyAccess } from "../access.js";
import { getFilesDb, FileRow } from "../db.js";
import { absoluteBlobPath } from "../paths.js";
import { errMeta, log } from "../log.js";
import { sendJson, sendText } from "./respond.js";

interface Range {
  start: number;
  end: number;
}

/**
 * RFC 7233 single-range parsing.
 *
 * Returns `null` for "no range header" and `"invalid"` for a range that must
 * answer 416. The previous version ran parseInt over both halves and used the
 * result unchecked, so `bytes=-500` (a legal suffix range that video players
 * send) produced NaN offsets, a `Content-Length: NaN` header and a stream that
 * threw.
 */
export const parseRange = (
  header: string | undefined,
  size: number
): Range | null | "invalid" => {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const [, startRaw, endRaw] = match;

  if (startRaw === "" && endRaw === "") return "invalid";

  // Suffix form: the last N bytes.
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    if (size === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start >= size) return "invalid";

  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(end) || end < start) return "invalid";

  return { start, end };
};

/**
 * Types a browser may safely render in place. Everything else — and anything
 * unknown — is forced to download.
 *
 * The hard exclusions are text/html and image/svg+xml: both execute script when
 * opened inline, and since they would run on the file server's own origin, an
 * uploaded one could read cookies and tokens for this domain. They must always
 * be attachments no matter what a client asks for.
 */
export const inlineType = (mime: string): boolean => {
  const type = mime.split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml") return false;
  return (
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type === "application/pdf" ||
    type === "text/plain"
  );
};

/** RFC 6266: ASCII fallback plus a UTF-8 form for names that need it. */
const contentDisposition = (
  name: string,
  disposition: "inline" | "attachment"
): string => {
  const encoded = encodeURIComponent(name);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

/**
 * The uploaded name with the extension the file actually has now.
 *
 * A png converted to webp by a compression job is still called "image.png" in
 * the database — that is the label the user gave it and what their app shows.
 * Handing the bytes over under that name would write a webp to disk called
 * .png, which plenty of viewers refuse to open.
 */
const downloadName = (originalName: string, relPath: string): string => {
  const actualExt = path.extname(relPath);
  const givenExt = path.extname(originalName);
  if (!actualExt || actualExt.toLowerCase() === givenExt.toLowerCase()) {
    return originalName;
  }
  return path.basename(originalName, givenExt) + actualExt;
};

export const handleDownload = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> => {
  const token =
    url.searchParams.get("token") ?? (req.headers.token as string) ?? "";

  const access = await verifyAccess(token, config.access.partDownload, true);
  if (!access.ok) return sendJson(res, access.status, access.body);

  // `/api/fs/f/<id>` and `/api/fs/f/<id>/<name>` are both valid. The trailing
  // name is the display label the client stored with the id — decoration for
  // the url, never used to find anything. The id is the first segment after the
  // prefix.
  const id = url.pathname.slice("/api/fs/f/".length).split("/")[0];

  if (!id) return sendText(res, 404, "404 File Not Found");

  const row = getFilesDb().prepare("SELECT * FROM files WHERE id = ?").get(id) as
    | FileRow
    | undefined;

  if (!row) return sendText(res, 404, "404 File Not Found");

  const abs = absoluteBlobPath(row.rel_path);

  // Strong validator from the content hash, so it stays correct across
  // compression rewrites without a stat() on the read path.
  const etag = `"${row.sha256.slice(0, 32)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "private, max-age=300" });
    res.end();
    return;
  }

  // Inline for safe types so images and PDFs open in the browser; ?download=1
  // forces a save. Unsafe types are attachments regardless.
  const forceDownload = url.searchParams.get("download") === "1";
  const disposition =
    !forceDownload && inlineType(row.mime) ? "inline" : "attachment";

  const baseHeaders = {
    "Content-Type": row.mime,
    "Content-Disposition": contentDisposition(
      downloadName(row.original_name, row.rel_path),
      disposition
    ),
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: etag,
    // Short and private: the url carries a token that rotates, so a shared
    // cache holding this would serve it to the wrong person.
    "Cache-Control": "private, max-age=300",
  };

  const range = parseRange(req.headers.range, row.size);

  if (range === "invalid") {
    res.writeHead(416, {
      "Content-Range": `bytes */${row.size}`,
      "Content-Type": "text/plain",
    });
    res.end("416 Range Not Satisfiable");
    return;
  }

  const stream =
    range === null
      ? fs.createReadStream(abs)
      : fs.createReadStream(abs, { start: range.start, end: range.end });

  stream.on("error", (err) => {
    log.error("download_stream_failed", { fileId: id, ...errMeta(err) });
    if (!res.headersSent) sendText(res, 404, "404 File Not Found");
    else res.destroy();
  });

  // Wait for the first byte before committing a status: a missing file should
  // answer 404, not a 200 with an empty body.
  stream.once("open", () => {
    if (range === null) {
      res.writeHead(200, { ...baseHeaders, "Content-Length": row.size });
    } else {
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${row.size}`,
        "Content-Length": range.end - range.start + 1,
      });
    }
    stream.pipe(res);
  });

  // Client hung up mid-transfer; stop reading the disk for nobody.
  res.on("close", () => stream.destroy());
};
