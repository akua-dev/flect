import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ExtensionManifest, validateExtensionManifest } from "./extensions";

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
