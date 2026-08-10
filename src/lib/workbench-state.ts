import { Effect, Schema } from "effect";
import {
  type WorkbenchHandoff,
  WorkbenchSnapshot,
  type WorkbenchTarget,
} from "../../shared/control";
import type { ShapingSnapshot } from "../../shared/revisions";

export class WorkbenchTargetUnavailable extends Schema.TaggedErrorClass<WorkbenchTargetUnavailable>()(
  "WorkbenchTargetUnavailable",
  {
    message: Schema.String,
  },
) {}

export class WorkbenchTransitionConflict extends Schema.TaggedErrorClass<WorkbenchTransitionConflict>()(
  "WorkbenchTransitionConflict",
  {
    expectedSequence: Schema.Int,
    currentSequence: Schema.Int,
    message: Schema.Literal("The workbench changed before the transition ran."),
  },
) {}

const hasUsableProduct = (shaping: ShapingSnapshot) =>
  shaping.proposal !== undefined || shaping.active.source !== "built-in";

const bindingFrom = (shaping: ShapingSnapshot) =>
  shaping.proposal === undefined
    ? ("accepted" as const)
    : ("candidate" as const);

const makeSnapshot = (
  target: WorkbenchTarget,
  shaping: ShapingSnapshot,
  transitionSequence: number,
  handoff?: WorkbenchHandoff,
) =>
  WorkbenchSnapshot.make({
    target,
    binding: bindingFrom(shaping),
    transitionSequence,
    ...(shaping.proposal === undefined
      ? {}
      : { candidateRevisionId: shaping.proposal.id }),
    ...(handoff === undefined ? {} : { handoff }),
  });

export const initialWorkbenchState = (
  shaping: ShapingSnapshot,
): WorkbenchSnapshot =>
  makeSnapshot(
    shaping.proposal !== undefined || hasUsableProduct(shaping)
      ? "use"
      : "shape",
    shaping,
    0,
  );

export const selectWorkbenchTarget = Effect.fn("Flect.Workbench.selectTarget")(
  function* (
    current: WorkbenchSnapshot,
    target: WorkbenchTarget,
    shaping: ShapingSnapshot,
    expectedSequence: number,
  ) {
    yield* Effect.annotateCurrentSpan({
      target,
      binding: bindingFrom(shaping),
      transitionSequence: current.transitionSequence,
    });
    if (current.transitionSequence !== expectedSequence) {
      return yield* Effect.fail(
        WorkbenchTransitionConflict.make({
          expectedSequence,
          currentSequence: current.transitionSequence,
          message: "The workbench changed before the transition ran.",
        }),
      );
    }
    if (shaping.safeMode || (target === "use" && !hasUsableProduct(shaping))) {
      return yield* Effect.fail(
        WorkbenchTargetUnavailable.make({
          message: shaping.safeMode
            ? "Restore the interface before changing workbench targets."
            : "Shape a valid candidate before using this workspace.",
        }),
      );
    }
    if (
      current.target === target &&
      current.binding === bindingFrom(shaping) &&
      current.candidateRevisionId === shaping.proposal?.id
    ) {
      return current;
    }
    return makeSnapshot(target, shaping, current.transitionSequence + 1);
  },
);

export const synchronizeWorkbenchState = (
  current: WorkbenchSnapshot,
  shaping: ShapingSnapshot,
): WorkbenchSnapshot => {
  const target = hasUsableProduct(shaping) ? "use" : "shape";
  const binding = bindingFrom(shaping);
  const candidateRevisionId = shaping.proposal?.id;
  if (
    current.target === target &&
    current.binding === binding &&
    current.candidateRevisionId === candidateRevisionId
  ) {
    return current;
  }
  return makeSnapshot(
    target,
    shaping,
    current.transitionSequence + 1,
    current.handoff,
  );
};
