import type { ReactNode } from "react";
import type {
  AgentPanelNode,
  InterfaceDocument,
  InterfaceNode,
  PromptNode,
} from "../../shared/interface-document";

export type InterfaceAction =
  | "open"
  | "extensions"
  | "connect"
  | "shape"
  | "safe-mode"
  | "accept-revision"
  | "reject-revision"
  | "rollback-revision";

export interface InterfaceRendererProps {
  readonly document: InterfaceDocument;
  readonly onAction: (action: InterfaceAction) => void;
  readonly renderPrompt: (node: PromptNode) => ReactNode;
  readonly renderAgentPanel?: (node: AgentPanelNode) => ReactNode;
}

interface NodeRendererProps extends Omit<InterfaceRendererProps, "document"> {
  readonly node: InterfaceNode;
}

function NodeRenderer({
  node,
  onAction,
  renderPrompt,
  renderAgentPanel,
}: NodeRendererProps) {
  switch (node.type) {
    case "stack":
      return (
        <div
          className={`interface-stack interface-stack--${node.direction} interface-stack--gap-${node.gap}`}
          data-node-id={node.id}
        >
          {node.children.map((child) => (
            <NodeRenderer
              key={child.id}
              node={child}
              onAction={onAction}
              renderAgentPanel={renderAgentPanel}
              renderPrompt={renderPrompt}
            />
          ))}
        </div>
      );
    case "text":
      return node.style === "headline" ? (
        <h1 className="interface-text interface-text--headline">{node.text}</h1>
      ) : (
        <p className={`interface-text interface-text--${node.style}`}>
          {node.text}
        </p>
      );
    case "prompt":
      return <div className="interface-prompt">{renderPrompt(node)}</div>;
    case "button":
      return (
        <button
          className="interface-action"
          onClick={() => onAction(node.action)}
          type="button"
        >
          {node.label}
        </button>
      );
    case "divider":
      return <hr className="interface-divider" />;
    case "agent-panel":
      return renderAgentPanel ? (
        renderAgentPanel(node)
      ) : (
        <aside className="interface-agent-panel">
          <h2>{node.title}</h2>
        </aside>
      );
  }
}

export function InterfaceRenderer({
  document,
  onAction,
  renderPrompt,
  renderAgentPanel,
}: InterfaceRendererProps) {
  return (
    <section aria-label={document.name} className="interface-canvas">
      <NodeRenderer
        node={document.root}
        onAction={onAction}
        renderAgentPanel={renderAgentPanel}
        renderPrompt={renderPrompt}
      />
    </section>
  );
}
