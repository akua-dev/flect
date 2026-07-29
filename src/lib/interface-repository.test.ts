import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import {
  InterfaceRevision,
  RevisionId,
  ShapingEvent,
  ShapingSnapshot,
} from "../../shared/revisions";
import {
  InterfaceRepository,
  makeInterfaceRepositoryLayer,
} from "./interface-repository";
import { InterfaceStorage } from "./interface-store";

const snapshot = ShapingSnapshot.make({
  version: 1,
  active: InterfaceRevision.make({
    version: 1,
    id: RevisionId.make("revision-2"),
    parentId: RevisionId.make("revision-1"),
    status: "accepted",
    source: "shaper",
    document: InterfaceDocument.make({
      ...defaultInterfaceDocument,
      name: "Focused workspace",
    }),
    createdAt: 2,
  }),
  lastKnownGood: InterfaceRevision.make({
    version: 1,
    id: RevisionId.make("revision-1"),
    status: "accepted",
    source: "user",
    document: defaultInterfaceDocument,
    createdAt: 1,
  }),
  safeMode: false,
  disabledExtensions: [],
  lastEvent: ShapingEvent.make({
    version: 1,
    sequence: 4,
    type: "revision-accepted",
    revisionId: RevisionId.make("revision-2"),
  }),
});

const makeStorage = (initial: string | null = null) => {
  const value = Ref.makeUnsafe<string | null>(initial);
  const reads = Ref.makeUnsafe(0);
  const writes = Ref.makeUnsafe(0);

  return {
    reads,
    writes,
    layer: Layer.succeed(InterfaceStorage)({
      read: () =>
        Ref.update(reads, (count) => count + 1).pipe(
          Effect.andThen(Ref.get(value)),
        ),
      write: (_key, next) =>
        Ref.update(writes, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(value, next)),
        ),
    }),
  };
};

describe("InterfaceRepository", () => {
  const roundTripStorage = makeStorage();
  const roundTripLayer = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(roundTripStorage.layer));

  it.layer(roundTripLayer)((it) => {
    it.effect("round-trips the validated revision journal", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        yield* repository.save(snapshot);
        const loaded = yield* repository.load;

        assert.deepStrictEqual(loaded.snapshot, snapshot);
        assert.strictEqual(loaded.recovered, false);
        assert.strictEqual(yield* Ref.get(roundTripStorage.writes), 1);
      }),
    );
  });

  const safeStorage = makeStorage(JSON.stringify(snapshot));
  const safeLayer = makeInterfaceRepositoryLayer({ safeMode: true }).pipe(
    Layer.provide(safeStorage.layer),
  );

  it.layer(safeLayer)((it) => {
    it.effect("bypasses journal storage entirely in safe mode", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const loaded = yield* repository.load;
        yield* repository.save(snapshot);

        assert.strictEqual(loaded.snapshot, undefined);
        assert.strictEqual(loaded.recovered, false);
        assert.strictEqual(yield* Ref.get(safeStorage.reads), 0);
        assert.strictEqual(yield* Ref.get(safeStorage.writes), 0);
      }),
    );
  });

  const corruptStorage = makeStorage("{not-json");
  const corruptLayer = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(corruptStorage.layer));

  it.layer(corruptLayer)((it) => {
    it.effect("fails closed when the persisted journal is corrupt", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const loaded = yield* repository.load;

        assert.strictEqual(loaded.snapshot, undefined);
        assert.strictEqual(loaded.recovered, true);
      }),
    );
  });
});
