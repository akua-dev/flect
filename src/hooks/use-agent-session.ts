import { Effect, Fiber, type ManagedRuntime, Stream } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AuthLoginEvent,
  type AuthLoginReference,
  type AuthLoginRequest,
  type AuthSelectionReply,
  type InteractiveAgentRole,
  ModelSelection,
  type ModelSummary,
  type ReasoningLevel,
  type RecoveryReason,
} from "../../shared/contracts";
import {
  type AgentWorkspaceSnapshot,
  type RoleConversationSnapshot,
  type ToolActivity,
  UserCommandSource,
} from "../../shared/control";
import type { GitRepositoryStatus } from "../../shared/git-workspace";
import type { InterfaceDocument } from "../../shared/interface-document";
import type { RevisionId } from "../../shared/revisions";
import type {
  ContinuityDrafts,
  ContinuityRecoveryReason,
} from "../../shared/role-continuity";
import {
  AgentWorkspace,
  type AgentWorkspaceShape,
  OperationContext,
  type ProviderAuthUiState,
} from "../lib/agent-workspace";
import { FlectUnavailableError } from "../lib/api";
import { browserRuntime } from "../lib/runtime";

export type AgentWorkspaceRuntime = ManagedRuntime.ManagedRuntime<
  AgentWorkspace,
  unknown
>;

export type AgentSessionStatus = RoleConversationSnapshot["status"];

export const isAgentSessionActive = (status: AgentSessionStatus) =>
  status === "submitting" || status === "streaming" || status === "cancelling";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "activity";
  readonly content: string;
  readonly createdAt?: number;
}

export interface RoleConversationState {
  readonly role: InteractiveAgentRole;
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly activities?: ReadonlyArray<ToolActivity>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
  readonly cancel: () => Promise<void>;
}

export interface AppConversationController extends RoleConversationState {
  readonly role: "app";
  readonly submit: (text: string) => Promise<void>;
}

export interface PreviewAppConversationController
  extends RoleConversationState {
  readonly role: "app";
  readonly submit: (
    text: string,
    document: InterfaceDocument,
    revisionId: RevisionId,
  ) => Promise<void>;
}

export interface ShaperConversationController extends RoleConversationState {
  readonly role: "shaper";
  readonly shape: (
    instruction: string,
    document: InterfaceDocument,
  ) => Promise<InterfaceDocument>;
}

