import http from "http";
import { config } from "./config.js";
import { accessCacheStats } from "./access.js";
import { queueStats } from "./queue.js";
import { dailyStats, diskStats } from "./quota.js";
import { handleUpload } from "./handlers/upload.js";
import { handleDownload } from "./handlers/download.js";
import { handleLegacyDownload } from "./handlers/legacy.js";
import { sendJson, sendText } from "./handlers/respond.js";
import { errMeta, log } from "./log.js";

const handleHealth = async (res: http.ServerResponse): Promise<void> => {
  let queue: ReturnType<typeof queueStats> | { error: string };
  try {
    queue = queueStats();
  } catch (err) {
    queue = { error: String(err) };
  }

  const disk = await diskStats();

  sendJson(res, 200, {
    status: "ok",
    node: config.nodeId,
    pid: process.pid,
    uptime: process.uptime(),
    queue,
    // Exposed so free space is something you watch, rather than something you
    // discover when the node stops.
    disk,
    daily: dailyStats(),
    accessCache: accessCacheStats(),
  });
};

const route = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> => {
  if (!req.url) return sendText(res, 400, "400 Bad Request");

  // Parsed against a dummy origin purely to get a spec-compliant path/query
  // split; the host is never used.
  let url: URL;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return sendText(res, 400, "400 Bad Request");
  }

  const { pathname } = url;

  if (pathname === "/health" && req.method === "GET") {
    return handleHealth(res);
  }

  // Download is checked before upload: /api/fs/f/... is a GET and must not be
  // caught by a looser upload match.
  if (pathname.startsWith("/api/fs/f/") && req.method === "GET") {
    return handleDownload(req, res, url);
  }

  if (
    (pathname === "/api/fs/upload" || pathname === "/api/fs") &&
    (req.method === "PUT" || req.method === "POST")
  ) {
    return handleUpload(req, res);
  }

  if (
    config.legacyDir &&
    pathname.startsWith(`/${config.legacyUrlPrefix}/`) &&
    req.method === "GET"
  ) {
    return handleLegacyDownload(req, res, url);
  }

  sendText(res, 404, "404 Not Found");
};

export const createServer = (): http.Server => {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      log.error("unhandled_request_error", { url: req.url, ...errMeta(err) });
      if (!res.headersSent) sendText(res, 500, "500 Internal Server Error");
      else res.destroy();
    });
  });

  // Keep-alive must outlive the upstream proxy's idle timeout, or the proxy
  // reuses a socket the server is closing and the client sees a 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 0; // large uploads are legitimately slow

  return server;
};
