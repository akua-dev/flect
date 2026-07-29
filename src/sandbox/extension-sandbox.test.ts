import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { SandboxResult, SetTextIntent } from "../../shared/sandbox";
import {
  ExtensionSandbox,
  makeExtensionSandboxTestLayer,
} from "./extension-sandbox";

const request = {
  extensionId: "weather-card",
  source:
    "input => ({ type: 'set-text', target: 'weather', text: input.city })",
  input: { city: "Berlin" },
};

describe("ExtensionSandbox", () => {
  const successHarness = makeExtensionSandboxTestLayer({
    run: () =>
      Effect.succeed(
        SandboxResult.make({
          version: 1,
          intents: [
            SetTextIntent.make({
              type: "set-text",
              target: "weather",
              text: "Berlin",
            }),
          ],
        }),
      ),
  });

  it.layer(successHarness.layer)((it) => {
    it.effect("returns a typed result and releases its worker", () =>
      Effect.gen(function* () {
        const sandbox = yield* ExtensionSandbox;
        const result = yield* sandbox.execute(request);
        const released = yield* Ref.get(successHarness.releases);

        assert.strictEqual(result.intents[0]?.type, "set-text");
        assert.strictEqual(released, 1);
      }),
    );
  });

  const deadlineHarness = makeExtensionSandboxTestLayer({
    run: () => Effect.never,
  });

  it.layer(deadlineHarness.layer)((it) => {
    it.effect("terminates and replaces a worker after the outer deadline", () =>
      Effect.gen(function* () {
        const sandbox = yield* ExtensionSandbox;
        const fiber = yield* sandbox.execute(request).pipe(Effect.forkChild);

        yield* TestClock.adjust("2 seconds");
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        const released = yield* Ref.get(deadlineHarness.releases);

        assert.strictEqual(error._tag, "SandboxExecutionFailed");
        assert.strictEqual(error.reason, "deadline");
        assert.strictEqual(released, 1);
      }),
    );
  });
});
