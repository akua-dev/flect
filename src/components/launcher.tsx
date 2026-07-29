import { useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import type { InterfaceDocument } from "../../shared/interface-document";
import type {
  AgentSessionStatus,
  ConversationMessage,
} from "../hooks/use-agent-session";
import { Composer } from "./composer";
import { RefreshIcon } from "./icons";
import { MessageContent } from "./message-content";

export interface LauncherController {
  readonly status: AgentSessionStatus;
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly selectModel: (model: ModelSummary | undefined) => void;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
  readonly submit: (prompt: string) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export interface LauncherProps {
  readonly document: InterfaceDocument;
  readonly safeMode: boolean;
  readonly session: LauncherController;
}

const actionLabel = {
  open: "Open",
  extensions: "Extensions",
  connect: "Connect",
} as const;

function RuntimeState({ status }: { readonly status: AgentSessionStatus }) {
  const ready = status !== "booting" && status !== "unavailable";
  return (
    <span aria-live="polite" className="runtime-state" role="status">
      <span
        className={`runtime-state__dot${ready ? " runtime-state__dot--ready" : ""}`}
      />
      {status === "booting"
        ? "Finding Pi"
        : ready
          ? "Pi ready"
          : "Runtime offline"}
    </span>
  );
}

function Conversation({
  messages,
  status,
}: {
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly status: AgentSessionStatus;
}) {
  return (
    <div aria-label="Conversation" className="conversation" role="log">
      {messages.map((message, index) => {
        const isLatest = index === messages.length - 1;
        return (
          <article
            className={`message message--${message.role}`}
            key={message.id}
          >
            <span className="sr-only">
              {message.role === "user" ? "You" : "Flect"}
            </span>
            {message.content ? (
              <MessageContent content={message.content} />
            ) : (
              isLatest &&
              status !== "error" && (
                <span className="thinking" role="status">
                  <span className="sr-only">Flect is responding</span>
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

export function Launcher({ document, safeMode, session }: LauncherProps) {
  const [notice, setNotice] = useState<string>();
  const hasConversation = session.messages.length > 0;

  return (
    <div className={`shell${hasConversation ? " shell--conversation" : ""}`}>
      <header className="topbar">
        <a aria-label="Flect home" className="wordmark" href="/">
          <span>Flect</span>
        </a>
        <div className="topbar__status">
          {safeMode ? (
            <span className="safe-mode">Safe mode</span>
          ) : (
            <a className="safe-mode-link" href="/?safe=1">
              Safe mode
            </a>
          )}
          <RuntimeState status={session.status} />
        </div>
      </header>

      <main className="workspace">
        {hasConversation ? (
          <Conversation messages={session.messages} status={session.status} />
        ) : (
          <section className="invitation">
            <h1>{document.headline}</h1>
          </section>
        )}

        <section className="composer-area">
          {session.status === "unavailable" && (
            <div className="runtime-alert" role="alert">
              <div>
                <strong>Local runtime offline</strong>
                <p>{session.error}</p>
              </div>
              <button
                className="retry-button"
                onClick={() => void session.refresh()}
                type="button"
              >
                <RefreshIcon />
                Try again
              </button>
            </div>
          )}

          {session.status === "error" && session.error && (
            <div className="runtime-alert" role="alert">
              <div>
                <strong>The turn stopped</strong>
                <p>{session.error}</p>
              </div>
              {session.lastPrompt && (
                <button
                  className="retry-button"
                  onClick={() => void session.submit(session.lastPrompt)}
                  type="button"
                >
                  <RefreshIcon />
                  Retry
                </button>
              )}
            </div>
          )}

          <Composer
            document={document}
            models={session.models}
            onCancel={session.cancel}
            onSecondaryAction={setNotice}
            onSelectModel={session.selectModel}
            onSubmit={session.submit}
            selectedModel={session.selectedModel}
            status={session.status}
          />

          <div className="secondary-rail">
            <div className="secondary-actions">
              {document.secondaryActions.map((action) => (
                <button
                  key={action}
                  onClick={() =>
                    setNotice(
                      `${actionLabel[action]} is ready for the extension layer.`,
                    )
                  }
                  type="button"
                >
                  {actionLabel[action]}
                </button>
              ))}
            </div>
            <span className="privacy-note">Local shell · models via Pi</span>
          </div>

          <p aria-live="polite" className="notice">
            {notice ?? (safeMode ? "Custom interface state is bypassed." : "")}
          </p>
        </section>
      </main>
    </div>
  );
}
