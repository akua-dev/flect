import { Effect, Fiber, type ManagedRuntime, Stream } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrivateShareSourceSummary } from "../../packages/product/src/host/share-source";
import {
  type CapsuleIntent,
  CapsuleIntentFailed,
  type CapsuleIntentOutcome,
  CapsuleIntentSucceeded,
} from "../../shared/capsule-protocol";
import type {
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  ReasoningLevel,
} from "../../shared/contracts";
import {
  CapsuleCommandSource,
  type FlectCommand,
  FlectCommandEnvelope,
  type FlectCommandReceipt,
  type FlectWorkspaceSnapshot,
  ImportCapsule,
  InvokeProductOperation,
  UserCommandSource,
} from "../../shared/control";
import type { GitRepositoryStatus } from "../../shared/git-workspace";
import { ContinuityDrafts } from "../../shared/role-continuity";
import type { ProviderAuthUiState } from "../lib/agent-workspace";
import { flectRuntime } from "../lib/runtime";
import {
  type CapsulePresentationState,
  FlectWorkspaceController,
  type FlectWorkspaceControllerShape,
  type RoleContinuityUiState,
} from "../lib/workspace-controller";

export type WorkspaceRuntime = ManagedRuntime.ManagedRuntime<
  FlectWorkspaceController,
  unknown
>;

export interface WorkspaceController {
  readonly snapshot: FlectWorkspaceSnapshot | undefined;
  readonly providerAuth: ProviderAuthUiState;
  readonly privateShareSources: ReadonlyArray<PrivateShareSourceSummary>;
  readonly continuity: RoleContinuityUiState;
  readonly setDraft: (
    key: keyof ContinuityDrafts,
    value: string,
  ) => Promise<void>;
  readonly exportContinuity: () => Promise<string>;
  readonly exportRepository: () => Promise<Uint8Array>;
  readonly readShareExport: (shareId: string) => Promise<Uint8Array>;
  readonly exportCapsule: () => Promise<Uint8Array>;
  readonly importCapsule: (archive: Uint8Array) => Promise<FlectCommandReceipt>;
  readonly invokeCapsuleIntent: (
    capsuleId: string,
    binding: "accepted" | "candidate",
    intent: CapsuleIntent,
  ) => Promise<CapsuleIntentOutcome>;
  readonly capsulePresentation: CapsulePresentationState;
  readonly repository: GitRepositoryStatus | undefined;
  readonly discardContinuity: () => Promise<void>;
  readonly retryContinuity: () => Promise<void>;
  readonly dispatch: (
    command: FlectCommand,
    expectedSequence?: number,
  ) => Promise<FlectCommandReceipt>;
  readonly selectReasoning: (
    reasoningLevel: ReasoningLevel | undefined,
  ) => void;
  readonly loginProvider: (request: AuthLoginRequest) => void;
  readonly replyProviderAuth: (reply: AuthSelectionReply) => Promise<void>;
  readonly cancelProviderAuth: (reference: AuthLoginReference) => Promise<void>;
  readonly refreshProviderAuth: () => Promise<void>;
  readonly logoutProvider: (providerId: string) => Promise<void>;
}

