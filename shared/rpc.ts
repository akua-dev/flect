import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { BunCommandResult } from "./bun-command";
import {
  AuthLoginEvent,
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  FlectEvent,
  FlectRuntimeError,
  GuardianDiagnostic,
  InteractiveAgentRole,
  ModelSummary,
  ProviderAuthSummary,
  RecoveryReason,
  RuntimeStatus,
  SessionSelection,
  ShapeEvent,
} from "./contracts";
import {
  FlectCommandEnvelope,
  FlectWorkspaceEvent,
  FlectWorkspaceSnapshot,
} from "./control";
import {
  ControlBrokerStatus,
  ControlCommandCompletion,
  ControlTransportFailed,
} from "./control-channel";
import {
  AgentIntegrationError,
  AgentIntegrationHost,
  AgentIntegrationStatus,
} from "./setup";

const Identifier = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export class GetRuntime extends Rpc.make("GetRuntime", {
  success: RuntimeStatus,
  error: FlectRuntimeError,
}) {}

export class ListModels extends Rpc.make("ListModels", {
  success: Schema.Array(ModelSummary),
  error: FlectRuntimeError,
}) {}

export class ListProviderAuth extends Rpc.make("ListProviderAuth", {
  success: Schema.Array(ProviderAuthSummary),
  error: FlectRuntimeError,
}) {}

export class LoginProvider extends Rpc.make("LoginProvider", {
  payload: AuthLoginRequest,
  success: AuthLoginEvent,
  error: FlectRuntimeError,
  stream: true,
}) {}

export class ReplyProviderAuthSelection extends Rpc.make(
  "ReplyProviderAuthSelection",
  {
    payload: AuthSelectionReply,
    success: Schema.Void,
    error: FlectRuntimeError,
  },
) {}

export class CancelProviderAuth extends Rpc.make("CancelProviderAuth", {
  payload: AuthLoginReference,
  success: Schema.Void,
  error: FlectRuntimeError,
}) {}

export class RefreshProviderAuth extends Rpc.make("RefreshProviderAuth", {
  success: Schema.Array(ProviderAuthSummary),
  error: FlectRuntimeError,
}) {}

export class LogoutProvider extends Rpc.make("LogoutProvider", {
  payload: { providerId: ProviderAuthSummary.fields.id },
  success: Schema.Array(ProviderAuthSummary),
  error: FlectRuntimeError,
}) {}

export class CreateSession extends Rpc.make("CreateSession", {
  payload: SessionSelection,
  success: Identifier,
  error: FlectRuntimeError,
}) {}

export class CloseSession extends Rpc.make("CloseSession", {
  payload: {
    sessionId: Identifier,
  },
  success: Schema.Void,
  error: FlectRuntimeError,
}) {}

export class Prompt extends Rpc.make("Prompt", {
  payload: {
    sessionId: Identifier,
    text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  },
  success: FlectEvent,
  error: FlectRuntimeError,
  stream: true,
}) {}

export class Cancel extends Rpc.make("Cancel", {
  payload: {
    sessionId: Identifier,
    role: InteractiveAgentRole,
  },
  success: Schema.Void,
  error: FlectRuntimeError,
}) {}

export class CompleteShellRequest extends Rpc.make("CompleteShellRequest", {
  payload: {
    sessionId: Identifier,
    role: InteractiveAgentRole,
    requestId: Schema.String.check(
      Schema.isMinLength(7),
      Schema.isMaxLength(80),
      Schema.isPattern(/^shell-[a-z0-9-]+$/),
    ),
    result: BunCommandResult,
  },
  success: Schema.Void,
  error: FlectRuntimeError,
}) {}

export class Shape extends Rpc.make("Shape", {
  payload: {
    sessionId: Identifier,
    instruction: Schema.Trim.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4_000),
    ),
    document: Schema.Unknown,
  },
  success: ShapeEvent,
  error: FlectRuntimeError,
  stream: true,
}) {}

export class DiagnoseRecovery extends Rpc.make("DiagnoseRecovery", {
  payload: {
    sessionId: Identifier,
    reason: RecoveryReason,
  },
  success: GuardianDiagnostic,
  error: FlectRuntimeError,
}) {}

export class ControlEnable extends Rpc.make("ControlEnable", {
  payload: {
    snapshot: FlectWorkspaceSnapshot,
  },
  success: ControlBrokerStatus,
  error: ControlTransportFailed,
}) {}

export class ControlDisable extends Rpc.make("ControlDisable", {
  success: Schema.Void,
  error: ControlTransportFailed,
}) {}

export class ControlPublishSnapshot extends Rpc.make("ControlPublishSnapshot", {
  payload: {
    snapshot: FlectWorkspaceSnapshot,
  },
  success: Schema.Void,
  error: ControlTransportFailed,
}) {}

export class ControlPublishEvent extends Rpc.make("ControlPublishEvent", {
  payload: {
    event: FlectWorkspaceEvent,
  },
  success: Schema.Void,
  error: ControlTransportFailed,
}) {}

export class ControlNextCommand extends Rpc.make("ControlNextCommand", {
  payload: {
    workspaceId: FlectWorkspaceSnapshot.fields.workspaceId,
  },
  success: FlectCommandEnvelope,
  error: ControlTransportFailed,
}) {}

export class ControlComplete extends Rpc.make("ControlComplete", {
  payload: {
    completion: ControlCommandCompletion,
  },
  success: Schema.Void,
  error: ControlTransportFailed,
}) {}

export class SetupAgentStatus extends Rpc.make("SetupAgentStatus", {
  success: Schema.Array(AgentIntegrationStatus),
  error: AgentIntegrationError,
}) {}

export class SetupAgentInstall extends Rpc.make("SetupAgentInstall", {
  payload: { host: AgentIntegrationHost },
  success: AgentIntegrationStatus,
  error: AgentIntegrationError,
}) {}

export class SetupAgentRemove extends Rpc.make("SetupAgentRemove", {
  payload: { host: AgentIntegrationHost },
  success: AgentIntegrationStatus,
  error: AgentIntegrationError,
}) {}

export const FlectRpcs = RpcGroup.make(
  GetRuntime,
  ListModels,
  ListProviderAuth,
  LoginProvider,
  ReplyProviderAuthSelection,
  CancelProviderAuth,
  RefreshProviderAuth,
  LogoutProvider,
  CreateSession,
  CloseSession,
  Prompt,
  Shape,
  Cancel,
  CompleteShellRequest,
  DiagnoseRecovery,
  ControlEnable,
  ControlDisable,
  ControlPublishSnapshot,
  ControlPublishEvent,
  ControlNextCommand,
  ControlComplete,
  SetupAgentStatus,
  SetupAgentInstall,
  SetupAgentRemove,
);
