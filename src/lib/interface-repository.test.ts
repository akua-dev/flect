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

const duplicateNodeSnapshot = ShapingSnapshot.make({
  ...snapshot,
  active: InterfaceRevision.make({
    ...snapshot.active,
    document: InterfaceDocument.make({
      version: 2,
      name: "Invalid workspace",
      root: {
        id: "root",
        type: "stack",
        direction: "column",
        gap: "lg",
        children: [
          {
            id: "duplicate",
            type: "text",
            text: "First",
            style: "body",
          },
          {
            id: "duplicate",
            type: "text",
            text: "Second",
            style: "body",
          },
        ],
      },
    }),
  }),
});

const invalidActiveStatusSnapshot = ShapingSnapshot.make({
  ...snapshot,
  active: InterfaceRevision.make({
    ...snapshot.active,
    status: "proposed",
  }),
});

const rejectedProposalSnapshot = ShapingSnapshot.make({
  ...snapshot,
  proposal: InterfaceRevision.make({
    ...snapshot.active,
    id: RevisionId.make("proposal-1"),
    parentId: snapshot.active.id,
    status: "rejected",
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
      remove: () => Effect.void,
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

  const invalidDocumentStorage = makeStorage(
    JSON.stringify(duplicateNodeSnapshot),
  );
  const invalidDocumentLayer = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(invalidDocumentStorage.layer));

  it.layer(invalidDocumentLayer)((it) => {
    it.effect("rejects schema-valid documents with invalid trees", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const loaded = yield* repository.load;

        assert.strictEqual(loaded.snapshot, undefined);
        assert.strictEqual(loaded.recovered, true);
      }),
    );
  });

  const invalidActiveStatusStorage = makeStorage(
    JSON.stringify(invalidActiveStatusSnapshot),
  );
  const invalidActiveStatusLayer = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(invalidActiveStatusStorage.layer));

  it.layer(invalidActiveStatusLayer)((it) => {
    it.effect("rejects snapshots with an unaccepted active revision", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const loaded = yield* repository.load;

        assert.strictEqual(loaded.snapshot, undefined);
        assert.strictEqual(loaded.recovered, true);
      }),
    );
  });

  const rejectedProposalStorage = makeStorage(
    JSON.stringify(rejectedProposalSnapshot),
  );
  const rejectedProposalLayer = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(rejectedProposalStorage.layer));

  it.layer(rejectedProposalLayer)((it) => {
    it.effect("rejects snapshots with a non-pending proposal", () =>
      Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const loaded = yield* repository.load;

        assert.strictEqual(loaded.snapshot, undefined);
        assert.strictEqual(loaded.recovered, true);
      }),
    );
  });
});
