import { Schema } from "effect";
import {
  FlectCommandEnvelope,
  FlectCommandError,
  FlectCommandReceipt,
  FlectWorkspaceEvent,
  FlectWorkspaceSnapshot,
  OperationRecord,
} from "./control";

const Port = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 65_535 }),
);
const Identifier = Schema.String.check(
  Schema.isMinLength(10),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z]+-[a-z0-9-]+$/),
);

export class ControlDescriptor extends Schema.Class<ControlDescriptor>(
  "ControlDescriptor",
)({
  version: Schema.Literal(1),
  instanceId: Identifier,
  workspaceId: FlectWorkspaceSnapshot.fields.workspaceId,
  url: Schema.String.check(
    Schema.isMinLength(18),
    Schema.isMaxLength(200),
    Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d+$/),
  ),
  token: Schema.String.check(
    Schema.isMinLength(43),
    Schema.isMaxLength(64),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  createdAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class ControlBrokerStatus extends Schema.Class<ControlBrokerStatus>(
  "ControlBrokerStatus",
)({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
  port: Port,
  instanceId: Schema.optionalKey(ControlDescriptor.fields.instanceId),
  workspaceId: Schema.optionalKey(FlectWorkspaceSnapshot.fields.workspaceId),
  url: Schema.String.check(Schema.isMaxLength(200)),
}) {}

export class ControlCommandSucceeded extends Schema.Class<ControlCommandSucceeded>(
  "ControlCommandSucceeded",
)({
  status: Schema.Literal("succeeded"),
  receipt: FlectCommandReceipt,
}) {}

export class ControlCommandFailed extends Schema.Class<ControlCommandFailed>(
  "ControlCommandFailed",
)({
  status: Schema.Literal("failed"),
  error: FlectCommandError,
}) {}

export const ControlCommandOutcome = Schema.Union([
  ControlCommandSucceeded,
  ControlCommandFailed,
]);
export type ControlCommandOutcome = typeof ControlCommandOutcome.Type;

export class ControlCommandCompletion extends Schema.Class<ControlCommandCompletion>(
  "ControlCommandCompletion",
)({
  commandId: FlectCommandEnvelope.fields.commandId,
  outcome: ControlCommandOutcome,
}) {}

export class ControlWorkspaceRegistration extends Schema.Class<ControlWorkspaceRegistration>(
  "ControlWorkspaceRegistration",
)({
  snapshot: FlectWorkspaceSnapshot,
}) {}

export class ControlSnapshotPublication extends Schema.Class<ControlSnapshotPublication>(
  "ControlSnapshotPublication",
)({
  snapshot: FlectWorkspaceSnapshot,
}) {}

export class ControlEventPublication extends Schema.Class<ControlEventPublication>(
  "ControlEventPublication",
)({
  event: FlectWorkspaceEvent,
}) {}

export class ControlNextCommandRequest extends Schema.Class<ControlNextCommandRequest>(
  "ControlNextCommandRequest",
)({
  workspaceId: FlectWorkspaceSnapshot.fields.workspaceId,
}) {}

export class ControlEventsResponse extends Schema.Class<ControlEventsResponse>(
  "ControlEventsResponse",
)({
  version: Schema.Literal(1),
  events: Schema.Array(FlectWorkspaceEvent).check(Schema.isMaxLength(512)),
}) {}

export class ControlLogsResponse extends Schema.Class<ControlLogsResponse>(
  "ControlLogsResponse",
)({
  version: Schema.Literal(1),
  operations: Schema.Array(OperationRecord).check(Schema.isMaxLength(500)),
}) {}

export class ControlCommandsResponse extends Schema.Class<ControlCommandsResponse>(
  "ControlCommandsResponse",
)({
  version: Schema.Literal(1),
  command: Schema.optionalKey(FlectCommandEnvelope),
}) {}

export class ControlAck extends Schema.Class<ControlAck>("ControlAck")({
  version: Schema.Literal(1),
  status: Schema.Literal("accepted"),
}) {}

export class ControlTransportFailed extends Schema.TaggedErrorClass<ControlTransportFailed>()(
  "ControlTransportFailed",
  {
    message: Schema.Literal("The local control transport is unavailable."),
  },
) {}
