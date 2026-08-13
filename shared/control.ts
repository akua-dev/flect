import { Effect, Schema, type SchemaAST } from "effect";
import { ShareSource } from "../packages/product/src/share";
import { CanvasSelection } from "./canvas-selection";
import {
  ExternalPiExtensionSelection,
  InteractiveAgentRole,
  ModelSelection,
  ModelSummary,
  ReasoningLevel,
  ValidationIssue,
} from "./contracts";
import {
  ExtensionCapability,
  PortableExtensionBinding,
  PortableExtensionCatalogSnapshot,
} from "./extensions";
import { GitRepositoryStatus } from "./git-workspace";
import { InterfaceDocument } from "./interface-document";
import {
  ProductCapabilityDecisionChoice,
  ProductCapabilityDecisionId,
  ProductCapabilityGrantScopeId,
  ProductCapabilityId,
  ProductCapabilityProjection,
  ProductCapabilityReceipt,
  ProductOperationId,
} from "./product-capability";
import { RevisionId, ShapingSnapshot } from "./revisions";
import {
  ShareInstallationRefs,
  ShareInstallationSnapshot,
  ShareLineage,
} from "./share-installation";
import { ShareReview } from "./share-review";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const Identifier = (prefix: string) =>
  Schema.String.check(
    Schema.isMinLength(prefix.length + 9),
    Schema.isMaxLength(100),
    Schema.isPattern(new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]*$`)),
  );

const BoundedText = (minimum: number, maximum: number) =>
  Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const CommandId = Identifier("cmd");
const WorkspaceId = Identifier("workspace");
const ClientId = Identifier("client");
export const OperationId = Identifier("operation");
const EventId = Identifier("event");
const ActivityId = Identifier("activity");
const ToolCallId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(160),
);
const NodeId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);
const ShareId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
);
const ShareObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const ShareArtifactIds = Schema.Array(ShareId).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
);
const SharePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(
    /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
  ),
);
const ShareCheckpointFiles = Schema.Array(
  Schema.Struct({
    path: SharePath,
    contents: Schema.Uint8Array.check(Schema.isMaxLength(8 * 1024 * 1024)),
  }),
).check(Schema.isMaxLength(4_096));

export const WorkbenchTarget = Schema.Literals(["use", "shape"]);
export type WorkbenchTarget = typeof WorkbenchTarget.Type;

export class WorkbenchHandoff extends Schema.Class<WorkbenchHandoff>(
  "WorkbenchHandoff",
)({
  version: Schema.Literal(1),
  instruction: BoundedText(1, 4_000),
  revisionId: RevisionId,
  selectedNodeId: Schema.optionalKey(NodeId),
  selection: Schema.optionalKey(CanvasSelection),
  failureOperationId: Schema.optionalKey(OperationId),
  failureSummary: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(1_000)),
  ),
}) {}

export class WorkbenchSnapshot extends Schema.Class<WorkbenchSnapshot>(
  "WorkbenchSnapshot",
)({
  target: WorkbenchTarget,
  binding: Schema.Literals(["accepted", "candidate"]),
  transitionSequence: Sequence,
  candidateRevisionId: Schema.optionalKey(RevisionId),
  handoff: Schema.optionalKey(WorkbenchHandoff),
}) {}

export class UserCommandSource extends Schema.Class<UserCommandSource>(
  "UserCommandSource",
)({
  kind: Schema.Literal("user"),
}) {}

export class ControlCommandSource extends Schema.Class<ControlCommandSource>(
  "ControlCommandSource",
)({
  kind: Schema.Literal("control"),
  clientId: ClientId,
  clientName: BoundedText(1, 120),
}) {}

export class AgentCommandSource extends Schema.Class<AgentCommandSource>(
  "AgentCommandSource",
)({
  kind: Schema.Literal("agent"),
  role: InteractiveAgentRole,
  sessionId: Identifier("session"),
  parentOperationId: OperationId,
  requestId: ToolCallId,
  binding: Schema.optionalKey(Schema.Literals(["accepted", "candidate"])),
}) {}

export class CapsuleCommandSource extends Schema.Class<CapsuleCommandSource>(
  "CapsuleCommandSource",
)({
  kind: Schema.Literal("capsule"),
  capsuleId: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(160),
    Schema.isPattern(/^[a-z][a-z0-9.-]*$/),
  ),
  binding: Schema.Literals(["accepted", "candidate"]),
  intentId: ToolCallId,
}) {}

export const FlectCommandSource = Schema.Union([
  UserCommandSource,
  ControlCommandSource,
  AgentCommandSource,
  CapsuleCommandSource,
]);
export type FlectCommandSource = typeof FlectCommandSource.Type;

export class Inspect extends Schema.Class<Inspect>("Inspect")({
  type: Schema.Literal("inspect"),
}) {}

export class SetMode extends Schema.Class<SetMode>("SetMode")({
  type: Schema.Literal("set-mode"),
  mode: Schema.Literals(["edit", "run"]),
}) {}

export class SelectWorkbenchTarget extends Schema.Class<SelectWorkbenchTarget>(
  "SelectWorkbenchTarget",
)({
  type: Schema.Literal("select-workbench-target"),
  target: WorkbenchTarget,
}) {}

export class SetRailCollapsed extends Schema.Class<SetRailCollapsed>(
  "SetRailCollapsed",
)({
  type: Schema.Literal("set-rail-collapsed"),
  collapsed: Schema.Boolean,
}) {}

export class SetRailWidth extends Schema.Class<SetRailWidth>("SetRailWidth")({
  type: Schema.Literal("set-rail-width"),
  width: Schema.Int.check(Schema.isBetween({ minimum: 340, maximum: 520 })),
}) {}

export class RefreshRuntime extends Schema.Class<RefreshRuntime>(
  "RefreshRuntime",
)({
  type: Schema.Literal("refresh-runtime"),
}) {}

export class SelectModel extends Schema.Class<SelectModel>("SelectModel")({
  type: Schema.Literal("select-model"),
  model: Schema.optionalKey(ModelSelection),
}) {}

export class SetModelFavorite extends Schema.Class<SetModelFavorite>(
  "SetModelFavorite",
)({
  type: Schema.Literal("set-model-favorite"),
  model: ModelSelection,
  favorite: Schema.Boolean,
}) {}

export class SetExternalExtensions extends Schema.Class<SetExternalExtensions>(
  "SetExternalExtensions",
)({
  type: Schema.Literal("set-external-extensions"),
  role: InteractiveAgentRole,
  enabled: Schema.Boolean,
}) {}

const PortableCapsuleId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
);
const PortableExtensionId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);
const PortableRevision = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[A-Za-z0-9._/-]+$/),
);

export class SetPortableExtensionEnabled extends Schema.Class<SetPortableExtensionEnabled>(
  "SetPortableExtensionEnabled",
)({
  type: Schema.Literal("set-portable-extension-enabled"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: PortableExtensionBinding,
  enabled: Schema.Boolean,
  grants: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
}) {}

export class TestPortableExtension extends Schema.Class<TestPortableExtension>(
  "TestPortableExtension",
)({
  type: Schema.Literal("test-portable-extension"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: Schema.Literal("candidate"),
  input: Schema.Json,
}) {}

export class SetPortableExtensionPin extends Schema.Class<SetPortableExtensionPin>(
  "SetPortableExtensionPin",
)({
  type: Schema.Literal("set-portable-extension-pin"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: PortableExtensionBinding,
  pinned: Schema.Boolean,
}) {}

export class ForkPortableExtension extends Schema.Class<ForkPortableExtension>(
  "ForkPortableExtension",
)({
  type: Schema.Literal("fork-portable-extension"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: PortableExtensionBinding,
  revision: PortableRevision,
}) {}

export class ResolvePortableExtensionUpdate extends Schema.Class<ResolvePortableExtensionUpdate>(
  "ResolvePortableExtensionUpdate",
)({
  type: Schema.Literal("resolve-portable-extension-update"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: Schema.Literal("candidate"),
  choice: Schema.Literals(["upstream", "fork"]),
}) {}

export class RemovePortableExtension extends Schema.Class<RemovePortableExtension>(
  "RemovePortableExtension",
)({
  type: Schema.Literal("remove-portable-extension"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: PortableExtensionBinding,
}) {}

export class InvokePortableExtension extends Schema.Class<InvokePortableExtension>(
  "InvokePortableExtension",
)({
  type: Schema.Literal("invoke-portable-extension"),
  capsuleId: PortableCapsuleId,
  extensionId: PortableExtensionId,
  role: InteractiveAgentRole,
  binding: PortableExtensionBinding,
  input: Schema.Json,
}) {}

export class SubmitAppPrompt extends Schema.Class<SubmitAppPrompt>(
  "SubmitAppPrompt",
)({
  type: Schema.Literal("submit-app-prompt"),
  text: BoundedText(1, 100_000),
}) {}

export class SubmitShaperInstruction extends Schema.Class<SubmitShaperInstruction>(
  "SubmitShaperInstruction",
)({
  type: Schema.Literal("submit-shaper-instruction"),
  instruction: BoundedText(1, 4_000),
}) {}

export class RequestShapeHandoff extends Schema.Class<RequestShapeHandoff>(
  "RequestShapeHandoff",
)({
  type: Schema.Literal("request-shape-handoff"),
  handoff: WorkbenchHandoff,
}) {}

export class CancelRole extends Schema.Class<CancelRole>("CancelRole")({
  type: Schema.Literal("cancel-role"),
  role: InteractiveAgentRole,
}) {}

export class InvokeInterfaceAction extends Schema.Class<InvokeInterfaceAction>(
  "InvokeInterfaceAction",
)({
  type: Schema.Literal("invoke-interface-action"),
  nodeId: NodeId,
}) {}

export class InvokeProductOperation extends Schema.Class<InvokeProductOperation>(
  "InvokeProductOperation",
)({
  type: Schema.Literal("invoke-product-operation"),
  operationId: ProductOperationId,
  input: Schema.Json,
}) {}

export class DecideProductCapability extends Schema.Class<DecideProductCapability>(
  "DecideProductCapability",
)({
  type: Schema.Literal("decide-product-capability"),
  capsuleId: ProductCapabilityGrantScopeId,
  capabilityId: ProductCapabilityId,
  choice: ProductCapabilityDecisionChoice,
}) {}

export class RevokeProductCapability extends Schema.Class<RevokeProductCapability>(
  "RevokeProductCapability",
)({
  type: Schema.Literal("revoke-product-capability"),
  decisionId: ProductCapabilityDecisionId,
}) {}

export class AcceptProposal extends Schema.Class<AcceptProposal>(
  "AcceptProposal",
)({
  type: Schema.Literal("accept-proposal"),
}) {}

export class RejectProposal extends Schema.Class<RejectProposal>(
  "RejectProposal",
)({
  type: Schema.Literal("reject-proposal"),
}) {}

export class RollbackRevision extends Schema.Class<RollbackRevision>(
  "RollbackRevision",
)({
  type: Schema.Literal("rollback-revision"),
}) {}

export class ImportCapsule extends Schema.Class<ImportCapsule>("ImportCapsule")(
  {
    type: Schema.Literal("import-capsule"),
    archive: Schema.Uint8Array,
  },
) {}

export class OpenShareSource extends Schema.Class<OpenShareSource>(
  "OpenShareSource",
)({
  type: Schema.Literal("open-share-source"),
  source: ShareSource,
}) {}

export class RejectShareCandidate extends Schema.Class<RejectShareCandidate>(
  "RejectShareCandidate",
)({ type: Schema.Literal("reject-share-candidate") }) {}

export class RetainShareCandidate extends Schema.Class<RetainShareCandidate>(
  "RetainShareCandidate",
)({
  type: Schema.Literal("retain-share-candidate"),
  artifactIds: ShareArtifactIds,
}) {}

export class ForkShare extends Schema.Class<ForkShare>("ForkShare")({
  type: Schema.Literal("fork-share"),
  shareId: ShareId,
}) {}

export class CheckpointShareFork extends Schema.Class<CheckpointShareFork>(
  "CheckpointShareFork",
)({
  type: Schema.Literal("checkpoint-share-fork"),
  shareId: ShareId,
  expectedForkCommit: ShareObjectId,
  files: ShareCheckpointFiles,
  removals: Schema.Array(SharePath).check(Schema.isMaxLength(4_096)),
  message: BoundedText(1, 500),
}) {}

export class PrepareShareUpdate extends Schema.Class<PrepareShareUpdate>(
  "PrepareShareUpdate",
)({
  type: Schema.Literal("prepare-share-update"),
  shareId: ShareId,
}) {}

export class ContinueShareFork extends Schema.Class<ContinueShareFork>(
  "ContinueShareFork",
)({
  type: Schema.Literal("continue-share-fork"),
  shareId: ShareId,
}) {}

export class OpenShareConflictInShape extends Schema.Class<OpenShareConflictInShape>(
  "OpenShareConflictInShape",
)({
  type: Schema.Literal("open-share-conflict-in-shape"),
  shareId: ShareId,
}) {}

export class ResolveShareConflict extends Schema.Class<ResolveShareConflict>(
  "ResolveShareConflict",
)({
  type: Schema.Literal("resolve-share-conflict"),
  shareId: ShareId,
  expectedBaseCommit: ShareObjectId,
  expectedUpstreamCommit: ShareObjectId,
  expectedForkCommit: ShareObjectId,
  files: ShareCheckpointFiles,
  removals: Schema.Array(SharePath).check(Schema.isMaxLength(100)),
  message: BoundedText(1, 500),
}) {}

export class ActivateShareCandidate extends Schema.Class<ActivateShareCandidate>(
  "ActivateShareCandidate",
)({
  type: Schema.Literal("activate-share-candidate"),
  shareId: ShareId,
  artifactIds: ShareArtifactIds,
}) {}

export class RemoveShare extends Schema.Class<RemoveShare>("RemoveShare")({
  type: Schema.Literal("remove-share"),
  shareId: ShareId,
}) {}

export class DeleteShareLocalData extends Schema.Class<DeleteShareLocalData>(
  "DeleteShareLocalData",
)({
  type: Schema.Literal("delete-share-local-data"),
  shareId: ShareId,
  expectedForkCommit: ShareObjectId,
}) {}

export class ExportShare extends Schema.Class<ExportShare>("ExportShare")({
  type: Schema.Literal("export-share"),
  shareId: ShareId,
}) {}

export class EnterSafeMode extends Schema.Class<EnterSafeMode>("EnterSafeMode")(
  {
    type: Schema.Literal("enter-safe-mode"),
  },
) {}

export class RestoreSafeMode extends Schema.Class<RestoreSafeMode>(
  "RestoreSafeMode",
)({
  type: Schema.Literal("restore-safe-mode"),
}) {}

export class EnableControl extends Schema.Class<EnableControl>("EnableControl")(
  {
    type: Schema.Literal("enable-control"),
  },
) {}

export class DisableControl extends Schema.Class<DisableControl>(
  "DisableControl",
)({
  type: Schema.Literal("disable-control"),
}) {}

export const FlectCommand = Schema.Union([
  Inspect,
  SetMode,
  SelectWorkbenchTarget,
  SetRailCollapsed,
  SetRailWidth,
  RefreshRuntime,
  SelectModel,
  SetModelFavorite,
  SetExternalExtensions,
  SetPortableExtensionEnabled,
  TestPortableExtension,
  SetPortableExtensionPin,
  ForkPortableExtension,
  ResolvePortableExtensionUpdate,
  RemovePortableExtension,
  InvokePortableExtension,
  SubmitAppPrompt,
  SubmitShaperInstruction,
  RequestShapeHandoff,
  CancelRole,
  InvokeInterfaceAction,
  InvokeProductOperation,
  DecideProductCapability,
  RevokeProductCapability,
  AcceptProposal,
  RejectProposal,
  RollbackRevision,
  ImportCapsule,
  OpenShareSource,
  RejectShareCandidate,
  RetainShareCandidate,
  ForkShare,
  CheckpointShareFork,
  PrepareShareUpdate,
  ContinueShareFork,
  OpenShareConflictInShape,
  ResolveShareConflict,
  ActivateShareCandidate,
  RemoveShare,
  DeleteShareLocalData,
  ExportShare,
  EnterSafeMode,
  RestoreSafeMode,
  EnableControl,
  DisableControl,
]);
export type FlectCommand = typeof FlectCommand.Type;

export class FlectCommandEnvelope extends Schema.Class<FlectCommandEnvelope>(
  "FlectCommandEnvelope",
)({
  version: Schema.Literal(1),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  source: FlectCommandSource,
  expectedSequence: Schema.optionalKey(Sequence),
  command: FlectCommand,
}) {}

export const decodeFlectCommandEnvelope = Effect.fn(
  "Flect.Control.decodeCommandEnvelope",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    FlectCommandEnvelope,
    strictOptions,
  )(input).pipe(
    Effect.mapError(() =>
      InvalidControlCommand.make({
        message: "The control command is invalid.",
      }),
    ),
  ),
);

export class ToolActivity extends Schema.Class<ToolActivity>("ToolActivity")({
  version: Schema.Literal(1),
  id: ActivityId,
  callId: ToolCallId,
  operationId: OperationId,
  turnId: Schema.optionalKey(OperationId),
  role: InteractiveAgentRole,
  toolName: BoundedText(1, 80),
  phase: Schema.Literals(["queued", "running", "succeeded", "failed"]),
  startedAt: Timestamp,
  updatedAt: Timestamp,
  completedAt: Schema.optionalKey(Timestamp),
  durationMs: Schema.optionalKey(Timestamp),
  command: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  output: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8_000))),
  resultSummary: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(500)),
  ),
  exitCode: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  ),
  previewUrl: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(2_048)),
  ),
  validationIssues: Schema.optionalKey(
    Schema.Array(ValidationIssue).check(Schema.isMaxLength(40)),
  ),
}) {}

export class ConversationMessage extends Schema.Class<ConversationMessage>(
  "ConversationMessage",
)({
  version: Schema.Literal(1),
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  turnId: Schema.optionalKey(OperationId),
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String.check(Schema.isMaxLength(100_000)),
  createdAt: Timestamp,
  source: FlectCommandSource,
}) {}

export class RoleConversationSnapshot extends Schema.Class<RoleConversationSnapshot>(
  "RoleConversationSnapshot",
)({
  role: InteractiveAgentRole,
  status: Schema.Literals([
    "booting",
    "ready",
    "submitting",
    "streaming",
    "cancelling",
    "error",
    "setup-required",
    "unavailable",
  ]),
  messages: Schema.Array(ConversationMessage).check(Schema.isMaxLength(500)),
  activities: Schema.Array(ToolActivity).check(Schema.isMaxLength(100)),
  lastPrompt: Schema.String.check(Schema.isMaxLength(100_000)),
  error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_000))),
}) {}

export class AgentWorkspaceSnapshot extends Schema.Class<AgentWorkspaceSnapshot>(
  "AgentWorkspaceSnapshot",
)({
  models: Schema.Array(ModelSummary).check(Schema.isMaxLength(1_000)),
  selectedModel: Schema.optionalKey(ModelSummary),
  reasoningLevel: Schema.optionalKey(ReasoningLevel),
  favoriteModels: Schema.Array(ModelSelection).check(Schema.isMaxLength(100)),
  externalExtensions: ExternalPiExtensionSelection,
  app: RoleConversationSnapshot,
  previewApp: RoleConversationSnapshot,
  shaper: RoleConversationSnapshot,
}) {}

export class OperationRecord extends Schema.Class<OperationRecord>(
  "OperationRecord",
)({
  version: Schema.Literal(1),
  sequence: Sequence,
  operationId: OperationId,
  commandId: Schema.optionalKey(CommandId),
  workspaceId: WorkspaceId,
  source: FlectCommandSource,
  category: Schema.Literals([
    "command",
    "session",
    "transport",
    "turn",
    "tool",
    "validation",
    "revision",
    "control",
    "capability",
  ]),
  phase: Schema.Literals([
    "accepted",
    "started",
    "updated",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  summary: BoundedText(1, 500),
  timestamp: Timestamp,
  role: Schema.optionalKey(InteractiveAgentRole),
  sessionId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  toolCallId: Schema.optionalKey(ToolCallId),
  revisionId: Schema.optionalKey(RevisionId),
  clientId: Schema.optionalKey(ClientId),
  validationIssues: Schema.optionalKey(
    Schema.Array(ValidationIssue).check(Schema.isMaxLength(40)),
  ),
  tool: Schema.optionalKey(ToolActivity),
  capability: Schema.optionalKey(ProductCapabilityReceipt),
}) {}

export class ControlClientSummary extends Schema.Class<ControlClientSummary>(
  "ControlClientSummary",
)({
  id: ClientId,
  name: BoundedText(1, 120),
  connectedAt: Timestamp,
  lastSeenAt: Timestamp,
}) {}

export class ControlStateSnapshot extends Schema.Class<ControlStateSnapshot>(
  "ControlStateSnapshot",
)({
  enabled: Schema.Boolean,
  instanceId: Schema.optionalKey(Identifier("instance")),
  clients: Schema.Array(ControlClientSummary).check(Schema.isMaxLength(50)),
}) {}

export class RailStateSnapshot extends Schema.Class<RailStateSnapshot>(
  "RailStateSnapshot",
)({
  collapsed: Schema.Boolean,
  width: Schema.Int.check(Schema.isBetween({ minimum: 340, maximum: 520 })),
}) {}

export class WorkspacePersistenceSnapshot extends Schema.Class<WorkspacePersistenceSnapshot>(
  "WorkspacePersistenceSnapshot",
)({
  source: Schema.Literals(["durable", "unavailable"]),
  capsule: Schema.Literals(["durable", "session", "unavailable"]),
}) {}

export class WorkspaceBuildSnapshot extends Schema.Class<WorkspaceBuildSnapshot>(
  "WorkspaceBuildSnapshot",
)({
  version: Schema.Literal(1),
  phase: Schema.Literals([
    "resolving-dependencies",
    "checkpointing-lock",
    "compiling",
    "packaging",
    "succeeded",
    "failed",
  ]),
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  buildId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(5), Schema.isMaxLength(80)),
  ),
  sourceRevision: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ),
  artifactDigest: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  ),
}) {}

export class ShareSourceOpened extends Schema.Class<ShareSourceOpened>(
  "ShareSourceOpened",
)({
  status: Schema.Literal("review-ready"),
  shareId: ShareId,
  lineage: ShareLineage,
}) {}

export class ShareCandidateRejected extends Schema.Class<ShareCandidateRejected>(
  "ShareCandidateRejected",
)({
  status: Schema.Literal("rejected"),
  shareId: ShareId,
}) {}

export class ShareCandidateRetained extends Schema.Class<ShareCandidateRetained>(
  "ShareCandidateRetained",
)({
  status: Schema.Literal("retained"),
  shareId: ShareId,
  refs: ShareInstallationRefs,
}) {}

export class ShareForkPrepared extends Schema.Class<ShareForkPrepared>(
  "ShareForkPrepared",
)({
  status: Schema.Literal("forked"),
  shareId: ShareId,
  forkCommit: ShareObjectId,
}) {}

export class ShareUpdatePrepared extends Schema.Class<ShareUpdatePrepared>(
  "ShareUpdatePrepared",
)({
  status: Schema.Literals([
    "fast-forward",
    "merged",
    "conflict",
    "replacement",
  ]),
  shareId: ShareId,
  candidateCommit: Schema.optionalKey(ShareObjectId),
}) {}

export class ShareCandidateActivated extends Schema.Class<ShareCandidateActivated>(
  "ShareCandidateActivated",
)({
  status: Schema.Literal("activated"),
  shareId: ShareId,
  artifactIds: ShareArtifactIds,
}) {}

export class ShareRemoved extends Schema.Class<ShareRemoved>("ShareRemoved")({
  status: Schema.Literal("removed"),
  shareId: ShareId,
}) {}

export class ShareLocalDataDeleted extends Schema.Class<ShareLocalDataDeleted>(
  "ShareLocalDataDeleted",
)({
  status: Schema.Literal("deleted"),
  shareId: ShareId,
}) {}

export class ShareExportPrepared extends Schema.Class<ShareExportPrepared>(
  "ShareExportPrepared",
)({
  status: Schema.Literal("exported"),
  shareId: ShareId,
  archiveSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  bytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 }),
  ),
}) {}

export class FlectWorkspaceSnapshot extends Schema.Class<FlectWorkspaceSnapshot>(
  "FlectWorkspaceSnapshot",
)({
  version: Schema.Literal(1),
  workspaceId: WorkspaceId,
  sequence: Sequence,
  phase: Schema.Literals([
    "booting",
    "ready",
    "shaping",
    "preview",
    "safe-mode",
    "unavailable",
  ]),
  mode: Schema.Literals(["edit", "run"]),
  document: InterfaceDocument,
  shaping: ShapingSnapshot,
  workbench: Schema.optionalKey(WorkbenchSnapshot),
  agent: AgentWorkspaceSnapshot,
  rail: RailStateSnapshot,
  control: ControlStateSnapshot,
  persistence: Schema.optionalKey(WorkspacePersistenceSnapshot),
  build: Schema.optionalKey(WorkspaceBuildSnapshot),
  permissions: Schema.optionalKey(
    Schema.Array(ProductCapabilityProjection).check(Schema.isMaxLength(256)),
  ),
  extensions: Schema.optionalKey(PortableExtensionCatalogSnapshot),
  operations: Schema.Array(OperationRecord).check(Schema.isMaxLength(500)),
  repository: Schema.optionalKey(GitRepositoryStatus),
  shares: Schema.optionalKey(ShareInstallationSnapshot),
  shareReview: Schema.optionalKey(ShareReview),
}) {}

export class FlectWorkspaceEvent extends Schema.Class<FlectWorkspaceEvent>(
  "FlectWorkspaceEvent",
)({
  version: Schema.Literal(1),
  id: EventId,
  sequence: Sequence,
  timestamp: Timestamp,
  workspaceId: WorkspaceId,
  operationId: Schema.optionalKey(OperationId),
  commandId: Schema.optionalKey(CommandId),
  source: FlectCommandSource,
  type: Schema.Literals([
    "command-accepted",
    "command-completed",
    "command-failed",
    "state-changed",
    "turn-started",
    "turn-updated",
    "turn-completed",
    "tool-started",
    "tool-updated",
    "tool-completed",
    "build-progress",
    "proposal-validation-failed",
    "revision-proposed",
    "revision-previewed",
    "revision-accepted",
    "revision-rejected",
    "revision-rolled-back",
    "safe-mode-entered",
    "safe-mode-restored",
    "control-enabled",
    "control-disabled",
    "client-connected",
    "client-disconnected",
  ]),
  role: Schema.optionalKey(InteractiveAgentRole),
  tool: Schema.optionalKey(ToolActivity),
  revisionId: Schema.optionalKey(RevisionId),
  message: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_000))),
}) {}

export class OperationFailed extends Schema.TaggedErrorClass<OperationFailed>()(
  "OperationFailed",
  {
    operationId: OperationId,
    message: BoundedText(1, 500),
  },
) {}

export class FlectCommandReceipt extends Schema.Class<FlectCommandReceipt>(
  "FlectCommandReceipt",
)({
  version: Schema.Literal(1),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  operationId: OperationId,
  sequence: Sequence,
  status: Schema.Literals(["accepted", "completed", "duplicate", "failed"]),
  result: Schema.optionalKey(Schema.Json),
  failure: Schema.optionalKey(OperationFailed),
}) {}

export class InvalidControlCommand extends Schema.TaggedErrorClass<InvalidControlCommand>()(
  "InvalidControlCommand",
  {
    message: Schema.Literal("The control command is invalid."),
  },
) {}

export class ControlUnauthorized extends Schema.TaggedErrorClass<ControlUnauthorized>()(
  "ControlUnauthorized",
  {
    message: BoundedText(1, 240),
  },
) {}

export class WorkspaceUnavailable extends Schema.TaggedErrorClass<WorkspaceUnavailable>()(
  "WorkspaceUnavailable",
  {
    message: Schema.Literal("The Flect workspace is unavailable."),
  },
) {}

export class CommandConflict extends Schema.TaggedErrorClass<CommandConflict>()(
  "CommandConflict",
  {
    message: Schema.Literal("The workspace changed before the command ran."),
    currentSequence: Sequence,
  },
) {}

export class CommandRejected extends Schema.TaggedErrorClass<CommandRejected>()(
  "CommandRejected",
  {
    message: BoundedText(1, 500),
  },
) {}

export const FlectCommandError = Schema.Union([
  InvalidControlCommand,
  ControlUnauthorized,
  WorkspaceUnavailable,
  CommandConflict,
  CommandRejected,
  OperationFailed,
]);
export type FlectCommandError = typeof FlectCommandError.Type;
