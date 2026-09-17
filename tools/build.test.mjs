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
    await cp(join(root, "gulpfile.js"), join(dir, "gulpfile.js"));
    await cp(join(root, "app/config/src"), join(dir, "app/config/src"), {
      recursive: true,
    });
    const env = {
      ...process.env,
      NODE_PATH: join(root, "node_modules"),
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
      [
        join(root, "node_modules/gulp/bin/gulp.js"),
        "--cwd",
        dir,
        "replace-url",
        "replace-version",
      ],
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
    "gulpfile.js",
    "app/index.html",
    "app/scripts/handlers/KeycloakUserHandler.js",
    "app/scripts/keycloak/keycloak.min.js",
    "app/silent-check-sso.html",
    "app/img/cedar-logo-main.png",
  ])
    assert.ok(files.includes(required), required);
});
