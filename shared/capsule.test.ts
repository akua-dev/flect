import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type CapsuleSource, decodeCapsule, encodeCapsule } from "./capsule";

const bytes = (value: string) => new TextEncoder().encode(value);
const extensionSource = "() => []";
const extensionDigest =
  "a4a348b6f4e91da9c77bf69cf56383647597fdf2b7a64d71ae214a0261892537";

const portableExtension = {
  formatVersion: 1,
  id: "weather-card",
  name: "Weather card",
  description: "Adds a bounded weather summary.",
  version: "1.0.0",
  bundle: "extensions/weather-card/bundle.mjs",
  roles: ["app"],
  compatibility: {
    flect: ">=0.2.0 <1.0.0",
    extensionApi: 1,
    platforms: ["browser", "macos"],
  },
  capabilities: [{ id: "interface:read", required: false }],
  publicInstructions: "Use only when weather context is useful.",
  commands: [],
  tools: [],
  resources: {
    deadlineMs: 100,
    memoryBytes: 16 * 1024 * 1024,
    inputBytes: 1024 * 1024,
    outputBytes: 1024 * 1024,
    maxIntents: 20,
  },
  provenance: {
    publisher: "akua-dev",
    source: "https://github.com/akua-dev/weather-card",
    revision: "v1.0.0",
    bundleSha256: extensionDigest,
  },
} as const;

const source = (): CapsuleSource => ({
  manifest: {
    formatVersion: 1,
    id: "dev.akua.flect.fixture",
    name: "Fixture",
    version: "1.0.0",
    entrypoints: [{ id: "main", path: "ui/index.html" }],
    capabilities: [{ id: "product.read", required: false }],
    compatibility: {
      flect: ">=0.2.0 <1.0.0",
      schemaVersion: 1,
      platforms: ["browser", "macos"],
    },
    provenance: {
      publisher: "akua-dev",
      source: "https://github.com/akua-dev/flect",
      revision: "0123456789abcdef0123456789abcdef01234567",
      builder: "flect@0.2.0",
    },
    signatures: [],
  },
  files: [
    { path: "ui/index.html", contents: bytes("<h1>Fixture</h1>") },
    { path: "assets/theme.css", contents: bytes("h1{color:navy}") },
  ],
});

describe("portable .flect capsules", () => {
  it("encodes identical inputs byte-identically and round-trips", async () => {
    const first = await Effect.runPromise(encodeCapsule(source()));
    const second = await Effect.runPromise(encodeCapsule(source()));
    expect(first).toEqual(second);

    const decoded = await Effect.runPromise(decodeCapsule(first));
    expect(decoded.manifest.id).toBe("dev.akua.flect.fixture");
    expect(decoded.files.map((file) => file.path)).toEqual([
      "assets/theme.css",
      "ui/index.html",
    ]);
  });

  it.each(["../escape", "/absolute", "ui/../../escape", ".git/config"])(
    "rejects unsafe path %s",
    async (path) => {
      const value = source();
      await expect(
        Effect.runPromise(
          encodeCapsule({ ...value, files: [{ path, contents: bytes("x") }] }),
        ),
      ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
    },
  );

  it("rejects duplicate entries and unknown authority-bearing manifest fields", async () => {
    const value = source();
    const duplicate = value.files[0];
    expect(duplicate).toBeDefined();
    if (duplicate === undefined) return;
    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          files: [duplicate, duplicate],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });

    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest: { ...value.manifest, credential: "secret" } as never,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
  });

  it("rejects tampered payload hashes", async () => {
    const archive = await Effect.runPromise(encodeCapsule(source()));
    const tampered = archive.slice();
    const marker = bytes("Fixture</h1>");
    const at = tampered.findIndex((_value, index) =>
      marker.every((byte, offset) => tampered[index + offset] === byte),
    );
    expect(at).toBeGreaterThan(0);
    tampered[at] ^= 1;
    await expect(
      Effect.runPromise(decodeCapsule(tampered)),
    ).rejects.toMatchObject({
      _tag: "InvalidCapsule",
    });
  });

  it("rejects unsupported format versions and trailing archive data", async () => {
    const value = source();
    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest: { ...value.manifest, formatVersion: 2 } as never,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });

    const archive = await Effect.runPromise(encodeCapsule(value));
    const trailing = new Uint8Array(archive.byteLength + 1);
    trailing.set(archive);
    trailing[trailing.byteLength - 1] = 1;
    await expect(
      Effect.runPromise(decodeCapsule(trailing)),
    ).rejects.toMatchObject({
      _tag: "InvalidCapsule",
    });
  });

  it("round-trips a verified portable extension without activating it", async () => {
    const value = source();
    const archive = await Effect.runPromise(
      encodeCapsule({
        ...value,
        manifest: {
          ...value.manifest,
          extensions: [portableExtension],
        } as never,
        files: [
          ...value.files,
          { path: portableExtension.bundle, contents: bytes(extensionSource) },
        ],
      }),
    );
    const decoded = await Effect.runPromise(decodeCapsule(archive));

    expect(decoded.manifest.extensions).toHaveLength(1);
    expect(decoded.manifest.extensions?.[0]?.id).toBe("weather-card");
    expect(decoded.manifest.extensions?.[0]?.roles).toEqual(["app"]);
    expect(decoded.manifest.extensions?.[0]).not.toHaveProperty("grants");
  });

  it("rejects missing and digest-mismatched extension bundles", async () => {
    const value = source();
    const manifest = {
      ...value.manifest,
      extensions: [portableExtension],
    } as never;

    await expect(
      Effect.runPromise(encodeCapsule({ ...value, manifest })),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest,
          files: [
            ...value.files,
            { path: portableExtension.bundle, contents: bytes("() => null") },
          ],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
  });

  it("rejects a portable bundle larger than the executable source boundary", async () => {
    const value = source();
    const oversized = bytes(`() => [] /* ${"x".repeat(256 * 1024)} */`);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", oversized)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest: {
            ...value.manifest,
            extensions: [
              {
                ...portableExtension,
                provenance: {
                  ...portableExtension.provenance,
                  bundleSha256: digest,
                },
              },
            ],
          } as never,
          files: [
            ...value.files,
            { path: portableExtension.bundle, contents: oversized },
          ],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
  });

  it("rejects duplicate extension package ids and authority-shaped fields", async () => {
    const value = source();
    const files = [
      ...value.files,
      { path: portableExtension.bundle, contents: bytes(extensionSource) },
    ];

    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest: {
            ...value.manifest,
            extensions: [portableExtension, portableExtension],
          } as never,
          files,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
    await expect(
      Effect.runPromise(
        encodeCapsule({
          ...value,
          manifest: {
            ...value.manifest,
            extensions: [{ ...portableExtension, grants: ["interface:read"] }],
          } as never,
          files,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
  });
});
