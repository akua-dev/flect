import { Context, Effect, Layer, Schema, Stream, SubscriptionRef } from "effect";
import {
  defaultInterfaceDocument,
  type InterfaceNode,
  type InterfaceDocument,
  type InvalidInterfaceDocument,
  validateInterfaceDocument,
} from "../../shared/interface-document";
import {
  InterfaceRevision,
  InvalidRevisionTransition,
  isRollbackAvailable,
  RevisionId,
  RevisionNotFound,
  ShapingEvent,
  ShapingSnapshot,
} from "../../shared/revisions";
import type {
  CapabilityIntent,
  ExtensionIntentContext,
} from "../../shared/sandbox";
import {
  InterfaceRepository,
  type InterfaceRepositoryShape,
} from "./interface-repository";
import type { InterfaceStorageError } from "./interface-store";

type RevisionSource =
  | "built-in"
  | "user"
  | "shaper"
  | "extension"
  | "recovery";
type TransitionError =
  | RevisionNotFound
  | InvalidRevisionTransition
  | InterfaceStorageError;

export class ExtensionIntentRejected extends Schema.TaggedErrorClass<ExtensionIntentRejected>()(
  "ExtensionIntentRejected",
  {
    reason: Schema.Literals([
      "empty",
      "safe-mode",
      "proposal-required",
      "proposal-active",
      "target-not-found",
    ]),
    message: Schema.Literal("The extension interface intent was rejected."),
  },
) {}

interface KernelState {
  readonly active: InterfaceRevision;
  readonly lastKnownGood: InterfaceRevision;
  readonly proposal: InterfaceRevision | undefined;
  readonly safeMode: boolean;
  readonly disabledExtensions: ReadonlyArray<string>;
  readonly failureCounts: ReadonlyMap<string, number>;
  readonly sequence: number;
  readonly lastEvent: ShapingEvent;
}

export interface ShapingKernelShape {
  readonly snapshot: Effect.Effect<ShapingSnapshot>;
  readonly changes: Stream.Stream<ShapingSnapshot>;
  readonly propose: (
    document: unknown,
    source: Exclude<RevisionSource, "built-in">,
  ) => Effect.Effect<
    InterfaceRevision,
    InvalidInterfaceDocument | InvalidRevisionTransition | InterfaceStorageError
  >;
  readonly applyExtensionIntents: (
    context: ExtensionIntentContext,
    intents: ReadonlyArray<CapabilityIntent>,
  ) => Effect.Effect<
    InterfaceRevision,
    | InvalidInterfaceDocument
    | InvalidRevisionTransition
    | InterfaceStorageError
    | ExtensionIntentRejected
  >;
  readonly preview: (
    id: RevisionId,
  ) => Effect.Effect<InterfaceRevision, TransitionError>;
  readonly supersede: (
    id: RevisionId,
    document: unknown,
    source: Exclude<RevisionSource, "built-in">,
  ) => Effect.Effect<
    InterfaceRevision,
    InvalidInterfaceDocument | TransitionError
  >;
  readonly accept: (
    id: RevisionId,
  ) => Effect.Effect<InterfaceRevision, TransitionError>;
  readonly reject: (
    id: RevisionId,
  ) => Effect.Effect<InterfaceRevision, TransitionError>;
  readonly rollback: Effect.Effect<
    InterfaceRevision,
    InvalidRevisionTransition | InterfaceStorageError
  >;
  readonly restoreLastKnownGood: Effect.Effect<
    InterfaceRevision,
    InvalidRevisionTransition | InterfaceStorageError
  >;
  readonly enterSafeMode: Effect.Effect<void, InterfaceStorageError>;
  readonly recordExtensionFailure: (
    extensionId: string,
  ) => Effect.Effect<void, InterfaceStorageError>;
  readonly recordExtensionSuccess: (
    extensionId: string,
  ) => Effect.Effect<void, InterfaceStorageError>;
}

export class ShapingKernel extends Context.Service<
  ShapingKernel,
  ShapingKernelShape
>()("flect/ShapingKernel") {}

export interface ShapingKernelOptions {
  readonly initialDocument?: InterfaceDocument;
  readonly nextId?: () => string;
  readonly now?: () => number;
}

