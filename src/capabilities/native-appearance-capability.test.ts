import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import { NativeAccentColor } from "../../shared/native-platform";
import {
  ProductCapabilityAllowChoice,
  ProductCapabilityRequestContext,
  ProductOperationInvocation,
} from "../../shared/product-capability";
import {
  makeNativeAppearanceOperation,
  NativeAppearanceCapabilityManifest,
} from "./native-appearance-capability";
import { makeProductCapabilityBrokerLayer } from "./product-capability-broker";
import { ProductCapabilityDecisionStore } from "./product-capability-decision-store";
import {
  makeProductCapabilityRegistryLayer,
  ProductCapabilityRegistry,
} from "./product-capability-registry";

const context = ProductCapabilityRequestContext.make({
  version: 1,
  scopeId: "dev.akua.native-appearance",
  workspaceId: "workspace-local-default",
  requestDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision: "revision-native-appearance-1",
  capabilities: [
    { capabilityId: NativeAppearanceCapabilityManifest.id, required: true },
  ],
});
const invocation = ProductOperationInvocation.make({
  version: 1,
  operationId: "native.appearance.current",
  input: null,
});

const makeLayer = () => {
  const read = vi.fn();
  const systemAccentColor = Effect.sync(() => {
    read();
    return NativeAccentColor.make({
      version: 1,
      platform: "macos",
      css: "#0A84FF",
      contrastText: "#000000",
    });
  });
  const store = Layer.succeed(ProductCapabilityDecisionStore)({
    load: () => Effect.succeed({ decisions: [] }),
    save: () => Effect.void,
  });
  const broker = makeProductCapabilityBrokerLayer({
    manifests: [NativeAppearanceCapabilityManifest],
  }).pipe(Layer.provide(store));
  return {
    read,
    layer: makeProductCapabilityRegistryLayer({
      operations: [makeNativeAppearanceOperation(systemAccentColor)],
    }).pipe(Layer.provide(broker)),
  };
};

describe("native appearance product capability", () => {
  it.effect("cannot reach AppKit before the protected decision", () => {
    const { layer, read } = makeLayer();
    return Effect.gen(function* () {
      const registry = yield* ProductCapabilityRegistry;
      const result = yield* Effect.result(registry.invoke(context, invocation));
      assert.isTrue(Result.isFailure(result));
      assert.strictEqual(read.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("allows a bounded read and denies it after revocation", () => {
    const { layer, read } = makeLayer();
    return Effect.gen(function* () {
      const registry = yield* ProductCapabilityRegistry;
      const granted = yield* registry.decide(
        context,
        NativeAppearanceCapabilityManifest.id,
        ProductCapabilityAllowChoice.make({
          type: "allow",
          confirmationPolicy: "session",
        }),
      );
      assert.deepStrictEqual(yield* registry.invoke(context, invocation), {
        version: 1,
        platform: "macos",
        css: "#0A84FF",
        contrastText: "#000000",
      });
      assert.strictEqual(read.mock.calls.length, 1);
      yield* registry.revoke(granted.decisionId ?? "missing");
      const revoked = yield* Effect.result(
        registry.invoke(context, invocation),
      );
      assert.isTrue(Result.isFailure(revoked));
      assert.strictEqual(read.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });
});
