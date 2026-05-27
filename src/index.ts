import http from "http";
import busboy from "busboy";
import fs from "fs";
import fsp from "fs/promises";
import mime from "mime";
import path from "path";
import url from "url";
import crypto from "crypto";
import { compressFun } from "./compress.js";

// --- Configuration from Environment Variables ---
const port = process.env.port ?? 2005;
const stamp = process.env.stamp ?? "fileServer";
const directory = process.env.directory ?? "uploads";
const urlUpload = process.env.urlUpload ?? "upload";
const urlDownload = process.env.urlDownload ?? "download";
const tokenUploader = process.env.tokenUploader;
const tokenDownload = process.env.tokenDownload;

// Max file size: default 100MB, configurable via env
const maxFileSize = parseInt(process.env.maxFileSize ?? "") || 100 * 1024 * 1024;

// Compression concurrency limit
const MAX_CONCURRENT_COMPRESSIONS = 2;
let activeCompressions = 0;
const compressionQueue: (() => void)[] = [];

// --- Directory Cache ---
let cachedDir = { path: "", date: "" };

/**
 * Creates and caches the dated directory (YYYY/MM/DD).
 * Avoids redundant mkdir calls within the same day.
 */
const createDatedDirectory = async (): Promise<string> => {
  const today = new Date().toISOString().slice(0, 10); // "2026-05-27"
  if (cachedDir.date === today) return cachedDir.path;

  const [year, month, day] = today.split("-");
  const targetDir = path.join(directory, year, month, day);
  await fsp.mkdir(targetDir, { recursive: true });

  cachedDir = { path: targetDir, date: today };
  return targetDir;
};

// --- Structured Logger ---
const log = (level: "info" | "warn" | "error", msg: string, meta?: object) =>
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta }));

// --- MIME Cache ---
const mimeCache = new Map<string, string>();
const getMime = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (!mimeCache.has(ext)) {
    mimeCache.set(ext, mime.getType(filePath) || "application/octet-stream");
  }
  return mimeCache.get(ext)!;
};

// --- Compression Queue ---
/**
 * Wraps compressFun with a concurrency limiter.
 * At most MAX_CONCURRENT_COMPRESSIONS run simultaneously; others are queued.
 */
const queueCompression = (filePath: string, level: number, resize: boolean) => {
  const run = () => {
    activeCompressions++;
    Promise.resolve(compressFun(filePath, level, resize))
      .catch((err) => log("error", "compression_failed", { filePath, err: String(err) }))
      .finally(() => {
        activeCompressions--;
        if (compressionQueue.length > 0) {
          const next = compressionQueue.shift()!;
          next();
        }
      });
  };

  if (activeCompressions < MAX_CONCURRENT_COMPRESSIONS) {
    run();
  } else {
    compressionQueue.push(run);
  }
};

// --- Upload Handler ---
const handleUpload = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  // Authorization check
  if (tokenUploader && req.headers.token !== tokenUploader) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("You do not have access");
  }

  // Track file promises to avoid race condition between 'file' and 'close' events
  const filePromises: Promise<void>[] = [];
  const filesToProcess: {
    fullPath: string;
    relativePath: string;
    originalName: string;
  }[] = [];

  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: maxFileSize },
  });

  bb.on("file", (_, file, info) => {
    const filePromise = (async () => {
      try {
        const targetDir = await createDatedDirectory();
        const originalName = info.filename || "no_filename";
        const ext = path.extname(originalName);

        const now = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, ""); // "20260527"
        const uniqueId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

        // Extract the filename without the extension
        const baseNameWithoutExt = path.basename(originalName, ext);

        // Standardize the filename format: [uniqueId]_[datePart]___[originalName][ext]
        // Three underscores (___) are used as a reliable separator for the frontend UI
        let finalFilename = `${uniqueId}_${datePart}___${baseNameWithoutExt}${ext}`;

        // Handle WebP conversion if requested in headers
        const { webp } = req.headers;
        const format = ext.substring(1).toLowerCase();
        if (Boolean(webp) && ["png", "jpeg", "jpg", "webp"].includes(format)) {
          finalFilename = `${uniqueId}_${datePart}___${baseNameWithoutExt}.webp`;
        }

        const savePath = path.join(targetDir, finalFilename);

        filesToProcess.push({
          fullPath: savePath,
          relativePath: path.relative(directory, savePath),
          originalName,
        });

        // Pipe and write file stream to the storage disk directly
        await new Promise<void>((resolve, reject) => {
          const writeStream = fs.createWriteStream(savePath);
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);

          // Handle cases where the uploaded file exceeds maxFileSize limit
          file.on("limit", () => {
            writeStream.destroy();
            fsp.unlink(savePath).catch(() => { });
            reject(new Error("FILE_TOO_LARGE"));
          });

          file.pipe(writeStream);
        });

        log("info", "file_saved", {
          path: filesToProcess.at(-1)?.relativePath,
          originalName,
        });
      } catch (err: any) {
        if (err?.message === "FILE_TOO_LARGE") {
          log("warn", "file_too_large", { maxFileSize });
          if (!res.headersSent) {
            res.writeHead(413, { "Content-Type": "text/plain" });
            res.end(`File exceeds maximum allowed size of ${maxFileSize} bytes`);
          }
        } else {
          log("error", "file_save_error", { err: String(err) });
        }
        file.resume();
      }
    })();

    filePromises.push(filePromise);
  });

  bb.on("close", async () => {
    // Wait for all active file streams to completely finish writing
    await Promise.all(filePromises);

    // Process post-upload image compression requests
    const { compress, level, resize } = req.headers;
    const numLevel = Number(level);

    if (level && (isNaN(numLevel) || numLevel < 0 || numLevel > 10)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      return res.end("The 'level' header must be a number between 0 and 10.");
    }

    for (const fileInfo of filesToProcess) {
      const format = path
        .extname(fileInfo.fullPath)
        .substring(1)
        .toLowerCase();
      if (
        Boolean(compress) &&
        ["png", "jpeg", "jpg", "webp"].includes(format)
      ) {
        queueCompression(fileInfo.fullPath, numLevel || 5, Boolean(resize));
      }
    }

    // Respond with an array of file paths. 
    // The frontend can extract the user-friendly name by using: url.split('___')[1]
    if (!res.headersSent) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          filesToProcess.map((f) => f.relativePath.replace(/\\/g, "/"))
        )
      );
    }
  });

  bb.on("error", (err) => {
    log("error", "busboy_error", { err: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Upload failed");
    }
  });

  req.pipe(bb);
};