export interface AgentWorkspaceController {
  readonly drafts?: ContinuityDrafts;
  readonly setDraft?: (
    key: keyof ContinuityDrafts,
    value: string,
  ) => Promise<void>;
  readonly continuity?: {
    readonly generation: number;
    readonly revisionSequence: number;
    readonly recovery?: ContinuityRecoveryReason;
  };
  readonly exportContinuity?: () => Promise<string>;
  readonly exportRepository?: () => Promise<Uint8Array>;
  readonly exportCapsule?: () => Promise<Uint8Array>;
  readonly importCapsule?: (archive: Uint8Array) => Promise<unknown>;
  readonly repository?: GitRepositoryStatus;
  readonly discardContinuity?: () => Promise<void>;
  readonly retryContinuity?: () => Promise<void>;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly reasoningLevel: ReasoningLevel | undefined;
  readonly providers: ProviderAuthUiState["providers"];
  readonly authEvent: AuthLoginEvent | undefined;
  readonly selectModel: (model: ModelSummary | undefined) => void;
  readonly selectReasoning: (
    reasoningLevel: ReasoningLevel | undefined,
  ) => void;
  readonly loginProvider: (request: AuthLoginRequest) => void;
  readonly replyProviderAuth: (reply: AuthSelectionReply) => Promise<void>;
  readonly cancelProviderAuth: (reference: AuthLoginReference) => Promise<void>;
  readonly refreshProviderAuth: () => Promise<void>;
  readonly logoutProvider: (providerId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly externalExtensions: AgentWorkspaceSnapshot["externalExtensions"];
  readonly toggleExternalExtensions: (
    role: InteractiveAgentRole,
  ) => Promise<void>;
  readonly app: AppConversationController;
  readonly previewApp: PreviewAppConversationController;
  readonly shaper: ShaperConversationController;
  readonly diagnoseRecovery: (
    reason: RecoveryReason,
  ) => Promise<{ readonly version: 1; readonly message: string }>;
}

const unavailable = () =>
  FlectUnavailableError.make({
    message: "The local Flect runtime is unavailable.",
  });

const operation = () =>
  OperationContext.make({
    operationId: `operation-${crypto.randomUUID()}`,
    commandId: `cmd-${crypto.randomUUID()}`,
    workspaceId: "workspace-local-default",
    source: UserCommandSource.make({ kind: "user" }),
  });

const activityMessage = (
  role: InteractiveAgentRole,
  activity: RoleConversationSnapshot["activities"][number],
): ConversationMessage => ({
  id: activity.id,
  role: "activity",
  createdAt: activity.updatedAt,
  content:
    activity.toolName === "bash"
      ? `${role === "app" ? "App Agent" : "Shaper"} used its sandbox.`
      : activity.validationIssues === undefined
        ? `${activity.toolName} ${activity.phase}.`
        : `Proposal validation found ${activity.validationIssues.length} issue${activity.validationIssues.length === 1 ? "" : "s"}.`,
});

const conversationMessages = (
  conversation: RoleConversationSnapshot,
): ReadonlyArray<ConversationMessage> =>
  [
    ...conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
    ...conversation.activities.map((activity) =>
      activityMessage(conversation.role, activity),
    ),
  ].sort((left, right) =>
    left.createdAt === undefined || right.createdAt === undefined
      ? 0
      : left.createdAt - right.createdAt,
  );

const pendingRole = (role: InteractiveAgentRole): RoleConversationSnapshot => ({
  role,
  status: "booting",
  messages: [],
  activities: [],
  lastPrompt: "",
});

export function useAgentSession(
  runtime: AgentWorkspaceRuntime = browserRuntime,
): AgentWorkspaceController & {
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
  readonly submit: (text: string) => Promise<void>;
  readonly shape: (
    instruction: string,
    document: InterfaceDocument,
  ) => Promise<InterfaceDocument>;
  readonly cancel: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<AgentWorkspaceSnapshot>();
  const [providerAuth, setProviderAuth] = useState<ProviderAuthUiState>({
    providers: [],
  });
  const workspaceRef = useRef<AgentWorkspaceShape | undefined>(undefined);

  useEffect(() => {
    const subscription = Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* Effect.sync(() => {
        workspaceRef.current = workspace;
      });
      yield* workspace.refresh;
      const [initial, initialProviderAuth] = yield* Effect.all([
        workspace.snapshot,
        workspace.providerAuth,
      ]);
      yield* Effect.sync(() => {
        setSnapshot(initial);
        setProviderAuth(initialProviderAuth);
      });
      yield* Effect.all(
        [
          workspace.changes.pipe(
            Stream.runForEach((next) => Effect.sync(() => setSnapshot(next))),
          ),
          workspace.providerAuthChanges.pipe(
            Stream.runForEach((next) =>
              Effect.sync(() => setProviderAuth(next)),
            ),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.ensuring(workspace.close));
    });
    const fiber = runtime.runFork(subscription);
    return () => {
      workspaceRef.current = undefined;
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, [runtime]);

  const workspaceEffect = useCallback(
    () =>
      Effect.suspend(() => {
        const workspace = workspaceRef.current;
        return workspace === undefined
          ? Effect.fail(unavailable())
          : Effect.succeed(workspace);
      }),
    [],
  );

  const refresh = useCallback(
    () =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.refresh),
        ),
      ),
    [runtime, workspaceEffect],
  );

