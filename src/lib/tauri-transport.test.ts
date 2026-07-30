import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Result,
} from "effect";
import { defaultInterfaceDocument } from "../../shared/interface-document";
import { FlectClient, FlectUnavailableError } from "./api";
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

  it.effect("encodes shape documents before crossing the private bridge", () =>
    Effect.gen(function* () {
      const listener = yield* Ref.make<
        ((payload: unknown) => void) | undefined
      >(undefined);
      const requests = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const encodedDocument = {
        version: defaultInterfaceDocument.version,
        name: defaultInterfaceDocument.name,
        root: defaultInterfaceDocument.root,
      };

      const bridge: TauriBridgeShape = {
        listen: (handler) =>
          Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
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
                  value: encodedDocument,
                },
              });
            }
          }),
      };

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* FlectClient;
          return yield* client.shape(
            "session-1",
            "Keep this focused",
            defaultInterfaceDocument,
          );
        }).pipe(
          Effect.provide(
            makeTauriFlectClientLayer().pipe(
              Layer.provide(Layer.succeed(TauriBridge)(bridge)),
            ),
          ),
        ),
      );

      const sent = yield* Ref.get(requests);
      assert.strictEqual(result.name, defaultInterfaceDocument.name);
      assert.strictEqual(sent.length, 1);

      const request = sent[0];
      assert.isTrue(
        typeof request === "object" &&
          request !== null &&
          "payload" in request &&
          typeof request.payload === "object" &&
          request.payload !== null &&
          "document" in request.payload &&
          typeof request.payload.document === "object" &&
          request.payload.document !== null &&
          Object.getPrototypeOf(request.payload.document) === Object.prototype,
      );
    }),
  );

  it.effect("fails pending calls when the private runtime stops", () =>
    Effect.gen(function* () {
      const listener = yield* Ref.make<
        ((payload: unknown) => void) | undefined
      >(undefined);
      const requestSent = yield* Deferred.make<void>();

      const bridge: TauriBridgeShape = {
        listen: (handler) =>
          Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
        send: (request) =>
          Effect.gen(function* () {
            if (
              typeof request === "object" &&
              request !== null &&
              "id" in request
            ) {
              yield* Deferred.succeed(requestSent, undefined);
              const active = yield* Ref.get(listener);
              active?.({
                _tag: "ClientProtocolError",
                error: {
                  _tag: "RpcClientError",
                  reason: {
                    _tag: "RpcClientDefect",
                    message: "The private runtime is unavailable.",
                    cause: null,
                  },
                },
              });
            }
            yield* Effect.never;
          }),
      };

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const pending = yield* Effect.forkScoped(client.status);
          yield* Deferred.await(requestSent);
          return yield* Fiber.await(pending);
        }).pipe(
          Effect.provide(
            makeTauriFlectClientLayer().pipe(
              Layer.provide(Layer.succeed(TauriBridge)(bridge)),
            ),
          ),
        ),
      );

      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        const error = Cause.findError(result.cause);
        assert.isTrue(Result.isSuccess(error));
        if (Result.isSuccess(error)) {
          assert.instanceOf(error.success, FlectUnavailableError);
        }
      }
    }),
  );
});
