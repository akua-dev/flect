import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, Stream } from "effect";
import {
  ShareGitInstallationSource,
  ShareInstallationRecord,
  ShareInstallationRefs,
  ShareInstalledArtifact,
} from "../../shared/share-installation";
import {
  InterfaceStorage,
  InterfaceStorageError,
} from "../lib/interface-store";
import {
  makeShareInstallationStoreLayer,
  ShareInstallationStore,
} from "./share-installation-store";

const hash = "a".repeat(64);
const commit = "b".repeat(40);
const record = (shareId: string) =>
  ShareInstallationRecord.make({
    formatVersion: 1,
    shareId,
    version: "1.0.0",
    source: ShareGitInstallationSource.make({
      _tag: "git",
      url: "https://example.test/share.git",
      descriptorCommit: "c".repeat(40),
      archiveSha256: hash,
    }),
    manifestSha256: hash,
    repositorySha256: hash,
    artifacts: [
      ShareInstalledArtifact.make({
        id: `${shareId}.component`,
        kind: "component",
        version: "1.0.0",
        contentSha256: hash,
      }),
    ],
    installedArtifactIds: [`${shareId}.component`],
    refs: ShareInstallationRefs.make({
      base: commit,
      upstream: commit,
      fork: commit,
    }),
    createdAt: 1,
    updatedAt: 1,
  });

const makeHarness = (initial: string | null, failWrites = false) => {
  const value = Ref.makeUnsafe(initial);
  const storage = Layer.succeed(InterfaceStorage)({
    read: () => Ref.get(value),
    write: (_key, next) =>
      failWrites
        ? Effect.fail(
            InterfaceStorageError.make({
              message: "Interface storage is unavailable.",
            }),
          )
        : Ref.set(value, next),
    remove: () => Ref.set(value, null),
  });
  return {
    value,
    layer: makeShareInstallationStoreLayer().pipe(Layer.provide(storage)),
  };
};

describe("share installation store", () => {
  it.effect("loads, saves, observes, sorts, and removes records", () => {
    const harness = makeHarness(null);
    return Effect.gen(function* () {
      const store = yield* ShareInstallationStore;
      const changes = yield* store.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* store.save(record("dev.flect.zeta"));
      yield* store.save(record("dev.flect.alpha"));
      const snapshot = yield* store.snapshot;
      assert.deepStrictEqual(
        snapshot.entries.map((entry) => entry.shareId),
        ["dev.flect.alpha", "dev.flect.zeta"],
      );
      yield* store.remove("dev.flect.zeta");
      const observed = yield* Fiber.join(changes);
      assert.deepStrictEqual(
        observed.map((item) => item.entries.length),
        [0, 1, 2],
      );
      assert.include(yield* Ref.get(harness.value), "dev.flect.alpha");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect(
    "recovers invalid state and preserves prior state on quota failure",
    () => {
      const invalid = makeHarness('{"credentials":"private-token"}');
      const failing = makeHarness(null, true);
      return Effect.gen(function* () {
        const invalidStore = yield* ShareInstallationStore;
        const recovered = yield* invalidStore.snapshot;
        assert.strictEqual(recovered.warning, "invalid-record");
        assert.deepStrictEqual(recovered.entries, []);

        const failed = yield* Effect.gen(function* () {
          const store = yield* ShareInstallationStore;
          const result = yield* store
            .save(record("dev.flect.alpha"))
            .pipe(Effect.result);
          return { result, snapshot: yield* store.snapshot };
        }).pipe(Effect.provide(failing.layer));
        assert.strictEqual(failed.result._tag, "Failure");
        assert.deepStrictEqual(failed.snapshot.entries, []);
      }).pipe(Effect.provide(invalid.layer));
    },
  );
});
