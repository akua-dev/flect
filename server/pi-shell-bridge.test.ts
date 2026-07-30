import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { BunCommandResult } from "../shared/bun-command";
import { makePiShellBridge } from "./pi-shell-bridge";

describe("Pi shell bridge", () => {
  it.effect("round-trips one typed browser shell request", () =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<{
        readonly requestId: string;
        readonly command: string;
      }>();
      const bridge = yield* makePiShellBridge((event) => {
        Effect.runSync(Deferred.succeed(observed, event));
      });
      const fiber = yield* bridge
        .request("bun run src/index.ts")
        .pipe(Effect.forkChild({ startImmediately: true }));
      const request = yield* Deferred.await(observed);
      const result = BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "42\n",
        stderr: "",
      });

      yield* bridge.complete(request.requestId, result);

      assert.strictEqual(bridge.tool.name, "bash");
      assert.strictEqual(request.command, "bun run src/index.ts");
      assert.deepStrictEqual(yield* Fiber.join(fiber), result);
    }),
  );

  it.effect("releases a pending command when its session closes", () =>
    Effect.gen(function* () {
      const requestId = yield* Deferred.make<string>();
      const bridge = yield* makePiShellBridge((event) => {
        Effect.runSync(Deferred.succeed(requestId, event.requestId));
      });
      const fiber = yield* bridge
        .request("sleep 30")
        .pipe(Effect.forkChild({ startImmediately: true }));
      const observedRequestId = yield* Deferred.await(requestId);

      yield* bridge.close;

      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.exitCode, 130);
      const error = yield* Effect.flip(
        bridge.complete(observedRequestId, result),
      );
      assert.strictEqual(error.operation, "shell");
    }),
  );
});
