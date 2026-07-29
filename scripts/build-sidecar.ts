import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve("src-tauri/binaries/flect-runtime-aarch64-apple-darwin");

await mkdir(dirname(output), { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve("server/sidecar.ts")],
  target: "bun",
  minify: false,
  sourcemap: "none",
  compile: {
    target: "bun-darwin-arm64",
    outfile: output,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exitCode = 1;
} else {
  console.log(`Built private Flect runtime: ${output}`);
}
