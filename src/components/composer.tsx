import { useEffect, useId, useRef, useState } from "react";
import type {
  AuthLoginEvent,
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  ModelSummary,
  ProviderAuthSummary,
  ReasoningLevel,
} from "../../shared/contracts";
import type { GitRepositoryStatus } from "../../shared/git-workspace";
import type { ContinuityDrafts } from "../../shared/role-continuity";
import {
  type AgentSessionStatus,
  isAgentSessionActive,
} from "../hooks/use-agent-session";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "./ai-elements/prompt-input";
import { ComposerActionsMenu } from "./composer-actions-menu";
import { ModelMenu } from "./model-menu";
import type { ConversationTarget, ShellMode } from "./role-switcher";

export interface ComposerProps {
  readonly mode: ShellMode;
  /** @deprecated Flect presents one conversation and ignores role targeting. */
  readonly target?: ConversationTarget;
  /** @deprecated Flect persists one visible draft. */
  readonly conversationKey?: "accepted-use" | "candidate-use" | "shape";
  /** @deprecated Internal agent roles are not a user-facing mode. */
  readonly agentLabel?: "App Agent" | "Preview App Agent" | "Shaper";
  /** @deprecated Routing is automatic. */
  readonly useDisabled?: boolean;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly drafts?: ContinuityDrafts;
  /** @deprecated There is no visible role switcher. */
  readonly roleSwitchDisabled?: boolean;
  readonly status: AgentSessionStatus;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly reasoningLevel?: ReasoningLevel;
  readonly providers?: ReadonlyArray<ProviderAuthSummary>;
  readonly authEvent?: AuthLoginEvent;
  readonly providerSetupInline?: boolean;
  readonly modelFavorites: ReadonlyArray<string>;
  readonly rollbackAvailable: boolean;
  /** @deprecated There is no visible mode switcher. */
  readonly onModeChange?: (mode: Exclude<ShellMode, "safe">) => void;
  /** @deprecated Flect routes typed work internally. */
  readonly onTargetChange?: (target: ConversationTarget) => void;
  readonly onSelectModel: (model: ModelSummary | undefined) => void;
  readonly onSelectReasoning?: (
    reasoningLevel: ReasoningLevel | undefined,
  ) => void;
  readonly onLoginProvider?: (request: AuthLoginRequest) => void;
  readonly onReplyProviderAuth?: (reply: AuthSelectionReply) => Promise<void>;
  readonly onCancelProviderAuth?: (
    reference: AuthLoginReference,
  ) => Promise<void>;
  readonly onRefreshProviderAuth?: () => Promise<void>;
  readonly onLogoutProvider?: (providerId: string) => Promise<void>;
  readonly onToggleModelFavorite: (modelKey: string) => Promise<void>;
  readonly onSubmit: (prompt: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onDraftChange?: (
    key: keyof ContinuityDrafts,
    value: string,
  ) => Promise<void>;
  readonly onRollback: () => Promise<void>;
  readonly onExportRepository: () => Promise<void>;
  readonly onExportCapsule?: () => Promise<void>;
  readonly onImportCapsule?: () => void;
  readonly onInstallCapsule?: () => void;
  readonly onImportWebProject?: () => void;
  readonly onImportWebProjectArchive?: () => void;
  readonly onImportWebProjectGit?: () => void;
  readonly onOpenShareSource?: () => void;
  readonly onOpenShareFile?: () => void;
  readonly onManageSharedSources?: () => void;
  readonly repository?: GitRepositoryStatus;
  readonly onOpenSafeMode: () => void;
  readonly externalExtensionsEnabled: boolean;
  readonly onToggleExternalExtensions: () => Promise<void>;
}

export function Composer({
  mode,
  placeholder,
  disabled = false,
  disabledReason,
  drafts: persistedDrafts,
  status,
  models,
  selectedModel,
  reasoningLevel,
  providers = [],
  authEvent,
  providerSetupInline = false,
  modelFavorites,
  rollbackAvailable,
  onSelectModel,
  onSelectReasoning = () => undefined,
  onLoginProvider = () => undefined,
  onReplyProviderAuth = async () => undefined,
  onCancelProviderAuth = async () => undefined,
  onRefreshProviderAuth = async () => undefined,
  onLogoutProvider = async () => undefined,
  onToggleModelFavorite,
  onSubmit,
  onCancel,
  onDraftChange,
  onRollback,
  onExportRepository,
  onExportCapsule,
  onImportCapsule,
  onInstallCapsule,
  onImportWebProject,
  onImportWebProjectArchive,
  onImportWebProjectGit,
  onOpenShareSource,
  onOpenShareFile,
  onManageSharedSources,
  repository,
  onOpenSafeMode,
  externalExtensionsEnabled,
  onToggleExternalExtensions,
}: ComposerProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const helpId = useId();
  const draftKey = "accepted-use";
  const continuityKey: keyof ContinuityDrafts = "acceptedUse";
  const prompt = mode === "safe" ? "" : (drafts[draftKey] ?? "");
  const isActive = isAgentSessionActive(status);
  const protectedActionsLocked = submitting || isActive;
  const inputUnavailable =
    disabled ||
    mode === "safe" ||
    status === "booting" ||
    status === "unavailable";
  const submissionUnavailable = inputUnavailable || status === "setup-required";
  const modelMenuDisabled =
    disabled ||
    mode === "safe" ||
    status === "booting" ||
    status === "unavailable" ||
    protectedActionsLocked;
  const canSubmit =
    prompt.trim().length > 0 &&
    !submissionUnavailable &&
    !protectedActionsLocked;
  const roleName = "Flect";
  const help =
    disabledReason ??
    (mode === "safe"
      ? "Restore the last-known-good interface before sending."
      : status === "booting"
        ? "Connecting to the local runtime."
        : status === "unavailable"
          ? "Start the local runtime before sending."
          : status === "setup-required"
            ? "Sign in to a Pi provider before sending."
            : submitting
              ? "Sending the message to Flect."
              : status === "cancelling"
                ? "Stopping the current response."
                : status === "submitting" || status === "streaming"
                  ? "Stop the current response before sending another message."
                  : prompt.trim().length === 0
                    ? "Enter a message to enable Send."
                    : "Press Enter to send. Press Shift Enter for a new line.");

  useEffect(() => {
    if (persistedDrafts === undefined) {
      return;
    }
    setDrafts((current) => ({
      ...current,
      "accepted-use": persistedDrafts.acceptedUse,
    }));
  }, [persistedDrafts]);

  const submit = async () => {
    const nextPrompt = prompt.trim();
    if (
      !nextPrompt ||
      submittingRef.current ||
      isActive ||
      submissionUnavailable
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      setDrafts((current) => ({ ...current, [draftKey]: "" }));
      await onDraftChange?.(continuityKey, "");
      await onSubmit(nextPrompt);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <PromptInput
      aria-busy={isActive}
      className="composer-form composer"
      data-composer-role="flect"
      onSubmit={() => {
        void submit();
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          aria-describedby={helpId}
          aria-label={`Message ${roleName}`}
          autoFocus={!inputUnavailable}
          disabled={inputUnavailable}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((current) => ({
              ...current,
              [draftKey]: value,
            }));
            void onDraftChange?.(continuityKey, value);
          }}
          placeholder={placeholder}
          rows={1}
          value={prompt}
        />
      </PromptInputBody>

      <PromptInputFooter className="composer__rail">
        <PromptInputTools className="composer__tools">
          <ComposerActionsMenu
            disabled={protectedActionsLocked}
            externalExtensionsEnabled={externalExtensionsEnabled}
            onExportRepository={onExportRepository}
            onExportCapsule={onExportCapsule}
            onImportCapsule={onImportCapsule}
            onInstallCapsule={onInstallCapsule}
            onImportWebProject={onImportWebProject}
            onImportWebProjectArchive={onImportWebProjectArchive}
            onImportWebProjectGit={onImportWebProjectGit}
            onOpenShareSource={onOpenShareSource}
            onOpenShareFile={onOpenShareFile}
            onManageSharedSources={onManageSharedSources}
            repository={repository}
            onOpenSafeMode={onOpenSafeMode}
            onRollback={onRollback}
            onToggleExternalExtensions={onToggleExternalExtensions}
            rollbackAvailable={rollbackAvailable}
            rollbackDisabled={protectedActionsLocked}
          />
          {mode === "safe" && (
            <span className="composer__safe-label">Safe mode</span>
          )}
          <ModelMenu
            authEvent={authEvent}
            providerAuthVisible={!providerSetupInline}
            disabled={modelMenuDisabled}
            favoriteKeys={modelFavorites}
            models={models}
            onCancelProviderAuth={onCancelProviderAuth}
            onLoginProvider={onLoginProvider}
            onLogoutProvider={onLogoutProvider}
            onRefreshProviderAuth={onRefreshProviderAuth}
            onReplyProviderAuth={onReplyProviderAuth}
            onSelect={onSelectModel}
            onSelectReasoning={onSelectReasoning}
            onToggleFavorite={onToggleModelFavorite}
            providers={providers}
            reasoningLevel={reasoningLevel}
            selectedModel={selectedModel}
          />
        </PromptInputTools>

        <div className="composer__actions">
          <PromptInputSubmit
            aria-describedby={helpId}
            aria-label={isActive ? `Stop ${roleName}` : `Send to ${roleName}`}
            className="submit-button"
            disabled={isActive ? status === "cancelling" : !canSubmit}
            onStop={() => void onCancel()}
            status={
              status === "streaming"
                ? "streaming"
                : status === "submitting" || status === "cancelling"
                  ? "submitted"
                  : status === "error"
                    ? "error"
                    : "ready"
            }
          />
        </div>
      </PromptInputFooter>
      <span className="sr-only" id={helpId}>
        {help}
      </span>
    </PromptInput>
  );
}
