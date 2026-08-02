import { Effect, Schema, type SchemaAST } from "effect";
import { BunCommandResult } from "./bun-command";
import {
  InterfaceDocument,
  InvalidInterfaceDocument,
} from "./interface-document";
import {
  AgentProductActionRequest,
  ProductActionRequestId,
  ProductActionResult,
} from "./product-action";
import { ProductSurfaceCapabilityId } from "./product-surface";

const NonEmptyText = Schema.Trim.check(Schema.isMinLength(1));
const PromptText = NonEmptyText.check(Schema.isMaxLength(100_000));
const ShapingInstruction = NonEmptyText.check(Schema.isMaxLength(4_000));
const DiagnosticText = NonEmptyText.check(Schema.isMaxLength(4_000));
const ShellRequestId = Schema.String.check(
  Schema.isMinLength(7),
  Schema.isMaxLength(80),
  Schema.isPattern(/^shell-[a-z0-9-]+$/),
);
const ShellCommandText = NonEmptyText.check(Schema.isMaxLength(262_144));

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export class ContractDecodeError extends Schema.TaggedErrorClass<ContractDecodeError>()(
  "ContractDecodeError",
  {
    message: Schema.Literal("Invalid contract value."),
  },
) {}

const invalidContract = () =>
  new ContractDecodeError({ message: "Invalid contract value." });

export class ModelSummary extends Schema.Class<ModelSummary>("ModelSummary")({
  provider: NonEmptyText,
  id: NonEmptyText,
  name: NonEmptyText,
}) {}

export class RuntimeStatus extends Schema.Class<RuntimeStatus>("RuntimeStatus")(
  {
    version: Schema.Literal(1),
    status: Schema.Literals(["ready", "unavailable"]),
    message: Schema.optionalKey(NonEmptyText),
  },
) {}

export class ModelSelection extends Schema.Class<ModelSelection>(
  "ModelSelection",
)({
  provider: NonEmptyText,
  id: NonEmptyText,
}) {}

export class ExternalPiExtensionSelection extends Schema.Class<ExternalPiExtensionSelection>(
  "ExternalPiExtensionSelection",
)({
  app: Schema.Boolean,
  shaper: Schema.Boolean,
}) {}

export class SessionSelection extends Schema.Class<SessionSelection>(
  "SessionSelection",
)({
  model: Schema.optionalKey(ModelSelection),
  externalExtensions: Schema.optionalKey(ExternalPiExtensionSelection),
  productCapabilityId: Schema.optionalKey(ProductSurfaceCapabilityId),
}) {}

export const InteractiveAgentRole = Schema.Literals(["app", "shaper"]);
export type InteractiveAgentRole = typeof InteractiveAgentRole.Type;

export class PromptRequest extends Schema.Class<PromptRequest>("PromptRequest")(
  {
    text: PromptText,
  },
) {}

export class ShapeRequest extends Schema.Class<ShapeRequest>("ShapeRequest")({
  instruction: ShapingInstruction,
  document: Schema.Unknown,
}) {}

export class ShapeResponse extends Schema.Class<ShapeResponse>("ShapeResponse")(
  {
    version: Schema.Literal(1),
    document: InterfaceDocument,
  },
) {}

export const RecoveryReason = Schema.Literals([
  "rollback-failed",
  "invalid-interface",
  "extension-disabled",
]);
export type RecoveryReason = typeof RecoveryReason.Type;

export class RecoveryRequest extends Schema.Class<RecoveryRequest>(
  "RecoveryRequest",
)({
  reason: RecoveryReason,
}) {}

export class GuardianDiagnostic extends Schema.Class<GuardianDiagnostic>(
  "GuardianDiagnostic",
)({
  version: Schema.Literal(1),
  message: DiagnosticText,
}) {}

export class TurnStarted extends Schema.Class<TurnStarted>("TurnStarted")({
  type: Schema.Literal("turn_started"),
}) {}

export class TextDelta extends Schema.Class<TextDelta>("TextDelta")({
  type: Schema.Literal("text_delta"),
  delta: Schema.String,
}) {}

export class TurnCompleted extends Schema.Class<TurnCompleted>("TurnCompleted")(
  {
    type: Schema.Literal("turn_completed"),
  },
) {}

export class TurnCancelled extends Schema.Class<TurnCancelled>("TurnCancelled")(
  {
    type: Schema.Literal("cancelled"),
  },
) {}

export class TurnError extends Schema.Class<TurnError>("TurnError")({
  type: Schema.Literal("error"),
  message: NonEmptyText,
}) {}

export class TurnBusy extends Schema.Class<TurnBusy>("TurnBusy")({
  type: Schema.Literal("busy"),
  message: Schema.Literal("The session is busy."),
}) {}

export class AgentShellRequest extends Schema.Class<AgentShellRequest>(
  "AgentShellRequest",
)({
  type: Schema.Literal("shell_request"),
  requestId: ShellRequestId,
  command: ShellCommandText,
}) {}

export class ShapeCompleted extends Schema.Class<ShapeCompleted>(
  "ShapeCompleted",
)({
  type: Schema.Literal("shape_completed"),
  document: InterfaceDocument,
}) {}

export class ShapeBusy extends Schema.Class<ShapeBusy>("ShapeBusy")({
  type: Schema.Literal("shape_busy"),
  message: Schema.Literal("The session is busy."),
}) {}

