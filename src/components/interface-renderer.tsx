import type { ReactNode } from "react";
import type { InterfaceActionProjection } from "../../shared/interface-actions";
import type {
  AgentPanelNode,
  InterfaceAction,
  InterfaceDocument,
  InterfaceNode,
  PromptNode,
} from "../../shared/interface-document";

export type { InterfaceAction } from "../../shared/interface-document";

export interface InterfaceRendererProps {
  readonly document: InterfaceDocument;
  readonly actions?: ReadonlyArray<InterfaceActionProjection>;
  readonly onAction: (action: InterfaceAction, nodeId: string) => void;
  readonly renderPrompt: (node: PromptNode) => ReactNode;
  readonly renderAgentPanel?: (node: AgentPanelNode) => ReactNode;
}

interface NodeRendererProps extends Omit<InterfaceRendererProps, "document"> {
  readonly node: InterfaceNode;
}

function NodeRenderer({
  node,
  onAction,
  actions,
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
              actions={actions}
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
    case "button": {
      const projection = actions?.find((action) => action.nodeId === node.id);
      return (
        <button
          className="interface-action"
          disabled={projection?.available === false}
          onClick={() => onAction(node.action, node.id)}
          title={projection?.unavailableReason}
          type="button"
        >
          {node.label}
        </button>
      );
    }
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
  actions,
  onAction,
  renderPrompt,
  renderAgentPanel,
}: InterfaceRendererProps) {
  return (
    <section aria-label={document.name} className="interface-canvas">
      <NodeRenderer
        actions={actions}
        node={document.root}
        onAction={onAction}
        renderAgentPanel={renderAgentPanel}
        renderPrompt={renderPrompt}
      />
    </section>
  );
}
