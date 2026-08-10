import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import { ComposerActionsMenu } from "./composer-actions-menu";
import { ArrowUpIcon, StopIcon } from "./icons";
import { ModelMenu } from "./model-menu";
import type { ConversationTarget, ShellMode } from "./role-switcher";

const MAX_COMPOSER_HEIGHT = 168;
const MIN_COMPOSER_HEIGHT = 48;

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
  const composingRef = useRef(false);
  const submittingRef = useRef(false);
  const initialFocusAttemptedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const draftKey = "accepted-use";
  const continuityKey: keyof ContinuityDrafts = "acceptedUse";
  const prompt = mode === "safe" ? "" : (drafts[draftKey] ?? "");
  const isActive = isAgentSessionActive(status);
  const protectedActionsLocked = submitting || isActive;
  const isUnavailable =
    disabled ||
    mode === "safe" ||
    status === "booting" ||
    status === "unavailable" ||
    status === "setup-required";
  const modelMenuDisabled =
    disabled ||
    mode === "safe" ||
    status === "booting" ||
    status === "unavailable" ||
    protectedActionsLocked;
  const canSubmit =
    prompt.trim().length > 0 && !isUnavailable && !protectedActionsLocked;
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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (
      initialFocusAttemptedRef.current ||
      textarea === null ||
      isUnavailable ||
      globalThis.matchMedia?.("(pointer: coarse)").matches === true
    ) {
      return;
    }
    initialFocusAttemptedRef.current = true;
    const active = textarea.ownerDocument.activeElement;
    if (active === null || active === textarea.ownerDocument.body) {
      textarea.focus({ preventScroll: true });
    }
  }, [isUnavailable]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }

    textarea.style.height = "0px";
    const measuredHeight = Math.max(textarea.scrollHeight, MIN_COMPOSER_HEIGHT);
    textarea.style.height = `${Math.min(
      measuredHeight,
      MAX_COMPOSER_HEIGHT,
    )}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  });

  const submit = async () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || submittingRef.current || isActive || isUnavailable) {
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
    <form
      aria-busy={isActive}
      className={`composer${isActive ? " composer--active" : ""}`}
      data-composer-role="flect"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-describedby={helpId}
        aria-label={`Message ${roleName}`}
        disabled={isUnavailable}
        name="prompt"
        onChange={(event) => {
          const value = event.target.value;
          setDrafts((current) => ({
            ...current,
            [draftKey]: value,
          }));
          void onDraftChange?.(continuityKey, value);
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !composingRef.current
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={prompt}
      />

      <div className="composer__rail">
        <div className="composer__tools">
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
        </div>

        <div className="composer__actions">
          {isActive ? (
            <button
              aria-describedby={helpId}
              aria-label={`Stop ${roleName}`}
              className="submit-button submit-button--stop"
              disabled={status === "cancelling"}
              onClick={() => void onCancel()}
              type="button"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              aria-describedby={helpId}
              aria-label={`Send to ${roleName}`}
              className="submit-button"
              disabled={!canSubmit}
              type="submit"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
      <span className="sr-only" id={helpId}>
        {help}
      </span>
    </form>
  );
}
