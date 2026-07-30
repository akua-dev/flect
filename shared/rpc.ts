import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  FlectEvent,
  FlectRuntimeError,
  GuardianDiagnostic,
  ModelSummary,
  RecoveryReason,
  RuntimeStatus,
  SessionSelection,
} from "./contracts";
import { InterfaceDocument } from "./interface-document";

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
  success: InterfaceDocument,
  error: FlectRuntimeError,
}) {}

export class DiagnoseRecovery extends Rpc.make("DiagnoseRecovery", {
  payload: {
    sessionId: Identifier,
    reason: RecoveryReason,
  },
  success: GuardianDiagnostic,
  error: FlectRuntimeError,
}) {}

export const FlectRpcs = RpcGroup.make(
  GetRuntime,
  ListModels,
  CreateSession,
  CloseSession,
  Prompt,
  Shape,
  Cancel,
  DiagnoseRecovery,
);
