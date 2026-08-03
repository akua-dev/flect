import { Context, Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import type {
  FlectCommandEnvelope,
  FlectWorkspaceEvent,
  FlectWorkspaceSnapshot,
} from "../../shared/control";
import {
  ControlAck,
  ControlBrokerStatus,
  ControlCommandCompletion,
  ControlCommandsResponse,
  ControlEventPublication,
  ControlNextCommandRequest,
  ControlSnapshotPublication,
  ControlWorkspaceRegistration,
} from "../../shared/control-channel";
import { FlectUnavailableError } from "./api";

const unavailable = () =>
  FlectUnavailableError.make({
    message: "The local Flect runtime is unavailable.",
  });

export interface WorkspaceControlTransportShape {
  readonly enable: (
    snapshot: FlectWorkspaceSnapshot,
  ) => Effect.Effect<ControlBrokerStatus, FlectUnavailableError>;
  readonly status: Effect.Effect<ControlBrokerStatus, FlectUnavailableError>;
  readonly disable: Effect.Effect<void, FlectUnavailableError>;
  readonly publishSnapshot: (
    snapshot: FlectWorkspaceSnapshot,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly publishEvent: (
    event: FlectWorkspaceEvent,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly nextCommand: (
    workspaceId: string,
  ) => Effect.Effect<FlectCommandEnvelope, FlectUnavailableError>;
  readonly complete: (
    completion: ControlCommandCompletion,
  ) => Effect.Effect<void, FlectUnavailableError>;
}

export class WorkspaceControlTransport extends Context.Service<
  WorkspaceControlTransport,
  WorkspaceControlTransportShape
>()("flect/WorkspaceControlTransport") {}

export const makeBrowserWorkspaceControlTransportLayer = (
  baseUrl = "/api/control",
) =>
  Layer.effect(
    WorkspaceControlTransport,
    Effect.gen(function* () {
      const transport = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          HttpClientRequest.prependUrl(baseUrl.replace(/\/$/, "")),
        ),
        HttpClient.filterStatusOk,
      );

      const enable = Effect.fn("Flect.ControlTransport.enable")(
        (snapshot: FlectWorkspaceSnapshot) =>
          HttpClientRequest.post("/enable").pipe(
            HttpClientRequest.schemaBodyJson(ControlWorkspaceRegistration)(
              ControlWorkspaceRegistration.make({ snapshot }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(ControlBrokerStatus),
            ),
            Effect.mapError(unavailable),
          ),
      );

      const status = HttpClientRequest.get("/status").pipe(
        transport.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ControlBrokerStatus)),
        Effect.mapError(unavailable),
      );

      const disable = HttpClientRequest.post("/disable").pipe(
        transport.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ControlAck)),
        Effect.asVoid,
        Effect.mapError(unavailable),
      );

      const publishSnapshot = Effect.fn(
        "Flect.ControlTransport.publishSnapshot",
      )((snapshot: FlectWorkspaceSnapshot) =>
        HttpClientRequest.post("/snapshot").pipe(
          HttpClientRequest.schemaBodyJson(ControlSnapshotPublication)(
            ControlSnapshotPublication.make({ snapshot }),
          ),
          Effect.flatMap(transport.execute),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ControlAck)),
          Effect.asVoid,
          Effect.mapError(unavailable),
        ),
      );

      const publishEvent = Effect.fn("Flect.ControlTransport.publishEvent")(
        (event: FlectWorkspaceEvent) =>
          HttpClientRequest.post("/event").pipe(
            HttpClientRequest.schemaBodyJson(ControlEventPublication)(
              ControlEventPublication.make({ event }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ControlAck)),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      );

      const nextCommand = Effect.fn("Flect.ControlTransport.nextCommand")(
        (workspaceId: string) =>
          HttpClientRequest.post("/commands/next").pipe(
            HttpClientRequest.schemaBodyJson(ControlNextCommandRequest)(
              ControlNextCommandRequest.make({ workspaceId }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(ControlCommandsResponse),
            ),
            Effect.flatMap((response) =>
              response.command === undefined
                ? Effect.fail(unavailable())
                : Effect.succeed(response.command),
            ),
            Effect.mapError(unavailable),
          ),
      );

      const complete = Effect.fn("Flect.ControlTransport.complete")(
        (completion: ControlCommandCompletion) =>
          HttpClientRequest.post("/commands/complete").pipe(
            HttpClientRequest.schemaBodyJson(ControlCommandCompletion)(
              completion,
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ControlAck)),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      );

      return {
        enable,
        status,
        disable,
        publishSnapshot,
        publishEvent,
        nextCommand,
        complete,
      };
    }),
  );