// --- Download Handler ---
const handleDownload = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const parsedUrl = url.parse(req.url!, true);

  // Authorization check
  if (tokenDownload && parsedUrl.query.token !== tokenDownload) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("You do not have access");
  }

  // Path sanitization and target calculation
  const requestedFile = decodeURIComponent(
    parsedUrl.pathname!.substring(`/${urlDownload}/`.length)
  );
  const fullPath = path.join(directory, requestedFile);

  // Path traversal guard (Security check)
  const uploadsRootDir = path.resolve(directory);
  const requestedPathResolved = path.resolve(fullPath);
  if (!requestedPathResolved.startsWith(uploadsRootDir)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("400 Bad Request: Invalid path");
  }

  try {
    const stat = await fsp.stat(requestedPathResolved);
    const mimeType = getMime(requestedPathResolved);

    // Parse original name directly from the file name using '___' split
    let downloadName = path.basename(requestedPathResolved);
    if (downloadName.includes("___")) {
      downloadName = downloadName.split("___")[1];
    }

    const encodedName = encodeURIComponent(downloadName);

    // HTTP Range Request support (Enables resumable downloads and video scrubbing)
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
      });

      fs.createReadStream(requestedPathResolved, { start, end }).pipe(res);
      return;
    }

    // Standard Full-File HTTP Response Headers
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "public, max-age=86400",
      "ETag": stat.mtime.getTime().toString(),
      "Last-Modified": stat.mtime.toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });

    const readStream = fs.createReadStream(requestedPathResolved);
    readStream.on("error", (err) => {
      log("error", "stream_error", { err: String(err) });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("500 Internal Server Error");
      }
    });
    readStream.pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 File Not Found");
  }
};

// --- Health Check Handler ---
const handleHealth = (_: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      uptime: process.uptime(),
      compressionQueue: compressionQueue.length,
      activeCompressions,
    })
  );
};

// --- Main HTTP Router ---
const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!req.url) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      return res.end("400 Bad Request");
    }

    if (req.url === "/health" && req.method === "GET") {
      handleHealth(req, res);
    } else if (req.url === `/${urlUpload}` && req.method === "PUT") {
      handleUpload(req, res);
    } else if (
      req.url.startsWith(`/${urlDownload}/`) &&
      req.method === "GET"
    ) {
      handleDownload(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
    }
  }
);

// Keep-Alive connection timeout optimizations for upstream Load Balancers (K8s/NGINX)
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// --- Graceful Shutdown Management ---
const shutdown = () => {
  log("info", "shutdown_initiated");
  server.close(() => {
    log("info", "shutdown_complete");
    process.exit(0);
  });
  // Forcefully kill process after 30 seconds if connections fail to drain properly
  setTimeout(() => {
    log("warn", "shutdown_forced");
    process.exit(1);
  }, 30_000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Initialization & Server Boot ---
server.listen(port, async () => {
  await fsp.mkdir(directory, { recursive: true });

  log("info", "server_started", {
    port,
    uploadUrl: `http://localhost:${port}/${urlUpload}`,
    downloadUrl: `http://localhost:${port}/${urlDownload}/<path>`,
    directory,
    stamp,
    maxFileSize,
    uploadToken: tokenUploader ? "enabled" : "disabled",
    downloadToken: tokenDownload ? "enabled" : "disabled",
  });
});