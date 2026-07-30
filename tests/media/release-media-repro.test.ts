import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const verifyReproducibility =
  process.env.FLECT_VERIFY_MEDIA_REPRODUCIBILITY === "1";
const generatedMedia = [
  "assets/screenshots/flect-launcher.png",
  "assets/screenshots/flect-shaper-preview.png",
  "assets/demo/flect-v0.1-demo.webm",
  "assets/demo/flect-v0.1-demo.webp",
  "assets/flect-shell.png",
  "assets/flect-hero.png",
] as const;

const digestGeneratedMedia = () =>
  Object.fromEntries(
    generatedMedia.map((relativePath) => [
      relativePath,
      createHash("sha256")
        .update(readFileSync(resolve(root, relativePath)))
        .digest("hex"),
    ]),
  );

const generateReleaseMedia = () => {
  const result = spawnSync("bun", ["run", "media:release"], {
    cwd: root,
    encoding: "utf8",
  });

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
};

describe.runIf(verifyReproducibility)("release media reproducibility", () => {
  it("produces byte-identical tracked media across consecutive captures", () => {
    generateReleaseMedia();
    const first = digestGeneratedMedia();

    generateReleaseMedia();
    const second = digestGeneratedMedia();

    expect(second).toEqual(first);
  }, 120_000);
});
