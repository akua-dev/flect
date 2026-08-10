import { Context, type Effect, Schema, type Stream } from "effect";
import type {
  FlectCommand,
  FlectCommandError,
  FlectCommandReceipt,
  FlectWorkspaceEvent,
  FlectWorkspaceSnapshot,
} from "../../shared/control";
import type {
  ControlBrokerStatus,
  ControlLogsResponse,
} from "../../shared/control-channel";
import type { InterfaceDocument } from "../../shared/interface-document";
import type { AxiAudience } from "./contracts";

export class FlectGatewayError extends Schema.TaggedErrorClass<FlectGatewayError>()(
  "FlectGatewayError",
  {
    reason: Schema.Literals([
      "unavailable",
      "unauthorized",
      "invalid-response",
      "unsupported",
      "not-found",
      "rejected",
    ]),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(500),
    ),
  },
) {}

export interface FlectCommandGatewayShape {
  readonly audience: AxiAudience;
  readonly binding?: "accepted" | "candidate";
  readonly bin: string;
  readonly status: Effect.Effect<ControlBrokerStatus, FlectGatewayError>;
  readonly inspect: Effect.Effect<FlectWorkspaceSnapshot, FlectGatewayError>;
  readonly logs: Effect.Effect<ControlLogsResponse, FlectGatewayError>;
  readonly events: (
    after: number,
  ) => Stream.Stream<FlectWorkspaceEvent, FlectGatewayError>;
  readonly command: (
    command: FlectCommand,
    expectedSequence?: number,
  ) => Effect.Effect<
    FlectCommandReceipt,
    FlectCommandError | FlectGatewayError
  >;
}

export class FlectCommandGateway extends Context.Service<
  FlectCommandGateway,
  FlectCommandGatewayShape
>()("flect/FlectCommandGateway") {}

export interface FlectInterfaceCommandGatewayShape {
  readonly validate: (
    path: string,
  ) => Effect.Effect<InterfaceDocument, FlectGatewayError>;
  readonly propose: (
    path: string,
  ) => Effect.Effect<unknown, FlectGatewayError | FlectCommandError>;
}

export class FlectInterfaceCommandGateway extends Context.Service<
  FlectInterfaceCommandGateway,
  FlectInterfaceCommandGatewayShape
>()("flect/FlectInterfaceCommandGateway") {}
