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
import {
  makePersistentShapingKernelLayer,
  makeShapingKernelTestLayer,
  ShapingKernel,
} from "./shaping-kernel";

const customizedDocument = (headline: string) =>
  InterfaceDocument.make({
    version: 2,
    name: headline,
    root: {
      id: "root",
      type: "stack",
      direction: "column",
      gap: "lg",
      children: [
        {
          id: "headline",
          type: "text",
          text: headline,
          style: "headline",
        },
        {
          id: "prompt",
          type: "prompt",
          placeholder: "Describe what to shape",
        },
      ],
    },
  });

const makePersistentHarness = (initial: string | null = null) => {
  const stored = Ref.makeUnsafe<string | null>(initial);
  const storage = Layer.succeed(InterfaceStorage)({
    read: () => Ref.get(stored),
    write: (_key, value) => Ref.set(stored, value),
    remove: () => Effect.void,
  });
  const repository = makeInterfaceRepositoryLayer({
    safeMode: false,
  }).pipe(Layer.provide(storage));

  return makePersistentShapingKernelLayer({
    nextId: (() => {
      let sequence = 0;
      return () => {
        sequence += 1;
        return `revision-${sequence}`;
      };
    })(),
    now: () => 1,
  }).pipe(Layer.provideMerge(repository));
};

describe("ShapingKernel", () => {
  it.layer(makeShapingKernelTestLayer())((it) => {
    it.effect("proposes without changing the active interface", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const proposal = yield* kernel.propose(
          customizedDocument("A focused workspace"),
          "shaper",
        );
        const snapshot = yield* kernel.snapshot;

        assert.deepStrictEqual(
          snapshot.active.document,
          defaultInterfaceDocument,
        );
        assert.strictEqual(snapshot.proposal?.id, proposal.id);
        assert.strictEqual(snapshot.proposal?.status, "proposed");
        assert.strictEqual(snapshot.lastEvent.type, "revision-proposed");
      }),
    );
  });

  const restoredDocument = customizedDocument("Restored workspace");
  const restoredSnapshot = ShapingSnapshot.make({
    version: 1,
    active: InterfaceRevision.make({
      version: 1,
      id: RevisionId.make("revision-2"),
      parentId: RevisionId.make("revision-1"),
      status: "accepted",
      source: "shaper",
      document: restoredDocument,
      createdAt: 2,
    }),
    lastKnownGood: InterfaceRevision.make({
      version: 1,
      id: RevisionId.make("revision-1"),
      status: "accepted",
      source: "built-in",
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

  it.layer(makePersistentHarness(JSON.stringify(restoredSnapshot)))((it) => {
    it.effect("restores the active and last-known-good journal state", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const snapshot = yield* kernel.snapshot;

        assert.deepStrictEqual(snapshot.active.document, restoredDocument);
        assert.deepStrictEqual(
          snapshot.lastKnownGood.document,
          defaultInterfaceDocument,
        );
        assert.strictEqual(snapshot.lastEvent.sequence, 4);
      }),
    );
  });

  it.layer(makePersistentHarness())((it) => {
    it.effect("persists accepted revisions as one journal transaction", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const repository = yield* InterfaceRepository;
        const proposal = yield* kernel.propose(
          customizedDocument("Persisted workspace"),
          "shaper",
        );
        yield* kernel.preview(proposal.id);
        yield* kernel.accept(proposal.id);

        const current = yield* kernel.snapshot;
        const persisted = yield* repository.load;

        assert.deepStrictEqual(persisted.snapshot, current);
      }),
    );
  });

  it.layer(makeShapingKernelTestLayer())((it) => {
    it.effect("previews and accepts a validated proposal atomically", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const document = customizedDocument("A focused workspace");
        const proposal = yield* kernel.propose(document, "shaper");

        yield* kernel.preview(proposal.id);
        const preview = yield* kernel.snapshot;
        assert.strictEqual(preview.proposal?.status, "previewed");
        assert.deepStrictEqual(
          preview.active.document,
          defaultInterfaceDocument,
        );

        const accepted = yield* kernel.accept(proposal.id);
        const snapshot = yield* kernel.snapshot;
        assert.strictEqual(accepted.status, "accepted");
        assert.deepStrictEqual(snapshot.active.document, document);
        assert.strictEqual(snapshot.proposal, undefined);
        assert.deepStrictEqual(
          snapshot.lastKnownGood.document,
          defaultInterfaceDocument,
        );
      }),
    );
  });

  it.layer(makeShapingKernelTestLayer())((it) => {
    it.effect("rejects a proposal without changing the active interface", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const proposal = yield* kernel.propose(
          customizedDocument("Rejected"),
          "user",
        );

        yield* kernel.reject(proposal.id);
        const snapshot = yield* kernel.snapshot;

        assert.deepStrictEqual(
          snapshot.active.document,
          defaultInterfaceDocument,
        );
        assert.strictEqual(snapshot.proposal, undefined);
        assert.strictEqual(snapshot.lastEvent.type, "revision-rejected");
      }),
    );
  });

  it.layer(makeShapingKernelTestLayer())((it) => {
    it.effect("rolls back to the last-known-good interface", () =>
      Effect.gen(function* () {
        const kernel = yield* ShapingKernel;
        const firstDocument = customizedDocument("First");
        const first = yield* kernel.propose(firstDocument, "user");
        yield* kernel.preview(first.id);
        yield* kernel.accept(first.id);

        const second = yield* kernel.propose(
          customizedDocument("Second"),
          "shaper",
        );
        yield* kernel.preview(second.id);
        yield* kernel.accept(second.id);
        yield* kernel.rollback;

        const snapshot = yield* kernel.snapshot;
        assert.deepStrictEqual(snapshot.active.document, firstDocument);
        assert.strictEqual(snapshot.safeMode, false);
        assert.strictEqual(snapshot.lastEvent.type, "revision-rolled-back");
      }),
    );
  });

  it.layer(makeShapingKernelTestLayer())((it) => {
    it.effect(
      "requests recovery once after three consecutive extension failures",
      () =>
        Effect.gen(function* () {
          const kernel = yield* ShapingKernel;

          yield* kernel.recordExtensionFailure("weather-card");
          yield* kernel.recordExtensionSuccess("weather-card");
          yield* kernel.recordExtensionFailure("weather-card");
          yield* kernel.recordExtensionFailure("weather-card");
          const beforeThreshold = yield* kernel.snapshot;

          assert.strictEqual(beforeThreshold.safeMode, false);

          yield* kernel.recordExtensionFailure("weather-card");

          const snapshot = yield* kernel.snapshot;
          assert.strictEqual(snapshot.safeMode, true);
          assert.deepStrictEqual(snapshot.disabledExtensions, ["weather-card"]);
          assert.deepStrictEqual(
            snapshot.active.document,
            defaultInterfaceDocument,
          );
          assert.strictEqual(snapshot.lastEvent.type, "recovery-requested");

          const recoverySequence = snapshot.lastEvent.sequence;
          yield* kernel.recordExtensionFailure("weather-card");
          const repeated = yield* kernel.snapshot;

          assert.strictEqual(repeated.lastEvent.sequence, recoverySequence);
          assert.strictEqual(repeated.lastEvent.type, "recovery-requested");
        }),
    );
  });
});
