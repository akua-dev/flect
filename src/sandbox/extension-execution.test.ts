import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { ExtensionManifest } from "../../shared/extensions";
import { SandboxResult, SetTextIntent } from "../../shared/sandbox";
import {
  makeShapingKernelTestLayer,
  ShapingKernel,
} from "../lib/shaping-kernel";
import {
  CapabilityAdapter,
  SandboxCapabilityBrokerLive,
} from "./capability-broker";
import {
  ExtensionExecution,
  ExtensionExecutionLive,
} from "./extension-execution";
import { makeExtensionSandboxTestLayer } from "./extension-sandbox";

const deniedManifest = ExtensionManifest.make({
  version: 1,
  id: "weather-card",
  name: "Weather card",
  source: "() => ({ type: 'set-text', target: 'weather', text: 'Berlin' })",
  capabilities: ["interface:read"],
});

const sandboxResult = SandboxResult.make({
  version: 1,
  intents: [
    SetTextIntent.make({
      type: "set-text",
      target: "weather",
      text: "Berlin",
    }),
  ],
});

describe("ExtensionExecution", () => {
  const sandboxCalls = Ref.makeUnsafe(0);
  const sandbox = makeExtensionSandboxTestLayer({
    run: () =>
      Ref.update(sandboxCalls, (count) => count + 1).pipe(
        Effect.as(sandboxResult),
      ),
  });
  const adapterCalls = Ref.makeUnsafe(0);
  const adapter = Layer.succeed(CapabilityAdapter)({
    setText: () => Ref.update(adapterCalls, (count) => count + 1),
  });
  const broker = SandboxCapabilityBrokerLive.pipe(Layer.provide(adapter));
  const dependencies = Layer.mergeAll(
    sandbox.layer,
    broker,
    makeShapingKernelTestLayer(),
  );
  const testLayer = ExtensionExecutionLive.pipe(
    Layer.provideMerge(dependencies),
  );

  it.layer(testLayer)((it) => {
    it.effect(
      "disables an extension after three denied executions and does not run it again",
      () =>
        Effect.gen(function* () {
          const execution = yield* ExtensionExecution;
          const kernel = yield* ShapingKernel;
          yield* Ref.set(sandboxCalls, 0);
          yield* Ref.set(adapterCalls, 0);

          const failures = yield* Effect.forEach([1, 2, 3], () =>
            execution
              .execute(deniedManifest, {}, ["interface:propose"])
              .pipe(Effect.flip),
          );

          assert.deepStrictEqual(
            failures.map((failure) => failure._tag),
            ["CapabilityDenied", "CapabilityDenied", "CapabilityDenied"],
          );

          const recovered = yield* kernel.snapshot;
          assert.deepStrictEqual(recovered.disabledExtensions, [
            "weather-card",
          ]);
          assert.strictEqual(recovered.lastEvent.type, "recovery-requested");

          const disabled = yield* execution
            .execute(deniedManifest, {}, ["interface:propose"])
            .pipe(Effect.flip);

          assert.strictEqual(disabled._tag, "ExtensionDisabled");
          assert.strictEqual(yield* Ref.get(sandboxCalls), 3);
          assert.strictEqual(yield* Ref.get(adapterCalls), 0);
        }),
    );

    it.effect("does not execute extensions while safe mode is active", () =>
      Effect.gen(function* () {
        const execution = yield* ExtensionExecution;
        const kernel = yield* ShapingKernel;
        yield* Ref.set(sandboxCalls, 0);
        yield* Ref.set(adapterCalls, 0);
        yield* kernel.enterSafeMode;

        const disabled = yield* execution
          .execute(deniedManifest, {}, ["interface:propose"])
          .pipe(Effect.flip);

        assert.strictEqual(disabled._tag, "ExtensionDisabled");
        assert.strictEqual(yield* Ref.get(sandboxCalls), 0);
        assert.strictEqual(yield* Ref.get(adapterCalls), 0);
      }),
    );
  });
});
