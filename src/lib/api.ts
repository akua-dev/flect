import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import type { BunCommandResult } from "../../shared/bun-command";
import {
  AgentShellResultAccepted,
  AgentShellResultRequest,
  CancelResponse,
  CloseSessionResponse,
  decodePromptRequest,
  FlectEvent,
  GuardianDiagnostic,
  type ModelSummary,
  ModelsResponse,
  PromptRequest,
  type RecoveryReason,
  RecoveryRequest,
  RuntimeStatus,
  SessionBusy,
  SessionResponse,
  SessionSelection,
  ShapeEvent,
  ShapeRequest,
} from "../../shared/contracts";
import {
  encodeInterfaceDocument,
  type InterfaceDocument,
} from "../../shared/interface-document";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export class FlectUnavailableError extends Schema.TaggedErrorClass<FlectUnavailableError>()(
  "FlectUnavailableError",
  {
    message: Schema.Literal("The local Flect runtime is unavailable."),
  },
) {}

const unavailable = () =>
  new FlectUnavailableError({
    message: "The local Flect runtime is unavailable.",
  });

const shapeFailure = (sessionId: string) => (error: unknown) =>
  error instanceof SessionBusy
    ? error
    : HttpClientError.isHttpClientError(error) && error.response?.status === 409
      ? new SessionBusy({
          sessionId,
          message: "The session is busy.",
        })
      : unavailable();

const diagnoseFailure = (sessionId: string) => (error: unknown) =>
  HttpClientError.isHttpClientError(error) && error.response?.status === 409
    ? new SessionBusy({
        sessionId,
        message: "The session is busy.",
      })
    : unavailable();

export interface FlectClientShape {
  readonly status: Effect.Effect<RuntimeStatus, FlectUnavailableError>;
  readonly models: Effect.Effect<
    ReadonlyArray<ModelSummary>,
    FlectUnavailableError
  >;
  readonly createSession: (
    selection: SessionSelection,
  ) => Effect.Effect<string, FlectUnavailableError>;
  readonly closeSession: (
    sessionId: string,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly prompt: (
    sessionId: string,
    text: string,
  ) => Stream.Stream<FlectEvent, FlectUnavailableError | SessionBusy>;
  readonly shape: (
    sessionId: string,
    instruction: string,
    document: InterfaceDocument,
  ) => Stream.Stream<ShapeEvent, FlectUnavailableError | SessionBusy>;
  readonly cancel: (
    sessionId: string,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly completeShellRequest: (
    sessionId: string,
    requestId: string,
    result: BunCommandResult,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly diagnoseRecovery: (
    sessionId: string,
    reason: RecoveryReason,
  ) => Effect.Effect<GuardianDiagnostic, FlectUnavailableError | SessionBusy>;
}

export class FlectClient extends Context.Service<
  FlectClient,
  FlectClientShape
>()("flect/browser/FlectClient") {}

const decodeEventJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FlectEvent),
  strictOptions,
);

const decodeShapeEventJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ShapeEvent),
  strictOptions,
);