export class ShapeError extends Schema.Class<ShapeError>("ShapeError")({
  type: Schema.Literal("shape_error"),
  message: Schema.Literal(
    "The local Flect runtime could not complete this request.",
  ),
}) {}

export const ShapeEvent = Schema.Union([
  AgentShellRequest,
  ShapeCompleted,
  ShapeBusy,
  ShapeError,
]);
export type ShapeEvent = typeof ShapeEvent.Type;

export const FlectEvent = Schema.Union([
  TurnStarted,
  TextDelta,
  AgentShellRequest,
  AgentProductActionRequest,
  TurnCompleted,
  TurnCancelled,
  TurnError,
  TurnBusy,
]);
export type FlectEvent = typeof FlectEvent.Type;

export class ModelsResponse extends Schema.Class<ModelsResponse>(
  "ModelsResponse",
)({
  version: Schema.Literal(1),
  models: Schema.Array(ModelSummary),
}) {}

export class SessionResponse extends Schema.Class<SessionResponse>(
  "SessionResponse",
)({
  version: Schema.Literal(1),
  sessionId: NonEmptyText,
}) {}

export class CancelResponse extends Schema.Class<CancelResponse>(
  "CancelResponse",
)({
  version: Schema.Literal(1),
  status: Schema.Literal("cancelled"),
}) {}

export class CancelRequest extends Schema.Class<CancelRequest>("CancelRequest")(
  {
    role: InteractiveAgentRole,
  },
) {}

export class PublicErrorResponse extends Schema.Class<PublicErrorResponse>(
  "PublicErrorResponse",
)({
  version: Schema.Literal(1),
  error: NonEmptyText,
}) {}

export class SessionNotFound extends Schema.TaggedErrorClass<SessionNotFound>()(
  "SessionNotFound",
  {
    sessionId: NonEmptyText,
    message: Schema.Literal("Session not found."),
  },
) {}

export class AgentShellResultRequest extends Schema.Class<AgentShellResultRequest>(
  "AgentShellResultRequest",
)({
  role: InteractiveAgentRole,
  requestId: ShellRequestId,
  result: BunCommandResult,
}) {}

export class AgentShellResultAccepted extends Schema.Class<AgentShellResultAccepted>(
  "AgentShellResultAccepted",
)({
  version: Schema.Literal(1),
  status: Schema.Literal("accepted"),
}) {}

export class SessionBusy extends Schema.TaggedErrorClass<SessionBusy>()(
  "SessionBusy",
  {
    sessionId: NonEmptyText,
    message: Schema.Literal("The session is busy."),
  },
) {}

export class AgentProductActionResultRequest extends Schema.Class<AgentProductActionResultRequest>(
  "AgentProductActionResultRequest",
)({
  role: Schema.Literal("app"),
  requestId: ProductActionRequestId,
  result: ProductActionResult,
}) {}

export class AgentProductActionResultAccepted extends Schema.Class<AgentProductActionResultAccepted>(
  "AgentProductActionResultAccepted",
)({
  version: Schema.Literal(1),
  status: Schema.Literal("accepted"),
}) {}

export class CloseSessionResponse extends Schema.Class<CloseSessionResponse>(
  "CloseSessionResponse",
)({
  version: Schema.Literal(1),
  status: Schema.Literal("closed"),
}) {}

export class NoModelAvailable extends Schema.TaggedErrorClass<NoModelAvailable>()(
  "NoModelAvailable",
  {
    message: Schema.Literal("No authenticated model is available."),
  },
) {}

export class PiOperationFailed extends Schema.TaggedErrorClass<PiOperationFailed>()(
  "PiOperationFailed",
  {
    operation: Schema.Literals([
      "initialize",
      "list_models",
      "create_session",
      "prompt",
      "shape",
      "cancel",
      "diagnose",
      "shell",
      "product_action",
    ]),
    message: Schema.Literal(
      "The model runtime could not complete the request.",
    ),
  },
) {}

export const FlectRuntimeError = Schema.Union([
  SessionNotFound,
  SessionBusy,
  NoModelAvailable,
  PiOperationFailed,
  InvalidInterfaceDocument,
]);
export type FlectRuntimeError = typeof FlectRuntimeError.Type;

export const decodeModelSummary = Effect.fn(
  "Flect.Contracts.decodeModelSummary",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    ModelSummary,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeRuntimeStatus = Effect.fn(
  "Flect.Contracts.decodeRuntimeStatus",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    RuntimeStatus,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeSessionSelection = Effect.fn(
  "Flect.Contracts.decodeSessionSelection",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    SessionSelection,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodePromptRequest = Effect.fn(
  "Flect.Contracts.decodePromptRequest",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    PromptRequest,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeFlectEvent = Effect.fn("Flect.Contracts.decodeFlectEvent")(
  (input: unknown) =>
    Schema.decodeUnknownEffect(
      FlectEvent,
      strictOptions,
    )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeModelsResponse = Effect.fn(
  "Flect.Contracts.decodeModelsResponse",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    ModelsResponse,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeSessionResponse = Effect.fn(
  "Flect.Contracts.decodeSessionResponse",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    SessionResponse,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);

export const decodeCancelResponse = Effect.fn(
  "Flect.Contracts.decodeCancelResponse",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    CancelResponse,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidContract)),
);