const snapshotFromState = (state: KernelState) =>
  ShapingSnapshot.make({
    version: 1,
    active: state.active,
    lastKnownGood: state.lastKnownGood,
    ...(state.proposal === undefined ? {} : { proposal: state.proposal }),
    safeMode: state.safeMode,
    disabledExtensions: state.disabledExtensions,
    lastEvent: state.lastEvent,
  });

const missingRevision = (id: RevisionId) =>
  RevisionNotFound.make({
    id,
    message: "The interface revision was not found.",
  });

const invalidTransition = (id: RevisionId) =>
  InvalidRevisionTransition.make({
    id,
    message: "The interface revision cannot make that transition.",
  });

const extensionIntentRejected = (
  reason: ExtensionIntentRejected["reason"],
) =>
  ExtensionIntentRejected.make({
    reason,
    message: "The extension interface intent was rejected.",
  });

const replaceTextNode = (
  node: InterfaceNode,
  target: string,
  text: string,
): readonly [InterfaceNode, boolean] => {
  if (node.type === "stack") {
    let changed = false;
    const children = node.children.map((child) => {
      const [next, replaced] = replaceTextNode(child, target, text);
      changed = changed || replaced;
      return next;
    });
    return [changed ? { ...node, children } : node, changed];
  }
  return node.type === "text" && node.id === target
    ? [{ ...node, text }, true]
    : [node, false];
};

