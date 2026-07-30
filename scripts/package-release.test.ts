import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateReleaseLayout,
  validateVersionManifest,
} from "./package-release";

const root = resolve(import.meta.dirname, "..");

const versionFromJson = (path: string) => {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  return typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string"
    ? value.version
    : undefined;
};

const packageVersion = versionFromJson(resolve(root, "package.json"));
const tauriVersion = versionFromJson(
  resolve(root, "src-tauri/tauri.conf.json"),
);
const cargoManifest = readFileSync(
  resolve(root, "src-tauri/Cargo.toml"),
  "utf8",
);
const cargoPackageVersion = cargoManifest.match(
  /\[package\][\s\S]*?\nversion = "([^"]+)"/,
)?.[1];

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("release packaging", () => {
  it("keeps every public version on 0.1.0", () => {
    expect(packageVersion).toBe("0.1.0");
    expect(cargoPackageVersion).toBe("0.1.0");
    expect(tauriVersion).toBe("0.1.0");
  });

  it("rejects a public version mismatch", async () => {
    await expect(
      Effect.runPromise(
        validateVersionManifest({
          packageVersion: "0.1.0",
          cargoVersion: "0.0.1",
          tauriVersion: "0.1.0",
        }),
      ),
    ).rejects.toMatchObject({
      message: "Every public Flect version must be 0.1.0.",
    });
  });

  it("rejects a missing sidecar, app, or DMG", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "flect-release-test-"));
    temporaryDirectories.push(temporary);
    const layout = {
      sidecar: resolve(temporary, "flect-runtime"),
      app: resolve(temporary, "Flect.app"),
      dmg: resolve(temporary, "Flect.dmg"),
    };

    await expect(
      Effect.runPromise(validateReleaseLayout(layout)),
    ).rejects.toMatchObject({
      message: "The compiled Flect sidecar is missing.",
    });

    await writeFile(layout.sidecar, "sidecar");
    await expect(
      Effect.runPromise(validateReleaseLayout(layout)),
    ).rejects.toMatchObject({
      message: "The Flect application bundle is missing.",
    });

    await mkdir(layout.app);
    await expect(
      Effect.runPromise(validateReleaseLayout(layout)),
    ).rejects.toMatchObject({
      message: "The Flect DMG is missing.",
    });

    await writeFile(layout.dmg, "dmg");
    await expect(
      Effect.runPromise(validateReleaseLayout(layout)),
    ).resolves.toBeUndefined();
  });
});
