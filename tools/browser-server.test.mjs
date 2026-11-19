import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceServer } from "../browser/serve.mjs";

test("missing browser assets return 404 without taking down subsequent navigations", async () => {
  const root = await mkdtemp(join(tmpdir(), "cedar-browser-server-"));
  await mkdir(join(root, ".workspace-build"));
  await writeFile(join(root, ".workspace-build/index.html"), "<!doctype html><title>Workspace</title>");
  await writeFile(join(root, ".workspace-build/main.js"), "window.ready = true;");
  const server = createWorkspaceServer(root).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // A missing font or logo must not invalidate another worker's document or bundle request.
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) =>
      fetch(base + ["/workspace-build/missing.woff2", "/img/missing.png", "/dashboard", "/workspace-build/main.js"][index % 4])
        .then(async response => ({ status: response.status, body: await response.text() })),
    ));
    for (const [index, response] of results.entries()) {
      assert.equal(response.status, index % 4 < 2 ? 404 : 200);
      if (index % 4 === 2) assert.match(response.body, /<title>Workspace<\/title>/);
      if (index % 4 === 3) assert.equal(response.body, "window.ready = true;");
    }
    const later = await fetch(base + "/dashboard");
    assert.equal(later.status, 200);
    assert.match(await later.text(), /Workspace/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
