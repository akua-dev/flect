import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { BunPreview, makeBunPreviewLayer } from "./bun-preview";

const request = (runId: string, port: number) => ({
  version: 1 as const,
  runId,
  port,
  method: "GET",
  path: "/hello",
  headers: {},
  body: "",
});

describe("BunPreview", () => {
  it.layer(makeBunPreviewLayer())((it) => {
    it.effect("registers one bounded port and routes only its owner", () =>
      Effect.gen(function* () {
        const preview = yield* BunPreview;
        const registration = yield* preview.register({
          runId: "run-a",
          port: 3000,
          handler: (input) =>
            Effect.succeed({
              status: 200,
              headers: { "content-type": "text/plain" },
              body: `hello ${input.path}`,
            }),
        });
        const response = yield* preview.request(request("run-a", 3000));
        const denied = yield* preview.request(request("run-b", 3000));

        assert.strictEqual(registration.previewUrl, "/preview/3000/");
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body, "hello /hello");
        assert.strictEqual(denied.status, 404);

        const duplicate = yield* preview
          .register({
            runId: "run-a",
            port: 3001,
            handler: () =>
              Effect.succeed({ status: 200, headers: {}, body: "" }),
          })
          .pipe(Effect.flip);
        assert.strictEqual(duplicate.reason, "preview");
      }),
    );

    it.effect("returns 503 after stop", () =>
      Effect.gen(function* () {
        const preview = yield* BunPreview;
        yield* preview.register({
          runId: "run-stop",
          port: 3002,
          handler: () =>
            Effect.succeed({ status: 200, headers: {}, body: "live" }),
        });
        yield* preview.stop("run-stop");
        const response = yield* preview.request(request("run-stop", 3002));

        assert.strictEqual(response.status, 503);
      }),
    );
  });

  it.layer(makeBunPreviewLayer({ handlerDeadline: "2 seconds" }))((it) => {
    it.effect("returns 504 when a handler exceeds its deadline", () =>
      Effect.gen(function* () {
        const preview = yield* BunPreview;
        yield* preview.register({
          runId: "run-slow",
          port: 3003,
          handler: () => Effect.never,
        });
        const fiber = yield* preview
          .request(request("run-slow", 3003))
          .pipe(Effect.forkChild);

        yield* TestClock.adjust("2 seconds");
        const response = yield* Fiber.join(fiber);
        assert.strictEqual(response.status, 504);
      }),
    );
  });

  it.layer(makeBunPreviewLayer())((it) => {
    it.effect("rejects oversized request and response bodies", () =>
      Effect.gen(function* () {
        const preview = yield* BunPreview;
        yield* preview.register({
          runId: "run-bounds",
          port: 3004,
          handler: () =>
            Effect.succeed({
              status: 200,
              headers: {},
              body: "x".repeat(1_048_577),
            }),
        });

        const response = yield* preview.request(request("run-bounds", 3004));
        assert.strictEqual(response.status, 502);

        const invalid = yield* preview
          .request({
            ...request("run-bounds", 3004),
            body: "x".repeat(1_048_577),
          })
          .pipe(Effect.flip);
        assert.strictEqual(invalid.reason, "preview");
      }),
    );
  });
});
