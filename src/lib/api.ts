import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
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
  ShapeRequest,
  ShapeResponse,
} from "../../shared/contracts";
import type { InterfaceDocument } from "../../shared/interface-document";

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
  ) => Stream.Stream<FlectEvent, FlectUnavailableError>;
  readonly shape: (
    sessionId: string,
    instruction: string,
    document: InterfaceDocument,
  ) => Effect.Effect<InterfaceDocument, FlectUnavailableError | SessionBusy>;
  readonly cancel: (
    sessionId: string,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly diagnoseRecovery: (
    sessionId: string,
    reason: RecoveryReason,
  ) => Effect.Effect<GuardianDiagnostic, FlectUnavailableError>;
}

export class FlectClient extends Context.Service<
  FlectClient,
  FlectClientShape
>()("flect/browser/FlectClient") {}

const decodeEventJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FlectEvent),
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

      const shape = Effect.fn("Flect.Client.shape")(
        (sessionId: string, instruction: string, document: InterfaceDocument) =>
          HttpClientRequest.post(
            `/sessions/${encodeURIComponent(sessionId)}/shape`,
          ).pipe(
            HttpClientRequest.schemaBodyJson(ShapeRequest)(
              new ShapeRequest({ instruction, document }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(ShapeResponse, strictOptions),
            ),
            Effect.map((response) => response.document),
            Effect.mapError(shapeFailure(sessionId)),
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
            Effect.mapError(unavailable),
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
        diagnoseRecovery,
      };
    }),
  );
