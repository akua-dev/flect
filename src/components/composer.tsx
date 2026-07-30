import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import {
  type AgentSessionStatus,
  isAgentSessionActive,
} from "../hooks/use-agent-session";
import { ComposerActionsMenu } from "./composer-actions-menu";
import { ArrowUpIcon, StopIcon } from "./icons";
import { ModelMenu } from "./model-menu";

const MAX_COMPOSER_HEIGHT = 168;
const MIN_COMPOSER_HEIGHT = 48;

export interface ComposerProps {
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly status: AgentSessionStatus;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly rollbackAvailable: boolean;
  readonly onSelectModel: (model: ModelSummary | undefined) => void;
  readonly onSubmit: (prompt: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onOpenShaper: () => void;
  readonly onRollback: () => Promise<void>;
  readonly onOpenSafeMode: () => void;
}

export function Composer({
  placeholder,
  disabled = false,
  status,
  models,
  selectedModel,
  rollbackAvailable,
  onSelectModel,
  onSubmit,
  onCancel,
  onOpenShaper,
  onRollback,
  onOpenSafeMode,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const isActive = isAgentSessionActive(status);
  const isUnavailable =
    disabled ||
    status === "booting" ||
    status === "unavailable" ||
    status === "setup-required";
  const canSubmit = prompt.trim().length > 0 && !isUnavailable && !isActive;
  const help = disabled
    ? "Wait for the current interface proposal."
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
                : "Press Enter to send. Press Shift Enter for a new line.";

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
    setPrompt("");
    await operation;
  };

  return (
    <form
      aria-busy={isActive}
      className={`composer${isActive ? " composer--active" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-describedby={helpId}
        aria-label="Message Flect"
        disabled={isUnavailable}
        name="prompt"
        onChange={(event) => setPrompt(event.target.value)}
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
            onOpenSafeMode={onOpenSafeMode}
            onOpenShaper={onOpenShaper}
            onRollback={onRollback}
            rollbackAvailable={rollbackAvailable}
            rollbackDisabled={isUnavailable || isActive}
          />
          <ModelMenu
            disabled={isUnavailable || isActive}
            models={models}
            onSelect={onSelectModel}
            selectedModel={selectedModel}
          />
        </div>

        <div className="composer__actions">
          {isActive ? (
            <button
              aria-describedby={helpId}
              aria-label="Stop response"
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
              aria-label="Send message"
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
