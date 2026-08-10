import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  assessPortableExtensionUpdate,
  ExtensionManifest,
  intersectPortableExtensionGrants,
  PortableExtensionRoleState,
  validateExtensionManifest,
  validatePortableExtensionPackage,
} from "./extensions";

const manifest = {
  version: 1,
  id: "weather-card",
  name: "Weather card",
  source: "({ city }) => ({ type: 'set-text', target: 'weather', text: city })",
  capabilities: ["interface:propose"],
} as const;

describe("extension manifests", () => {
  it.effect("decodes an explicit inert capability manifest", () =>
    Effect.gen(function* () {
      const decoded = yield* validateExtensionManifest(manifest);

      assert.instanceOf(decoded, ExtensionManifest);
      assert.deepStrictEqual(decoded.capabilities, ["interface:propose"]);
    }),
  );

  it.effect("rejects undeclared capabilities", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateExtensionManifest({
          ...manifest,
          capabilities: ["process:spawn"],
        }),
      );

      assert.strictEqual(error._tag, "InvalidExtensionManifest");
    }),
  );

  it.effect("rejects oversized source and credential-shaped fields", () =>
    Effect.gen(function* () {
      const oversized = yield* Effect.flip(
        validateExtensionManifest({
          ...manifest,
          source: "x".repeat(256 * 1024 + 1),
        }),
      );
      const credential = yield* Effect.flip(
        validateExtensionManifest({
          ...manifest,
          apiKey: "must-never-land-here",
        }),
      );

      assert.strictEqual(oversized._tag, "InvalidExtensionManifest");
      assert.strictEqual(credential._tag, "InvalidExtensionManifest");
      assert.notInclude(credential.message, "must-never-land-here");
    }),
  );
});

const portablePackage = {
  formatVersion: 1,
  id: "weather-card",
  name: "Weather card",
  description: "Adds a bounded weather summary to the product experience.",
  version: "1.2.0",
  bundle: "extensions/weather-card/bundle.mjs",
  roles: ["app", "shaper"],
  compatibility: {
    flect: ">=0.2.0 <1.0.0",
    extensionApi: 1,
    platforms: ["browser", "macos"],
  },
  capabilities: [
    { id: "interface:read", required: true },
    { id: "interface:propose", required: false },
  ],
  publicInstructions: "Use this extension only when weather context is useful.",
  commands: [
    {
      id: "forecast",
      name: "Forecast",
      description: "Return the public forecast projection.",
    },
  ],
  tools: [],
  resources: {
    deadlineMs: 100,
    memoryBytes: 16 * 1024 * 1024,
    inputBytes: 1024 * 1024,
    outputBytes: 1024 * 1024,
    maxIntents: 20,
  },
  provenance: {
    publisher: "Akua",
    source: "https://github.com/akua-dev/weather-card",
    revision: "v1.2.0",
    bundleSha256: "a".repeat(64),
  },
} as const;

