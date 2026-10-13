import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("./dist/", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function send(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

const server = createServer((request, response) => {
  try {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      // URL mã hoá sai (ví dụ "/%E0") – trả lỗi thay vì làm sập server
      send(response, 400, "Bad request");
      return;
    }
    if (pathname.includes("\0")) { send(response, 400, "Bad request"); return; }
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = normalize(join(root, relativePath));
    if (filePath !== root.replace(/[\\/]$/, "") && !filePath.startsWith(root.endsWith(sep) ? root : root + sep)) {
      send(response, 404, "Not found");
      return;
    }
    let stats;
    try { stats = statSync(filePath); } catch { stats = null; }
    if (!stats || !stats.isFile()) { send(response, 404, "Not found"); return; }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": stats.size,
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(filePath);
    stream.on("error", () => { if (!response.headersSent) send(response, 500, "Read error"); else response.destroy(); });
    stream.pipe(response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) send(response, 500, "Server error");
    else response.destroy();
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Cổng ${port} đang được dùng. Chạy với PORT=xxxx npm start để đổi cổng.`);
  else console.error(error);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LUMA running at http://127.0.0.1:${port}`);
});
