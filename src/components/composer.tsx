import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import {
  type AgentSessionStatus,
  isAgentSessionActive,
} from "../hooks/use-agent-session";
import { ComposerActionsMenu } from "./composer-actions-menu";
import { ArrowUpIcon, StopIcon } from "./icons";
import { ModelMenu } from "./model-menu";
import { RoleSwitcher, type ShellMode } from "./role-switcher";

const MAX_COMPOSER_HEIGHT = 168;
const MIN_COMPOSER_HEIGHT = 48;

export interface ComposerProps {
  readonly mode: ShellMode;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly roleSwitchDisabled: boolean;
  readonly status: AgentSessionStatus;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly modelFavorites: ReadonlyArray<string>;
  readonly rollbackAvailable: boolean;
  readonly onModeChange: (mode: Exclude<ShellMode, "safe">) => void;
  readonly onSelectModel: (model: ModelSummary | undefined) => void;
  readonly onToggleModelFavorite: (modelKey: string) => Promise<void>;
  readonly onSubmit: (prompt: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onRollback: () => Promise<void>;
  readonly onOpenSafeMode: () => void;
  readonly externalExtensionsEnabled: boolean;
  readonly onToggleExternalExtensions: () => Promise<void>;
}

export function Composer({
  mode,
  placeholder,
  disabled = false,
  disabledReason,
  roleSwitchDisabled,
  status,
  models,
  selectedModel,
  modelFavorites,
  rollbackAvailable,
  onModeChange,
  onSelectModel,
  onToggleModelFavorite,
  onSubmit,
  onCancel,
  onRollback,
  onOpenSafeMode,
  externalExtensionsEnabled,
  onToggleExternalExtensions,
}: ComposerProps) {
  const [drafts, setDrafts] = useState({ edit: "", run: "" });
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const roleMode = mode === "safe" ? "edit" : mode;
  const prompt = mode === "safe" ? "" : drafts[roleMode];
  const isActive = isAgentSessionActive(status);
  const isUnavailable =
    disabled ||
    mode === "safe" ||
    status === "booting" ||
    status === "unavailable" ||
    status === "setup-required";
  const canSubmit = prompt.trim().length > 0 && !isUnavailable && !isActive;
  const roleName = mode === "run" ? "App Agent" : "Shaper";
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
            : status === "cancelling"
              ? "Stopping the current response."
              : status === "submitting" || status === "streaming"
                ? "Stop the current response before sending another message."
                : prompt.trim().length === 0
                  ? "Enter a message to enable Send."
                  : "Press Enter to send. Press Shift Enter for a new line.");

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
    if (!nextPrompt || isActive || isUnavailable) {
      return;
    }

    const operation = onSubmit(nextPrompt);
    setDrafts((current) => ({ ...current, [roleMode]: "" }));
    await operation;
  };

  return (
    <form
      aria-busy={isActive}
      className={`composer${isActive ? " composer--active" : ""}`}
      data-composer-role={mode}
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
        onChange={(event) =>
          setDrafts((current) => ({
            ...current,
            [roleMode]: event.target.value,
          }))
        }
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
            disabled={isUnavailable || isActive}
            externalExtensionsEnabled={externalExtensionsEnabled}
            onOpenSafeMode={onOpenSafeMode}
            onRollback={onRollback}
            onToggleExternalExtensions={onToggleExternalExtensions}
            rollbackAvailable={rollbackAvailable}
            rollbackDisabled={isUnavailable || isActive}
          />
          {mode === "safe" ? (
            <span className="composer__safe-label">Safe mode</span>
          ) : (
            <RoleSwitcher
              disabled={roleSwitchDisabled}
              mode={mode}
              onChange={onModeChange}
            />
          )}
          <ModelMenu
            disabled={isUnavailable || isActive}
            favoriteKeys={modelFavorites}
            models={models}
            onSelect={onSelectModel}
            onToggleFavorite={onToggleModelFavorite}
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
