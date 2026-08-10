import { Effect, Layer, Schema, Stream } from "effect";
import {
  type AgentCommandSource,
  type FlectCommandError,
  FlectCommandReceipt,
  FlectWorkspaceSnapshot,
} from "../../shared/control";
import {
  ControlBrokerStatus,
  ControlLogsResponse,
} from "../../shared/control-channel";
import { validateInterfaceDocument } from "../../shared/interface-document";
import {
  AgentCommandBus,
  type AgentCommandBusError,
} from "./agent-command-bus";
import {
  FlectCommandGateway,
  FlectGatewayError,
  FlectInterfaceCommandGateway,
} from "./gateway";

const gatewayError = (message: string) =>
  FlectGatewayError.make({ reason: "unavailable", message });

const decode = <A, R>(schema: Schema.ConstraintDecoder<A, R>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() =>
      FlectGatewayError.make({
        reason: "invalid-response",
        message: "The embedded Flect command returned an invalid response.",
      }),
    ),
  );

const mapBusError = (
  error: AgentCommandBusError | FlectCommandError | FlectGatewayError,
) =>
  error._tag === "AgentCommandBusError" ? gatewayError(error.message) : error;

export const makeAgentFlectCommandGatewayLayer = (
  source: AgentCommandSource,
  readInterface?: (path: string) => Effect.Effect<unknown, FlectGatewayError>,
) => {
  const commandLayer = Layer.effect(
    FlectCommandGateway,
    Effect.gen(function* () {
      const bus = yield* AgentCommandBus;
      const inspect = bus.submit(source, { type: "inspect" }).pipe(
        Effect.mapError((error) =>
          error._tag === "AgentCommandBusError"
            ? gatewayError(error.message)
            : gatewayError("The embedded Flect workspace is unavailable."),
        ),
        Effect.flatMap((result) =>
          decode(FlectWorkspaceSnapshot, result.value),
        ),
      );
      return {
        audience: source.role,
        binding:
          source.binding ?? (source.role === "app" ? "accepted" : "candidate"),
        bin: "flect",
        status: inspect.pipe(
          Effect.map((snapshot) =>
            ControlBrokerStatus.make({
              version: 1,
              enabled: true,
              connected: true,
              port: 1,
              workspaceId: snapshot.workspaceId,
              url: "browser-embedded",
            }),
          ),
        ),
        inspect,
        logs: bus.submit(source, { type: "logs" }).pipe(
          Effect.mapError(() =>
            gatewayError("The embedded Flect logs are unavailable."),
          ),
          Effect.flatMap((result) => decode(ControlLogsResponse, result.value)),
        ),
        events: () =>
          Stream.fail(
            FlectGatewayError.make({
              reason: "unsupported",
              message: "Embedded event watching is unavailable.",
            }),
          ),
        command: (command) =>
          bus.submit(source, { type: "command", command }).pipe(
            Effect.mapError(mapBusError),
            Effect.flatMap((result) =>
              decode(FlectCommandReceipt, result.value),
            ),
          ),
      };
    }),
  );
  if (readInterface === undefined) {
    return commandLayer;
  }
  const validate = Effect.fn("Flect.AgentGateway.validateInterface")(
    (path: string) =>
      readInterface(path).pipe(
        Effect.flatMap(validateInterfaceDocument),
        Effect.mapError((error) =>
          error._tag === "FlectGatewayError"
            ? error
            : FlectGatewayError.make({
                reason: "invalid-response",
                message: "The interface document is invalid.",
              }),
        ),
      ),
  );
  const interfaceLayer = Layer.effect(
    FlectInterfaceCommandGateway,
    Effect.gen(function* () {
      const bus = yield* AgentCommandBus;
      return {
        validate,
        propose: (path: string) =>
          validate(path).pipe(
            Effect.flatMap((document) =>
              bus.submit(source, { type: "propose-interface", document }),
            ),
            Effect.map((result) => result.value),
            Effect.mapError(mapBusError),
          ),
      };
    }),
  );
  return Layer.merge(commandLayer, interfaceLayer);
};
