import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { CanvasSelection } from "../../shared/canvas-selection";
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
  readonly selectionMode?: boolean;
  readonly selectedNodeId?: string;
  readonly onSelectionChange?: (
    selection: CanvasSelection,
    nodeId: string,
  ) => void;
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
  selectionMode = false,
  selectedNodeId,
}: NodeRendererProps) {
  const selectable = {
    "data-node-id": node.id,
    "data-selected": selectedNodeId === node.id ? "true" : undefined,
    tabIndex: selectionMode ? 0 : undefined,
  };
  switch (node.type) {
    case "stack":
      return (
        <div
          className={`interface-stack interface-stack--${node.direction} interface-stack--gap-${node.gap}`}
          {...selectable}
        >
          {node.children.map((child) => (
            <NodeRenderer
              actions={actions}
              key={child.id}
              node={child}
              onAction={onAction}
              renderAgentPanel={renderAgentPanel}
              renderPrompt={renderPrompt}
              selectedNodeId={selectedNodeId}
              selectionMode={selectionMode}
            />
          ))}
        </div>
      );
    case "text":
      return node.style === "headline" ? (
        <h1 className="interface-text interface-text--headline" {...selectable}>
          {node.text}
        </h1>
      ) : (
        <p
          className={`interface-text interface-text--${node.style}`}
          {...selectable}
        >
          {node.text}
        </p>
      );
    case "prompt":
      return (
        <div className="interface-prompt" {...selectable}>
          {renderPrompt(node)}
        </div>
      );
    case "button": {
      const projection = actions?.find((action) => action.nodeId === node.id);
      return (
        <button
          className="interface-action"
          disabled={projection?.available === false}
          onClick={() => onAction(node.action, node.id)}
          title={projection?.unavailableReason}
          type="button"
          {...selectable}
        >
          {node.label}
        </button>
      );
    }
    case "divider":
      return <hr className="interface-divider" {...selectable} />;
    case "agent-panel":
      return renderAgentPanel ? (
        <div {...selectable}>{renderAgentPanel(node)}</div>
      ) : (
        <aside className="interface-agent-panel" {...selectable}>
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
  selectionMode = false,
  selectedNodeId,
  onSelectionChange,
}: InterfaceRendererProps) {
  const choose = (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    if (!selectionMode || onSelectionChange === undefined) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const element = target.closest<HTMLElement>("[data-node-id]");
    const nodeId = element?.dataset.nodeId;
    if (element === null || element === undefined || nodeId === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = (element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    const label =
      element.getAttribute("aria-label")?.trim().slice(0, 240) ||
      visible.slice(0, 240) ||
      element.localName;
    const role = element.getAttribute("role")?.trim().slice(0, 80);
    onSelectionChange(
      CanvasSelection.make({
        version: 1,
        semanticId: nodeId,
        tag: element.localName,
        label,
        ...(role === undefined || role.length === 0 ? {} : { role }),
        ...(visible.length === 0 ? {} : { text: visible }),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        styles: {
          display: style.display || "initial",
          position: style.position || "static",
          color: style.color || "transparent",
          backgroundColor: style.backgroundColor || "transparent",
          fontSize: style.fontSize || "initial",
          fontWeight: style.fontWeight || "normal",
          gap: style.gap || "normal",
          padding: style.padding || "0px",
          margin: style.margin || "0px",
        },
      }),
      nodeId,
    );
  };
  return (
    <section
      aria-label={document.name}
      className="interface-canvas"
      data-selection-mode={selectionMode ? "true" : "false"}
      onClickCapture={choose}
      onKeyDownCapture={choose}
    >
      <NodeRenderer
        actions={actions}
        node={document.root}
        onAction={onAction}
        renderAgentPanel={renderAgentPanel}
        renderPrompt={renderPrompt}
        selectedNodeId={selectedNodeId}
        selectionMode={selectionMode}
      />
    </section>
  );
}
