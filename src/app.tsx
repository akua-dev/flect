import { Effect } from "effect";
import { useCallback, useMemo } from "react";
import {
  ShareGitSource,
  ShareLocalSource,
  SharePrivateSource,
  ShareUrlSource,
} from "../packages/product/src/share";
import { ModelSelection, type ModelSummary } from "../shared/contracts";
import {
  AcceptProposal,
  ActivateShareCandidate,
  CancelRole,
  ContinueShareFork,
  DecideProductCapability,
  DeleteShareLocalData,
  DisableControl,
  EnableControl,
  EnterSafeMode,
  ExportShare,
  ForkPortableExtension,
  InvokeInterfaceAction,
  OpenShareConflictInShape,
  OpenShareSource,
  PrepareShareUpdate,
  RefreshRuntime as RefreshRuntimeCommand,
  RejectProposal,
  RejectShareCandidate,
  RemovePortableExtension,
  RemoveShare,
  RequestShapeHandoff,
  ResolvePortableExtensionUpdate,
  RestoreSafeMode,
  RetainShareCandidate,
  RevokeProductCapability,
  RollbackRevision,
  SelectModel,
  SelectWorkbenchTarget,
  SetExternalExtensions,
  SetMode,
  SetModelFavorite,
  SetPortableExtensionEnabled,
  SetPortableExtensionPin,
  SetRailCollapsed,
  SetRailWidth,
  SubmitAppPrompt,
  SubmitShaperInstruction,
  TestPortableExtension,
  WorkbenchHandoff,
} from "../shared/control";
import { projectInterfaceActions } from "../shared/interface-actions";
import { isRollbackAvailable } from "../shared/revisions";
import { ShellPreferencesValue } from "../shared/shell-preferences";
import type { ShapingController } from "./components/agent-rail";
import { RoleAwareShell } from "./components/role-aware-shell";
import type {
  AgentWorkspaceController,
  ConversationMessage,
  RoleConversationState,
} from "./hooks/use-agent-session";
import { useNativeSetup } from "./hooks/use-native-setup";
import { useNativeUpdate } from "./hooks/use-native-update";
import { useWorkspace, type WorkspaceRuntime } from "./hooks/use-workspace";
import { flectRuntime } from "./lib/runtime";
import { workspacePhase } from "./lib/workspace-phase";

export interface AppProps {
  readonly runtime?: WorkspaceRuntime;
}

const toMessages = (
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: "user" | "assistant";
    readonly content: string;
    readonly createdAt: number;
  }>,
): ReadonlyArray<ConversationMessage> =>
  messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));

const modelKey = (model: Pick<ModelSummary, "provider" | "id">) =>
  `${model.provider}/${model.id}`;

