import fs from "fs";
import fsp from "fs/promises";
import http from "http";
import mime from "mime";
import path from "path";
import { config } from "../config.js";
import { verifyAccess } from "../access.js";
import { resolveInside } from "../paths.js";
import { errMeta, log } from "../log.js";
import { inlineType, parseRange } from "./download.js";
import { sendJson, sendText } from "./respond.js";

/**
 * Serves the tree the old server wrote, so urls it already handed out keep
 * working. Read-only: nothing new is ever written here.
 *
 * Paths still arrive from the url in this route (new uploads are addressed by
 * id instead), which is why containment is checked rather than assumed.
 */
export const handleLegacyDownload = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> => {
  if (!config.legacyDir) return sendText(res, 404, "404 Not Found");

  const token =
    url.searchParams.get("token") ?? (req.headers.token as string) ?? "";

  const access = await verifyAccess(token, config.access.partDownload, true);
  if (!access.ok) return sendJson(res, access.status, access.body);

  let requested: string;
  try {
    requested = decodeURIComponent(
      url.pathname.slice(`/${config.legacyUrlPrefix}/`.length)
    );
  } catch {
    return sendText(res, 400, "400 Bad Request");
  }

  const abs = await resolveInside(config.legacyDir, requested);
  if (!abs) {
    log.warn("legacy_path_rejected", { requested });
    return sendText(res, 400, "400 Bad Request: Invalid path");
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
    if (!stat.isFile()) return sendText(res, 404, "404 File Not Found");
  } catch {
    return sendText(res, 404, "404 File Not Found");
  }

  // The old naming scheme carried the display name in the filename after a
  // '___' separator. Missing separator means an even older file; fall back to
  // the whole basename rather than guessing.
  const base = path.basename(abs);
  const displayName = base.includes("___") ? base.split("___").slice(1).join("___") : base;
  const encoded = encodeURIComponent(displayName);
  const ascii = displayName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }

  const contentType = mime.getType(abs) ?? "application/octet-stream";
  const forceDownload = url.searchParams.get("download") === "1";
  const disposition =
    !forceDownload && inlineType(contentType) ? "inline" : "attachment";

  const headers = {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": "private, max-age=300",
  };

  const range = parseRange(req.headers.range, stat.size);
  if (range === "invalid") {
    res.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
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
    log.error("legacy_stream_failed", { requested, ...errMeta(err) });
    if (!res.headersSent) sendText(res, 404, "404 File Not Found");
    else res.destroy();
  });

  stream.once("open", () => {
    if (range === null) {
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
    } else {
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
        "Content-Length": range.end - range.start + 1,
      });
    }
    stream.pipe(res);
  });

  res.on("close", () => stream.destroy());
};
