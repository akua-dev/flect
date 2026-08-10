import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Semaphore } from "effect";
import {
  ContinuityDrafts,
  emptyRoleContinuityRecord,
  RoleContinuityRecord,
} from "../../shared/role-continuity";
import {
  InterfaceStorage,
  InterfaceStorageError,
  type InterfaceStorageShape,
} from "./interface-store";
import {
  ContinuityLock,
  makeContinuityLockLayer,
  makeRoleContinuityRepositoryLayer,
  RoleContinuityRepository,
} from "./role-continuity-repository";

const KEY = "flect.role-continuity.v1";

const harness = (
  initial: string | null = null,
  overrides: Partial<InterfaceStorageShape> = {},
) => {
  let stored = initial;
  const storage = Layer.succeed(InterfaceStorage)({
    read: (key) =>
      Effect.sync(() => {
        expect(key).toBe(KEY);
        return stored;
      }),
    write: (key, value) =>
      Effect.sync(() => {
        expect(key).toBe(KEY);
        stored = value;
      }),
    remove: (key) =>
      Effect.sync(() => {
        expect(key).toBe(KEY);
        stored = null;
      }),
    ...overrides,
  });
  const lock = Layer.effect(
    ContinuityLock,
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1);
      return {
        exclusive: <A, E>(effect: Effect.Effect<A, E>) =>
          semaphore.withPermits(1)(effect),
      };
    }),
  );
  return {
    layer: makeRoleContinuityRepositoryLayer.pipe(
      Layer.provide(Layer.merge(storage, lock)),
    ),
    stored: () => stored,
  };
};

const changed = (generation: number, text: string) =>
  RoleContinuityRecord.make({
    ...emptyRoleContinuityRecord(3),
    generation,
    drafts: ContinuityDrafts.make({
      acceptedUse: text,
      candidateUse: "",
      shape: "",
    }),
  });

describe("RoleContinuityRepository", () => {
  it.effect(
    "serializes the Effect fallback when Web Locks are unavailable",
    () =>
      Effect.gen(function* () {
        const lock = yield* ContinuityLock;
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const events: Array<string> = [];
        const first = yield* lock
          .exclusive(
            Effect.gen(function* () {
              events.push("first:start");
              yield* Deferred.succeed(firstStarted, undefined);
              yield* Deferred.await(releaseFirst);
              events.push("first:end");
            }),
          )
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(firstStarted);
        const second = yield* lock
          .exclusive(
            Effect.sync(() => {
              events.push("second");
            }),
          )
          .pipe(Effect.forkChild({ startImmediately: true }));

        yield* Effect.yieldNow;
        expect(events).toEqual(["first:start"]);
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(events).toEqual(["first:start", "first:end", "second"]);
      }).pipe(Effect.provide(makeContinuityLockLayer(undefined))),
  );

  it.effect("loads missing and valid records without inventing state", () => {
    const missing = harness();
    return Effect.gen(function* () {
      const repository = yield* RoleContinuityRepository;
      expect(yield* repository.load).toEqual({ status: "empty" });

      const saved = yield* repository.save(0, changed(0, "persist me"));
      expect(saved.generation).toBe(1);
      expect(yield* repository.load).toEqual({
        status: "ready",
        record: saved,
      });
    }).pipe(Effect.provide(missing.layer));
  });

  it.effect(
    "reports corrupt and incompatible records without replacing them",
    () => {
      const corrupt = harness("{bad");
      const incompatible = harness(
        JSON.stringify({ ...emptyRoleContinuityRecord(0), version: 2 }),
      );
      return Effect.gen(function* () {
        const corruptResult = yield* Effect.gen(function* () {
          return yield* (yield* RoleContinuityRepository).load;
        }).pipe(Effect.provide(corrupt.layer));
        expect(corruptResult).toEqual({
          status: "recovery",
          reason: "corrupt-record",
        });
        expect(corrupt.stored()).toBe("{bad");

        const incompatibleResult = yield* Effect.gen(function* () {
          return yield* (yield* RoleContinuityRepository).load;
        }).pipe(Effect.provide(incompatible.layer));
        expect(incompatibleResult).toEqual({
          status: "recovery",
          reason: "incompatible-record",
        });
        expect(incompatible.stored()).not.toBeNull();
      });
    },
  );

  it.effect("rejects stale writes and preserves the newer record", () => {
    const state = harness();
    return Effect.gen(function* () {
      const repository = yield* RoleContinuityRepository;
      const first = yield* repository.save(0, changed(0, "newer"));
      const conflict = yield* repository
        .save(0, changed(0, "stale"))
        .pipe(Effect.flip);

      expect(conflict._tag).toBe("ContinuityConflict");
      if (conflict._tag === "ContinuityConflict") {
        expect(conflict.expectedGeneration).toBe(0);
        expect(conflict.currentGeneration).toBe(1);
      }
      expect(yield* repository.load).toEqual({
        status: "ready",
        record: first,
      });
    }).pipe(Effect.provide(state.layer));
  });

  it.effect(
    "leaves the prior record intact when quota or storage rejects a write",
    () => {
      const previous = JSON.stringify(changed(1, "last known good"));
      const state = harness(previous, {
        write: () =>
          Effect.fail(
            InterfaceStorageError.make({
              message: "Interface storage is unavailable.",
            }),
          ),
      });
      return Effect.gen(function* () {
        const repository = yield* RoleContinuityRepository;
        const error = yield* repository
          .save(1, changed(1, "must not replace"))
          .pipe(Effect.flip);

        expect(error._tag).toBe("InterfaceStorageError");
        expect(state.stored()).toBe(previous);
      }).pipe(Effect.provide(state.layer));
    },
  );

  it.effect("discards only the continuity record", () => {
    const state = harness(JSON.stringify(changed(2, "discard")));
    return Effect.gen(function* () {
      const repository = yield* RoleContinuityRepository;
      yield* repository.discard;
      expect(state.stored()).toBeNull();
      expect(yield* repository.load).toEqual({ status: "empty" });
    }).pipe(Effect.provide(state.layer));
  });

  it.effect("exports only a schema-validated bounded record", () => {
    const valid = harness(JSON.stringify(changed(2, "exportable")));
    const corrupt = harness("{bad");
    return Effect.gen(function* () {
      const exported = yield* Effect.gen(function* () {
        return yield* (yield* RoleContinuityRepository).export;
      }).pipe(Effect.provide(valid.layer));
      expect(JSON.parse(exported)).toMatchObject({
        generation: 2,
        drafts: { acceptedUse: "exportable" },
      });

      const failure = yield* Effect.gen(function* () {
        return yield* (yield* RoleContinuityRepository).export;
      }).pipe(Effect.provide(corrupt.layer), Effect.flip);
      expect(failure._tag).toBe("InvalidRoleContinuity");
    });
  });
});