const makeShapingKernel = (
  options: ShapingKernelOptions,
  repository?: InterfaceRepositoryShape,
) =>
  Effect.gen(function* () {
    const initialDocument = options.initialDocument ?? defaultInterfaceDocument;
    const now = options.now ?? Date.now;
    const initialRevision = InterfaceRevision.make({
      version: 1,
      id: RevisionId.make("built-in"),
      status: "accepted",
      source: "built-in",
      document: initialDocument,
      createdAt: 0,
    });
    const initialEvent = ShapingEvent.make({
      version: 1,
      sequence: 0,
      type: "initialized",
      revisionId: initialRevision.id,
    });
    const loaded =
      repository === undefined ? undefined : yield* repository.load;
    const restored = loaded?.snapshot;
    const recovered = loaded?.recovered ?? false;
    const recoveryRequested = loaded?.recovery === true;
    const forcedSafeMode = recovered || recoveryRequested;
    const initialState: KernelState =
      restored === undefined
        ? {
            active: initialRevision,
            lastKnownGood: initialRevision,
            proposal: undefined,
            safeMode: forcedSafeMode,
            disabledExtensions: [],
            failureCounts: new Map(),
            sequence: forcedSafeMode ? 1 : 0,
            lastEvent: forcedSafeMode
              ? ShapingEvent.make({
                  version: 1,
                  sequence: 1,
                  type: "safe-mode-entered",
                  revisionId: initialRevision.id,
                })
              : initialEvent,
          }
        : {
            active:
              restored.safeMode || forcedSafeMode
                ? initialRevision
                : restored.active,
            lastKnownGood: restored.lastKnownGood,
            proposal:
              restored.safeMode || forcedSafeMode
                ? undefined
                : restored.proposal,
            safeMode: restored.safeMode || forcedSafeMode,
            disabledExtensions: restored.disabledExtensions,
            failureCounts: new Map(),
            sequence: restored.lastEvent.sequence,
            lastEvent: restored.lastEvent,
          };
    const pendingProposal =
      initialState.proposal?.status === "proposed"
        ? initialState.proposal
        : undefined;
    const reconciledState =
      pendingProposal === undefined
        ? initialState
        : {
            ...initialState,
            proposal: InterfaceRevision.make({
              ...pendingProposal,
              status: "previewed",
            }),
            sequence: initialState.sequence + 1,
            lastEvent: ShapingEvent.make({
              version: 1,
              sequence: initialState.sequence + 1,
              type: "revision-previewed",
              revisionId: pendingProposal.id,
            }),
          };
    let idSequence = reconciledState.sequence;
    const nextId =
      options.nextId ??
      (() => {
        idSequence += 1;
        return `revision-${idSequence}`;
      });
    const stateRef = yield* SubscriptionRef.make<KernelState>(reconciledState);
    const persist = Effect.fn("Flect.ShapingKernel.persist")(
      (state: KernelState) =>
        repository === undefined
          ? Effect.void
          : repository
              .save(snapshotFromState(state))
              .pipe(
                Effect.andThen(
                  state.safeMode
                    ? Effect.void
                    : (repository.clearRecovery ?? Effect.void),
                ),
              ),
    );
    const markRecovery = repository?.markRecovery ?? Effect.void;
    if (pendingProposal !== undefined) {
      yield* persist(reconciledState).pipe(
        Effect.catchTag("InterfaceStorageError", () => Effect.void),
      );
    }

    const eventFor = (
      state: KernelState,
      type: ShapingEvent["type"],
      fields: {
        readonly revisionId?: RevisionId;
        readonly extensionId?: string;
        readonly operationId?: string;
      } = {},
    ) =>
      ShapingEvent.make({
        version: 1,
        sequence: state.sequence + 1,
        type,
        ...fields,
      });

    const propose = Effect.fn("Flect.ShapingKernel.propose")(function* (
      input: unknown,
      source: Exclude<RevisionSource, "built-in">,
    ) {
      const document = yield* validateInterfaceDocument(input);
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          InvalidRevisionTransition | InterfaceStorageError
        > => {
          const id = state.proposal?.id ?? RevisionId.make(nextId());
          if (state.safeMode || state.proposal !== undefined) {
            return Effect.fail(invalidTransition(id));
          }
          const revision = InterfaceRevision.make({
            version: 1,
            id,
            parentId: state.active.id,
            status: "proposed",
            source,
            document,
            createdAt: now(),
          });
          const next: KernelState = {
            ...state,
            proposal: revision,
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-proposed", {
              revisionId: revision.id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            revision,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const applyExtensionIntents = Effect.fn(
      "Flect.ShapingKernel.applyExtensionIntents",
    )(function* (
      context: ExtensionIntentContext,
      intents: ReadonlyArray<CapabilityIntent>,
    ) {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (state): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          | InvalidInterfaceDocument
          | InvalidRevisionTransition
          | InterfaceStorageError
          | ExtensionIntentRejected
        > => {
          if (intents.length === 0) {
            return Effect.fail(extensionIntentRejected("empty"));
          }
          if (state.safeMode) {
            return Effect.fail(extensionIntentRejected("safe-mode"));
          }
          if (context.binding === "candidate") {
            if (
              state.proposal === undefined ||
              state.proposal.status !== "previewed"
            ) {
              return Effect.fail(extensionIntentRejected("proposal-required"));
            }
          } else if (state.proposal !== undefined) {
            return Effect.fail(extensionIntentRejected("proposal-active"));
          }

          const base =
            context.binding === "candidate"
              ? state.proposal
              : state.active;
          if (base === undefined) {
            return Effect.fail(extensionIntentRejected("proposal-required"));
          }
          return Effect.gen(function* () {
            let root = base.document.root;
            for (const intent of intents) {
              switch (intent.type) {
                case "set-text": {
                  const [next, replaced] = replaceTextNode(
                    root,
                    intent.target,
                    intent.text,
                  );
                  if (!replaced) {
                    return yield* Effect.fail(
                      extensionIntentRejected("target-not-found"),
                    );
                  }
                  root = next;
                  break;
                }
              }
            }
            const document = yield* validateInterfaceDocument({
              ...base.document,
              root,
            });
            const id = RevisionId.make(nextId());
            const previewed = context.binding === "candidate";
            const revision = InterfaceRevision.make({
              version: 1,
              id,
              parentId: state.active.id,
              status: previewed ? "previewed" : "proposed",
              source: "extension",
              document,
              createdAt: now(),
            });
            const failureCounts = new Map(state.failureCounts);
            failureCounts.delete(context.extensionId);
            const next: KernelState = {
              ...state,
              proposal: revision,
              failureCounts,
              sequence: state.sequence + 1,
              lastEvent: eventFor(
                state,
                previewed ? "revision-previewed" : "revision-proposed",
                {
                  revisionId: id,
                  extensionId: context.extensionId,
                  operationId: context.operationId,
                },
              ),
            };
            return yield* persist(next).pipe(
              Effect.as([revision, next] as const),
            );
          });
        },
      );
    });

    const preview = Effect.fn("Flect.ShapingKernel.preview")(function* (
      id: RevisionId,
    ) {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          TransitionError
        > => {
          const proposal = state.proposal;
          if (proposal === undefined || proposal.id !== id) {
            return Effect.fail(missingRevision(id));
          }
          if (proposal.status !== "proposed") {
            return Effect.fail(invalidTransition(id));
          }
          const previewed = InterfaceRevision.make({
            ...proposal,
            status: "previewed",
          });
          const next: KernelState = {
            ...state,
            proposal: previewed,
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-previewed", {
              revisionId: id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            previewed,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const supersede = Effect.fn("Flect.ShapingKernel.supersede")(function* (
      id: RevisionId,
      input: unknown,
      source: Exclude<RevisionSource, "built-in">,
    ) {
      const document = yield* validateInterfaceDocument(input);
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          TransitionError
        > => {
          const proposal = state.proposal;
          if (proposal === undefined || proposal.id !== id) {
            return Effect.fail(missingRevision(id));
          }
          if (state.safeMode || proposal.status !== "previewed") {
            return Effect.fail(invalidTransition(id));
          }
          const revision = InterfaceRevision.make({
            version: 1,
            id: RevisionId.make(nextId()),
            parentId: state.active.id,
            status: "previewed",
            source,
            document,
            createdAt: now(),
          });
          const next: KernelState = {
            ...state,
            proposal: revision,
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-previewed", {
              revisionId: revision.id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            revision,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const accept = Effect.fn("Flect.ShapingKernel.accept")(function* (
      id: RevisionId,
    ) {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          TransitionError
        > => {
          const proposal = state.proposal;
          if (proposal === undefined || proposal.id !== id) {
            return Effect.fail(missingRevision(id));
          }
          if (proposal.status !== "previewed") {
            return Effect.fail(invalidTransition(id));
          }
          const accepted = InterfaceRevision.make({
            ...proposal,
            status: "accepted",
          });
          const next: KernelState = {
            ...state,
            active: accepted,
            lastKnownGood: state.active,
            proposal: undefined,
            safeMode: false,
            failureCounts: new Map(),
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-accepted", {
              revisionId: id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            accepted,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const reject = Effect.fn("Flect.ShapingKernel.reject")(function* (
      id: RevisionId,
    ) {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          TransitionError
        > => {
          const proposal = state.proposal;
          if (proposal === undefined || proposal.id !== id) {
            return Effect.fail(missingRevision(id));
          }
          const rejected = InterfaceRevision.make({
            ...proposal,
            status: "rejected",
          });
          const next: KernelState = {
            ...state,
            proposal: undefined,
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-rejected", {
              revisionId: id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            rejected,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const restoreLastKnownGood = Effect.fn(
      "Flect.ShapingKernel.restoreLastKnownGood",
    )(function* () {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          InvalidRevisionTransition | InterfaceStorageError
        > => {
          if (!state.safeMode) {
            return Effect.fail(invalidTransition(state.active.id));
          }
          const recovered = InterfaceRevision.make({
            ...state.lastKnownGood,
            source: "recovery",
            status: "accepted",
          });
          const next: KernelState = {
            ...state,
            active: recovered,
            lastKnownGood: recovered,
            proposal: undefined,
            safeMode: false,
            failureCounts: new Map(),
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-rolled-back", {
              revisionId: recovered.id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            recovered,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const rollback = Effect.fn("Flect.ShapingKernel.rollback")(function* () {
      return yield* SubscriptionRef.modifyEffect(
        stateRef,
        (
          state,
        ): Effect.Effect<
          readonly [InterfaceRevision, KernelState],
          InvalidRevisionTransition | InterfaceStorageError
        > => {
          if (!isRollbackAvailable(snapshotFromState(state))) {
            return Effect.fail(invalidTransition(state.active.id));
          }
          const recovered = InterfaceRevision.make({
            ...state.lastKnownGood,
            source: "recovery",
            status: "accepted",
          });
          const next: KernelState = {
            ...state,
            active: recovered,
            lastKnownGood: recovered,
            proposal: undefined,
            safeMode: false,
            failureCounts: new Map(),
            sequence: state.sequence + 1,
            lastEvent: eventFor(state, "revision-rolled-back", {
              revisionId: recovered.id,
            }),
          };
          const transition: readonly [InterfaceRevision, KernelState] = [
            recovered,
            next,
          ];
          return persist(next).pipe(Effect.as(transition));
        },
      );
    });

    const enterSafeMode = Effect.fn("Flect.ShapingKernel.enterSafeMode")(
      function* () {
        const marker = yield* markRecovery.pipe(Effect.result);
        const persisted = yield* SubscriptionRef.modifyEffect(
          stateRef,
          (state) => {
            const next: KernelState = {
              ...state,
              active: initialRevision,
              proposal: undefined,
              safeMode: true,
              sequence: state.sequence + 1,
              lastEvent: eventFor(state, "safe-mode-entered", {
                revisionId: state.lastKnownGood.id,
              }),
            };
            return persist(next).pipe(
              Effect.result,
              Effect.map((result) => [result, next] as const),
            );
          },
        );
        if (persisted._tag === "Failure") {
          return yield* Effect.fail(persisted.failure);
        }
        if (marker._tag === "Failure") {
          return yield* Effect.fail(marker.failure);
        }
      },
    );

    const recordExtensionFailure = Effect.fn(
      "Flect.ShapingKernel.recordExtensionFailure",
    )(function* (extensionId: string) {
      yield* SubscriptionRef.modifyEffect(stateRef, (state) => {
        if (state.disabledExtensions.includes(extensionId)) {
          return Effect.succeed([undefined, state] satisfies readonly [
            undefined,
            KernelState,
          ]);
        }

        const failureCounts = new Map(state.failureCounts);
        const failures = (failureCounts.get(extensionId) ?? 0) + 1;
        failureCounts.set(extensionId, failures);
        const shouldRecover = failures >= 3;
        const disabledExtensions =
          shouldRecover && !state.disabledExtensions.includes(extensionId)
            ? [...state.disabledExtensions, extensionId]
            : state.disabledExtensions;

        const next: KernelState = {
          ...state,
          active: shouldRecover ? initialRevision : state.active,
          proposal: shouldRecover ? undefined : state.proposal,
          safeMode: shouldRecover || state.safeMode,
          disabledExtensions,
          failureCounts,
          sequence: state.sequence + 1,
          lastEvent: eventFor(
            state,
            shouldRecover ? "recovery-requested" : "extension-failed",
            {
              extensionId,
              ...(shouldRecover ? { revisionId: state.lastKnownGood.id } : {}),
            },
          ),
        };
        const transition: readonly [undefined, KernelState] = [undefined, next];
        if (shouldRecover) {
          return markRecovery.pipe(
            Effect.andThen(persist(next).pipe(Effect.result)),
            Effect.map((result) => [result, next] as const),
          );
        }
        return persist(next).pipe(Effect.as(transition));
      });
    });

    const recordExtensionSuccess = Effect.fn(
      "Flect.ShapingKernel.recordExtensionSuccess",
    )(function* (extensionId: string) {
      yield* SubscriptionRef.modifyEffect(stateRef, (state) => {
        if (!state.failureCounts.has(extensionId)) {
          return Effect.succeed([undefined, state] satisfies readonly [
            undefined,
            KernelState,
          ]);
        }
        const failureCounts = new Map(state.failureCounts);
        failureCounts.delete(extensionId);
        const next: KernelState = {
          ...state,
          failureCounts,
        };
        const transition: readonly [undefined, KernelState] = [undefined, next];
        return persist(next).pipe(Effect.as(transition));
      });
    });

    return {
      snapshot: SubscriptionRef.get(stateRef).pipe(
        Effect.map(snapshotFromState),
      ),
      changes: SubscriptionRef.changes(stateRef).pipe(
        Stream.map(snapshotFromState),
      ),
      propose,
      applyExtensionIntents,
      preview,
      supersede,
      accept,
      reject,
      rollback: rollback(),
      restoreLastKnownGood: restoreLastKnownGood(),
      enterSafeMode: enterSafeMode(),
      recordExtensionFailure,
      recordExtensionSuccess,
    };
  });

export const makeShapingKernelLayer = (options: ShapingKernelOptions = {}) =>
  Layer.effect(ShapingKernel, makeShapingKernel(options));

export const makePersistentShapingKernelLayer = (
  options: ShapingKernelOptions = {},
) =>
  Layer.effect(
    ShapingKernel,
    Effect.gen(function* () {
      const repository = yield* InterfaceRepository;
      return yield* makeShapingKernel(options, repository);
    }),
  );

export const makeShapingKernelTestLayer = () => {
  let sequence = 0;
  return makeShapingKernelLayer({
    nextId: () => {
      sequence += 1;
      return `revision-${sequence}`;
    },
    now: () => sequence,
  });
};
