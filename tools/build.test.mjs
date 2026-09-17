import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root = fileURLToPath(new URL("../", import.meta.url));
test("deployment configuration completes writes and preserves explicit split origins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedar-workspace-config-"));
  try {
    await mkdir(join(dir, "tools"));
    await cp(
      join(root, "tools/workspace.mjs"),
      join(dir, "tools/workspace.mjs"),
    );
    await cp(join(root, "app/config/src"), join(dir, "app/config/src"), {
      recursive: true,
    });
    const env = {
      ...process.env,
      CEDAR_FRONTEND_BEHAVIOR: "server",
      CEDAR_FRONTEND_TARGET: "fixture",
      CEDAR_FRONTEND_fixture_UI_HOST: "ui.example",
      CEDAR_FRONTEND_fixture_REST_HOST: "api.example",
      CEDAR_VERSION: "1.2.3-test",
      CEDAR_VERSION_MODIFIER: "",
      CEDAR_GA4_TRACKING_ID: "",
      CEDAR_DATACITE_ENABLED: "false",
      CEDAR_SOURCE_COMMIT: "1".repeat(40),
      CEDAR_WORKSPACE_FRONTEND_URL: "https://workspace.example",
      CEDAR_TEMPLATE_DESIGNER_FRONTEND_URL: "https://designer.example",
      CEDAR_AUTH_URL: "https://auth.example",
    };
    execFileSync(
      process.execPath,
      [join(dir, "tools/workspace.mjs"), "configure"],
      { env, stdio: "pipe", timeout: 20000 },
    );
    const config = JSON.parse(
      await readFile(join(dir, "app/config/url-service.conf.json"), "utf8"),
    );
    assert.equal(config.workspaceFrontend, "https://workspace.example");
    assert.equal(config.templateDesignerFrontend, "https://designer.example");
    assert.equal(config.resourceRestAPI, "https://resource.api.example");
    assert.equal("messagingRestAPI" in config, false);
    const cee = JSON.parse(
      await readFile(
        join(dir, "app/config/embeddable-editor-config.json"),
        "utf8",
      ),
    );
    assert.equal(cee.terminologyBaseUrl, "https://terminology.api.example/");
    const context = { window: {} };
    vm.runInNewContext(
      await readFile(join(dir, "app/config/version.js"), "utf8"),
      context,
    );
    assert.equal(context.window.cedarSourceCommit, "1".repeat(40));
    assert.equal(context.window.cedarAuthUrl, "https://auth.example");
    assert.equal(context.window.cedarDevelopmentMode, false);
    assert.equal(context.window.dataciteEnabled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("staging preserves the served entry when a build lacks its entry document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedar-workspace-stage-"));
  try {
    await mkdir(join(dir, "tools"));
    await cp(
      join(root, "tools/stage-workspace.mjs"),
      join(dir, "tools/stage-workspace.mjs"),
    );
    await mkdir(join(dir, ".workspace-build"));
    await mkdir(join(dir, "app/workspace-build"), { recursive: true });
    await writeFile(
      join(dir, "app/workspace-build/index.html"),
      "previous working entry",
    );
    await writeFile(join(dir, ".workspace-build/main-new.js"), "new asset");
    assert.throws(() =>
      execFileSync(process.execPath, [join(dir, "tools/stage-workspace.mjs")], {
        stdio: "pipe",
      }),
    );
    assert.equal(
      await readFile(join(dir, "app/workspace-build/index.html"), "utf8"),
      "previous working entry",
    );
    await writeFile(
      join(dir, ".workspace-build/index.html"),
      '<script src="main-new.js"></script>',
    );
    execFileSync(process.execPath, [join(dir, "tools/stage-workspace.mjs")]);
    assert.equal(
      await readFile(join(dir, "app/workspace-build/main-new.js"), "utf8"),
      "new asset",
    );
    assert.match(
      await readFile(join(dir, "app/workspace-build/index.html"), "utf8"),
      /main-new.js/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("installed lock and packed source contain no retired runtime or vendor tree", async () => {
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  for (const name of [
    "angular",
    "angular-route",
    "angular-mocks",
    "jquery",
    "requirejs",
    "karma",
    "gulp",
    "gulp-connect",
    "gulp-replace",
    "websocket-driver",
  ])
    assert.equal(
      Object.keys(lock.packages).some(
        (path) =>
          path.endsWith("/node_modules/" + name) ||
          path === "node_modules/" + name,
      ),
      false,
      name,
    );
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    },
  );
  const files = JSON.parse(output)[0].files.map((file) => file.path);
  const retired =
    /^(app\/(bower_components|less|fonts|media|resources)\/|app\/(legacy\.html|require-config\.js|test-require-config\.js)$|karma\.conf\.js$|bower\.json$)/;
  assert.deepEqual(
    files.filter((file) => retired.test(file)),
    [],
  );
  assert.deepEqual(
    files.filter(
      (file) =>
        file.startsWith("app/scripts/") &&
        !/^app\/scripts\/(handlers\/KeycloakUserHandler\.js|keycloak\/keycloak\.min\.js(?:\.map)?)$/.test(
          file,
        ),
    ),
    [],
  );
  for (const required of [
    "src/main.ts",
    "src/index.html",
    "angular.json",
    "tools/workspace.mjs",
    "app/index.html",
    "app/scripts/handlers/KeycloakUserHandler.js",
    "app/scripts/keycloak/keycloak.min.js",
    "app/silent-check-sso.html",
    "app/img/cedar-logo-main.png",
  ])
    assert.ok(files.includes(required), required);
});

test("static server supports routes and HEAD without exposing missing assets or symlinks", async () => {
  const { staticServer } = await import("./workspace.mjs");
  const { symlink } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "workspace-http-"));
  await mkdir(join(dir, "app"));
  await writeFile(
    join(dir, "app/index.html"),
    "<cedar-workspace></cedar-workspace>",
  );
  await writeFile(join(dir, "app/main.js"), 'console.log("ok")');
  await writeFile(join(dir, "secret.txt"), "private");
  await symlink(join(dir, "secret.txt"), join(dir, "app/leak.txt"));
  const server = staticServer(join(dir, "app"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(
      await (await fetch(origin + "/instances/edit/example")).text(),
      /cedar-workspace/,
    );
    const asset = await fetch(origin + "/main.js", { method: "HEAD" });
    assert.equal(asset.headers.get("content-type"), "text/javascript");
    assert.equal(asset.headers.get("cache-control"), "no-store");
    assert.equal(await asset.text(), "");
    assert.equal((await fetch(origin + "/missing.js")).status, 404);
    assert.equal((await fetch(origin + "/leak.txt")).status, 403);
    assert.equal((await fetch(origin + "/.git/config")).status, 403);
    assert.equal((await fetch(origin + "/", { method: "POST" })).status, 405);
    assert.equal((await fetch(origin + "/%zz")).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("configuration rejects missing deployment identity and safely quotes values", async () => {
  const { configure } = await import("./workspace.mjs");
  const dir = await mkdtemp(join(tmpdir(), "workspace-config-"));
  try {
    await cp(join(root, "app/config/src"), join(dir, "app/config/src"), {
      recursive: true,
    });
    const env = {
      CEDAR_FRONTEND_BEHAVIOR: "server",
      CEDAR_FRONTEND_TARGET: "fixture",
      CEDAR_FRONTEND_fixture_UI_HOST: "ui.example",
      CEDAR_FRONTEND_fixture_REST_HOST: "api.example",
    };
    await assert.rejects(configure(dir, env), /source commit/);
    Object.assign(env, {
      CEDAR_SOURCE_COMMIT: "2".repeat(40),
      CEDAR_VERSION: 'quoted"\\\nversion',
      CEDAR_VERSION_MODIFIER: "",
      CEDAR_DATACITE_ENABLED: "true",
      CEDAR_GA4_TRACKING_ID: "",
    });
    await configure(dir, env);
    const context = { window: {} };
    vm.runInNewContext(
      await readFile(join(dir, "app/config/version.js"), "utf8"),
      context,
    );
    assert.equal(context.window.cedarVersion, env.CEDAR_VERSION);
    assert.equal(context.window.dataciteEnabled, true);
    await assert.rejects(
      configure(dir, { ...env, CEDAR_FRONTEND_BEHAVIOR: "invalid" }),
      /Invalid/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
