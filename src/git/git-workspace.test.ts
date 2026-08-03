import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  makeGitWorkspace,
  type GitWorkspaceLockManager,
  type GitWorkspaceWorker,
} from "./git-workspace";

class HangingWorker implements GitWorkspaceWorker {
  terminated = false;

  addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
  ) {}

  removeEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
  ) {}

  postMessage(_message: unknown) {}

  terminate() {
    this.terminated = true;
  }
}

describe("GitWorkspace worker lifecycle", () => {
  it.effect("terminates before releasing the lock after a timeout", () =>
    Effect.gen(function* () {
      const workers: Array<HangingWorker> = [];
      let lockReleasedAfterTermination = false;
      const lockManager: GitWorkspaceLockManager = {
        request: async (_name, _options, callback) => {
          try {
            return await callback(null);
          } finally {
            lockReleasedAfterTermination = workers[0]?.terminated === true;
          }
        },
      };
      const git = yield* makeGitWorkspace({
        deadline: "1 millis",
        lockManager,
        makeWorker: () => {
          const worker = new HangingWorker();
          workers.push(worker);
          return worker;
        },
      });

      const first = yield* git.open({ workspaceId: "default" }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("1 second");
      const firstError = yield* Fiber.join(first).pipe(Effect.flip);

      assert.strictEqual(firstError.reason, "interrupted");
      assert.strictEqual(workers.length, 1);
      assert.isTrue(workers[0]?.terminated === true);
      assert.isTrue(lockReleasedAfterTermination);

      const second = yield* git.open({ workspaceId: "default" }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(second).pipe(Effect.flip);

      assert.strictEqual(workers.length, 2);
      assert.isTrue(workers[1]?.terminated === true);
    }),
  );
});
