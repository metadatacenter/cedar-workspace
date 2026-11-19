import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const defaultRoot = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
export function createWorkspaceServer(root = defaultRoot) {
  return createServer(async (request, response) => {
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
    let body;
    try {
      // Read before committing a 200: a missing asset must return 404, not crash the server.
      body = await readFile(full);
    } catch {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, {
        "Content-Type": types[extname(full)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(body);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createWorkspaceServer().listen(Number(process.env.PORT || 4797), "0.0.0.0");
}
