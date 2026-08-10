import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type CapsuleSource, decodeCapsule, encodeCapsule } from "./capsule";
import {
  evaluateCapsuleTrustPolicy,
  forkCapsule,
  signCapsule,
  verifyCapsuleSignatures,
} from "./capsule-trust";

const encoder = new TextEncoder();
const signedAt = "2026-08-10T12:00:00.000Z";

const source = (): CapsuleSource => ({
  manifest: {
    formatVersion: 1,
    id: "dev.akua.signed-fixture",
    name: "Signed fixture",
    version: "1.0.0",
    entrypoints: [{ id: "main", path: "index.html" }],
    capabilities: [{ id: "product:read", required: false }],
    compatibility: {
      flect: ">=0.2.0 <1.0.0",
      schemaVersion: 1,
      platforms: ["browser", "macos"],
    },
    provenance: {
      publisher: "Akua",
      source: "https://example.test/signed-fixture",
      revision: "v1.0.0",
      builder: "fixture",
    },
    signatures: [],
  },
  files: [
    {
      path: "index.html",
      contents: encoder.encode("<main>Signed fixture</main>"),
    },
  ],
});

const keys = () =>
  crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

describe("capsule signing and trust", () => {
  it("verifies canonical Ed25519 content without creating permission authority", async () => {
    const pair = await keys();
    const archive = await Effect.runPromise(encodeCapsule(source()));
    const signed = await Effect.runPromise(
      signCapsule(archive, {
        keyId: "akua:release-2026",
        privateKey: pair.privateKey,
        signedAt,
      }),
    );
    const assessment = await Effect.runPromise(
      verifyCapsuleSignatures(signed, [
        {
          keyId: "akua:release-2026",
          publicKey: pair.publicKey,
          status: "active",
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2026-12-31T23:59:59.999Z",
        },
      ]),
    );

    expect(assessment.status).toBe("verified");
    expect(assessment.keyIds).toEqual(["akua:release-2026"]);
    expect(assessment.authoritative).toBe(false);
    expect(
      evaluateCapsuleTrustPolicy(assessment, { mode: "require-verified" }),
    ).toEqual({
      allowed: true,
      reason: "accepted",
      permissionAuthorityChanged: false,
    });
  });

  it("distinguishes changed bytes, invalid claims, unknown keys, and revocation", async () => {
    const pair = await keys();
    const otherPair = await keys();
    const archive = await Effect.runPromise(encodeCapsule(source()));
    const signed = await Effect.runPromise(
      signCapsule(archive, {
        keyId: "akua:key",
        privateKey: pair.privateKey,
        signedAt,
      }),
    );
    const decoded = await Effect.runPromise(decodeCapsule(signed));
    const { files: _files, ...manifest } = decoded.manifest;
    const changed = await Effect.runPromise(
      encodeCapsule({
        manifest: { ...manifest, name: "Changed after signing" },
        files: decoded.files,
      }),
    );
    const claim = decoded.manifest.signatures[0];
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const invalid = await Effect.runPromise(
      encodeCapsule({
        manifest: {
          ...manifest,
          signatures: [
            {
              ...claim,
              signature: claim.signature.replace(/^./, (character) =>
                character === "A" ? "B" : "A",
              ),
            },
          ],
        },
        files: decoded.files,
      }),
    );
    const activeKey = {
      keyId: "akua:key",
      publicKey: pair.publicKey,
      status: "active" as const,
    };

    await expect(
      Effect.runPromise(verifyCapsuleSignatures(changed, [activeKey])),
    ).resolves.toMatchObject({ status: "changed-after-signing" });
    await expect(
      Effect.runPromise(verifyCapsuleSignatures(invalid, [activeKey])),
    ).resolves.toMatchObject({ status: "invalid" });
    await expect(
      Effect.runPromise(verifyCapsuleSignatures(signed, [])),
    ).resolves.toMatchObject({ status: "unknown-key" });
    await expect(
      Effect.runPromise(
        verifyCapsuleSignatures(signed, [
          { ...activeKey, status: "revoked", replacedBy: "akua:next" },
        ]),
      ),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(
      Effect.runPromise(
        verifyCapsuleSignatures(signed, [
          { ...activeKey, publicKey: otherPair.publicKey },
        ]),
      ),
    ).resolves.toMatchObject({ status: "invalid" });
  });

  it("records local fork lineage and deliberately removes upstream signatures", async () => {
    const pair = await keys();
    const archive = await Effect.runPromise(encodeCapsule(source()));
    const signed = await Effect.runPromise(
      signCapsule(archive, {
        keyId: "akua:key",
        privateKey: pair.privateKey,
        signedAt,
      }),
    );
    const forked = await Effect.runPromise(
      forkCapsule(signed, { revision: "local-2" }),
    );
    const decoded = await Effect.runPromise(decodeCapsule(forked));
    const assessment = await Effect.runPromise(
      verifyCapsuleSignatures(forked, []),
    );

    expect(decoded.manifest.signatures).toEqual([]);
    expect(decoded.manifest.lineage).toMatchObject({
      kind: "local-fork",
      parentSource: "https://example.test/signed-fixture",
      parentRevision: "v1.0.0",
    });
    expect(assessment.status).toBe("locally-forked");
    expect(
      evaluateCapsuleTrustPolicy(assessment, { mode: "require-verified" }),
    ).toMatchObject({
      allowed: false,
      reason: "verification-required",
      permissionAuthorityChanged: false,
    });
  });

  it("applies approved-publisher policy separately from permissions", async () => {
    const pair = await keys();
    const archive = await Effect.runPromise(encodeCapsule(source()));
    const signed = await Effect.runPromise(
      signCapsule(archive, {
        keyId: "akua:key",
        privateKey: pair.privateKey,
        signedAt,
      }),
    );
    const assessment = await Effect.runPromise(
      verifyCapsuleSignatures(signed, [
        { keyId: "akua:key", publicKey: pair.publicKey, status: "active" },
      ]),
    );
    expect(
      evaluateCapsuleTrustPolicy(assessment, {
        mode: "approved-keys",
        keyIds: ["other:key"],
      }),
    ).toEqual({
      allowed: false,
      reason: "publisher-not-approved",
      permissionAuthorityChanged: false,
    });
  });
});
