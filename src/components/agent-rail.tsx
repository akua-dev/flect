import { useEffect } from "react";
import type { InterfaceDocument } from "../../shared/interface-document";
import type {
  AgentWorkspaceController,
  ConversationMessage,
} from "../hooks/use-agent-session";
import { isAgentSessionActive } from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import { Composer } from "./composer";
import { PanelCloseIcon, RefreshIcon } from "./icons";
import { MessageContent } from "./message-content";
import type { ShellMode } from "./role-switcher";

export interface ShapingController {
  readonly status: "idle" | "shaping" | "preview" | "error";
  readonly error?: string;
  readonly rollbackAvailable: boolean;
  readonly isolation: "unchecked" | "checking" | "ready" | "unavailable";
  readonly verifyIsolation: () => Promise<void>;
  readonly request: (instruction: string) => Promise<void>;
  readonly accept: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

export interface AgentRailProps {
  readonly mode: ShellMode;
  readonly document: InterfaceDocument;
  readonly workspace: AgentWorkspaceController;
  readonly shaping: ShapingController;
  readonly preferences: ShellPreferencesController;
  readonly onModeChange: (mode: Exclude<ShellMode, "safe">) => void;
  readonly onCollapse: () => void;
  readonly onOpenSafeMode: () => void;
  readonly onRestoreSafeMode: () => Promise<void>;
}

function RuntimeState({
  status,
}: {
  readonly status: AgentWorkspaceController["app"]["status"];
}) {
  const ready =
    status !== "booting" &&
    status !== "unavailable" &&
    status !== "setup-required";
  return (
    <span aria-live="polite" className="runtime-state" role="status">
      <span
        className={`runtime-state__dot${ready ? " runtime-state__dot--ready" : ""}`}
      />
      {status === "booting"
        ? "Finding Pi"
        : status === "setup-required"
          ? "Pi setup needed"
          : status === "cancelling"
            ? "Stopping"
            : ready
              ? "Pi ready"
              : "Runtime offline"}
    </span>
  );
}

function Conversation({
  messages,
  status,
  label,
}: {
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly status: AgentWorkspaceController["app"]["status"];
  readonly label: string;
}) {
  return (
    <div
      aria-label={`${label} conversation`}
      aria-live="polite"
      className="conversation"
      role="log"
    >
      {messages.length === 0 && (
        <div className="conversation__empty">
          <strong>
            {label === "Shaper"
              ? "Shape the interface in plain language."
              : "Use the app through its agent."}
          </strong>
          <p>
            {label === "Shaper"
              ? "Every proposal is validated before it reaches the canvas."
              : "Ask about the current experience or call an approved action."}
          </p>
        </div>
      )}
      {messages.map((message, index) => {
        const isLatest = index === messages.length - 1;
        return (
          <article
            className={`message message--${message.role}`}
            key={message.id}
          >
            <span className="sr-only">
              {message.role === "user"
                ? "You"
                : message.role === "activity"
                  ? "Activity"
                  : label}
            </span>
            {message.content ? (
              <MessageContent content={message.content} />
            ) : (
              isLatest &&
              (status === "submitting" || status === "streaming") && (
                <span className="thinking" role="status">
                  <span className="sr-only">{label} is responding</span>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </span>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}

export function AgentRail({
  mode,
  document,
  workspace,
  shaping,
  preferences,
  onModeChange,
  onCollapse,
  onOpenSafeMode,
  onRestoreSafeMode,
}: AgentRailProps) {
  const controller = mode === "run" ? workspace.app : workspace.shaper;
  const roleLabel =
    mode === "run" ? "App Agent" : mode === "safe" ? "Recovery" : "Shaper";
  const operationActive =
    isAgentSessionActive(workspace.app.status) ||
    isAgentSessionActive(workspace.shaper.status) ||
    shaping.status === "shaping";
  const previewBlocked = shaping.status === "preview";

  useEffect(() => {
    if (shaping.status === "preview") {
      void shaping.verifyIsolation();
    }
  }, [shaping.status, shaping.verifyIsolation]);

  return (
    <aside
      aria-label="Flect agent"
      className="agent-rail"
      data-mode={mode}
      tabIndex={-1}
    >
      <header className="agent-rail__header">
        <div className="agent-rail__identity">
          <strong>{roleLabel}</strong>
          <span>
            {mode === "run"
              ? "Use app"
              : mode === "safe"
                ? "Protected shell"
                : "Edit interface"}
          </span>
        </div>
        <div className="agent-rail__header-actions">
          <RuntimeState status={controller.status} />
          <button
            aria-label="Collapse agent"
            className="icon-button"
            onClick={onCollapse}
            type="button"
          >
            <PanelCloseIcon />
          </button>
        </div>
      </header>

      <Conversation
        label={roleLabel}
        messages={controller.messages}
        status={controller.status}
      />

      <div className="agent-rail__dock">
        {mode === "safe" && (
          <section className="recovery-banner" role="status">
            <div>
              <strong>Custom interface state is bypassed.</strong>
              <p>Restore the last-known-good revision to return.</p>
            </div>
            <button
              className="decision-button decision-button--primary"
              onClick={() => void onRestoreSafeMode()}
              type="button"
            >
              Restore interface
            </button>
          </section>
        )}

        {shaping.status === "preview" && (
          <section aria-label="Revision decision" className="revision-banner">
            <div className="revision-banner__copy">
              <span>Validated preview</span>
              <strong>{document.name}</strong>
              <small>
                {shaping.isolation === "ready"
                  ? "Extensions isolated"
                  : shaping.isolation === "unavailable"
                    ? "Extension isolation unavailable"
                    : "Checking extension isolation"}
              </small>
            </div>
            <div className="revision-banner__actions">
              <button
                className="decision-button decision-button--primary"
                disabled={operationActive}
                onClick={() => void shaping.accept()}
                type="button"
              >
                Keep change
              </button>
              <button
                className="decision-button"
                disabled={operationActive}
                onClick={() => void shaping.reject()}
                type="button"
              >
                Reject
              </button>
            </div>
          </section>
        )}

        {(controller.status === "unavailable" ||
          controller.status === "setup-required") && (
          <div className="runtime-alert" role="alert">
            <div>
              <strong>
                {controller.status === "setup-required"
                  ? "Pi setup needed"
                  : "Local runtime offline"}
              </strong>
              <p>{controller.error}</p>
            </div>
            <button
              className="retry-button"
              onClick={() => void workspace.refresh()}
              type="button"
            >
              <RefreshIcon />
              Try again
            </button>
          </div>
        )}

        {(controller.status === "error" ||
          controller.status === "cancelling" ||
          shaping.status === "error") && (
          <div className="runtime-alert" role="alert">
            <div>
              <strong>
                {controller.status === "cancelling"
                  ? "Still stopping"
                  : mode === "edit"
                    ? "The interface was not changed"
                    : "The turn stopped"}
              </strong>
              <p>{shaping.error ?? controller.error}</p>
            </div>
          </div>
        )}

        <Composer
          disabled={previewBlocked || mode === "safe"}
          disabledReason={
            previewBlocked
              ? "Keep or reject the preview before shaping again."
              : undefined
          }
          externalExtensionsEnabled={
            mode === "run"
              ? workspace.externalExtensions.app
              : workspace.externalExtensions.shaper
          }
          mode={mode}
          modelFavorites={preferences.value.modelFavorites}
          models={workspace.models}
          onCancel={controller.cancel}
          onModeChange={onModeChange}
          onOpenSafeMode={onOpenSafeMode}
          onRollback={shaping.rollback}
          onSelectModel={workspace.selectModel}
          onToggleExternalExtensions={() =>
            workspace.toggleExternalExtensions(mode === "run" ? "app" : "shaper")
          }
          onSubmit={
            mode === "run"
              ? workspace.app.submit
              : mode === "edit"
                ? shaping.request
                : async () => undefined
          }
          onToggleModelFavorite={preferences.toggleModelFavorite}
          placeholder={
            mode === "run"
              ? "Ask about this app or take an action"
              : "Build, change, or connect anything"
          }
          roleSwitchDisabled={operationActive || mode === "safe"}
          rollbackAvailable={shaping.rollbackAvailable}
          selectedModel={workspace.selectedModel}
          status={controller.status}
        />
      </div>
    </aside>
  );
}