  const selectModel = useCallback(
    (model: ModelSummary | undefined) => {
      runtime.runFork(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.selectModel(
              model === undefined
                ? undefined
                : ModelSelection.make({
                    provider: model.provider,
                    id: model.id,
                  }),
            ),
          ),
        ),
      );
    },
    [runtime, workspaceEffect],
  );

  const toggleExternalExtensions = useCallback(
    (role: InteractiveAgentRole) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.setExternalExtensions(
              role,
              !(snapshot?.externalExtensions[role] ?? false),
            ),
          ),
        ),
      ),
    [runtime, snapshot, workspaceEffect],
  );

  const selectReasoning = useCallback(
    (reasoningLevel: ReasoningLevel | undefined) => {
      runtime.runFork(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.selectReasoning(reasoningLevel),
          ),
        ),
      );
    },
    [runtime, workspaceEffect],
  );

  const loginProvider = useCallback(
    (request: AuthLoginRequest) => {
      void runtime
        .runPromise(
          workspaceEffect().pipe(
            Effect.flatMap((workspace) => workspace.loginProvider(request)),
          ),
        )
        .catch(() => undefined);
    },
    [runtime, workspaceEffect],
  );

  const replyProviderAuth = useCallback(
    (reply: AuthSelectionReply) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.replyProviderAuth(reply)),
        ),
      ),
    [runtime, workspaceEffect],
  );
  const cancelProviderAuth = useCallback(
    (reference: AuthLoginReference) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.cancelProviderAuth(reference),
          ),
        ),
      ),
    [runtime, workspaceEffect],
  );
  const refreshProviderAuth = useCallback(
    () =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.refreshProviderAuth),
        ),
      ),
    [runtime, workspaceEffect],
  );
  const logoutProvider = useCallback(
    (providerId: string) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.logoutProvider(providerId)),
        ),
      ),
    [runtime, workspaceEffect],
  );

  const submit = useCallback(
    (text: string) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.submitAppPrompt(operation(), text),
          ),
          Effect.exit,
          Effect.asVoid,
        ),
      ),
    [runtime, workspaceEffect],
  );

  const submitPreview = useCallback(
    (text: string, document: InterfaceDocument, revisionId: RevisionId) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.submitPreviewPrompt(
              operation(),
              text,
              document,
              revisionId,
            ),
          ),
          Effect.exit,
          Effect.asVoid,
        ),
      ),
    [runtime, workspaceEffect],
  );

  const shape = useCallback(
    (instruction: string, document: InterfaceDocument) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) =>
            workspace.submitShaperInstruction(
              operation(),
              instruction,
              document,
            ),
          ),
        ),
      ),
    [runtime, workspaceEffect],
  );

  const cancel = useCallback(
    (role: InteractiveAgentRole) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.cancel(role)),
          Effect.catch(() => Effect.void),
        ),
      ),
    [runtime, workspaceEffect],
  );

  const diagnoseRecovery = useCallback(
    (reason: RecoveryReason) =>
      runtime.runPromise(
        workspaceEffect().pipe(
          Effect.flatMap((workspace) => workspace.diagnoseRecovery(reason)),
        ),
      ),
    [runtime, workspaceEffect],
  );

  const appSnapshot = snapshot?.app ?? pendingRole("app");
  const previewAppSnapshot = snapshot?.previewApp ?? pendingRole("app");
  const shaperSnapshot = snapshot?.shaper ?? pendingRole("shaper");
  const app = useMemo<AppConversationController>(
    () => ({
      role: "app",
      status: appSnapshot.status,
      messages: conversationMessages(appSnapshot),
      activities: appSnapshot.activities,
      lastPrompt: appSnapshot.lastPrompt,
      error: appSnapshot.error,
      submit,
      cancel: () => cancel("app"),
    }),
    [appSnapshot, cancel, submit],
  );
  const shaper = useMemo<ShaperConversationController>(
    () => ({
      role: "shaper",
      status: shaperSnapshot.status,
      messages: conversationMessages(shaperSnapshot),
      activities: shaperSnapshot.activities,
      lastPrompt: shaperSnapshot.lastPrompt,
      error: shaperSnapshot.error,
      shape,
      cancel: () => cancel("shaper"),
    }),
    [cancel, shape, shaperSnapshot],
  );
  const previewApp = useMemo<PreviewAppConversationController>(
    () => ({
      role: "app",
      status: previewAppSnapshot.status,
      messages: conversationMessages(previewAppSnapshot),
      activities: previewAppSnapshot.activities,
      lastPrompt: previewAppSnapshot.lastPrompt,
      error: previewAppSnapshot.error,
      submit: submitPreview,
      cancel: () =>
        runtime.runPromise(
          workspaceEffect().pipe(
            Effect.flatMap((workspace) => workspace.cancelPreview),
            Effect.catch(() => Effect.void),
          ),
        ),
    }),
    [previewAppSnapshot, runtime, submitPreview, workspaceEffect],
  );

  return {
    models: snapshot?.models ?? [],
    selectedModel: snapshot?.selectedModel,
    reasoningLevel: snapshot?.reasoningLevel,
    providers: providerAuth.providers,
    authEvent: providerAuth.event,
    selectModel,
    selectReasoning,
    loginProvider,
    replyProviderAuth,
    cancelProviderAuth,
    refreshProviderAuth,
    logoutProvider,
    refresh,
    externalExtensions: snapshot?.externalExtensions ?? {
      app: false,
      shaper: false,
    },
    toggleExternalExtensions,
    app,
    previewApp,
    shaper,
    diagnoseRecovery,
    status: app.status,
    messages: app.messages,
    lastPrompt: app.lastPrompt,
    error: app.error,
    submit,
    shape,
    cancel: app.cancel,
  };
}
