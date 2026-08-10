import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ControlDescriptor } from "../shared/control-channel";
import {
  controlDescriptorPath,
  makeControlToken,
  readControlDescriptor,
  removeControlDescriptor,
  writeControlDescriptor,
} from "./control-descriptor";

describe("control descriptor", () => {
  it.effect("writes a private schema-valid descriptor atomically", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "flect-control-descriptor-")),
      );
      const token = makeControlToken();
      const descriptor = ControlDescriptor.make({
        version: 1,
        instanceId: "instance-descriptor-test",
        workspaceId: "workspace-descriptor-test",
        url: "http://127.0.0.1:43123",
        token,
        pid: process.pid,
        createdAt: 1,
      });

      yield* writeControlDescriptor(descriptor, directory);
      const decoded = yield* readControlDescriptor(directory);
      const directoryMode = (yield* Effect.promise(() => stat(directory))).mode;
      const fileMode = (yield* Effect.promise(() =>
        stat(controlDescriptorPath(directory)),
      )).mode;

      assert.strictEqual(Buffer.from(token, "base64url").byteLength, 32);
      assert.deepStrictEqual(decoded, descriptor);
      assert.strictEqual(directoryMode & 0o777, 0o700);
      assert.strictEqual(fileMode & 0o777, 0o600);

      yield* removeControlDescriptor(directory);
      const missing = yield* readControlDescriptor(directory).pipe(Effect.exit);
      assert.strictEqual(missing._tag, "Failure");
    }),
  );

  it.effect("removes stale process descriptors", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "flect-control-stale-")),
      );
      yield* writeControlDescriptor(
        ControlDescriptor.make({
          version: 1,
          instanceId: "instance-stale-test",
          workspaceId: "workspace-stale-test",
          url: "http://127.0.0.1:43124",
          token: makeControlToken(),
          pid: 2_147_483_647,
          createdAt: 1,
        }),
        directory,
      );

      const result = yield* readControlDescriptor(directory).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
      const missing = yield* readControlDescriptor(directory, false).pipe(
        Effect.exit,
      );
      assert.strictEqual(missing._tag, "Failure");
    }),
  );
});
