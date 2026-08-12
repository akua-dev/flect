import {
  type CSSProperties,
  type KeyboardEvent,
  lazy,
  type PointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PrivateShareSourceSummary } from "../../packages/product/src/host/share-source";
import type { CanvasSelection } from "../../shared/canvas-selection";
import type {
  CapsuleIntent,
  CapsuleIntentOutcome,
} from "../../shared/capsule-protocol";
import type { InterfaceActionProjection } from "../../shared/interface-actions";
import type { InterfaceDocument } from "../../shared/interface-document";
import type { ProductCapabilityDecisionChoice } from "../../shared/product-capability";
import type { ShareInstallationRecord } from "../../shared/share-installation";
import type { ShareReview as ShareReviewContract } from "../../shared/share-review";
import type { AgentWorkspaceController } from "../hooks/use-agent-session";
import { isAgentSessionActive } from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import type { CapsulePresentationState } from "../lib/workspace-controller";
import type { WorkspacePhase } from "../lib/workspace-phase";
import {
  AgentRail,
  type AgentRailProps,
  type ShapingController,
} from "./agent-rail";
import { PanelOpenIcon } from "./icons";
import { type InterfaceAction, InterfaceRenderer } from "./interface-renderer";
import type { ConversationTarget, ShellMode } from "./role-switcher";
import { WindowDragRegion } from "./window-drag-region";

const ShareLibrary = lazy(() =>
  import("./share-library").then((module) => ({
    default: module.ShareLibrary,
  })),
);
const ShareReview = lazy(() =>
  import("./share-review").then((module) => ({
    default: module.ShareReview,
  })),
);
const ShareSourceDialog = lazy(() =>
  import("./share-source-dialog").then((module) => ({
    default: module.ShareSourceDialog,
  })),
);
const CapsuleFrame = lazy(() =>
  import("./capsule-frame").then((module) => ({
    default: module.CapsuleFrame,
  })),
);
const DiagnosticsPanel = lazy(() =>
  import("./diagnostics-panel").then((module) => ({
    default: module.DiagnosticsPanel,
  })),
);

const ShareSurfaceFallback = () => (
  <span className="sr-only" role="status">
    Opening sharing controls
  </span>
);

export type { ShellMode } from "./role-switcher";

