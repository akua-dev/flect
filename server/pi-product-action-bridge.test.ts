import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { ProductActionResult } from "../shared/product-action";
import { makePiProductActionBridge } from "./pi-product-action-bridge";

describe("Pi product-action bridge", () => {
  it.effect("round-trips one typed browser product action", () =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<{
        readonly requestId: string;
        readonly capabilityId: string;
        readonly action: string;
        readonly inputJson: string;
      }>();
      const bridge = yield* makePiProductActionBridge(
        "akua-outreach-review",
        (event) => {
          Effect.runSync(Deferred.succeed(observed, event));
        },
      );
      const fiber = yield* bridge
        .request("inspect", "{}")
        .pipe(Effect.forkChild({ startImmediately: true }));
      const request = yield* Deferred.await(observed);
      const result = ProductActionResult.make({
        version: 1,
        status: "ok",
        resultJson: '{"company":"Documenso"}',
      });

      yield* bridge.complete(request.requestId, result);

      assert.strictEqual(bridge.tool.name, "product_action");
      assert.strictEqual(request.capabilityId, "akua-outreach-review");
      assert.strictEqual(request.action, "inspect");
      assert.strictEqual(request.inputJson, "{}");
      assert.deepStrictEqual(yield* Fiber.join(fiber), result);
    }),
  );

  it.effect("releases a pending action when the session closes", () =>
    Effect.gen(function* () {
      const requestId = yield* Deferred.make<string>();
      const bridge = yield* makePiProductActionBridge(
        "akua-outreach-review",
        (event) => {
          Effect.runSync(Deferred.succeed(requestId, event.requestId));
        },
      );
      const fiber = yield* bridge
        .request("inspect", "{}")
        .pipe(Effect.forkChild({ startImmediately: true }));
      const observedRequestId = yield* Deferred.await(requestId);

      yield* bridge.close;

      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "denied");
      const error = yield* Effect.flip(
        bridge.complete(observedRequestId, result),
      );
      assert.strictEqual(error.operation, "product_action");
    }),
  );
});
