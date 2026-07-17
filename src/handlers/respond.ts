import http from "http";

export const sendJson = (
  res: http.ServerResponse,
  status: number,
  body: unknown
): void => {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const sendText = (
  res: http.ServerResponse,
  status: number,
  body: string
): void => {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};
