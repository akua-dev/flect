import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import {
  NativeUpdateCandidate,
  NativeUpdateProgress,
  NativeUpdateSnapshot,
} from "../../shared/native-update";
import {
  makeGuardedNativeUpdateLayer,
  NativeUpdate,
  type NativeUpdateAdapterShape,
  NativeUpdateUnavailableLive,
} from "./native-update";

const candidate = (token: string, version = "0.2.1") =>
  NativeUpdateCandidate.make({
    version,
    token,
    notes: "A bounded update.",
    target: "darwin-aarch64",
    contentLength: 1024,
  });

const available = (token: string, version = "0.2.1") =>
  NativeUpdateSnapshot.make({
    version: 1,
    state: "available",
    installedVersion: "0.2.0",
    candidate: candidate(token, version),
  });

describe("NativeUpdate", () => {
  it.effect("strictly decodes the closed native update contract", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(NativeUpdateSnapshot, {
        errors: "all",
        onExcessProperty: "error",
      })({
        version: 1,
        state: "downloading",
        installedVersion: "0.2.0",
        candidate: {
          version: "0.2.1",
          token: "candidate-token-0001",
          notes: "Security and reliability improvements.",
          target: "darwin-aarch64",
          contentLength: 2048,
        },
        progress: { downloadedBytes: 512, totalBytes: 2048 },
      });

      assert.strictEqual(decoded.state, "downloading");
      if (decoded.state !== "downloading") return;
      assert.strictEqual(decoded.progress.downloadedBytes, 512);

      const excess = yield* Effect.result(
        Schema.decodeUnknownEffect(NativeUpdateSnapshot, {
          errors: "all",
          onExcessProperty: "error",
        })({
          version: 1,
          state: "current",
          installedVersion: "0.2.0",
          checkedAtMillis: 10,
          endpoint: "https://example.com/latest.json",
        }),
      );
      assert.isTrue(Result.isFailure(excess));
    }),
  );

  it.effect("rejects an install token after a newer check", () => {
    const checks = [
      available("candidate-token-0001"),
      available("candidate-token-0002", "0.2.2"),
    ];
    let checkIndex = 0;
    const installed: Array<string> = [];
    const adapter: NativeUpdateAdapterShape = {
      status: Effect.succeed(
        NativeUpdateSnapshot.make({
          version: 1,
          state: "current",
          installedVersion: "0.2.0",
          checkedAtMillis: 1,
        }),
      ),
      check: Effect.sync(() => checks[checkIndex++] ?? checks[1]),
      install: (token) =>
        Effect.sync(() => {
          installed.push(token);
          return NativeUpdateSnapshot.make({
            version: 1,
            state: "ready-to-relaunch",
            installedVersion: "0.2.0",
            candidate: candidate(token, "0.2.2"),
            progress: NativeUpdateProgress.make({
              downloadedBytes: 1024,
              totalBytes: 1024,
            }),
          });
        }),
      relaunch: Effect.void,
    };

    return Effect.gen(function* () {
      const updates = yield* NativeUpdate;
      yield* updates.check;
      yield* updates.check;

      const stale = yield* Effect.result(
        updates.install("candidate-token-0001"),
      );
      assert.isTrue(Result.isFailure(stale));
      if (Result.isFailure(stale)) {
        assert.strictEqual(stale.failure.reason, "stale");
      }
      assert.deepStrictEqual(installed, []);

      const ready = yield* updates.install("candidate-token-0002");
      assert.strictEqual(ready.state, "ready-to-relaunch");
      assert.deepStrictEqual(installed, ["candidate-token-0002"]);

      const replay = yield* Effect.result(
        updates.install("candidate-token-0002"),
      );
      assert.isTrue(Result.isFailure(replay));
      assert.deepStrictEqual(installed, ["candidate-token-0002"]);
    }).pipe(Effect.provide(makeGuardedNativeUpdateLayer(adapter)));
  });

  it.layer(NativeUpdateUnavailableLive)((it) => {
    it.effect("keeps browser update support explicitly unavailable", () =>
      Effect.gen(function* () {
        const updates = yield* NativeUpdate;
        const status = yield* updates.status;
        const checked = yield* updates.check;

        assert.deepStrictEqual(status, checked);
        assert.strictEqual(status.state, "unavailable");
        if (status.state !== "unavailable") return;
        assert.strictEqual(status.reason, "browser");
      }),
    );
  });

  it("does not require a host layer for schema construction", () => {
    assert.strictEqual(Layer.isLayer(NativeUpdateUnavailableLive), true);
  });
});
