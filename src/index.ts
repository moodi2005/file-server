import http from "http";
import busboy from "busboy";
import fs from "fs";
import mime from "mime";
import url from "url";
import { compressFun } from "./compress.js";

const port = process.env.port ?? 2005;
const stamp = process.env.stamp ?? "fileServer";
const directory = process.env.directory ?? "uploads";
const urlUpload = process.env.urlUpload ?? 'upload';

const tokenUploader = process.env.tokenUploader;
const tokenDownload = process.env.tokenDownload;

// Check if the directory exists, if not, create it
if (!fs.existsSync(directory)) fs.mkdirSync(directory);

const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Handle file upload request
    if (req.url === `/${urlUpload}` && req.method === "PUT") {
      // Check if the token is provided and valid
      if (tokenUploader && req.headers.token !== tokenUploader) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("You do not have access");
      }
      const files: string[] = [];
      let filename = "";
      const bb = busboy({ headers: req.headers });
      bb.on("file", (_, file: NodeJS.ReadableStream, info: busboy.FileInfo) => {
        // Generate a unique filename based on the current timestamp and the provided stamp
        filename = `${new Date().getTime()}_${stamp}_${info.filename}`;
        if (fs.existsSync(filename)) {
          let i = 1;
          while (fs.existsSync(filename)) {
            i++;
            filename = `${new Date().getTime()}${i}_${stamp}_${info.filename}`;
          }
        }
        const { webp } = req.headers;
        const format = filename.split(".").pop();

        // Convert the image to WebP format if the "webp" header is provided and the format is supported
        if (webp && ["png", "jpeg", "jpg", "webp"].indexOf(format) !== -1) {
          const newFormat = filename.split(".");
          newFormat[newFormat.length - 1] = "webp";
          filename = newFormat.toString().replaceAll(",", ".");
        }
        files.push(filename);

        file.pipe(fs.createWriteStream(`./${directory}/` + filename));
      });
      bb.on("close", () => {
        const { compress, level, resize } = req.headers;
        if (
          level &&
          (isNaN(Number(level)) || Number(level) < 0 || Number(level) > 10)
        ) {
          res.writeHead(410, { "Content-Type": "text/plain" });
          return res.end("The level range must be between 1 and 9");
        }
        const format = filename.split(".").pop();
        if (compress && ["png", "jpeg", "jpg", "webp"].indexOf(format) !== -1) {
          // Compress the image if the "compress" header is provided and the format is supported
          compressFun(
            `./${directory}/` + filename,
            Number(level),
            Boolean(resize)
          );
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(JSON.stringify(files));
      });
      req.pipe(bb);
    } else if (req.url !== "/upload" && req.method === "GET") {
      const params = url.parse(req.url, true);
      // Check if the token is provided and valid
      if (tokenDownload && params.query.token !== tokenDownload) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("You do not have access");
      }
      
      const path = `./${directory}${req.url}`;
      if (fs.existsSync(path)) {
        let stat = fs.statSync(path);
        const mimeType = mime.getType(path);
        const name = req.url.split(`_${stamp}_`)[1];
        res.setHeader("Content-disposition", `attachment;filename=${name}`);
        res.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": stat.size,
        });

        let readStream = fs.createReadStream(path);
        readStream.pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404");
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404");
    }
  }
);

server.listen(port, () => {
  console.log("\x1b[34m",'|| File Server  ||');
  console.log("\x1b[0m","==================");
  console.log(`Upload Address:  http://localhost:${port}/${urlUpload}`)
  console.log(`View Address:  http://localhost:${port}/?file`)
  console.log(`Directory files : /${directory}`);
  console.log(`Stapm : ${stamp}`);
  console.log(`Token Upload : ${tokenUploader ? '✓' : '✕'}`);
  console.log(`Token Download : ${tokenDownload ? '✓' : '✕'}`);
});