export function useWorkspace(
  runtime: WorkspaceRuntime = flectRuntime,
): WorkspaceController {
  const [snapshot, setSnapshot] = useState<FlectWorkspaceSnapshot>();
  const [providerAuth, setProviderAuth] = useState<ProviderAuthUiState>({
    providers: [],
  });
  const [privateShareSources, setPrivateShareSources] = useState<
    ReadonlyArray<PrivateShareSourceSummary>
  >([]);
  const [continuity, setContinuity] = useState<RoleContinuityUiState>({
    drafts: ContinuityDrafts.make({
      acceptedUse: "",
      candidateUse: "",
      shape: "",
    }),
    generation: 0,
    revisionSequence: 0,
  });
  const [capsulePresentation, setCapsulePresentation] =
    useState<CapsulePresentationState>({});
  const snapshotRef = useRef<FlectWorkspaceSnapshot | undefined>(undefined);

  useEffect(() => {
    const subscription = Effect.gen(function* () {
      const controller = yield* FlectWorkspaceController;
      const [
        initial,
        initialProviderAuth,
        initialPrivateShareSources,
        initialContinuity,
        initialCapsule,
      ] = yield* Effect.all([
        controller.snapshot,
        controller.providerAuth,
        controller.privateShareSources ?? Effect.succeed([]),
        controller.continuity,
        controller.capsulePresentation ?? Effect.succeed({}),
      ]);
      yield* Effect.sync(() => {
        snapshotRef.current = initial;
        setSnapshot(initial);
        setProviderAuth(initialProviderAuth);
        setPrivateShareSources(initialPrivateShareSources);
        setContinuity(initialContinuity);
        setCapsulePresentation(initialCapsule);
      });
      yield* Effect.all(
        [
          controller.changes.pipe(
            Stream.runForEach((next) =>
              Effect.sync(() => {
                snapshotRef.current = next;
                setSnapshot(next);
              }),
            ),
          ),
          controller.providerAuthChanges.pipe(
            Stream.runForEach((next) =>
              Effect.sync(() => setProviderAuth(next)),
            ),
          ),
          controller.continuityChanges.pipe(
            Stream.runForEach((next) => Effect.sync(() => setContinuity(next))),
          ),
          ...(controller.capsulePresentationChanges === undefined
            ? []
            : [
                controller.capsulePresentationChanges.pipe(
                  Stream.runForEach((next) =>
                    Effect.sync(() => setCapsulePresentation(next)),
                  ),
                ),
              ]),
        ],
        { concurrency: "unbounded", discard: true },
      );
    });
    const fiber = runtime.runFork(subscription);
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, [runtime]);

  const dispatch = useCallback(
    (command: FlectCommand, expectedSequence?: number) => {
      const current = snapshotRef.current;
      if (current === undefined) {
        return Promise.reject(new Error("Flect workspace is opening."));
      }
      return runtime.runPromise(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          return yield* controller.dispatch(
            FlectCommandEnvelope.make({
              version: 1,
              commandId: `cmd-${crypto.randomUUID()}`,
              workspaceId: current.workspaceId,
              source: UserCommandSource.make({ kind: "user" }),
              ...(expectedSequence === undefined ? {} : { expectedSequence }),
              command,
            }),
          );
        }),
      );
    },
    [runtime],
  );

  const selectReasoning = useCallback(
    (reasoningLevel: ReasoningLevel | undefined) => {
      runtime.runFork(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          yield* controller.selectReasoning(reasoningLevel);
        }),
      );
    },
    [runtime],
  );

  const loginProvider = useCallback(
    (request: AuthLoginRequest) => {
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const controller = yield* FlectWorkspaceController;
            yield* controller.loginProvider(request);
          }),
        )
        .catch(() => undefined);
    },
    [runtime],
  );

  const runProviderAction = useCallback(
    <A, E>(
      use: (controller: FlectWorkspaceControllerShape) => Effect.Effect<A, E>,
    ) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          yield* use(controller);
        }),
      ),
    [runtime],
  );

  const replyProviderAuth = useCallback(
    (reply: AuthSelectionReply) =>
      runProviderAction((controller) => controller.replyProviderAuth(reply)),
    [runProviderAction],
  );
  const cancelProviderAuth = useCallback(
    (reference: AuthLoginReference) =>
      runProviderAction((controller) =>
        controller.cancelProviderAuth(reference),
      ),
    [runProviderAction],
  );
  const refreshProviderAuth = useCallback(
    () => runProviderAction((controller) => controller.refreshProviderAuth),
    [runProviderAction],
  );

  const setDraft = useCallback(
    (key: keyof ContinuityDrafts, value: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          yield* controller.setDraft(key, value);
        }),
      ),
    [runtime],
  );
  const exportContinuity = useCallback(
    () =>
      runtime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* FlectWorkspaceController).exportContinuity;
        }),
      ),
    [runtime],
  );
  const exportRepository = useCallback(
    () =>
      runtime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* FlectWorkspaceController).exportRepository;
        }),
      ),
    [runtime],
  );
  const readShareExport = useCallback(
    (shareId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* FlectWorkspaceController).readShareExport(
            shareId,
          );
        }),
      ),
    [runtime],
  );
  const exportCapsule = useCallback(
    () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          if (controller.exportCapsule === undefined) {
            return yield* Effect.die("Capsule export is unavailable.");
          }
          return yield* controller.exportCapsule;
        }),
      ),
    [runtime],
  );
  const importCapsule = useCallback(
    (archive: Uint8Array) =>
      dispatch(ImportCapsule.make({ type: "import-capsule", archive })),
    [dispatch],
  );
  const invokeCapsuleIntent = useCallback(
    (
      capsuleId: string,
      binding: "accepted" | "candidate",
      intent: CapsuleIntent,
    ) => {
      const current = snapshotRef.current;
      if (current === undefined) {
        return Promise.resolve<CapsuleIntentOutcome>(
          CapsuleIntentFailed.make({
            version: 1,
            type: "intent-result",
            id: intent.id,
            ok: false,
            error: {
              code: "unavailable",
              message: "The product operation is unavailable.",
            },
          }),
        );
      }
      return runtime.runPromise(
        Effect.gen(function* () {
          const controller = yield* FlectWorkspaceController;
          return yield* controller
            .dispatch(
              FlectCommandEnvelope.make({
                version: 1,
                commandId: `cmd-${crypto.randomUUID()}`,
                workspaceId: current.workspaceId,
                source: CapsuleCommandSource.make({
                  kind: "capsule",
                  capsuleId,
                  binding,
                  intentId: intent.id,
                }),
                command: InvokeProductOperation.make({
                  type: "invoke-product-operation",
                  operationId: intent.action,
                  input: intent.input,
                }),
              }),
            )
            .pipe(
              Effect.match({
                onFailure: () =>
                  CapsuleIntentFailed.make({
                    version: 1,
                    type: "intent-result",
                    id: intent.id,
                    ok: false,
                    error: {
                      code: "denied",
                      message: "The product operation was denied.",
                    },
                  }),
                onSuccess: (receipt) =>
                  receipt.result === undefined
                    ? CapsuleIntentFailed.make({
                        version: 1,
                        type: "intent-result",
                        id: intent.id,
                        ok: false,
                        error: {
                          code: "invalid-result",
                          message:
                            "The product operation returned an invalid result.",
                        },
                      })
                    : CapsuleIntentSucceeded.make({
                        version: 1,
                        type: "intent-result",
                        id: intent.id,
                        ok: true,
                        output: receipt.result,
                      }),
              }),
            );
        }),
      );
    },
    [runtime],
  );
  const discardContinuity = useCallback(
    () =>
      runtime.runPromise(
        Effect.gen(function* () {
          yield* (yield* FlectWorkspaceController).discardContinuity;
        }),
      ),
    [runtime],
  );
  const retryContinuity = useCallback(
    () =>
      runtime.runPromise(
        Effect.gen(function* () {
          yield* (yield* FlectWorkspaceController).retryContinuity;
        }),
      ),
    [runtime],
  );
  const logoutProvider = useCallback(
    (providerId: string) =>
      runProviderAction((controller) => controller.logoutProvider(providerId)),
    [runProviderAction],
  );

  return {
    snapshot,
    providerAuth,
    privateShareSources,
    continuity,
    setDraft,
    exportContinuity,
    exportRepository,
    readShareExport,
    exportCapsule,
    importCapsule,
    invokeCapsuleIntent,
    capsulePresentation,
    repository: snapshot?.repository,
    discardContinuity,
    retryContinuity,
    dispatch,
    selectReasoning,
    loginProvider,
    replyProviderAuth,
    cancelProviderAuth,
    refreshProviderAuth,
    logoutProvider,
  };
}
