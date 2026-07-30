import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref } from "effect";
import { BunPreview, makeBunPreviewLayer } from "./bun-preview";
import {
  releaseBunPreviewExecution,
} from "./bun-preview-execution";

const request = (runId: string, port: number) => ({
  version: 1 as const,
  runId,
  port,
  method: "GET",
  path: "/hello",
  headers: {},
  body: "",
});

describe("BunPreviewExecution", () => {
  it.layer(makeBunPreviewLayer())((it) => {
    it.effect(
      "releases interrupted registration and route ownership before reuse",
      () =>
        Effect.gen(function* () {
          const preview = yield* BunPreview;
          const route = yield* Ref.make<
            | { readonly runId: string; readonly port: number }
            | undefined
          >(undefined);
          const startupReachedRoute = yield* Deferred.make<void>();
          const runId = "run-interrupted";
          const port = 3005;
          const release = () =>
            releaseBunPreviewExecution({
              runId,
              port,
              stopRealm: () => undefined,
              stopPreview: preview.stop,
              stopRoute: (ownerRunId, ownerPort) =>
                Ref.update(route, (current) =>
                  current?.runId === ownerRunId && current.port === ownerPort
                    ? undefined
                    : current,
                ),
              clearActive: () => Effect.void,
            });
          const running = yield* Effect.acquireUseRelease(
            preview.register({
              runId,
              port,
              handler: () =>
                Effect.succeed({ status: 200, headers: {}, body: "live" }),
            }),
            () =>
              Effect.gen(function* () {
                yield* Ref.set(route, { runId, port });
                yield* Deferred.succeed(startupReachedRoute, undefined);
                yield* Effect.never;
              }),
            release,
          ).pipe(Effect.forkChild);

          yield* Deferred.await(startupReachedRoute);
          yield* Fiber.interrupt(running);

          assert.isUndefined(yield* Ref.get(route));
          const restartedRunId = "run-restarted-after-interrupt";
          yield* preview.register({
            runId: restartedRunId,
            port,
            handler: () =>
              Effect.succeed({ status: 200, headers: {}, body: "restarted" }),
          });
          yield* Ref.set(route, { runId: restartedRunId, port });

          const response = yield* preview.request(
            request(restartedRunId, port),
          );
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body, "restarted");

          yield* release();
          assert.deepStrictEqual(yield* Ref.get(route), {
            runId: restartedRunId,
            port,
          });
          const stillRunning = yield* preview.request(
            request(restartedRunId, port),
          );
          assert.strictEqual(stillRunning.status, 200);
        }),
    );
  });
});
