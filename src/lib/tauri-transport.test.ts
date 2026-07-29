import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { FlectClient } from "./api";
import {
  makeTauriFlectClientLayer,
  TauriBridge,
  type TauriBridgeShape,
} from "./tauri-transport";

describe("Tauri RPC transport", () => {
  it.effect(
    "routes an Effect RPC request through invoke and a private event",
    () =>
      Effect.gen(function* () {
        const listener = yield* Ref.make<
          ((payload: unknown) => void) | undefined
        >(undefined);
        const unlistenCount = yield* Ref.make(0);
        const requests = yield* Ref.make<ReadonlyArray<unknown>>([]);

        const bridge: TauriBridgeShape = {
          listen: (handler) =>
            Ref.set(listener, handler).pipe(
              Effect.as(Ref.update(unlistenCount, (count) => count + 1)),
            ),
          send: (request) =>
            Effect.gen(function* () {
              yield* Ref.update(requests, (current) => [...current, request]);
              if (
                typeof request === "object" &&
                request !== null &&
                "id" in request
              ) {
                const active = yield* Ref.get(listener);
                active?.({
                  _tag: "Exit",
                  requestId: request.id,
                  exit: {
                    _tag: "Success",
                    value: { version: 1, status: "ready" },
                  },
                });
              }
            }),
        };

        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* FlectClient;
            return yield* client.status;
          }).pipe(
            Effect.provide(
              makeTauriFlectClientLayer().pipe(
                Layer.provide(Layer.succeed(TauriBridge)(bridge)),
              ),
            ),
          ),
        );

        const sent = yield* Ref.get(requests);
        const releases = yield* Ref.get(unlistenCount);
        assert.strictEqual(result.status, "ready");
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(releases, 1);
      }),
  );
});