describe("portable extension packages", () => {
  it.effect(
    "decodes an inspectable App and Shaper package without grants",
    () =>
      Effect.gen(function* () {
        const decoded =
          yield* validatePortableExtensionPackage(portablePackage);

        assert.strictEqual(decoded.id, "weather-card");
        assert.deepStrictEqual(decoded.roles, ["app", "shaper"]);
        assert.deepStrictEqual(
          decoded.capabilities.map((capability) => capability.id),
          ["interface:read", "interface:propose"],
        );
        assert.notProperty(decoded, "grants");
        assert.notProperty(decoded, "credentials");
      }),
  );

  it.effect("rejects duplicate roles, capabilities, and contribution ids", () =>
    Effect.gen(function* () {
      const duplicateRoles = yield* Effect.flip(
        validatePortableExtensionPackage({
          ...portablePackage,
          roles: ["app", "app"],
        }),
      );
      const duplicateCapabilities = yield* Effect.flip(
        validatePortableExtensionPackage({
          ...portablePackage,
          capabilities: [
            { id: "interface:read", required: true },
            { id: "interface:read", required: false },
          ],
        }),
      );
      const duplicateContributions = yield* Effect.flip(
        validatePortableExtensionPackage({
          ...portablePackage,
          commands: [portablePackage.commands[0], portablePackage.commands[0]],
        }),
      );

      assert.strictEqual(duplicateRoles._tag, "InvalidExtensionManifest");
      assert.strictEqual(
        duplicateCapabilities._tag,
        "InvalidExtensionManifest",
      );
      assert.strictEqual(
        duplicateContributions._tag,
        "InvalidExtensionManifest",
      );
    }),
  );

  it.effect(
    "rejects Guardian, ambient authority, invalid versions, and excessive resources",
    () =>
      Effect.gen(function* () {
        const guardian = yield* Effect.flip(
          validatePortableExtensionPackage({
            ...portablePackage,
            roles: ["guardian"],
          }),
        );
        const credential = yield* Effect.flip(
          validatePortableExtensionPackage({
            ...portablePackage,
            apiKey: "must-never-enter-extension-state",
          }),
        );
        const version = yield* Effect.flip(
          validatePortableExtensionPackage({
            ...portablePackage,
            version: "latest",
          }),
        );
        const resources = yield* Effect.flip(
          validatePortableExtensionPackage({
            ...portablePackage,
            resources: { ...portablePackage.resources, deadlineMs: 101 },
          }),
        );

        for (const failure of [guardian, credential, version, resources]) {
          assert.strictEqual(failure._tag, "InvalidExtensionManifest");
          assert.notInclude(
            failure.message,
            "must-never-enter-extension-state",
          );
        }
      }),
  );

  it("intersects grants with the package request and target role", () => {
    assert.deepStrictEqual(
      intersectPortableExtensionGrants(portablePackage, "app", [
        "interface:propose",
      ]),
      ["interface:propose"],
    );
    assert.deepStrictEqual(
      intersectPortableExtensionGrants(portablePackage, "guardian", [
        "interface:read",
      ]),
      [],
    );
  });

  it("requires explicit review for authority expansion and respects pins and forks", () => {
    assert.strictEqual(
      assessPortableExtensionUpdate(portablePackage, {
        ...portablePackage,
        version: "1.3.0",
      }).status,
      "compatible",
    );
    assert.strictEqual(
      assessPortableExtensionUpdate(portablePackage, {
        ...portablePackage,
        version: "1.3.0",
        capabilities: [
          ...portablePackage.capabilities,
          { id: "interface:propose", required: true },
        ],
      }).status,
      "authority-review",
    );
    assert.strictEqual(
      assessPortableExtensionUpdate(
        portablePackage,
        { ...portablePackage, version: "1.3.0" },
        { pinned: true },
      ).status,
      "pinned",
    );
    assert.strictEqual(
      assessPortableExtensionUpdate(
        portablePackage,
        { ...portablePackage, version: "1.3.0" },
        { forkRevision: "local-weather-layout" },
      ).status,
      "conflict",
    );
  });

  it("projects only bounded lifecycle and failure evidence", () => {
    const state = PortableExtensionRoleState.make({
      version: 1,
      capsuleId: "dev.akua.weather",
      extensionId: "weather-card",
      packageVersion: "1.2.0",
      bundleSha256: "a".repeat(64),
      provenanceRevision: "v1.2.0",
      role: "app",
      binding: "candidate",
      state: "failed",
      requestedCapabilities: ["interface:read", "interface:propose"],
      requiredCapabilities: ["interface:read"],
      grantedCapabilities: ["interface:read"],
      pinned: false,
      tested: false,
      failureCount: 1,
      failure: {
        version: 1,
        reason: "execution",
        message: "The portable extension failed safely.",
        recovery: "Disable the extension or ask Flect to fix it.",
      },
    });

    assert.strictEqual(state.failure?.reason, "execution");
    assert.notProperty(state.failure, "stack");
    assert.notProperty(state.failure, "path");
    assert.notProperty(state.failure, "error");
  });
});
