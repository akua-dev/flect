import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");
const ASSETS = join(DIST, "assets");
const KIB = 1_024;

const fail = (message: string): never => {
  throw new Error(`Browser bundle gate failed: ${message}`);
};

const gzipSize = async (path: string) =>
  Bun.gzipSync(await Bun.file(path).bytes()).byteLength;

const oneAsset = async (prefix: string, suffix = ".js") => {
  const matches = (await readdir(ASSETS)).filter(
    (name) => name.startsWith(prefix) && name.endsWith(suffix),
  );
  if (matches.length !== 1) {
    fail(`expected one ${prefix}*${suffix} asset, found ${matches.length}`);
  }
  return join(ASSETS, matches[0] as string);
};

const assetReferences = (source: string) =>
  [...source.matchAll(/["'`](assets\/[^"'`]+)["'`]/g)].map(
    (match) => match[1] as string,
  );

const size = async (path: string) => ({
  decoded: Bun.file(path).size,
  gzip: await gzipSize(path),
});

const htmlPath = join(DIST, "index.html");
const html = await Bun.file(htmlPath).text();
const initialNames = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => basename((match[1] as string).split("?")[0] as string),
);
const activationEntry = await oneAsset(
  "index.astro_astro_type_script_index_0_lang.",
);
const activationClient = await oneAsset("main.");
const activationCss = await oneAsset("index.", ".css");
const workspaceEntry = await oneAsset("workspace-entry.");
const activationEntrySource = await Bun.file(activationEntry).text();
const activationClientSource = await Bun.file(activationClient).text();
const workspaceGraph = [
  `assets/${basename(workspaceEntry)}`,
  ...assetReferences(activationClientSource),
].filter((value, index, all) => all.indexOf(value) === index);

const forbiddenInitial = [
  "workspace-entry",
  "agent-rail",
  "sandbox",
  "worker",
  "wasm",
  "rifty",
  "quickjs",
  "esbuild",
  "package-resolver",
  "proposal-build",
  "git-workspace",
];
for (const name of initialNames) {
  if (forbiddenInitial.some((token) => name.includes(token))) {
    fail(`view-only HTML references ${name}`);
  }
}

const initialJs = await size(activationEntry);
const clientJs = await size(activationClient);
const css = await size(activationCss);
const bootstrapGzip = initialJs.gzip + clientJs.gzip;
if (bootstrapGzip > 10 * KIB) {
  fail(`activation bootstrap is ${bootstrapGzip} bytes gzip (limit 10240)`);
}
if (clientJs.gzip > 200 * KIB || clientJs.decoded > 600 * KIB) {
  fail(
    `protected client is ${clientJs.gzip} bytes gzip / ${clientJs.decoded} decoded`,
  );
}
if (css.gzip > 25 * KIB) {
  fail(`initial CSS is ${css.gzip} bytes gzip (limit 25600)`);
}

const forbiddenWorkspaceModules = [
  "sandboxed-shell",
  "live-sandboxed-shell",
  "live-proposal-build",
  "browser-package-resolver",
  "browser-build-worker",
  "extension-worker",
  "rifty-js-runtime",
  "rifty-wasi",
  "quickjs",
  ".wasm",
];
for (const reference of workspaceGraph) {
  if (forbiddenWorkspaceModules.some((token) => reference.includes(token))) {
    fail(`first workspace graph eagerly references ${reference}`);
  }
}

if (!activationEntrySource.includes("main.")) {
  fail("static entry does not expose the event-driven activation client");
}
if (!activationClientSource.includes("workspace-entry.")) {
  fail(
    "activation client does not keep the workspace behind a second boundary",
  );
}

console.log(
  JSON.stringify(
    {
      viewOnlyRequests: initialNames.length,
      activationBootstrap: {
        gzip: bootstrapGzip,
        decoded: initialJs.decoded + clientJs.decoded,
      },
      initialCss: css,
      firstWorkspaceModules: workspaceGraph.length,
      onDemandBoundaries: ["shell", "compiler", "package", "worker", "wasm"],
    },
    undefined,
    2,
  ),
);