export const makeFlectClientLayer = (baseUrl = "/api") =>
  Layer.effect(
    FlectClient,
    Effect.gen(function* () {
      const transport = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          HttpClientRequest.prependUrl(baseUrl.replace(/\/$/, "")),
        ),
        HttpClient.filterStatusOk,
      );

      const status = transport
        .get("/runtime")
        .pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(RuntimeStatus, strictOptions),
          ),
          Effect.mapError(unavailable),
        );

      const models = transport.get("/models").pipe(
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(ModelsResponse, strictOptions),
        ),
        Effect.map((response) => response.models),
        Effect.mapError(unavailable),
      );

      const createSession = Effect.fn("Flect.Client.createSession")(
        (selection: SessionSelection) =>
          HttpClientRequest.post("/sessions").pipe(
            HttpClientRequest.schemaBodyJson(SessionSelection)(selection),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(SessionResponse, strictOptions),
            ),
            Effect.map((response) => response.sessionId),
            Effect.mapError(unavailable),
          ),
      );

      const prompt = (
        sessionId: string,
        text: string,
      ): Stream.Stream<FlectEvent, FlectUnavailableError> => {
        const response = decodePromptRequest({ text }).pipe(
          Effect.flatMap((prompt) =>
            HttpClientRequest.post(
              `/sessions/${encodeURIComponent(sessionId)}/prompts`,
            ).pipe(
              HttpClientRequest.schemaBodyJson(PromptRequest)(prompt),
              Effect.flatMap(transport.execute),
            ),
          ),
          Effect.map((result) => result.stream),
          Effect.mapError(unavailable),
        );

        return Stream.unwrap(response).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith("data:")),
          Stream.map((line) => line.slice(5).trimStart()),
          Stream.mapEffect((json) =>
            decodeEventJson(json).pipe(Effect.mapError(unavailable)),
          ),
          Stream.mapError(unavailable),
        );
      };

      const closeSession = Effect.fn("Flect.Client.closeSession")(
        (sessionId: string) =>
          HttpClientRequest.delete(
            `/sessions/${encodeURIComponent(sessionId)}`,
          ).pipe(
            transport.execute,
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                CloseSessionResponse,
                strictOptions,
              ),
            ),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      );

      const cancel = Effect.fn("Flect.Client.cancel")((sessionId: string) =>
        transport
          .post(`/sessions/${encodeURIComponent(sessionId)}/cancel`)
          .pipe(
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(CancelResponse, strictOptions),
            ),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      );

      const completeShellRequest = Effect.fn(
        "Flect.Client.completeShellRequest",
      )((sessionId: string, requestId: string, result: BunCommandResult) =>
        HttpClientRequest.post(
          `/sessions/${encodeURIComponent(sessionId)}/shell-results`,
        ).pipe(
          HttpClientRequest.schemaBodyJson(AgentShellResultRequest)(
            AgentShellResultRequest.make({ requestId, result }),
          ),
          Effect.flatMap(transport.execute),
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              AgentShellResultAccepted,
              strictOptions,
            ),
          ),
          Effect.asVoid,
          Effect.mapError(unavailable),
        ),
      );

      const shape = (
        sessionId: string,
        instruction: string,
        document: InterfaceDocument,
      ) =>
        Stream.unwrap(
          encodeInterfaceDocument(document).pipe(
            Effect.flatMap((encodedDocument) =>
              HttpClientRequest.post(
                `/sessions/${encodeURIComponent(sessionId)}/shape`,
              ).pipe(
                HttpClientRequest.schemaBodyJson(ShapeRequest)(
                  ShapeRequest.make({
                    instruction,
                    document: encodedDocument,
                  }),
                ),
                Effect.flatMap(transport.execute),
              ),
            ),
            Effect.map((result) => result.stream),
            Effect.mapError(shapeFailure(sessionId)),
          ),
        ).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith("data:")),
          Stream.map((line) => line.slice(5).trimStart()),
          Stream.mapEffect((json) =>
            decodeShapeEventJson(json).pipe(
              Effect.mapError(() => unavailable()),
            ),
          ),
          Stream.mapError(shapeFailure(sessionId)),
          Stream.mapEffect(
            (
              event,
            ): Effect.Effect<
              ShapeEvent,
              FlectUnavailableError | SessionBusy
            > => {
              if (event.type === "shape_busy") {
                return Effect.fail(
                  new SessionBusy({
                    sessionId,
                    message: "The session is busy.",
                  }),
                );
              }
              if (event.type === "shape_error") {
                return Effect.fail(unavailable());
              }
              return Effect.succeed(event);
            },
          ),
        );

      const diagnoseRecovery = Effect.fn("Flect.Client.diagnoseRecovery")(
        (sessionId: string, reason: RecoveryReason) =>
          HttpClientRequest.post(
            `/sessions/${encodeURIComponent(sessionId)}/guardian`,
          ).pipe(
            HttpClientRequest.schemaBodyJson(RecoveryRequest)(
              new RecoveryRequest({ reason }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                GuardianDiagnostic,
                strictOptions,
              ),
            ),
            Effect.mapError(diagnoseFailure(sessionId)),
          ),
      );

      return {
        status,
        models,
        createSession,
        closeSession,
        prompt,
        shape,
        cancel,
        completeShellRequest,
        diagnoseRecovery,
      };
    }),
  );
