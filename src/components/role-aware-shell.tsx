import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { InterfaceDocument } from "../../shared/interface-document";
import type { AgentWorkspaceController } from "../hooks/use-agent-session";
import { isAgentSessionActive } from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import type { WorkspacePhase } from "../lib/workspace-phase";
import { AgentRail, type ShapingController } from "./agent-rail";
import { PanelOpenIcon } from "./icons";
import { type InterfaceAction, InterfaceRenderer } from "./interface-renderer";
import { ProductSurface } from "./product-surface";
import type { ShellMode } from "./role-switcher";

export type { ShellMode } from "./role-switcher";

export interface RoleAwareShellProps {
  readonly phase: WorkspacePhase;
  readonly document: InterfaceDocument;
  readonly preview: boolean;
  readonly workspace: AgentWorkspaceController;
  readonly shaping: ShapingController;
  readonly preferences: ShellPreferencesController;
  readonly onOpenSafeMode: () => void;
  readonly onRestoreSafeMode: () => Promise<void>;
}

const focusableSelector = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const initialMode = (phase: WorkspacePhase): ShellMode =>
  phase === "accepted" ? "run" : phase === "safe" ? "safe" : "edit";

export function RoleAwareShell({
  phase,
  document,
  preview,
  workspace,
  shaping,
  preferences,
  onOpenSafeMode,
  onRestoreSafeMode,
}: RoleAwareShellProps) {
  const [mode, setMode] = useState<ShellMode>(() => initialMode(phase));
  const [compactViewport, setCompactViewport] = useState(
    () => globalThis.matchMedia?.("(max-width: 980px)").matches ?? false,
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const railContainerRef = useRef<HTMLDivElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const shouldFocusRailRef = useRef(false);
  const resizeOriginRef = useRef<
    | {
        readonly pointerX: number;
        readonly width: number;
      }
    | undefined
  >(undefined);
  const composerRectRef = useRef<DOMRect | undefined>(undefined);
  const shellStyle: CSSProperties & Record<"--flect-rail-width", string> = {
    "--flect-rail-width": `${preferences.value.railWidth}px`,
  };

  const hasShaperActivity =
    workspace.shaper.messages.length > 0 || shaping.status !== "idle";
  const docked =
    phase === "accepted" || phase === "preview" || hasShaperActivity;
  const collapsed =
    docked && phase !== "safe" && preferences.value.railCollapsed;
  const operationActive =
    isAgentSessionActive(workspace.app.status) ||
    isAgentSessionActive(workspace.shaper.status) ||
    shaping.status === "shaping";

  useEffect(() => {
    if (phase === "safe") {
      setMode("safe");
    } else if (phase === "preview" || phase === "blank") {
      setMode("edit");
    } else if (mode === "safe") {
      setMode("run");
    }
  }, [mode, phase]);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(max-width: 980px)");
    if (media === undefined) {
      return;
    }
    const update = () => setCompactViewport(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!collapsed && shouldFocusRailRef.current) {
      shouldFocusRailRef.current = false;
      queueMicrotask(() => {
        railContainerRef.current
          ?.querySelector<HTMLElement>(".agent-rail button:not(:disabled)")
          ?.focus();
      });
    }
  }, [collapsed]);

  useLayoutEffect(() => {
    if (collapsed) {
      return;
    }
    const composer =
      railContainerRef.current?.querySelector<HTMLElement>(".composer");
    if (composer === undefined || composer === null) {
      return;
    }
    composer.dataset.layout = docked ? "rail" : "center";
    const next = composer.getBoundingClientRect();
    const previous = composerRectRef.current;
    composerRectRef.current = next;
    const reduced =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false;
    if (
      previous === undefined ||
      reduced ||
      typeof composer.animate !== "function" ||
      (previous.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width &&
        previous.height === next.height)
    ) {
      return;
    }
    const scaleX = next.width === 0 ? 1 : previous.width / next.width;
    const scaleY = next.height === 0 ? 1 : previous.height / next.height;
    composer.animate(
      [
        {
          transform: `translate(${previous.x - next.x}px, ${previous.y - next.y}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: "top left",
        },
        { transform: "none", transformOrigin: "top left" },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }, [collapsed, docked]);

  const selectMode = useCallback(
    (next: Exclude<ShellMode, "safe">) => {
      if (operationActive || phase === "safe") {
        return;
      }
      setMode(next);
      if (preferences.value.railCollapsed) {
        shouldFocusRailRef.current = true;
        void preferences.setRailCollapsed(false);
      }
    },
    [operationActive, phase, preferences],
  );

  const collapse = useCallback(() => {
    void preferences.setRailCollapsed(true).then(() => {
      queueMicrotask(() => reopenRef.current?.focus());
    });
  }, [preferences]);

  const expand = useCallback(() => {
    shouldFocusRailRef.current = true;
    void preferences.setRailCollapsed(false);
  }, [preferences]);

  useEffect(() => {
    if (!compactViewport || !docked || collapsed) {
      return;
    }
    queueMicrotask(() => {
      railContainerRef.current
        ?.querySelector<HTMLElement>(".agent-rail button:not(:disabled)")
        ?.focus();
    });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        collapse();
      }
    };
    globalThis.document.addEventListener("keydown", closeOnEscape);
    return () =>
      globalThis.document.removeEventListener("keydown", closeOnEscape);
  }, [collapse, collapsed, compactViewport, docked]);

  const handleInterfaceAction = useCallback(
    (action: InterfaceAction) => {
      switch (action) {
        case "shape":
          selectMode("edit");
          break;
        case "safe-mode":
          onOpenSafeMode();
          break;
        case "accept-revision":
          void shaping.accept();
          break;
        case "reject-revision":
          void shaping.reject();
          break;
        case "rollback-revision":
          void shaping.rollback();
          break;
      }
    },
    [onOpenSafeMode, selectMode, shaping],
  );

  const resizeBy = useCallback(
    (delta: number) =>
      preferences.setRailWidth(preferences.value.railWidth + delta),
    [preferences],
  );

  const handleSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowLeft"
        ? 16
        : event.key === "ArrowRight"
          ? -16
          : event.key === "Home"
            ? 340 - preferences.value.railWidth
            : event.key === "End"
              ? 520 - preferences.value.railWidth
              : 0;
    if (delta !== 0) {
      event.preventDefault();
      void resizeBy(delta);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    resizeOriginRef.current = {
      pointerX: event.clientX,
      width: preferences.value.railWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = resizeOriginRef.current;
    if (origin === undefined) {
      return;
    }
    void preferences.setRailWidth(
      origin.width + (origin.pointerX - event.clientX),
    );
  };

  const finishResize = () => {
    resizeOriginRef.current = undefined;
  };

  const handleRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!compactViewport || collapsed) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      collapse();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const elements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const first = elements[0];
    const last = elements.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`role-shell${docked ? " role-shell--split" : " role-shell--centered"}${collapsed ? " role-shell--collapsed" : ""}${preview ? " role-shell--preview" : ""}`}
      data-mode={mode}
      data-reduced-motion={
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "true"
          : "false"
      }
      ref={shellRef}
      style={shellStyle}
    >
      <header className="topbar">
        <a aria-label="Flect home" className="wordmark" href="/">
          Flect
        </a>
        <div className="topbar__status">
          {phase === "safe" ? (
            <span className="safe-mode">Safe mode</span>
          ) : (
            <button
              className="safe-mode-link"
              onClick={onOpenSafeMode}
              type="button"
            >
              Safe mode
            </button>
          )}
        </div>
      </header>

      <main className="workspace-canvas">
        {!docked ? (
          <section className="blank-invitation">
            <h1>What should we shape?</h1>
          </section>
        ) : (
          <InterfaceRenderer
            document={document}
            onAction={handleInterfaceAction}
            renderProductSurface={(node) =>
              phase === "safe" ? null : (
                <ProductSurface
                  enabled
                  node={node}
                  productAction={workspace.productAction}
                />
              )
            }
            renderPrompt={() => (
              <button
                className="canvas-agent-entry"
                onClick={expand}
                type="button"
              >
                Open {mode === "run" ? "App Agent" : "Shaper"}
              </button>
            )}
          />
        )}
      </main>

      <div
        aria-hidden={collapsed}
        className="agent-rail-container"
        data-layout={docked ? "rail" : "center"}
        inert={collapsed}
        onKeyDown={handleRailKeyDown}
        ref={railContainerRef}
      >
        {docked && !compactViewport && !collapsed && (
          <hr
            aria-label="Resize agent panel"
            aria-orientation="vertical"
            aria-valuemax={520}
            aria-valuemin={340}
            aria-valuenow={preferences.value.railWidth}
            className="agent-rail-resizer"
            onKeyDown={handleSeparatorKeyDown}
            onPointerCancel={finishResize}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishResize}
            tabIndex={0}
          />
        )}
        <AgentRail
          document={document}
          mode={mode}
          onCollapse={collapse}
          onModeChange={selectMode}
          onOpenSafeMode={onOpenSafeMode}
          onRestoreSafeMode={onRestoreSafeMode}
          preferences={preferences}
          shaping={shaping}
          workspace={workspace}
        />
      </div>

      {docked && collapsed && (
        <button
          aria-label="Open Flect agent"
          className="agent-reopen"
          onClick={expand}
          ref={reopenRef}
          type="button"
        >
          <PanelOpenIcon />
          <span>{mode === "run" ? "App Agent" : "Shaper"}</span>
        </button>
      )}
      {compactViewport && docked && !collapsed && (
        <button
          aria-label="Close agent panel"
          className="sheet-backdrop"
          onClick={collapse}
          type="button"
        />
      )}
    </div>
  );
}