export interface RoleAwareShellProps {
  readonly build?: AgentRailProps["build"];
  readonly phase: WorkspacePhase;
  readonly document: InterfaceDocument;
  readonly capsulePresentation?: CapsulePresentationState;
  readonly extensions?: AgentRailProps["extensions"];
  readonly actions?: ReadonlyArray<InterfaceActionProjection>;
  readonly preview: boolean;
  readonly workspace: AgentWorkspaceController;
  readonly shaping: ShapingController;
  readonly preferences: ShellPreferencesController;
  readonly onOpenSafeMode: () => void;
  readonly onRestoreSafeMode: () => Promise<void>;
  readonly diagnostics?: AgentRailProps["diagnostics"];
  readonly controlledMode?: Exclude<ShellMode, "safe">;
  readonly onModeChange?: (mode: Exclude<ShellMode, "safe">) => Promise<void>;
  readonly controlledTarget?: ConversationTarget;
  readonly onTargetChange?: (target: ConversationTarget) => Promise<void>;
  readonly useDisabled?: boolean;
  readonly activeRevisionId?: import("../../shared/revisions").RevisionId;
  readonly candidateRevisionId?: import("../../shared/revisions").RevisionId;
  readonly onInterfaceAction?: (nodeId: string) => Promise<void>;
  readonly onCapsuleIntent?: (
    intent: CapsuleIntent,
  ) => Promise<CapsuleIntentOutcome>;
  readonly onDecideProductCapability?: (
    capsuleId: string,
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => Promise<void>;
  readonly onRevokeProductCapability?: (decisionId: string) => Promise<void>;
  readonly onSetPortableExtensionEnabled?: AgentRailProps["onSetPortableExtensionEnabled"];
  readonly onTestPortableExtension?: AgentRailProps["onTestPortableExtension"];
  readonly onSetPortableExtensionPinned?: AgentRailProps["onSetPortableExtensionPinned"];
  readonly onForkPortableExtension?: AgentRailProps["onForkPortableExtension"];
  readonly onResolvePortableExtensionUpdate?: AgentRailProps["onResolvePortableExtensionUpdate"];
  readonly onRemovePortableExtension?: AgentRailProps["onRemovePortableExtension"];
  readonly shareReview?: ShareReviewContract;
  readonly shareInstallation?: ShareInstallationRecord;
  readonly shareInstallations?: ReadonlyArray<ShareInstallationRecord>;
  readonly privateShareSources?: ReadonlyArray<PrivateShareSourceSummary>;
  readonly onRetainShare?: (
    artifactIds: ReadonlyArray<string>,
  ) => Promise<void>;
  readonly onPrepareShareUpdate?: () => Promise<void>;
  readonly onContinueShareFork?: () => Promise<void>;
  readonly onOpenShareConflictInShape?: () => Promise<void>;
  readonly onActivateShare?: (
    artifactIds: ReadonlyArray<string>,
  ) => Promise<void>;
  readonly onRejectShare?: () => Promise<void>;
  readonly onOpenShareUrl?: (url: string) => Promise<void>;
  readonly onOpenShareGit?: (url: string, commit: string) => Promise<void>;
  readonly onOpenSharePrivate?: (
    adapterId: string,
    reference: string,
  ) => Promise<void>;
  readonly onOpenShareFile?: (name: string, bytes: Uint8Array) => Promise<void>;
  readonly onExportShare?: (shareId: string) => Promise<void>;
  readonly onRemoveShare?: (shareId: string) => Promise<void>;
  readonly onDeleteShare?: (
    shareId: string,
    expectedForkCommit: string,
  ) => Promise<void>;
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

const isStarterInterface = (document: InterfaceDocument) => {
  const root = document.root;
  const actions =
    root.type === "stack"
      ? root.children.flatMap((node) =>
          node.type === "stack" ? node.children : [node],
        )
      : [];
  return (
    document.name === "Flect" &&
    actions.some(
      (node) =>
        node.type === "button" &&
        node.id === "shape-interface" &&
        node.label === "Start building",
    )
  );
};

export function RoleAwareShell({
  build,
  phase,
  document,
  capsulePresentation,
  extensions,
  actions,
  preview,
  workspace,
  shaping,
  preferences,
  onOpenSafeMode,
  onRestoreSafeMode,
  diagnostics,
  controlledMode,
  onModeChange,
  controlledTarget,
  onTargetChange,
  useDisabled = false,
  activeRevisionId,
  candidateRevisionId,
  onInterfaceAction,
  onCapsuleIntent,
  onDecideProductCapability,
  onRevokeProductCapability,
  onSetPortableExtensionEnabled,
  onTestPortableExtension,
  onSetPortableExtensionPinned,
  onForkPortableExtension,
  onResolvePortableExtensionUpdate,
  onRemovePortableExtension,
  shareReview,
  shareInstallation,
  shareInstallations = [],
  privateShareSources = [],
  onRetainShare,
  onPrepareShareUpdate,
  onContinueShareFork,
  onOpenShareConflictInShape,
  onActivateShare,
  onRejectShare,
  onOpenShareUrl,
  onOpenShareGit,
  onOpenSharePrivate,
  onOpenShareFile,
  onExportShare,
  onRemoveShare,
  onDeleteShare,
}: RoleAwareShellProps) {
  const [localMode, setLocalMode] = useState<ShellMode>(() =>
    initialMode(phase),
  );
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareLibraryOpen, setShareLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareFileError, setShareFileError] = useState<string>();
  const [selectionMode, setSelectionMode] = useState(false);
  const [canvasSelection, setCanvasSelection] = useState<CanvasSelection>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const shareFileRef = useRef<HTMLInputElement>(null);
  const mode: ShellMode =
    phase === "safe" ? "safe" : (controlledMode ?? localMode);
  const target: ConversationTarget =
    phase === "safe"
      ? "shape"
      : (controlledTarget ?? (mode === "run" ? "use" : "shape"));
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
  const starterWorkspace = phase === "blank" || isStarterInterface(document);
  const compiledCapsule =
    phase === "safe"
      ? undefined
      : preview
        ? capsulePresentation?.candidate
        : capsulePresentation?.accepted;
  const collapsed =
    docked && phase !== "safe" && preferences.value.railCollapsed;
  const operationActive =
    isAgentSessionActive(workspace.app.status) ||
    isAgentSessionActive(workspace.previewApp.status) ||
    isAgentSessionActive(workspace.shaper.status) ||
    shaping.status === "shaping";
  const shareReviewObscuresRail =
    shareReview !== undefined &&
    !preview &&
    !(shareReview.lineage === "conflict" && target === "shape");
  const workbenchStatus =
    phase === "safe"
      ? "Safe mode. Customized interface state is bypassed. Restore, export, discard, or retry continuity from the protected shell."
      : shaping.status === "preview"
        ? `Imported candidate ${document.name} validated. Review its authority changes, then activate or discard it.`
        : operationActive
          ? "Flect is responding. Cancel is available."
          : "Flect is ready. Build, change, or use the product in one conversation.";

  useEffect(() => {
    if (controlledMode !== undefined) {
      return;
    }
    if (phase === "safe") {
      setLocalMode("safe");
    } else if (phase === "preview" || phase === "blank") {
      setLocalMode("edit");
    } else if (localMode === "safe") {
      setLocalMode("run");
    }
  }, [controlledMode, localMode, phase]);

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
    if (collapsed) {
      reopenRef.current?.focus();
    }
  }, [collapsed]);

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
      compactViewport ||
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
  }, [collapsed, compactViewport, docked]);

  const selectMode = useCallback(
    (next: Exclude<ShellMode, "safe">) => {
      if (operationActive || phase === "safe") {
        return;
      }
      if (onModeChange === undefined) {
        setLocalMode(next);
      } else {
        void onModeChange(next);
      }
      if (preferences.value.railCollapsed) {
        shouldFocusRailRef.current = true;
        void preferences.setRailCollapsed(false);
      }
    },
    [onModeChange, operationActive, phase, preferences],
  );

  const selectTarget = useCallback(
    (next: ConversationTarget) => {
      if (operationActive || phase === "safe") {
        return;
      }
      if (onTargetChange !== undefined) {
        void onTargetChange(next);
      } else {
        selectMode(next === "use" ? "run" : "edit");
      }
      if (preferences.value.railCollapsed) {
        shouldFocusRailRef.current = true;
        void preferences.setRailCollapsed(false);
      }
    },
    [onTargetChange, operationActive, phase, preferences, selectMode],
  );

  const collapse = useCallback(() => {
    void preferences.setRailCollapsed(true);
  }, [preferences]);

  const expand = useCallback(() => {
    shouldFocusRailRef.current = true;
    void preferences.setRailCollapsed(false);
  }, [preferences]);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    queueMicrotask(() => {
      railContainerRef.current
        ?.querySelector<HTMLButtonElement>("[data-settings-trigger]")
        ?.focus();
    });
  }, []);

  const focusComposer = useCallback(() => {
    if (preferences.value.railCollapsed) {
      shouldFocusRailRef.current = true;
      void preferences.setRailCollapsed(false);
    }
    queueMicrotask(() => {
      railContainerRef.current
        ?.querySelector<HTMLTextAreaElement>(
          '.composer textarea[name="message"]',
        )
        ?.focus({ preventScroll: true });
    });
  }, [preferences]);

  const chooseCanvasSelection = useCallback(
    (selection: CanvasSelection | undefined, nodeId?: string) => {
      setCanvasSelection(selection);
      setSelectedNodeId(selection === undefined ? undefined : nodeId);
      if (selection !== undefined) {
        setSelectionMode(false);
        focusComposer();
      }
    },
    [focusComposer],
  );

  useEffect(() => {
    void activeRevisionId;
    setSelectionMode(false);
    setCanvasSelection(undefined);
    setSelectedNodeId(undefined);
  }, [activeRevisionId]);

  const applyDirectManipulation = useCallback(
    (instruction: string) => {
      if (canvasSelection === undefined || operationActive) return;
      setSelectionMode(false);
      void (
        shaping.requestTargeted?.(
          instruction,
          canvasSelection,
          selectedNodeId,
        ) ?? shaping.request(instruction)
      );
    },
    [canvasSelection, operationActive, selectedNodeId, shaping],
  );

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
    (action: InterfaceAction, nodeId: string) => {
      if (onInterfaceAction !== undefined) {
        void onInterfaceAction(nodeId);
        return;
      }
      switch (action) {
        case "shape":
          selectTarget("shape");
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
    [onInterfaceAction, onOpenSafeMode, selectTarget, shaping],
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
      className={`role-shell${docked ? " role-shell--split" : " role-shell--centered"}${collapsed ? " role-shell--collapsed" : ""}${preview ? " role-shell--preview" : ""}${settingsOpen ? " role-shell--settings" : ""}`}
      data-mode={mode}
      data-phase={phase}
      data-active-revision={activeRevisionId}
      data-reduced-motion={
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "true"
          : "false"
      }
      data-target={target}
      data-use-disabled={useDisabled || phase === "blank" ? "true" : "false"}
      ref={shellRef}
      style={shellStyle}
    >
      <div
        aria-atomic="true"
        aria-label="Workbench status"
        className="sr-only"
        role="status"
      >
        {workbenchStatus}
      </div>
      <WindowDragRegion />
      <header className="topbar">
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

      {shareDialogOpen &&
        onOpenShareUrl !== undefined &&
        onOpenShareGit !== undefined && (
          <Suspense fallback={<ShareSurfaceFallback />}>
            <ShareSourceDialog
              candidateOpen={shareReview !== undefined}
              onClose={() => setShareDialogOpen(false)}
              onOpenGit={onOpenShareGit}
              {...(onOpenSharePrivate === undefined
                ? {}
                : { onOpenPrivate: onOpenSharePrivate })}
              onOpenUrl={onOpenShareUrl}
              open={shareDialogOpen}
              privateSources={privateShareSources}
            />
          </Suspense>
        )}
      {onOpenShareFile !== undefined && (
        <input
          accept=".flect-share,application/octet-stream"
          aria-label="Open shared file"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setShareFileError(undefined);
            if (file !== undefined) {
              void file
                .arrayBuffer()
                .then((buffer) =>
                  onOpenShareFile(file.name, new Uint8Array(buffer)),
                )
                .catch(() =>
                  setShareFileError(
                    "The shared file could not be reviewed safely.",
                  ),
                );
            }
            event.currentTarget.value = "";
          }}
          ref={shareFileRef}
          type="file"
        />
      )}
      {shareFileError !== undefined && (
        <div className="share-file-error" role="alert">
          <span>{shareFileError}</span>
          <button
            aria-label="Dismiss shared file error"
            onClick={() => setShareFileError(undefined)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}
      {shareLibraryOpen &&
        onExportShare !== undefined &&
        onRemoveShare !== undefined &&
        onDeleteShare !== undefined && (
          <Suspense fallback={<ShareSurfaceFallback />}>
            <ShareLibrary
              entries={shareInstallations}
              onClose={() => setShareLibraryOpen(false)}
              onDelete={onDeleteShare}
              onExport={onExportShare}
              onRemove={onRemoveShare}
              open={shareLibraryOpen}
            />
          </Suspense>
        )}

      <main
        className={`workspace-canvas${settingsOpen ? " workspace-canvas--settings" : ""}`}
      >
        {settingsOpen && diagnostics !== undefined ? (
          <Suspense fallback={<ShareSurfaceFallback />}>
            <DiagnosticsPanel
              control={diagnostics.control}
              onClose={closeSettings}
              onToggleControl={diagnostics.onToggleControl}
              operations={diagnostics.operations}
              persistence={diagnostics.persistence}
              presentation="workspace"
              setup={diagnostics.setup}
              update={diagnostics.update}
            />
          </Suspense>
        ) : (
          <>
            {docked &&
              !starterWorkspace &&
              phase === "accepted" &&
              !preview && (
                <div
                  aria-label="Canvas editing"
                  className="canvas-edit-toolbar"
                  role="toolbar"
                >
                  <button
                    aria-pressed={selectionMode}
                    className="canvas-edit-toolbar__select"
                    disabled={operationActive}
                    onClick={() => setSelectionMode((current) => !current)}
                    type="button"
                  >
                    {selectionMode ? "Choose an element" : "Select element"}
                  </button>
                  {canvasSelection !== undefined && (
                    <>
                      <span
                        className="canvas-edit-toolbar__selection"
                        role="status"
                      >
                        {canvasSelection.label}
                      </span>
                      <div className="canvas-edit-toolbar__actions">
                        <button
                          disabled={operationActive}
                          onClick={() =>
                            applyDirectManipulation(
                              "Move the selected element one position earlier in its current layout while preserving responsive behavior.",
                            )
                          }
                          type="button"
                        >
                          Move earlier
                        </button>
                        <button
                          disabled={operationActive}
                          onClick={() =>
                            applyDirectManipulation(
                              "Move the selected element one position later in its current layout while preserving responsive behavior.",
                            )
                          }
                          type="button"
                        >
                          Move later
                        </button>
                        <button
                          disabled={operationActive}
                          onClick={() =>
                            applyDirectManipulation(
                              "Make the selected element slightly smaller using its existing responsive layout and design tokens.",
                            )
                          }
                          type="button"
                        >
                          Smaller
                        </button>
                        <button
                          disabled={operationActive}
                          onClick={() =>
                            applyDirectManipulation(
                              "Make the selected element slightly larger using its existing responsive layout and design tokens.",
                            )
                          }
                          type="button"
                        >
                          Larger
                        </button>
                        <button
                          aria-label="Clear canvas selection"
                          onClick={() => chooseCanvasSelection(undefined)}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            {!preview &&
              shareReview !== undefined &&
              onRetainShare !== undefined &&
              onPrepareShareUpdate !== undefined &&
              onActivateShare !== undefined &&
              onRejectShare !== undefined && (
                <Suspense fallback={<ShareSurfaceFallback />}>
                  <ShareReview
                    busy={operationActive}
                    {...(shareInstallation === undefined
                      ? {}
                      : { installedVersion: shareInstallation.version })}
                    onActivate={onActivateShare}
                    onContinueFork={onContinueShareFork}
                    onOpenConflictInShape={onOpenShareConflictInShape}
                    {...(onOpenShareUrl === undefined ||
                    onOpenShareGit === undefined
                      ? {}
                      : { onOpenSource: () => setShareDialogOpen(true) })}
                    {...(onOpenShareFile === undefined
                      ? {}
                      : { onOpenFile: () => shareFileRef.current?.click() })}
                    onPrepareUpdate={onPrepareShareUpdate}
                    onReject={onRejectShare}
                    onRetain={onRetainShare}
                    pending={shareInstallation?.pending !== undefined}
                    retained={shareInstallation !== undefined}
                    review={shareReview}
                  />
                </Suspense>
              )}
            {starterWorkspace ? (
              <section className="blank-invitation">
                <h1>What do you want to make?</h1>
                <p>Describe the outcome in the message box to start.</p>
              </section>
            ) : compiledCapsule !== undefined ? (
              <Suspense fallback={<ShareSurfaceFallback />}>
                <CapsuleFrame
                  assets={compiledCapsule.assets}
                  entrypointPath={compiledCapsule.entrypointPath}
                  html={compiledCapsule.html}
                  onDirectManipulation={(kind, deltaX, deltaY) =>
                    applyDirectManipulation(
                      kind === "move"
                        ? `Move the selected element ${Math.abs(Math.round(deltaX))} pixels ${deltaX < 0 ? "left" : "right"} and ${Math.abs(Math.round(deltaY))} pixels ${deltaY < 0 ? "up" : "down"} in the current view. Translate that gesture into responsive layout source instead of storing fixed canvas coordinates.`
                        : `Resize the selected element by approximately ${Math.round(deltaX)} pixels in width and ${Math.round(deltaY)} pixels in height in the current view. Translate that gesture into responsive layout source and preserve accessible content reflow.`,
                    )
                  }
                  onIntent={onCapsuleIntent}
                  onSelectionChange={(selection) =>
                    chooseCanvasSelection(selection)
                  }
                  selection={canvasSelection}
                  selectionMode={selectionMode}
                  title={compiledCapsule.name}
                />
              </Suspense>
            ) : (
              <InterfaceRenderer
                actions={actions}
                document={document}
                onAction={handleInterfaceAction}
                onSelectionChange={(selection, nodeId) =>
                  chooseCanvasSelection(selection, nodeId)
                }
                renderPrompt={() => (
                  <button
                    className="canvas-agent-entry"
                    onClick={focusComposer}
                    type="button"
                  >
                    Ask Flect about this interface
                  </button>
                )}
                selectedNodeId={selectedNodeId}
                selectionMode={selectionMode}
              />
            )}
          </>
        )}
      </main>

      <div
        aria-hidden={collapsed || shareReviewObscuresRail}
        className="agent-rail-container"
        data-layout={docked ? "rail" : "center"}
        inert={collapsed || shareReviewObscuresRail}
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
          acceptedCapsuleReview={capsulePresentation?.acceptedReview}
          build={build}
          canvasSelection={canvasSelection}
          capsuleReview={capsulePresentation?.candidateReview}
          diagnostics={diagnostics}
          document={document}
          extensions={extensions}
          mode={mode}
          preview={preview}
          candidateRevisionId={candidateRevisionId}
          selectedNodeId={selectedNodeId}
          useDisabled={useDisabled || phase === "blank"}
          onCollapse={collapse}
          onOpenSafeMode={onOpenSafeMode}
          onOpenSettings={openSettings}
          settingsInDock={!docked}
          {...(onOpenShareUrl === undefined || onOpenShareGit === undefined
            ? {}
            : { onOpenShareSource: () => setShareDialogOpen(true) })}
          {...(onOpenShareFile === undefined
            ? {}
            : { onOpenShareFile: () => shareFileRef.current?.click() })}
          {...(onExportShare === undefined ||
          onRemoveShare === undefined ||
          onDeleteShare === undefined
            ? {}
            : { onManageSharedSources: () => setShareLibraryOpen(true) })}
          onRestoreSafeMode={onRestoreSafeMode}
          onDecideProductCapability={onDecideProductCapability}
          onRevokeProductCapability={onRevokeProductCapability}
          onSetPortableExtensionEnabled={onSetPortableExtensionEnabled}
          onTestPortableExtension={onTestPortableExtension}
          onSetPortableExtensionPinned={onSetPortableExtensionPinned}
          onForkPortableExtension={onForkPortableExtension}
          onResolvePortableExtensionUpdate={onResolvePortableExtensionUpdate}
          onRemovePortableExtension={onRemovePortableExtension}
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
          <span>Flect</span>
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
