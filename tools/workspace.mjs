// Dependency-free configuration, deployment assembly and local static serving.
import {
  copyFile,
  mkdir,
  readFile,
  writeFile,
  realpath,
  stat,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hostFontFile = "cedar-embeddable-editor.host-fonts.js";
async function hasHostFonts(base) {
  try {
    return (
      await stat(
        resolve(base, "node_modules/cedar-embeddable-editor", hostFontFile),
      )
    ).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function configure(base = root, env = process.env) {
  const required = (name) => {
    if (env[name] === undefined)
      throw new Error(`Missing environment variable: ${name}`);
    return env[name];
  };
  const behavior = required("CEDAR_FRONTEND_BEHAVIOR");
  if (!["server", "develop"].includes(behavior))
    throw new Error("Invalid CEDAR_FRONTEND_BEHAVIOR");
  const target = required("CEDAR_FRONTEND_TARGET");
  const ui = required(`CEDAR_FRONTEND_${target}_UI_HOST`);
  const rest = required(`CEDAR_FRONTEND_${target}_REST_HOST`);
  let commit = env.CEDAR_SOURCE_COMMIT || "";
  if (commit && !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Invalid CEDAR_SOURCE_COMMIT");
  if (!commit) {
    try {
      commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: base,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
  }
  if (behavior === "server" && !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Server payload generation requires a Git source commit");
  const values = {
    cedarCeeHostFonts: await hasHostFonts(base),
    cedarVersion: required("CEDAR_VERSION"),
    cedarVersionModifier: required("CEDAR_VERSION_MODIFIER"),
    cedarSourceCommit: commit,
    cedarDevelopmentMode: behavior === "develop",
    cedarAuthUrl: env.CEDAR_AUTH_URL || `https://auth.${ui}`,
    versioningEnabled: true,
    makeOpenEnabled: true,
    dataciteEnabled: required("CEDAR_DATACITE_ENABLED") === "true",
    cedarGA4TrackingId: required("CEDAR_GA4_TRACKING_ID"),
  };
  const urls = {
    resourceRestAPI: `https://resource.${rest}`,
    userRestAPI: `https://user.${rest}`,
    groupRestAPI: `https://group.${rest}`,
    workspaceFrontend:
      env.CEDAR_WORKSPACE_FRONTEND_URL ||
      (target === "local"
        ? "http://localhost:4201"
        : `https://workspace-next.${ui}`),
    templateDesignerFrontend:
      env.CEDAR_TEMPLATE_DESIGNER_FRONTEND_URL ||
      (target === "local"
        ? "http://localhost:4202"
        : `https://designer-next.${ui}`),
    openViewBase: `https://openview.${rest}`,
    dataciteDOIBase: `https://bridging.${rest}/doi/datacite`,
    monitoringFrontend: `https://monitoring.${ui}`,
  };
  const cee = JSON.parse(
    await readFile(
      resolve(base, "app/config/src/embeddable-editor-config.json"),
      "utf8",
    ),
  );
  cee.terminologyBaseUrl = `https://terminology.${rest}/`;
  cee.bridgeBaseUrl = `https://bridge.${rest}/`;
  const output = resolve(base, "app/config");
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "url-service.conf.json"),
    JSON.stringify(urls, null, 2) + "\n",
  );
  await writeFile(
    resolve(output, "embeddable-editor-config.json"),
    JSON.stringify(cee, null, 2) + "\n",
  );
  const script = Object.entries(values)
    .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
    .join("\n");
  await writeFile(
    resolve(output, "version.js"),
    script +
      '\nwindow.cedarCacheControl = window.cedarVersion + window.cedarVersionModifier + (window.cedarSourceCommit ? "-" + window.cedarSourceCommit.substring(0, 12) : "") + (window.cedarDevelopmentMode ? "-dev-" + Date.now() : "");\n',
  );
}

export async function copyCee(base = root) {
  const destination = resolve(
    base,
    "app/third_party_components/cedar-embeddable-editor",
  );
  await mkdir(destination, { recursive: true });
  await copyFile(
    resolve(
      base,
      "node_modules/cedar-embeddable-editor/cedar-embeddable-editor.js",
    ),
    resolve(destination, "cedar-embeddable-editor.js"),
  );
  if (await hasHostFonts(base)) {
    await copyFile(
      resolve(base, "node_modules/cedar-embeddable-editor", hostFontFile),
      resolve(destination, hostFontFile),
    );
  } else {
    await rm(resolve(destination, hostFontFile), { force: true });
  }
}

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};
export function staticServer(directory) {
  const base = resolve(directory);
  return createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (
        pathname.includes("\0") ||
        pathname.split("/").some((p) => p.startsWith(".")) ||
        pathname.includes("\\")
      ) {
        res.writeHead(403).end();
        return;
      }
      let path = resolve(base, "." + pathname);
      if (!path.startsWith(base + sep)) path = resolve(base, "index.html");
      try {
        if (!(await stat(path)).isFile()) throw new Error("Not a file");
      } catch {
        // Missing assets must not masquerade as a successful HTML response.
        if (extname(pathname)) {
          res.writeHead(404).end();
          return;
        }
        path = resolve(base, "index.html");
      }
      if (!(await realpath(path)).startsWith((await realpath(base)) + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": body.length,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(400).end();
    }
  });
}

async function main(command) {
  if (!["start", "build", "configure", "copy-cee"].includes(command))
    throw new Error("Usage: workspace.mjs start|build|configure|copy-cee");
  if (command === "copy-cee") return copyCee();
  await configure();
  if (command === "configure") return;
  await copyCee();
  execFileSync(
    process.execPath,
    ["node_modules/@angular/cli/bin/ng.js", "build"],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync(process.execPath, ["tools/stage-workspace.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (command === "build" || process.env.CEDAR_FRONTEND_BEHAVIOR === "server")
    return;
  const port = Number(process.env.CEDAR_FRONTEND_PORT || 4201);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid CEDAR_FRONTEND_PORT");
  const server = staticServer(resolve(root, "app"));
  server.listen(port, "0.0.0.0", () =>
    console.log(`CEDAR Workspace development server on port ${port}`),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
