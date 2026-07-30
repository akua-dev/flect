import { useEffect, useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import type {
  InterfaceDocument,
  InterfaceNode,
  PromptNode,
} from "../../shared/interface-document";
import type {
  AgentSessionStatus,
  ConversationMessage,
} from "../hooks/use-agent-session";
import { Composer } from "./composer";
import { RefreshIcon } from "./icons";
import { type InterfaceAction, InterfaceRenderer } from "./interface-renderer";
import { MessageContent } from "./message-content";
import { ShaperPanel, type ShapingController } from "./shaper-panel";

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
  readonly shaping: ShapingController;
  readonly onOpenSafeMode?: () => void;
  readonly onRestoreSafeMode?: () => void;
}

const actionLabel: Record<InterfaceAction, string> = {
  shape: "Shape interface",
  "safe-mode": "Safe mode",
  "accept-revision": "Accept revision",
  "reject-revision": "Reject revision",
  "rollback-revision": "Roll back",
};

function findPrompt(node: InterfaceNode): PromptNode | undefined {
  if (node.type === "prompt") {
    return node;
  }
  if (node.type !== "stack") {
    return undefined;
  }
  for (const child of node.children) {
    const prompt = findPrompt(child);
    if (prompt !== undefined) {
      return prompt;
    }
  }
  return undefined;
}

const defaultPrompt: PromptNode = {
  id: "protected-prompt",
  type: "prompt",
  placeholder: "Build, change, or connect anything",
};

function RuntimeState({ status }: { readonly status: AgentSessionStatus }) {
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
            ? "Stopping response"
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
              (status === "submitting" || status === "streaming") && (
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

export function Launcher({
  document,
  safeMode,
  session,
  shaping,
  onOpenSafeMode = () => globalThis.location.assign("/?safe=1"),
  onRestoreSafeMode = () => globalThis.location.assign("/"),
}: LauncherProps) {
  const [notice, setNotice] = useState<string>();
  const [shaperOpen, setShaperOpen] = useState(false);
  const hasConversation = session.messages.length > 0;
  const documentPrompt = findPrompt(document.root);
  const promptNode = documentPrompt ?? defaultPrompt;

  useEffect(() => {
    if (shaping.status === "preview") {
      setShaperOpen(true);
      void shaping.verifyIsolation();
    }
  }, [shaping.status, shaping.verifyIsolation]);

  const openShaper = () => {
    setShaperOpen(true);
    void shaping.verifyIsolation();
  };

  const handleInterfaceAction = (action: InterfaceAction) => {
    if (action === "safe-mode") {
      onOpenSafeMode();
      return;
    }
    if (action === "shape") {
      openShaper();
      return;
    }
    if (action === "accept-revision") {
      void shaping.accept();
      return;
    }
    if (action === "reject-revision") {
      void shaping.reject();
      return;
    }
    if (action === "rollback-revision") {
      void shaping.rollback();
      return;
    }
    setNotice(`${actionLabel[action]} is ready.`);
  };

  const renderComposer = (node: PromptNode) => (
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

      {session.status === "setup-required" && (
        <div className="runtime-alert" role="alert">
          <div>
            <strong>Pi setup needed</strong>
            <p>{session.error}</p>
          </div>
          <button
            className="retry-button"
            onClick={() => void session.refresh()}
            type="button"
          >
            <RefreshIcon />
            Check again
          </button>
        </div>
      )}

      {(session.status === "error" || session.status === "cancelling") &&
        session.error && (
          <div className="runtime-alert" role="alert">
            <div>
              <strong>
                {session.status === "cancelling"
                  ? "Response is still stopping"
                  : "The turn stopped"}
              </strong>
              <p>{session.error}</p>
            </div>
            {session.status === "cancelling" ? (
              <button
                className="retry-button"
                onClick={() => void session.cancel()}
                type="button"
              >
                <RefreshIcon />
                Try again
              </button>
            ) : (
              session.lastPrompt && (
                <button
                  className="retry-button"
                  onClick={() => void session.submit(session.lastPrompt)}
                  type="button"
                >
                  <RefreshIcon />
                  Retry
                </button>
              )
            )}
          </div>
        )}

      <Composer
        disabled={shaping.status === "shaping"}
        models={session.models}
        onCancel={session.cancel}
        onOpenSafeMode={onOpenSafeMode}
        onOpenShaper={openShaper}
        onRollback={shaping.rollback}
        onSelectModel={session.selectModel}
        onSubmit={session.submit}
        placeholder={node.placeholder}
        rollbackAvailable={shaping.rollbackAvailable === true}
        selectedModel={session.selectedModel}
        status={session.status}
      />
    </section>
  );

  return (
    <div
      className={`shell${hasConversation ? " shell--conversation" : ""}${shaperOpen ? " shell--shaping" : ""}`}
    >
      <header className="topbar">
        <a aria-label="Flect home" className="wordmark" href="/">
          <span>Flect</span>
        </a>
        <div className="topbar__status">
          {safeMode ? (
            <div className="safe-mode-group">
              <span className="safe-mode">Safe mode</span>
              <button
                className="safe-mode-recovery"
                onClick={onRestoreSafeMode}
                type="button"
              >
                Restore last-known-good
              </button>
            </div>
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
          <>
            <Conversation messages={session.messages} status={session.status} />
            {renderComposer(promptNode)}
          </>
        ) : (
          <>
            <InterfaceRenderer
              document={document}
              onAction={handleInterfaceAction}
              renderPrompt={renderComposer}
            />
            {documentPrompt === undefined && renderComposer(defaultPrompt)}
          </>
        )}

        <p aria-live="polite" className="notice">
          {notice ?? (safeMode ? "Custom interface state is bypassed." : "")}
        </p>
      </main>
      {shaperOpen && (
        <ShaperPanel
          agentStatus={session.status}
          controller={shaping}
          onClose={() => setShaperOpen(false)}
        />
      )}
    </div>
  );
}
