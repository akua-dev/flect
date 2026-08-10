import { Effect } from "effect";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeCapsule } from "../../shared/capsule";
import { makeRepositoryTar } from "../git/repository-tar";
import { importWebProjectArchive } from "./web-project-archive";

const encoder = new TextEncoder();

describe("web project archive import", () => {
  it.each([
    {
      name: "project.zip",
      archive: () =>
        zipSync({
          "project/index.html": encoder.encode("<main>ZIP app</main>"),
          "project/.env": encoder.encode("TOKEN=secret"),
        }),
    },
    {
      name: "project.tar",
      archive: () =>
        makeRepositoryTar([
          { path: "project/", kind: "directory" },
          {
            path: "project/index.html",
            kind: "file",
            contents: encoder.encode("<main>TAR app</main>"),
          },
          {
            path: "project/.env",
            kind: "file",
            contents: encoder.encode("TOKEN=secret"),
          },
        ]),
    },
  ])(
    "imports $name without retaining secret files",
    async ({ name, archive }) => {
      const result = await Effect.runPromise(
        importWebProjectArchive(name, archive()),
      );
      const capsule = await Effect.runPromise(decodeCapsule(result.archive));

      expect(result.report.source).toBe("archive");
      expect(result.report.revision).toMatch(/^[0-9a-f]{64}$/);
      expect(result.report.ignoredFiles).toEqual([".env"]);
      expect(capsule.files.map((file) => file.path)).not.toContain(".env");
    },
  );

  it("rejects encryption, ZIP64 markers, and unsupported archive types", async () => {
    const encrypted = zipSync({
      "project/index.html": encoder.encode("<main>Safe</main>"),
    });
    encrypted[6] = (encrypted[6] ?? 0) | 1;
    const central = encrypted.findIndex(
      (_, index) =>
        encrypted[index] === 0x50 &&
        encrypted[index + 1] === 0x4b &&
        encrypted[index + 2] === 0x01 &&
        encrypted[index + 3] === 0x02,
    );
    encrypted[central + 8] = (encrypted[central + 8] ?? 0) | 1;

    const encryptedFailure = await Effect.runPromise(
      importWebProjectArchive("project.zip", encrypted).pipe(Effect.flip),
    );
    const unsupportedFailure = await Effect.runPromise(
      importWebProjectArchive("project.rar", new Uint8Array(64)).pipe(
        Effect.flip,
      ),
    );

    expect(encryptedFailure.message).toContain("Links, encryption, ZIP64");
    expect(unsupportedFailure.message).toContain(".zip or POSIX .tar");
  });
});
