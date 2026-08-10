import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import type { ShareManifest } from "../../packages/product/src/share";
import {
  makeShareSignatureVerifierLayer,
  ShareSignatureVerifier,
} from "./share-signature-verifier";

const signature = btoa(String.fromCharCode(...new Uint8Array(64).fill(7)));
const manifest = (signatures: ShareManifest["signatures"]): ShareManifest => ({
  formatVersion: 1,
  id: "dev.flect.shared-card",
  name: "Shared card",
  version: "1.0.0",
  repository: {
    _tag: "embedded",
    archivePath: "repository.tar",
    sha256: "a".repeat(64),
    commit: "b".repeat(40),
  },
  artifacts: [],
  compatibility: { flect: ">=0.2.0", platforms: ["browser"] },
  provenance: {
    publisher: "akua-dev",
    source: "fixture",
    revision: "v1",
    builder: "test",
  },
  signatures,
  migrations: [],
});

describe("share signature verifier", () => {
  it.effect(
    "keeps unsigned and unconfigured signatures non-authoritative",
    () =>
      Effect.gen(function* () {
        const verifier = yield* ShareSignatureVerifier;
        assert.strictEqual(
          (yield* verifier.verify(manifest([]), "c".repeat(64))).status,
          "unsigned",
        );
        const present = yield* verifier.verify(
          manifest([{ algorithm: "ed25519", keyId: "akua:key", signature }]),
          "c".repeat(64),
        );
        assert.strictEqual(present.status, "present-unverified");
        assert.isFalse(present.authoritative);
      }).pipe(Effect.provide(makeShareSignatureVerifierLayer())),
  );

  it.effect("reports configured verification without creating authority", () =>
    Effect.gen(function* () {
      const verifier = yield* ShareSignatureVerifier;
      const verified = yield* verifier.verify(
        manifest([{ algorithm: "ed25519", keyId: "akua:key", signature }]),
        "c".repeat(64),
      );
      assert.strictEqual(verified.status, "verified");
      assert.isFalse(verified.authoritative);
      assert.deepStrictEqual(verified.keyIds, ["akua:key"]);
    }).pipe(
      Effect.provide(
        makeShareSignatureVerifierLayer({
          verify: () => Effect.succeed(true),
        }),
      ),
    ),
  );

  it.effect(
    "fails closed on malformed, duplicate, rejected, and defective claims",
    () =>
      Effect.gen(function* () {
        const verifier = yield* ShareSignatureVerifier;
        const malformed = yield* verifier.verify(
          manifest([
            {
              algorithm: "ed25519",
              keyId: "akua:key",
              signature: "not-base64",
            },
          ]),
          "c".repeat(64),
        );
        const duplicate = yield* verifier.verify(
          manifest([
            { algorithm: "ed25519", keyId: "akua:key", signature },
            { algorithm: "ed25519", keyId: "akua:key", signature },
          ]),
          "c".repeat(64),
        );
        const defective = yield* verifier.verify(
          manifest([{ algorithm: "ed25519", keyId: "other:key", signature }]),
          "c".repeat(64),
        );
        assert.strictEqual(malformed.status, "invalid");
        assert.strictEqual(duplicate.status, "invalid");
        assert.strictEqual(defective.status, "invalid");
      }).pipe(
        Effect.provide(
          makeShareSignatureVerifierLayer({
            verify: () =>
              Effect.failCause(Cause.die(new Error("private-key-material"))),
          }),
        ),
      ),
  );
});
