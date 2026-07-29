import { useRef, useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import type { AgentSessionStatus } from "../hooks/use-agent-session";
import {
  AddIcon,
  ArrowUpIcon,
  CapabilitiesIcon,
  MicrophoneIcon,
  StopIcon,
} from "./icons";
import { ModelMenu } from "./model-menu";

export interface ComposerProps {
  readonly placeholder: string;
  readonly status: AgentSessionStatus;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly onSelectModel: (model: ModelSummary | undefined) => void;
  readonly onSubmit: (prompt: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onSecondaryAction: (message: string) => void;
}

export function Composer({
  placeholder,
  status,
  models,
  selectedModel,
  onSelectModel,
  onSubmit,
  onCancel,
  onSecondaryAction,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const composingRef = useRef(false);
  const isActive = status === "submitting" || status === "streaming";
  const isUnavailable = status === "booting" || status === "unavailable";
  const canSubmit = prompt.trim().length > 0 && !isUnavailable;
  const help =
    status === "booting"
      ? "Connecting to the local runtime."
      : status === "unavailable"
        ? "Start the local runtime before shaping."
        : prompt.trim().length === 0
          ? "Enter a prompt to enable Shape."
          : "Press Enter to shape. Press Shift Enter for a new line.";

  const submit = async () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isActive || isUnavailable) {
      return;
    }

    setPrompt("");
    await onSubmit(nextPrompt);
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
        aria-describedby="composer-help"
        aria-label="Describe what to shape"
        disabled={isUnavailable}
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
        name="prompt"
        placeholder={placeholder}
        rows={3}
        value={prompt}
      />

      <div className="composer__rail">
        <div className="composer__tools">
          <button
            aria-label="Add context"
            className="icon-button"
            onClick={() =>
              onSecondaryAction("Context sources are coming next.")
            }
            type="button"
          >
            <AddIcon />
          </button>
          <button
            aria-label="Capabilities"
            className="icon-button"
            onClick={() =>
              onSecondaryAction(
                "Capabilities will stay explicit and revocable.",
              )
            }
            type="button"
          >
            <CapabilitiesIcon />
          </button>
          <span className="composer__divider" />
          <ModelMenu
            disabled={isUnavailable || isActive}
            models={models}
            onSelect={onSelectModel}
            selectedModel={selectedModel}
          />
        </div>

        <div className="composer__actions">
          <button
            aria-label="Voice input"
            className="icon-button"
            onClick={() =>
              onSecondaryAction("Voice input is not available yet.")
            }
            type="button"
          >
            <MicrophoneIcon />
          </button>
          {isActive ? (
            <button
              aria-label="Stop response"
              className="submit-button submit-button--stop"
              onClick={() => void onCancel()}
              type="button"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              aria-describedby="composer-help"
              aria-label="Shape"
              className="submit-button"
              disabled={!canSubmit}
              type="submit"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
      <span className="sr-only" id="composer-help">
        {help}
      </span>
    </form>
  );
}
