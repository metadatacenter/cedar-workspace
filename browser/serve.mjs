import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = path.startsWith("/workspace-build/")
    ? ".workspace-build/" + path.slice(17)
    : path.startsWith("/img/")
      ? "app" + path
      : ".workspace-build/index.html";
  const full = resolve(root, file);
  if (!full.startsWith(root + "/")) {
    response.writeHead(403).end();
    return;
  }
  try {
    response
      .writeHead(200, {
        "Content-Type": types[extname(full)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(await readFile(full));
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.PORT || 4797), "0.0.0.0");
