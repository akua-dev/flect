import { Effect, Schema } from "effect";
import {
  type FormEvent,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CanvasSelection } from "../../shared/canvas-selection";
import type {
  ControlStateSnapshot,
  OperationRecord,
  ToolActivity,
  WorkspaceBuildSnapshot,
  WorkspacePersistenceSnapshot,
} from "../../shared/control";
import { OperationFailed as OperationFailedSchema } from "../../shared/control";
import type {
  ExtensionCapability,
  PortableExtensionCatalogSnapshot,
} from "../../shared/extensions";
import type { InterfaceDocument } from "../../shared/interface-document";
import {
  ProductCapabilityAllowChoice,
  type ProductCapabilityConfirmationPolicy,
  type ProductCapabilityDecisionChoice,
  ProductCapabilityDenyChoice,
} from "../../shared/product-capability";
import type { RevisionId } from "../../shared/revisions";
import type {
  AgentWorkspaceController,
  ConversationMessage,
} from "../hooks/use-agent-session";
import { isAgentSessionActive } from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import type { WebProjectImportResult } from "../lib/web-project-import";
import type { CapsuleReview } from "../lib/workspace-controller";
import {
  Conversation as AIConversation,
  ConversationContent as AIConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import {
  Message as AIMessage,
  MessageContent as AIMessageContent,
} from "./ai-elements/message";
import { Reasoning, ReasoningTrigger } from "./ai-elements/reasoning";
import { Composer } from "./composer";
import type {
  DiagnosticsPanelProps,
  NativeSetupView,
  NativeUpdateView,
} from "./diagnostics-panel";
import type { ExtensionReviewKey } from "./extension-review";
import { PanelCloseIcon, RefreshIcon } from "./icons";
import type { ConversationTarget, ShellMode } from "./role-switcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

const ActivityCard = lazy(() =>
  import("./activity-card").then((module) => ({
    default: module.ActivityCard,
  })),
);
const DiagnosticsPanel = lazy(() =>
  import("./diagnostics-panel").then((module) => ({
    default: module.DiagnosticsPanel,
  })),
);
const ExtensionReview = lazy(() =>
  import("./extension-review").then((module) => ({
    default: module.ExtensionReview,
  })),
);
const MessageContent = lazy(() =>
  import("./message-content").then((module) => ({
    default: module.MessageContent,
  })),
);
const ProviderAuthPanel = lazy(() =>
  import("./provider-auth-panel").then((module) => ({
    default: module.ProviderAuthPanel,
  })),
);

const SurfaceFallback = ({ label }: { readonly label: string }) => (
  <span className="sr-only" role="status">
    {label}
  </span>
);

const diagnosticsLabel = (
  control: DiagnosticsPanelProps["control"],
  persistence: DiagnosticsPanelProps["persistence"],
) =>
  persistence?.source !== "durable"
    ? "Storage unavailable"
    : persistence.capsule === "session"
      ? "Session-only storage"
      : persistence.capsule === "unavailable"
        ? "Storage degraded"
        : control.enabled
          ? `${control.clients.length} client${control.clients.length === 1 ? "" : "s"}`
          : "Local control off";

function DeferredDiagnosticsPanel(props: DiagnosticsPanelProps) {
  const [requested, setRequested] = useState(false);
  if (requested) {
    return (
      <Suspense
        fallback={
          <details className="diagnostics-panel" open>
            {/* biome-ignore lint/a11y/useSemanticElements: summary is the native disclosure control; the explicit role keeps it exposed consistently across WebKit and JSDOM. */}
            <summary aria-label="Diagnostics" role="button">
              <span>Diagnostics</span>
              <small aria-hidden="true">
                {diagnosticsLabel(props.control, props.persistence)}
              </small>
            </summary>
            <SurfaceFallback label="Opening diagnostics" />
          </details>
        }
      >
        <DiagnosticsPanel {...props} defaultOpen />
      </Suspense>
    );
  }
  return (
    <details
      className="diagnostics-panel"
      onToggle={(event) => {
        if (event.currentTarget.open) setRequested(true);
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: summary is the native disclosure control; the explicit role keeps it exposed consistently across WebKit and JSDOM. */}
      <summary aria-label="Diagnostics" role="button">
        <span>Diagnostics</span>
        <small aria-hidden="true">
          {diagnosticsLabel(props.control, props.persistence)}
        </small>
      </summary>
    </details>
  );
}

export interface ShapingController {
  readonly status: "idle" | "shaping" | "preview" | "error";
  readonly error?: string;
  readonly rollbackAvailable: boolean;
  readonly isolation: "unchecked" | "checking" | "ready" | "unavailable";
  readonly verifyIsolation: () => Promise<void>;
  readonly request: (instruction: string) => Promise<void>;
  readonly requestTargeted?: (
    instruction: string,
    selection: CanvasSelection,
    selectedNodeId?: string,
  ) => Promise<void>;
  readonly fixFailure: (activity: ToolActivity) => Promise<void>;
  readonly accept: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

export interface AgentRailProps {
  readonly build?: WorkspaceBuildSnapshot;
  readonly mode: ShellMode;
  /** @deprecated Flect routes internal roles automatically. */
  readonly target?: ConversationTarget;
  readonly preview?: boolean;
  readonly candidateRevisionId?: RevisionId;
  readonly capsuleReview?: CapsuleReview;
  readonly acceptedCapsuleReview?: CapsuleReview;
  readonly extensions?: PortableExtensionCatalogSnapshot;
  readonly useDisabled?: boolean;
  readonly canvasSelection?: CanvasSelection;
  readonly selectedNodeId?: string;
  readonly document: InterfaceDocument;
  readonly workspace: AgentWorkspaceController;
  readonly shaping: ShapingController;
  readonly preferences: ShellPreferencesController;
  /** @deprecated There is no visible mode switcher. */
  readonly onModeChange?: (mode: Exclude<ShellMode, "safe">) => void;
  /** @deprecated Flect routes typed work internally. */
  readonly onTargetChange?: (target: ConversationTarget) => void;
  readonly onCollapse: () => void;
  readonly onOpenSafeMode: () => void;
  readonly onOpenShareSource?: () => void;
  readonly onOpenShareFile?: () => void;
  readonly onManageSharedSources?: () => void;
  readonly onRestoreSafeMode: () => Promise<void>;
  readonly onDecideProductCapability?: (
    capsuleId: string,
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => Promise<void>;
  readonly onRevokeProductCapability?: (decisionId: string) => Promise<void>;
  readonly onSetPortableExtensionEnabled?: (
    key: ExtensionReviewKey,
    enabled: boolean,
    grants: ReadonlyArray<ExtensionCapability>,
  ) => Promise<void>;
  readonly onTestPortableExtension?: (key: ExtensionReviewKey) => Promise<void>;
  readonly onSetPortableExtensionPinned?: (
    key: ExtensionReviewKey,
    pinned: boolean,
  ) => Promise<void>;
  readonly onForkPortableExtension?: (
    key: ExtensionReviewKey,
    revision: string,
  ) => Promise<void>;
  readonly onResolvePortableExtensionUpdate?: (
    key: ExtensionReviewKey,
    choice: "upstream" | "fork",
  ) => Promise<void>;
  readonly onRemovePortableExtension?: (
    key: ExtensionReviewKey,
  ) => Promise<void>;
  readonly diagnostics?: {
    readonly control: ControlStateSnapshot;
    readonly operations: ReadonlyArray<OperationRecord>;
    readonly onToggleControl: () => Promise<void>;
    readonly setup?: NativeSetupView;
    readonly update?: NativeUpdateView;
    readonly persistence?: WorkspacePersistenceSnapshot;
  };
}

const capsuleTrustLabel = (review: CapsuleReview) => {
  switch (review.signature.status) {
    case "unsigned":
      return "Unsigned";
    case "locally-forked":
      return "Local fork · unsigned";
    case "verified":
      return `Verified · ${review.signature.keyIds.join(", ")}`;
    case "unknown-key":
      return `Unknown signer · ${review.signature.keyIds.join(", ")}`;
    case "revoked":
      return "Publisher key revoked";
    case "expired":
      return "Signature outside key validity";
    case "changed-after-signing":
      return "Changed after signing";
    case "invalid":
      return "Invalid signature";
  }
};

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

export function ProductCapabilities({
  scopeId,
  capabilities,
  onDecide,
  onRevoke,
}: {
  readonly scopeId: string;
  readonly capabilities: CapsuleReview["capabilities"];
  readonly onDecide?: (
    capsuleId: string,
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => Promise<void>;
  readonly onRevoke?: (decisionId: string) => Promise<void>;
}) {
  const [pendingCapabilityId, setPendingCapabilityId] = useState<string>();
  const [grantError, setGrantError] = useState(false);
  const decide = async (
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => {
    if (onDecide === undefined || pendingCapabilityId !== undefined) return;
    setPendingCapabilityId(capabilityId);
    setGrantError(false);
    try {
      await onDecide(scopeId, capabilityId, choice);
    } catch {
      setGrantError(true);
    } finally {
      setPendingCapabilityId(undefined);
    }
  };
  const revoke = async (capabilityId: string, decisionId: string) => {
    if (onRevoke === undefined || pendingCapabilityId !== undefined) return;
    setPendingCapabilityId(capabilityId);
    setGrantError(false);
    try {
      await onRevoke(decisionId);
    } catch {
      setGrantError(true);
    } finally {
      setPendingCapabilityId(undefined);
    }
  };
  const revokeCapability = (
    capability: CapsuleReview["capabilities"][number],
  ) =>
    capability.decisionId === undefined
      ? Promise.resolve()
      : revoke(capability.capabilityId, capability.decisionId);
  const policyLabel = (policy: ProductCapabilityConfirmationPolicy) => {
    switch (policy) {
      case "once":
        return "Allow once";
      case "session":
        return "This session";
      case "workspace":
        return "This workspace";
      case "persistent":
        return "Always allow";
    }
  };
  const lifecycleLabel = (
    state: CapsuleReview["capabilities"][number]["state"],
  ) => {
    switch (state) {
      case "available":
        return "Available";
      case "requested":
        return "Awaiting decision";
      case "granted":
        return "Granted";
      case "denied":
        return "Denied";
      case "expired":
        return "Expired";
      case "revoked":
        return "Revoked";
    }
  };

  return (
    <div className="capsule-review__capabilities">
      <strong>Capabilities</strong>
      {capabilities.length === 0 ? (
        <p>No product or host capabilities requested.</p>
      ) : (
        <ul>
          {capabilities.map((capability) => (
            <li key={capability.capabilityId}>
              <span className="capsule-review__capability-copy">
                <span>{capability.capabilityId}</span>
                <small>
                  {capability.required ? "Required" : "Optional"}
                  {" · "}
                  {capability.availability === "unavailable"
                    ? "Unavailable on this host"
                    : lifecycleLabel(capability.state)}
                  {capability.confirmationPolicy === undefined
                    ? ""
                    : ` · ${policyLabel(capability.confirmationPolicy)}`}
                </small>
                <details className="capsule-review__capability-scope">
                  <summary>Scope details</summary>
                  <small>
                    {capability.operationIds.length} operation
                    {capability.operationIds.length === 1 ? "" : "s"}
                    {" · "}
                    {capability.resourceIds.length} resource
                    {capability.resourceIds.length === 1 ? "" : "s"}
                    {" · "}
                    {capability.dataClassIds.length} data class
                    {capability.dataClassIds.length === 1 ? "" : "es"}
                  </small>
                  {capability.expiresAtMillis !== undefined && (
                    <small>
                      Expires{" "}
                      {new Date(capability.expiresAtMillis).toISOString()}
                    </small>
                  )}
                  {capability.rateLimit !== undefined && (
                    <small>
                      Up to {capability.rateLimit.maxInvocations} calls per{" "}
                      {capability.rateLimit.intervalMs} ms
                    </small>
                  )}
                  {capability.decisionId !== undefined && (
                    <small>Decision {capability.decisionId}</small>
                  )}
                </details>
              </span>
              {capability.availability === "available" && (
                <fieldset className="capsule-review__capability-actions">
                  <legend className="sr-only">
                    Decide {capability.capabilityId}
                  </legend>
                  {capability.state === "granted" &&
                  capability.decisionId !== undefined &&
                  onRevoke !== undefined ? (
                    <button
                      aria-label={`Revoke ${capability.capabilityId}`}
                      className="decision-button"
                      disabled={pendingCapabilityId !== undefined}
                      onClick={() => void revokeCapability(capability)}
                      type="button"
                    >
                      {pendingCapabilityId === capability.capabilityId
                        ? "Saving…"
                        : "Revoke"}
                    </button>
                  ) : (
                    onDecide !== undefined && (
                      <>
                        {capability.confirmationPolicies.map((policy) => (
                          <button
                            aria-label={`${policyLabel(policy)} ${capability.capabilityId}`}
                            className={`decision-button${policy === "session" ? " decision-button--primary" : ""}`}
                            disabled={pendingCapabilityId !== undefined}
                            key={policy}
                            onClick={() =>
                              void decide(
                                capability.capabilityId,
                                ProductCapabilityAllowChoice.make({
                                  type: "allow",
                                  confirmationPolicy: policy,
                                }),
                              )
                            }
                            type="button"
                          >
                            {pendingCapabilityId === capability.capabilityId
                              ? "Saving…"
                              : policyLabel(policy)}
                          </button>
                        ))}
                        <button
                          aria-label={`Deny ${capability.capabilityId}`}
                          className="decision-button"
                          disabled={pendingCapabilityId !== undefined}
                          onClick={() =>
                            void decide(
                              capability.capabilityId,
                              ProductCapabilityDenyChoice.make({
                                type: "deny",
                              }),
                            )
                          }
                          type="button"
                        >
                          Deny
                        </button>
                      </>
                    )
                  )}
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      {grantError && (
        <p
          aria-label="Product capability change failed"
          className="capsule-review__grant-error"
          role="alert"
        >
          The capability change could not be saved.
        </p>
      )}
    </div>
  );
}

function Conversation({
  messages,
  activities,
  status,
  label,
  onFixFailure,
}: {
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly activities: NonNullable<
    AgentWorkspaceController["app"]["activities"]
  >;
  readonly status: AgentWorkspaceController["app"]["status"];
  readonly label: string;
  readonly onFixFailure?: (activity: ToolActivity) => void;
}) {
  return (
    <AIConversation
      aria-label={`${label} conversation`}
      className="conversation conversation-shell"
    >
      <AIConversationContent
        className="conversation__content"
        scrollClassName="conversation__scroll"
      >
        {messages.length === 0 && activities.length === 0 && (
          <ConversationEmptyState
            className="conversation__empty"
            description="Ask for a change, use the current interface, or call an approved action. Flect routes the work for you."
            title="Build and use the product in one conversation."
          />
        )}
        {messages.map((message, index) => {
          const isLatest = index === messages.length - 1;
          return (
            <AIMessage
              className={`message message--${message.role}`}
              from={message.role === "user" ? "user" : "assistant"}
              key={message.id}
            >
              <AIMessageContent>
                <span className="sr-only">
                  {message.role === "user"
                    ? "You"
                    : message.role === "activity"
                      ? "Activity"
                      : label}
                </span>
                {message.content ? (
                  <Suspense fallback={<span>{message.content}</span>}>
                    <MessageContent
                      content={message.content}
                      messageRole={message.role}
                      streaming={
                        message.role === "assistant" &&
                        isLatest &&
                        status === "streaming"
                      }
                    />
                  </Suspense>
                ) : (
                  isLatest &&
                  (status === "submitting" || status === "streaming") && (
                    <Reasoning isStreaming>
                      <ReasoningTrigger
                        getThinkingMessage={() => `${label} is responding`}
                      />
                    </Reasoning>
                  )
                )}
              </AIMessageContent>
            </AIMessage>
          );
        })}
        {activities.map((activity) => (
          <div key={activity.id}>
            <Suspense
              fallback={<SurfaceFallback label="Opening activity details" />}
            >
              <ActivityCard
                activity={activity}
                {...(onFixFailure === undefined
                  ? {}
                  : { onFixInShape: onFixFailure })}
              />
            </Suspense>
          </div>
        ))}
      </AIConversationContent>
      <ConversationScrollButton aria-label="Jump to latest" />
    </AIConversation>
  );
}

export function AgentRail({
  build,
  mode,
  preview = false,
  candidateRevisionId,
  capsuleReview,
  acceptedCapsuleReview,
  extensions,
  useDisabled = false,
  canvasSelection,
  selectedNodeId,
  document,
  workspace,
  shaping,
  preferences,
  onCollapse,
  onOpenSafeMode,
  onOpenShareSource,
  onOpenShareFile,
  onManageSharedSources,
  onRestoreSafeMode,
  onDecideProductCapability,
  onRevokeProductCapability,
  onSetPortableExtensionEnabled,
  onTestPortableExtension,
  onSetPortableExtensionPinned,
  onForkPortableExtension,
  onResolvePortableExtensionUpdate,
  onRemovePortableExtension,
  diagnostics,
}: AgentRailProps) {
  const conversationControllers = [
    workspace.app,
    workspace.previewApp,
    workspace.shaper,
  ] as const;
  const preferredController = preview
    ? workspace.previewApp
    : useDisabled
      ? workspace.shaper
      : workspace.app;
  const controller =
    conversationControllers.find((entry) =>
      isAgentSessionActive(entry.status),
    ) ?? preferredController;
  const roleLabel = mode === "safe" ? "Recovery" : "Flect";
  const messages = conversationControllers
    .flatMap((entry) => entry.messages)
    .filter((message) => message.role !== "activity")
    .map((message, sequence) => ({ message, sequence }))
    .sort((left, right) => {
      const leftTime = left.message.createdAt;
      const rightTime = right.message.createdAt;
      return leftTime === undefined || rightTime === undefined
        ? left.sequence - right.sequence
        : leftTime - rightTime || left.sequence - right.sequence;
    })
    .map(({ message }) => message);
  const activities = conversationControllers
    .flatMap((entry) => entry.activities ?? [])
    .sort((left, right) => left.updatedAt - right.updatedAt);
  const operationActive =
    isAgentSessionActive(workspace.app.status) ||
    isAgentSessionActive(workspace.previewApp.status) ||
    isAgentSessionActive(workspace.shaper.status) ||
    shaping.status === "shaping";
  const cancel = async () => {
    const active = conversationControllers.filter((entry) =>
      isAgentSessionActive(entry.status),
    );
    await Effect.runPromise(
      Effect.forEach(
        active.length === 0 ? [controller] : active,
        (entry) =>
          Effect.tryPromise({
            try: () => entry.cancel(),
            catch: () => new Error("Agent cancellation failed."),
          }),
        { concurrency: "unbounded", discard: true },
      ),
    );
  };
  const submit =
    mode === "safe"
      ? async () => undefined
      : canvasSelection !== undefined
        ? (text: string) =>
            shaping.requestTargeted?.(text, canvasSelection, selectedNodeId) ??
            shaping.request(text)
        : preview && candidateRevisionId !== undefined
          ? (text: string) =>
              workspace.previewApp.submit(text, document, candidateRevisionId)
          : useDisabled
            ? shaping.request
            : workspace.app.submit;
  const externalExtensionsEnabled =
    workspace.externalExtensions.app && workspace.externalExtensions.shaper;
  const toggleExternalExtensions = async () => {
    const enabled = !externalExtensionsEnabled;
    if (workspace.externalExtensions.app !== enabled) {
      await workspace.toggleExternalExtensions("app");
    }
    if (workspace.externalExtensions.shaper !== enabled) {
      await workspace.toggleExternalExtensions("shaper");
    }
  };
  const candidateExtensionBlocked =
    capsuleReview !== undefined &&
    extensions?.entries.some(
      (entry) =>
        entry.capsuleId === capsuleReview.id &&
        entry.binding === "candidate" &&
        (entry.state === "failed" ||
          (entry.state === "enabled" && !entry.tested)),
    ) === true;
  const portableExtensionActions =
    onSetPortableExtensionEnabled !== undefined &&
    onTestPortableExtension !== undefined &&
    onSetPortableExtensionPinned !== undefined &&
    onForkPortableExtension !== undefined &&
    onResolvePortableExtensionUpdate !== undefined &&
    onRemovePortableExtension !== undefined
      ? {
          onSetEnabled: onSetPortableExtensionEnabled,
          onTest: onTestPortableExtension,
          onSetPinned: onSetPortableExtensionPinned,
          onFork: onForkPortableExtension,
          onResolveUpdate: onResolvePortableExtensionUpdate,
          onRemove: onRemovePortableExtension,
        }
      : undefined;
  const keepChangeRef = useRef<HTMLButtonElement>(null);
  const rejectChangeRef = useRef<HTMLButtonElement>(null);
  const [capsuleNotice, setCapsuleNotice] = useState<string>();
  const [installOpen, setInstallOpen] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [installError, setInstallError] = useState<string>();
  const [installing, setInstalling] = useState(false);
  const installDialogRef = useRef<HTMLDialogElement>(null);
  const [gitImportOpen, setGitImportOpen] = useState(false);
  const [gitImportUrl, setGitImportUrl] = useState("");
  const [gitImportCommit, setGitImportCommit] = useState("");
  const [gitImportError, setGitImportError] = useState<string>();
  const [gitImporting, setGitImporting] = useState(false);
  const gitImportDialogRef = useRef<HTMLDialogElement>(null);
  const exportContinuity = async () => {
    const encoded = await workspace.exportContinuity?.();
    if (encoded === undefined) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([encoded], { type: "application/json" }),
    );
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = "flect-role-continuity.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportRepository = async () => {
    const archive = await workspace.exportRepository?.();
    if (archive === undefined) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([archive.slice().buffer], { type: "application/x-tar" }),
    );
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = "flect-repository.tar";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportCapsule = async () => {
    try {
      const archive = await workspace.exportCapsule?.();
      if (archive === undefined) return;
      const url = URL.createObjectURL(
        new Blob([archive.slice().buffer], { type: "application/vnd.flect" }),
      );
      const anchor = globalThis.document.createElement("a");
      anchor.href = url;
      anchor.download = "interface.flect";
      anchor.click();
      URL.revokeObjectURL(url);
      setCapsuleNotice("Flect app exported.");
    } catch {
      setCapsuleNotice("Flect app export failed safely.");
    }
  };
  const importCapsule = () => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = ".flect,application/vnd.flect";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      setCapsuleNotice("Verifying Flect app…");
      void file
        .arrayBuffer()
        .then((buffer) => workspace.importCapsule?.(new Uint8Array(buffer)))
        .then(() => setCapsuleNotice("Flect app verified. Ready to activate."))
        .catch(() => setCapsuleNotice("Flect app import failed safely."));
    });
    input.click();
  };
  const finishProjectImport = async ({
    archive,
    report,
  }: WebProjectImportResult) => {
    setCapsuleNotice(
      report.kind === "static-html"
        ? "Packaging static HTML project…"
        : `Building ${report.kind === "vite-react" ? "Vite React" : report.kind === "vite-vue" ? "Vue" : report.kind === "vite-svelte" ? "Svelte" : "Vite"} project locally…`,
    );
    await workspace.importCapsule?.(archive);
    setCapsuleNotice(
      `${report.kind === "static-html" ? "Static app packaged" : "Portable build verified"} · ${report.includedFiles} source files${report.ignoredFiles.length === 0 ? "" : ` · ${report.ignoredFiles.length} ignored`}. Ready to activate.`,
    );
  };
  const projectImportFailureMessage = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "_tag") === "WebProjectImportFailure" &&
    typeof Reflect.get(error, "message") === "string"
      ? Reflect.get(error, "message")
      : Schema.is(OperationFailedSchema)(error)
        ? error.message
        : "App project import failed safely. Choose one source with a root index.html.";
  const importHtmlProject = () => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return;
      setCapsuleNotice("Checking app project…");
      void import("../lib/web-project-import")
        .then(({ importWebProject, shouldAvoidReadingWebProjectFile }) =>
          Effect.runPromise(
            Effect.forEach(
              files,
              (file) =>
                Effect.tryPromise({
                  try: async () => {
                    const path = file.webkitRelativePath || file.name;
                    const ignored = shouldAvoidReadingWebProjectFile(path);
                    return {
                      path,
                      contents: ignored
                        ? new Uint8Array()
                        : new Uint8Array(await file.arrayBuffer()),
                    };
                  },
                  catch: () => new Error("project file could not be read"),
                }),
              { concurrency: "unbounded" },
            ).pipe(
              Effect.flatMap((projectFiles) => importWebProject(projectFiles)),
            ),
          ),
        )
        .then(finishProjectImport)
        .catch((error: unknown) => {
          setCapsuleNotice(projectImportFailureMessage(error));
        });
    });
    input.click();
  };
  const importProjectArchive = () => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.tar,application/zip,application/x-tar";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      setCapsuleNotice("Checking project archive…");
      void file
        .arrayBuffer()
        .then(async (buffer) => {
          const { importWebProjectArchive } = await import(
            "../lib/web-project-archive"
          );
          return Effect.runPromise(
            importWebProjectArchive(file.name, new Uint8Array(buffer)),
          );
        })
        .then(finishProjectImport)
        .catch((error: unknown) =>
          setCapsuleNotice(projectImportFailureMessage(error)),
        );
    });
    input.click();
  };
  const importGitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGitImporting(true);
    setGitImportError(undefined);
    setCapsuleNotice("Cloning exact Git source in isolation…");
    try {
      const { importWebProjectFromGit } = await import(
        "../lib/web-project-git-import"
      );
      const result = await Effect.runPromise(
        importWebProjectFromGit(gitImportUrl, gitImportCommit),
      );
      await finishProjectImport(result);
      setGitImportOpen(false);
      setGitImportUrl("");
      setGitImportCommit("");
    } catch (error) {
      const message = projectImportFailureMessage(error);
      setGitImportError(message);
      setCapsuleNotice(message);
    } finally {
      setGitImporting(false);
    }
  };
  const installCapsule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInstalling(true);
    setInstallError(undefined);
    setCapsuleNotice("Downloading and verifying Flect app…");
    try {
      const { loadBrowserCapsuleArchiveFromUrl } = await import(
        "../lib/browser-capsule-loader"
      );
      const archive = await Effect.runPromise(
        loadBrowserCapsuleArchiveFromUrl(installUrl),
      );
      await workspace.importCapsule?.(archive);
      setCapsuleNotice("Flect app verified. Ready to activate.");
      setInstallOpen(false);
      setInstallUrl("");
    } catch {
      setInstallError(
        "Install failed safely. Check the URL, CORS access, and capsule integrity.",
      );
      setCapsuleNotice("Flect app install failed safely.");
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    const dialog = installDialogRef.current;
    if (!installOpen || dialog === null || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, [installOpen]);

  useEffect(() => {
    const dialog = gitImportDialogRef.current;
    if (!gitImportOpen || dialog === null || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, [gitImportOpen]);

  useEffect(() => {
    if (shaping.status === "preview") {
      void shaping.verifyIsolation();
    }
  }, [shaping.status, shaping.verifyIsolation]);

  useEffect(() => {
    if (shaping.status !== "preview") {
      return;
    }
    queueMicrotask(() =>
      capsuleReview?.activationBlocked || candidateExtensionBlocked
        ? rejectChangeRef.current?.focus()
        : keepChangeRef.current?.focus(),
    );
  }, [
    candidateExtensionBlocked,
    capsuleReview?.activationBlocked,
    shaping.status,
  ]);

  return (
    <aside
      aria-label="Flect agent"
      className="agent-rail"
      data-mode={mode}
      data-status={controller.status}
      tabIndex={-1}
    >
      <header className="agent-rail__header">
        <div className="agent-rail__identity">
          <strong>{roleLabel}</strong>
          <span>{mode === "safe" ? "Protected shell" : "Live canvas"}</span>
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
        activities={activities}
        label={roleLabel}
        messages={messages}
        status={controller.status}
        onFixFailure={(activity) => void shaping.fixFailure(activity)}
      />

      <div className="agent-rail__dock">
        {build !== undefined && build.phase !== "succeeded" && (
          <div
            className={`build-progress build-progress--${build.phase}`}
            role={build.phase === "failed" ? "alert" : "status"}
          >
            <span aria-hidden="true" />
            <span className="sr-only">Browser build: </span>
            <strong>{build.message}</strong>
          </div>
        )}
        {capsuleNotice !== undefined && (
          <p className="capsule-notice" role="status">
            {capsuleNotice}
          </p>
        )}
        {mode === "safe" && (
          <section className="recovery-banner" role="status">
            <div>
              <strong>Custom interface state is bypassed.</strong>
              <p>Restore the last-known-good revision to return.</p>
              <small>
                {workspace.continuity?.recovery === undefined
                  ? `Session continuity generation ${workspace.continuity?.generation ?? 0}, revision ${workspace.continuity?.revisionSequence ?? 0}.`
                  : `Session continuity needs recovery: ${workspace.continuity.recovery}.`}
              </small>
            </div>
            <div className="revision-banner__actions">
              <button
                className="decision-button decision-button--primary"
                onClick={() => void onRestoreSafeMode()}
                type="button"
              >
                Restore interface
              </button>
              <button
                className="decision-button"
                disabled={workspace.continuity?.recovery !== undefined}
                onClick={() => void exportContinuity()}
                type="button"
              >
                Export session continuity
              </button>
              <button
                className="decision-button"
                onClick={() => void workspace.discardContinuity?.()}
                type="button"
              >
                Discard session continuity
              </button>
              {workspace.continuity?.recovery !== undefined && (
                <button
                  className="decision-button"
                  onClick={() => void workspace.retryContinuity?.()}
                  type="button"
                >
                  Retry session continuity
                </button>
              )}
            </div>
          </section>
        )}

        {shaping.status !== "preview" &&
          acceptedCapsuleReview !== undefined &&
          acceptedCapsuleReview.capabilities.length > 0 && (
            <details className="capsule-review">
              <summary>Product capabilities</summary>
              <ProductCapabilities
                capabilities={acceptedCapsuleReview.capabilities}
                onDecide={onDecideProductCapability}
                onRevoke={onRevokeProductCapability}
                scopeId={acceptedCapsuleReview.id}
              />
            </details>
          )}

        {shaping.status !== "preview" &&
          acceptedCapsuleReview !== undefined &&
          acceptedCapsuleReview.extensions.length > 0 &&
          extensions !== undefined &&
          portableExtensionActions !== undefined && (
            <details className="capsule-review">
              <summary>Portable extensions</summary>
              <Suspense
                fallback={
                  <SurfaceFallback label="Opening portable extensions" />
                }
              >
                <ExtensionReview
                  binding="accepted"
                  capsuleId={acceptedCapsuleReview.id}
                  entries={extensions.entries}
                  packages={acceptedCapsuleReview.extensions}
                  {...portableExtensionActions}
                />
              </Suspense>
            </details>
          )}

        {shaping.status === "preview" && (
          <section aria-label="Import decision" className="revision-banner">
            <div className="revision-banner__copy">
              <span>Imported app ready</span>
              <strong>{document.name}</strong>
              <small>
                {shaping.isolation === "ready"
                  ? "Extensions isolated"
                  : shaping.isolation === "unavailable"
                    ? "Extension isolation unavailable"
                    : "Checking extension isolation"}
              </small>
            </div>
            {capsuleReview !== undefined && (
              <details className="capsule-review" open>
                <summary>
                  {acceptedCapsuleReview?.id === capsuleReview.id
                    ? `Review update ${acceptedCapsuleReview.version} → ${capsuleReview.version}`
                    : acceptedCapsuleReview === undefined
                      ? "Imported app details"
                      : `Review replacement for ${acceptedCapsuleReview.name}`}
                </summary>
                {acceptedCapsuleReview !== undefined && (
                  <p className="capsule-review__comparison">
                    {acceptedCapsuleReview.id === capsuleReview.id
                      ? "The installed app stays active until you explicitly activate this version."
                      : "The current installed app stays active until you explicitly activate this replacement."}
                  </p>
                )}
                <dl>
                  <div>
                    <dt>Publisher</dt>
                    <dd>
                      {capsuleReview.publisher} · {capsuleReview.version}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{capsuleReview.source}</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{capsuleReview.revision}</dd>
                  </div>
                  <div>
                    <dt>Trust</dt>
                    <dd>{capsuleTrustLabel(capsuleReview)}</dd>
                  </div>
                  <div>
                    <dt>Contents</dt>
                    <dd>
                      {capsuleReview.fileCount} file
                      {capsuleReview.fileCount === 1 ? "" : "s"} ·{" "}
                      {capsuleReview.totalBytes.toLocaleString()} bytes
                    </dd>
                  </div>
                  <div>
                    <dt>Platforms</dt>
                    <dd>{capsuleReview.platforms.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Flect</dt>
                    <dd>
                      {capsuleReview.flectRange} ·{" "}
                      {capsuleReview.flectCompatible
                        ? "compatible"
                        : "incompatible"}
                    </dd>
                  </div>
                  <div>
                    <dt>This host</dt>
                    <dd>
                      {capsuleReview.currentPlatform} ·{" "}
                      {capsuleReview.platformCompatible
                        ? "supported"
                        : "unsupported"}
                    </dd>
                  </div>
                  {capsuleReview.build !== undefined && (
                    <>
                      <div>
                        <dt>Verified build</dt>
                        <dd>
                          artifact{" "}
                          {capsuleReview.build.artifactDigest.slice(0, 7)}
                          {" · source "}
                          {capsuleReview.build.sourceRevision.slice(0, 7)}
                        </dd>
                      </div>
                      {capsuleReview.build.dependencyGraphDigest !==
                        undefined && (
                        <div>
                          <dt>Dependencies</dt>
                          <dd>
                            Locked in source Git · graph{" "}
                            {capsuleReview.build.dependencyGraphDigest.slice(
                              0,
                              7,
                            )}
                          </dd>
                        </div>
                      )}
                    </>
                  )}
                </dl>
                {capsuleReview.importReport !== undefined && (
                  <div className="capsule-review__capabilities">
                    <strong>Import compatibility</strong>
                    <p>
                      {capsuleReview.importReport.kind === "vite-react"
                        ? "Vite React"
                        : capsuleReview.importReport.kind === "vite-vue"
                          ? "Vue"
                          : capsuleReview.importReport.kind === "vite-svelte"
                            ? "Svelte"
                            : capsuleReview.importReport.kind === "vite"
                              ? "Vite"
                              : "Static HTML"}
                      {" · "}
                      {capsuleReview.importReport.entrypoint}
                    </p>
                    {capsuleReview.importReport.adaptations.length > 0 && (
                      <ul>
                        {capsuleReview.importReport.adaptations.map(
                          (adaptation) => (
                            <li key={adaptation}>
                              <span>{adaptation}</span>
                              <small>Adapted</small>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                    {capsuleReview.importReport.warnings.map((warning) => (
                      <p className="capsule-review__warning" key={warning}>
                        {warning}
                      </p>
                    ))}
                    {capsuleReview.importReport.ignoredFiles.length > 0 && (
                      <small>
                        {capsuleReview.importReport.ignoredFiles.length} ignored
                        secret or generated file
                        {capsuleReview.importReport.ignoredFiles.length === 1
                          ? ""
                          : "s"}
                      </small>
                    )}
                  </div>
                )}
                <ProductCapabilities
                  capabilities={capsuleReview.capabilities}
                  onDecide={onDecideProductCapability}
                  onRevoke={onRevokeProductCapability}
                  scopeId={capsuleReview.id}
                />
                {capsuleReview.extensions.length > 0 &&
                  extensions !== undefined &&
                  portableExtensionActions !== undefined && (
                    <Suspense
                      fallback={
                        <SurfaceFallback label="Opening portable extensions" />
                      }
                    >
                      <ExtensionReview
                        binding="candidate"
                        capsuleId={capsuleReview.id}
                        disabled={operationActive}
                        entries={extensions.entries}
                        packages={capsuleReview.extensions}
                        {...portableExtensionActions}
                      />
                    </Suspense>
                  )}
                {capsuleReview.activationBlocked && (
                  <p className="capsule-review__warning" role="alert">
                    {!capsuleReview.trustDecision.allowed
                      ? "This app cannot be activated because its signature does not satisfy the configured publisher policy. Signatures never grant product capabilities."
                      : !capsuleReview.flectCompatible ||
                          !capsuleReview.platformCompatible
                        ? "This app is incompatible with this Flect version or host. You can inspect it, but it cannot be activated."
                        : "This app requires capabilities that are not granted. You can inspect it, but it cannot be activated."}
                  </p>
                )}
                {candidateExtensionBlocked && (
                  <p className="capsule-review__warning" role="alert">
                    Every enabled candidate extension must pass its bounded test
                    before this app can be activated. Disable failed extensions
                    or ask Flect to fix them.
                  </p>
                )}
              </details>
            )}
            <div className="revision-banner__actions">
              <button
                className="decision-button decision-button--primary"
                disabled={
                  operationActive ||
                  capsuleReview?.activationBlocked === true ||
                  candidateExtensionBlocked
                }
                onClick={() => void shaping.accept()}
                ref={keepChangeRef}
                type="button"
              >
                Activate app
              </button>
              <button
                className="decision-button"
                disabled={operationActive}
                onClick={() => void shaping.reject()}
                ref={rejectChangeRef}
                type="button"
              >
                Discard
              </button>
            </div>
          </section>
        )}

        {controller.status === "setup-required" && (
          <section
            aria-labelledby="provider-setup-title"
            className="provider-setup"
          >
            <Card>
              <CardHeader>
                <CardTitle id="provider-setup-title">
                  Connect an agent
                </CardTitle>
                <CardDescription>
                  Sign in once, then tell Flect what you want to make. Your
                  draft stays private until the connection succeeds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Suspense
                  fallback={<SurfaceFallback label="Opening provider setup" />}
                >
                  <ProviderAuthPanel
                    authEvent={workspace.authEvent}
                    compact
                    disabled={operationActive}
                    onCancel={workspace.cancelProviderAuth}
                    onLogin={workspace.loginProvider}
                    onLogout={workspace.logoutProvider}
                    onRefresh={workspace.refreshProviderAuth}
                    onReply={workspace.replyProviderAuth}
                    providers={workspace.providers}
                  />
                </Suspense>
              </CardContent>
            </Card>
          </section>
        )}

        {controller.status === "unavailable" && (
          <div className="runtime-alert" role="alert">
            <div>
              <strong>Local runtime offline</strong>
              <p>{controller.error}</p>
            </div>
            <button
              className="retry-button"
              onClick={() => void workspace.refresh()}
              type="button"
            >
              <RefreshIcon />
              Restart runtime
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

        {diagnostics !== undefined && (
          <DeferredDiagnosticsPanel
            control={diagnostics.control}
            onToggleControl={diagnostics.onToggleControl}
            operations={diagnostics.operations}
            persistence={diagnostics.persistence}
            setup={diagnostics.setup}
            update={diagnostics.update}
          />
        )}

        <Composer
          disabled={mode === "safe"}
          drafts={workspace.drafts}
          externalExtensionsEnabled={externalExtensionsEnabled}
          mode={mode}
          modelFavorites={preferences.value.modelFavorites}
          models={workspace.models}
          reasoningLevel={workspace.reasoningLevel}
          providers={workspace.providers}
          providerSetupInline={controller.status === "setup-required"}
          authEvent={workspace.authEvent}
          onCancel={cancel}
          onDraftChange={workspace.setDraft}
          onOpenSafeMode={onOpenSafeMode}
          onExportRepository={exportRepository}
          onExportCapsule={exportCapsule}
          onImportCapsule={importCapsule}
          onInstallCapsule={() => {
            setInstallError(undefined);
            setInstallOpen(true);
          }}
          onImportWebProject={importHtmlProject}
          onImportWebProjectArchive={importProjectArchive}
          onImportWebProjectGit={() => {
            setGitImportError(undefined);
            setGitImportOpen(true);
          }}
          onOpenShareSource={onOpenShareSource}
          onOpenShareFile={onOpenShareFile}
          onManageSharedSources={onManageSharedSources}
          repository={workspace.repository}
          onRollback={shaping.rollback}
          onSelectModel={workspace.selectModel}
          onSelectReasoning={workspace.selectReasoning}
          onLoginProvider={workspace.loginProvider}
          onReplyProviderAuth={workspace.replyProviderAuth}
          onCancelProviderAuth={workspace.cancelProviderAuth}
          onRefreshProviderAuth={workspace.refreshProviderAuth}
          onLogoutProvider={workspace.logoutProvider}
          onToggleExternalExtensions={toggleExternalExtensions}
          onSubmit={submit}
          onToggleModelFavorite={preferences.toggleModelFavorite}
          placeholder="Build, change, use, or connect anything"
          rollbackAvailable={shaping.rollbackAvailable}
          selectedModel={workspace.selectedModel}
          status={controller.status}
        />
        {installOpen && (
          <dialog
            aria-labelledby="capsule-install-title"
            className="capsule-install-dialog"
            onCancel={(event) => {
              event.preventDefault();
              if (!installing) setInstallOpen(false);
            }}
            ref={installDialogRef}
          >
            <form onSubmit={(event) => void installCapsule(event)}>
              <header>
                <strong id="capsule-install-title">Install Flect app</strong>
                <p>
                  Flect downloads without credentials, verifies the manifest and
                  every file, then opens a reviewable preview.
                </p>
              </header>
              <label htmlFor="capsule-install-url">HTTPS capsule URL</label>
              <input
                autoFocus
                disabled={installing}
                id="capsule-install-url"
                onChange={(event) => setInstallUrl(event.currentTarget.value)}
                placeholder="https://example.com/app.flect"
                required
                type="url"
                value={installUrl}
              />
              {installError !== undefined && (
                <p className="capsule-install-dialog__error" role="alert">
                  {installError}
                </p>
              )}
              <div>
                <button
                  className="decision-button"
                  disabled={installing}
                  onClick={() => setInstallOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="decision-button decision-button--primary"
                  disabled={installing || installUrl.length === 0}
                  type="submit"
                >
                  {installing ? "Verifying…" : "Download and review"}
                </button>
              </div>
            </form>
          </dialog>
        )}
        {gitImportOpen && (
          <dialog
            aria-labelledby="git-import-title"
            className="capsule-install-dialog"
            onCancel={(event) => {
              event.preventDefault();
              if (!gitImporting) setGitImportOpen(false);
            }}
            ref={gitImportDialogRef}
          >
            <form onSubmit={(event) => void importGitProject(event)}>
              <header>
                <strong id="git-import-title">Import from Git</strong>
                <p>
                  Flect clones public HTTPS source in its isolated Git worker,
                  checks out exactly one commit, and never runs repository code.
                </p>
              </header>
              <label htmlFor="git-import-url">Public HTTPS repository</label>
              <input
                autoFocus
                disabled={gitImporting}
                id="git-import-url"
                onChange={(event) => setGitImportUrl(event.currentTarget.value)}
                placeholder="https://github.com/owner/project.git"
                required
                type="url"
                value={gitImportUrl}
              />
              <label htmlFor="git-import-commit">Exact commit ID</label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                disabled={gitImporting}
                id="git-import-commit"
                maxLength={40}
                minLength={40}
                onChange={(event) =>
                  setGitImportCommit(event.currentTarget.value)
                }
                pattern="[0-9a-f]{40}"
                placeholder="40 lowercase hexadecimal characters"
                required
                spellCheck={false}
                value={gitImportCommit}
              />
              {gitImportError !== undefined && (
                <p className="capsule-install-dialog__error" role="alert">
                  {gitImportError}
                </p>
              )}
              <div>
                <button
                  className="decision-button"
                  disabled={gitImporting}
                  onClick={() => setGitImportOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="decision-button decision-button--primary"
                  disabled={
                    gitImporting ||
                    gitImportUrl.length === 0 ||
                    gitImportCommit.length !== 40
                  }
                  type="submit"
                >
                  {gitImporting ? "Importing…" : "Import exact commit"}
                </button>
              </div>
            </form>
          </dialog>
        )}
      </div>
    </aside>
  );
}
