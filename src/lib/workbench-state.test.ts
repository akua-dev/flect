import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
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
  initialWorkbenchState,
  selectWorkbenchTarget,
  synchronizeWorkbenchState,
} from "./workbench-state";

const acceptedDocument = InterfaceDocument.make({
  ...defaultInterfaceDocument,
  name: "Accepted product",
});

const accepted = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("revision-accepted"),
  status: "accepted",
  source: "user",
  document: acceptedDocument,
  createdAt: 1,
});

const builtIn = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("built-in"),
  status: "accepted",
  source: "built-in",
  document: defaultInterfaceDocument,
  createdAt: 0,
});

const shaping = (
  active: InterfaceRevision,
  proposal?: InterfaceRevision,
  safeMode = false,
) =>
  ShapingSnapshot.make({
    version: 1,
    active,
    lastKnownGood: active,
    ...(proposal === undefined ? {} : { proposal }),
    safeMode,
    disabledExtensions: [],
    lastEvent: ShapingEvent.make({
      version: 1,
      sequence: proposal === undefined ? 0 : 1,
      type: proposal === undefined ? "initialized" : "revision-previewed",
      revisionId: proposal?.id ?? active.id,
    }),
  });

const candidate = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("revision-candidate"),
  parentId: accepted.id,
  status: "previewed",
  source: "shaper",
  document: InterfaceDocument.make({
    ...acceptedDocument,
    name: "Candidate product",
  }),
  createdAt: 2,
});

describe("workbench state", () => {
  it("starts blank workspaces in Shape and accepted products in Use", () => {
    const blank = initialWorkbenchState(shaping(builtIn));
    const product = initialWorkbenchState(shaping(accepted));

    assert.strictEqual(blank.target, "shape");
    assert.strictEqual(blank.binding, "accepted");
    assert.strictEqual(product.target, "use");
    assert.strictEqual(product.binding, "accepted");
  });

  it("selects candidate Use as soon as a preview exists", () => {
    const current = initialWorkbenchState(shaping(accepted));
    const next = synchronizeWorkbenchState(
      current,
      shaping(accepted, candidate),
    );

    assert.strictEqual(next.target, "use");
    assert.strictEqual(next.binding, "candidate");
    assert.strictEqual(next.candidateRevisionId, candidate.id);
    assert.strictEqual(next.transitionSequence, 1);
  });

  it.effect(
    "supports rapid explicit Shape and Use selection on a candidate",
    () =>
      Effect.gen(function* () {
        const preview = shaping(accepted, candidate);
        const current = initialWorkbenchState(preview);
        const shape = yield* selectWorkbenchTarget(
          current,
          "shape",
          preview,
          0,
        );
        const use = yield* selectWorkbenchTarget(shape, "use", preview, 1);

        assert.strictEqual(shape.target, "shape");
        assert.strictEqual(shape.binding, "candidate");
        assert.strictEqual(use.target, "use");
        assert.strictEqual(use.binding, "candidate");
        assert.strictEqual(use.transitionSequence, 2);
      }),
  );

  it.effect("rejects blank Use, stale selection, and safe-mode selection", () =>
    Effect.gen(function* () {
      const blankSnapshot = shaping(builtIn);
      const blank = initialWorkbenchState(blankSnapshot);
      const unavailable = yield* selectWorkbenchTarget(
        blank,
        "use",
        blankSnapshot,
        0,
      ).pipe(Effect.flip);

      const productSnapshot = shaping(accepted);
      const product = initialWorkbenchState(productSnapshot);
      const stale = yield* selectWorkbenchTarget(
        product,
        "shape",
        productSnapshot,
        4,
      ).pipe(Effect.flip);
      const safe = yield* selectWorkbenchTarget(
        product,
        "shape",
        shaping(accepted, undefined, true),
        0,
      ).pipe(Effect.flip);

      assert.strictEqual(unavailable._tag, "WorkbenchTargetUnavailable");
      assert.strictEqual(stale._tag, "WorkbenchTransitionConflict");
      assert.strictEqual(safe._tag, "WorkbenchTargetUnavailable");
    }),
  );

  it("returns deterministically to accepted Use after candidate removal", () => {
    const preview = initialWorkbenchState(shaping(accepted, candidate));
    const next = synchronizeWorkbenchState(preview, shaping(accepted));

    assert.strictEqual(next.target, "use");
    assert.strictEqual(next.binding, "accepted");
    assert.strictEqual(next.candidateRevisionId, undefined);
    assert.strictEqual(next.transitionSequence, 1);
  });
});