const clearSafeModeRoute = Effect.fn("Flect.App.clearSafeModeRoute")(() =>
  Effect.try({
    try: () => {
      const url = new URL(globalThis.location.href);
      if (url.searchParams.get("safe") !== "1") {
        return;
      }
      url.searchParams.delete("safe");
      globalThis.history.replaceState(
        globalThis.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.void)),
);

export function App({ runtime = flectRuntime }: AppProps = {}) {
  const {
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
    repository,
    discardContinuity,
    retryContinuity,
    dispatch,
    selectReasoning,
    loginProvider,
    replyProviderAuth,
    cancelProviderAuth,
    refreshProviderAuth,
    logoutProvider,
  } = useWorkspace(runtime);
  const setup = useNativeSetup();
  const update = useNativeUpdate();

  const command = useCallback(
    async (value: Parameters<typeof dispatch>[0]) => {
      try {
        await dispatch(value);
      } catch {
        // The controller records a bounded, redacted failure for diagnostics.
      }
    },
    [dispatch],
  );

  const workspace = useMemo<AgentWorkspaceController | undefined>(() => {
    if (snapshot === undefined) {
      return undefined;
    }

    const role = (value: typeof snapshot.agent.app): RoleConversationState => ({
      role: value.role,
      status: value.status,
      messages: toMessages(value.messages),
      activities: value.activities,
      lastPrompt: value.lastPrompt,
      error: value.error,
      cancel: () =>
        command(
          CancelRole.make({
            type: "cancel-role",
            role: value.role,
          }),
        ),
    });
    const app = role(snapshot.agent.app);
    const previewApp = role(snapshot.agent.previewApp);
    const shaper = role(snapshot.agent.shaper);

    return {
      drafts: continuity.drafts,
      setDraft,
      continuity: {
        generation: continuity.generation,
        revisionSequence: continuity.revisionSequence,
        ...(continuity.recovery === undefined
          ? {}
          : { recovery: continuity.recovery }),
      },
      exportContinuity,
      exportRepository,
      exportCapsule,
      importCapsule,
      repository,
      discardContinuity,
      retryContinuity,
      models: snapshot.agent.models,
      selectedModel: snapshot.agent.selectedModel,
      reasoningLevel: snapshot.agent.reasoningLevel,
      providers: providerAuth.providers,
      authEvent: providerAuth.event,
      selectModel: (model) => {
        void command(
          SelectModel.make({
            type: "select-model",
            ...(model === undefined
              ? {}
              : {
                  model: ModelSelection.make({
                    provider: model.provider,
                    id: model.id,
                  }),
                }),
          }),
        );
      },
      selectReasoning,
      loginProvider,
      replyProviderAuth,
      cancelProviderAuth,
      refreshProviderAuth,
      logoutProvider,
      refresh: () =>
        command(RefreshRuntimeCommand.make({ type: "refresh-runtime" })),
      externalExtensions: snapshot.agent.externalExtensions,
      toggleExternalExtensions: (interactiveRole) =>
        command(
          SetExternalExtensions.make({
            type: "set-external-extensions",
            role: interactiveRole,
            enabled: !snapshot.agent.externalExtensions[interactiveRole],
          }),
        ),
      app: {
        ...app,
        role: "app",
        submit: (text) =>
          command(
            SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text,
            }),
          ),
      },
      previewApp: {
        ...previewApp,
        role: "app",
        submit: (text) =>
          command(
            SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text,
            }),
          ),
      },
      shaper: {
        ...shaper,
        role: "shaper",
        shape: async (instruction) => {
          await command(
            SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction,
            }),
          );
          return snapshot.document;
        },
      },
      diagnoseRecovery: async () => ({
        version: 1,
        message: "Protected recovery is available through the Guardian.",
      }),
    };
  }, [
    cancelProviderAuth,
    command,
    continuity,
    discardContinuity,
    exportContinuity,
    exportRepository,
    exportCapsule,
    importCapsule,
    repository,
    loginProvider,
    logoutProvider,
    providerAuth,
    refreshProviderAuth,
    replyProviderAuth,
    selectReasoning,
    retryContinuity,
    setDraft,
    snapshot,
  ]);

  const preferences = useMemo(() => {
    if (snapshot === undefined) {
      return undefined;
    }
    const value = ShellPreferencesValue.make({
      version: 1,
      railWidth: snapshot.rail.width,
      railCollapsed: snapshot.rail.collapsed,
      modelFavorites: snapshot.agent.favoriteModels.map(
        (favorite) => `${favorite.provider}/${favorite.id}`,
      ),
    });
    return {
      value,
      setRailWidth: (width: number) =>
        command(
          SetRailWidth.make({
            type: "set-rail-width",
            width: Math.max(340, Math.min(520, Math.round(width))),
          }),
        ),
      setRailCollapsed: (collapsed: boolean) =>
        command(
          SetRailCollapsed.make({
            type: "set-rail-collapsed",
            collapsed,
          }),
        ),
      toggleModelFavorite: async (key: string) => {
        const model = snapshot.agent.models.find(
          (candidate) => modelKey(candidate) === key,
        );
        if (model === undefined) {
          return;
        }
        await command(
          SetModelFavorite.make({
            type: "set-model-favorite",
            model: ModelSelection.make({
              provider: model.provider,
              id: model.id,
            }),
            favorite: !snapshot.agent.favoriteModels.some(
              (candidate) => modelKey(candidate) === key,
            ),
          }),
        );
      },
    };
  }, [command, snapshot]);

  if (
    snapshot === undefined ||
    workspace === undefined ||
    preferences === undefined
  ) {
    return (
      <div className="role-shell role-shell--loading">
        <header className="topbar">
          <a aria-label="Flect home" className="wordmark" href="/">
            Flect
          </a>
        </header>
        <main aria-busy="true" className="workspace-canvas">
          <p className="shell-loading-status" role="status">
            Opening workspace
          </p>
        </main>
      </div>
    );
  }

  const failedOperation = snapshot.operations.findLast(
    (operation) => operation.phase === "failed",
  );
  const shapingStatus: ShapingController["status"] =
    snapshot.phase === "shaping"
      ? "shaping"
      : snapshot.phase === "preview"
        ? "preview"
        : snapshot.agent.shaper.status === "error"
          ? "error"
          : "idle";
  const shaping: ShapingController = {
    status: shapingStatus,
    ...(snapshot.agent.shaper.error === undefined &&
    failedOperation === undefined
      ? {}
      : {
          error:
            snapshot.agent.shaper.error ??
            failedOperation?.summary ??
            "The interface was not changed.",
        }),
    rollbackAvailable: isRollbackAvailable(snapshot.shaping),
    isolation: "ready",
    verifyIsolation: async () => undefined,
    request: (instruction) =>
      command(
        SubmitShaperInstruction.make({
          type: "submit-shaper-instruction",
          instruction,
        }),
      ),
    fixFailure: (activity) =>
      command(
        RequestShapeHandoff.make({
          type: "request-shape-handoff",
          handoff: WorkbenchHandoff.make({
            version: 1,
            instruction:
              "Fix the interface behavior that caused this failed operation.",
            revisionId:
              snapshot.shaping.proposal?.id ?? snapshot.shaping.active.id,
            failureOperationId: activity.operationId,
            failureSummary:
              activity.resultSummary ??
              `${activity.toolName} failed${
                activity.exitCode === undefined
                  ? "."
                  : ` with exit code ${activity.exitCode}.`
              }`,
          }),
        }),
      ),
    accept: () => command(AcceptProposal.make({ type: "accept-proposal" })),
    reject: () => command(RejectProposal.make({ type: "reject-proposal" })),
    rollback: () =>
      command(RollbackRevision.make({ type: "rollback-revision" })),
  };

  return (
    <RoleAwareShell
      build={snapshot.build}
      capsulePresentation={capsulePresentation}
      actions={projectInterfaceActions(snapshot.document, snapshot.shaping)}
      controlledMode={snapshot.mode}
      controlledTarget={
        snapshot.workbench?.target ??
        (snapshot.mode === "run" ? "use" : "shape")
      }
      candidateRevisionId={snapshot.shaping.proposal?.id}
      diagnostics={{
        control: snapshot.control,
        operations: snapshot.operations,
        persistence: snapshot.persistence,
        setup,
        update,
        onToggleControl: () =>
          command(
            snapshot.control.enabled
              ? DisableControl.make({ type: "disable-control" })
              : EnableControl.make({ type: "enable-control" }),
          ),
      }}
      document={snapshot.document}
      extensions={snapshot.extensions}
      onInterfaceAction={(nodeId) =>
        command(
          InvokeInterfaceAction.make({
            type: "invoke-interface-action",
            nodeId,
          }),
        )
      }
      onCapsuleIntent={(intent) => {
        const binding = snapshot.phase === "preview" ? "candidate" : "accepted";
        const capsule =
          binding === "candidate"
            ? capsulePresentation.candidate
            : capsulePresentation.accepted;
        return capsule === undefined
          ? Promise.reject(new Error("The capsule is unavailable."))
          : invokeCapsuleIntent(capsule.id, binding, intent);
      }}
      onModeChange={(mode) => command(SetMode.make({ type: "set-mode", mode }))}
      onTargetChange={(target) =>
        command(
          SelectWorkbenchTarget.make({
            type: "select-workbench-target",
            target,
          }),
        )
      }
      onOpenSafeMode={() => {
        void command(EnterSafeMode.make({ type: "enter-safe-mode" }));
      }}
      onRestoreSafeMode={() =>
        dispatch(RestoreSafeMode.make({ type: "restore-safe-mode" }))
          .then(() => Effect.runPromise(clearSafeModeRoute()))
          .then(() => undefined)
      }
      onDecideProductCapability={(capsuleId, capabilityId, choice) =>
        dispatch(
          DecideProductCapability.make({
            type: "decide-product-capability",
            capsuleId,
            capabilityId,
            choice,
          }),
        ).then(() => undefined)
      }
      onRevokeProductCapability={(decisionId) =>
        dispatch(
          RevokeProductCapability.make({
            type: "revoke-product-capability",
            decisionId,
          }),
        ).then(() => undefined)
      }
      onSetPortableExtensionEnabled={(key, enabled, grants) =>
        dispatch(
          SetPortableExtensionEnabled.make({
            type: "set-portable-extension-enabled",
            ...key,
            enabled,
            grants,
          }),
        ).then(() => undefined)
      }
      onTestPortableExtension={(key) =>
        dispatch(
          TestPortableExtension.make({
            type: "test-portable-extension",
            ...key,
            binding: "candidate",
            input: { type: "protected-review-test" },
          }),
        ).then(() => undefined)
      }
      onSetPortableExtensionPinned={(key, pinned) =>
        dispatch(
          SetPortableExtensionPin.make({
            type: "set-portable-extension-pin",
            ...key,
            pinned,
          }),
        ).then(() => undefined)
      }
      onForkPortableExtension={(key, revision) =>
        dispatch(
          ForkPortableExtension.make({
            type: "fork-portable-extension",
            ...key,
            revision,
          }),
        ).then(() => undefined)
      }
      onResolvePortableExtensionUpdate={(key, choice) =>
        dispatch(
          ResolvePortableExtensionUpdate.make({
            type: "resolve-portable-extension-update",
            ...key,
            binding: "candidate",
            choice,
          }),
        ).then(() => undefined)
      }
      onRemovePortableExtension={(key) =>
        dispatch(
          RemovePortableExtension.make({
            type: "remove-portable-extension",
            ...key,
          }),
        ).then(() => undefined)
      }
      shareReview={snapshot.shareReview}
      privateShareSources={privateShareSources}
      shareInstallation={snapshot.shares?.entries.find(
        (entry) => entry.shareId === snapshot.shareReview?.shareId,
      )}
      shareInstallations={snapshot.shares?.entries ?? []}
      onRetainShare={(artifactIds) =>
        dispatch(
          RetainShareCandidate.make({
            type: "retain-share-candidate",
            artifactIds: [...artifactIds],
          }),
        ).then(() => undefined)
      }
      onPrepareShareUpdate={() =>
        snapshot.shareReview === undefined
          ? Promise.resolve()
          : dispatch(
              PrepareShareUpdate.make({
                type: "prepare-share-update",
                shareId: snapshot.shareReview.shareId,
              }),
            ).then(() => undefined)
      }
      onContinueShareFork={() =>
        snapshot.shareReview === undefined
          ? Promise.resolve()
          : dispatch(
              ContinueShareFork.make({
                type: "continue-share-fork",
                shareId: snapshot.shareReview.shareId,
              }),
            ).then(() => undefined)
      }
      onOpenShareConflictInShape={() =>
        snapshot.shareReview === undefined
          ? Promise.resolve()
          : dispatch(
              OpenShareConflictInShape.make({
                type: "open-share-conflict-in-shape",
                shareId: snapshot.shareReview.shareId,
              }),
            ).then(() => undefined)
      }
      onActivateShare={(artifactIds) =>
        snapshot.shareReview === undefined
          ? Promise.resolve()
          : dispatch(
              ActivateShareCandidate.make({
                type: "activate-share-candidate",
                shareId: snapshot.shareReview.shareId,
                artifactIds: [...artifactIds],
              }),
            ).then(() => undefined)
      }
      onRejectShare={() =>
        dispatch(
          RejectShareCandidate.make({ type: "reject-share-candidate" }),
        ).then(() => undefined)
      }
      onOpenShareUrl={(url) =>
        dispatch(
          OpenShareSource.make({
            type: "open-share-source",
            source: ShareUrlSource.make({ _tag: "url", url }),
          }),
        ).then(() => undefined)
      }
      onOpenShareGit={(url, commit) =>
        dispatch(
          OpenShareSource.make({
            type: "open-share-source",
            source: ShareGitSource.make({ _tag: "git", url, commit }),
          }),
        ).then(() => undefined)
      }
      onOpenSharePrivate={(adapterId, reference) =>
        dispatch(
          OpenShareSource.make({
            type: "open-share-source",
            source: SharePrivateSource.make({
              _tag: "private",
              adapterId,
              reference,
            }),
          }),
        ).then(() => undefined)
      }
      onOpenShareFile={(name, bytes) =>
        dispatch(
          OpenShareSource.make({
            type: "open-share-source",
            source: ShareLocalSource.make({ _tag: "local", name, bytes }),
          }),
        ).then(() => undefined)
      }
      onExportShare={async (shareId) => {
        await dispatch(ExportShare.make({ type: "export-share", shareId }));
        const archive = await readShareExport(shareId);
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(archive)], {
            type: "application/octet-stream",
          }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${shareId}.flect-share`;
        anchor.click();
        URL.revokeObjectURL(url);
      }}
      onRemoveShare={(shareId) =>
        dispatch(RemoveShare.make({ type: "remove-share", shareId })).then(
          () => undefined,
        )
      }
      onDeleteShare={(shareId, expectedForkCommit) =>
        dispatch(
          DeleteShareLocalData.make({
            type: "delete-share-local-data",
            shareId,
            expectedForkCommit,
          }),
        ).then(() => undefined)
      }
      phase={workspacePhase(snapshot.shaping, false)}
      preferences={preferences}
      preview={snapshot.phase === "preview"}
      shaping={shaping}
      workspace={workspace}
      useDisabled={
        snapshot.shaping.proposal === undefined &&
        snapshot.shaping.active.source === "built-in"
      }
    />
  );
}
