import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateUpdaterArchiveEntries,
  validateUpdaterEvidence,
  writeStaticUpdateManifest,
} from "./release-update";

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("release updater evidence", () => {
  const signedFixture = (archive: Uint8Array) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const publicRaw = publicDer.subarray(publicDer.length - 32);
    const keyId = Buffer.from("0102030405060708", "hex");
    const algorithm = Buffer.from("ED", "ascii");
    const publicRecord = Buffer.concat([algorithm, keyId, publicRaw]);
    const artifactSignature = sign(
      null,
      createHash("blake2b512").update(archive).digest(),
      privateKey,
    );
    const trustedComment = "timestamp:0\tfile:Flect.app.tar.gz\tprehashed";
    const globalSignature = sign(
      null,
      Buffer.concat([artifactSignature, Buffer.from(trustedComment)]),
      privateKey,
    );
    const publicSource = `untrusted comment: flect updater public key\n${publicRecord.toString("base64")}\n`;
    const signatureSource = `untrusted comment: signature from flect updater key\n${Buffer.concat([algorithm, keyId, artifactSignature]).toString("base64")}\ntrusted comment: ${trustedComment}\n${globalSignature.toString("base64")}\n`;
    return {
      publicKey: Buffer.from(publicSource).toString("base64"),
      signature: Buffer.from(signatureSource).toString("base64"),
    };
  };

  it("keeps development packaging explicitly updater-unavailable", async () => {
    await expect(
      Effect.runPromise(
        validateUpdaterEvidence({ mode: "development", version: "0.2.0" }),
      ),
    ).resolves.toEqual({ available: false, reason: "development" });
  });

  it("fails every public updater boundary closed", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "flect-updater-test-"));
    temporaryDirectories.push(temporary);
    const archivePath = join(temporary, "Flect.app.tar.gz");
    const signaturePath = `${archivePath}.sig`;
    const archive = Buffer.from("exact updater archive");
    const signed = signedFixture(archive);
    await writeFile(archivePath, archive);
    await writeFile(signaturePath, `${signed.signature}\n`);
    const valid = {
      mode: "public" as const,
      version: "0.2.0",
      target: "darwin-aarch64" as const,
      publicKey: signed.publicKey,
      privateKeyConfigured: true,
      archivePath,
      signaturePath,
      artifactUrl:
        "https://github.com/akua-dev/flect/releases/download/v0.2.0/Flect.app.tar.gz",
    };

    await expect(
      Effect.runPromise(validateUpdaterEvidence(valid)),
    ).resolves.toMatchObject({ available: true, target: "darwin-aarch64" });

    const failures = [
      [{ ...valid, publicKey: "" }, "public update key"],
      [{ ...valid, privateKeyConfigured: false }, "private signing key"],
      [{ ...valid, target: "linux-x86_64" }, "darwin-aarch64"],
      [
        { ...valid, artifactUrl: "http://example.test/Flect.app.tar.gz" },
        "fixed HTTPS",
      ],
      [
        { ...valid, archivePath: join(temporary, "missing.tar.gz") },
        "archive is missing",
      ],
      [
        { ...valid, signaturePath: join(temporary, "missing.sig") },
        "signature is missing",
      ],
      [
        { ...valid, archivePath: join(temporary, "changed.tar.gz") },
        "does not match",
      ],
    ] as const;

    await writeFile(join(temporary, "changed.tar.gz"), "changed archive");

    for (const [input, message] of failures) {
      await expect(
        Effect.runPromise(validateUpdaterEvidence(input)),
      ).rejects.toMatchObject({ message: expect.stringContaining(message) });
    }
  });

  it("writes only the static Tauri manifest contract and no secret input", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "flect-updater-test-"));
    temporaryDirectories.push(temporary);
    const manifestPath = join(temporary, "latest.json");
    await Effect.runPromise(
      writeStaticUpdateManifest({
        path: manifestPath,
        version: "0.2.0",
        notes: "A focused first release.",
        url: "https://github.com/akua-dev/flect/releases/download/v0.2.0/Flect.app.tar.gz",
        signature: "public artifact signature",
      }),
    );
    const source = await readFile(manifestPath, "utf8");

    expect(JSON.parse(source)).toEqual({
      version: "0.2.0",
      notes: "A focused first release.",
      platforms: {
        "darwin-aarch64": {
          url: "https://github.com/akua-dev/flect/releases/download/v0.2.0/Flect.app.tar.gz",
          signature: "public artifact signature",
        },
      },
    });
    expect(source).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
  });

  it("accepts only one bounded Flect app inventory", async () => {
    await expect(
      Effect.runPromise(
        validateUpdaterArchiveEntries(
          [
            "Flect.app/",
            "Flect.app/Contents/",
            "Flect.app/Contents/MacOS/flect",
            "Flect.app/Contents/MacOS/flect-runtime",
          ].join("\n"),
        ),
      ),
    ).resolves.toBeUndefined();

    for (const invalid of [
      "Other.app/Contents/MacOS/flect",
      "Flect.app/../secret",
      "Flect.app/Contents/MacOS/flect\nFlect.app/Contents/MacOS/flect-runtime\nFlect.app/Contents/MacOS/flectctl",
    ]) {
      await expect(
        Effect.runPromise(validateUpdaterArchiveEntries(invalid)),
      ).rejects.toMatchObject({
        message: "The updater archive inventory is invalid.",
      });
    }
  });
});
