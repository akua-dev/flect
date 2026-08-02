import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import type { BunCommandResult } from "../../shared/bun-command";
import {
  AgentProductActionResultAccepted,
  AgentProductActionResultRequest,
  AgentShellResultAccepted,
  AgentShellResultRequest,
  CancelRequest,
  CancelResponse,
  CloseSessionResponse,
  decodePromptRequest,
  FlectEvent,
  GuardianDiagnostic,
  type InteractiveAgentRole,
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
import type { ProductActionResult } from "../../shared/product-action";
import {
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../../shared/product-surface";

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

export class ProductSurfaceHostUnavailable extends Schema.TaggedErrorClass<ProductSurfaceHostUnavailable>()(
  "ProductSurfaceHostUnavailable",
  {
    reason: Schema.Literals(["unavailable", "not-found", "pending", "expired"]),
    message: Schema.Literal("The local product surface is unavailable."),
  },
) {}

const unavailable = () =>
  new FlectUnavailableError({
    message: "The local Flect runtime is unavailable.",
  });

const productSurfaceUnavailable = (
  reason: "unavailable" | "not-found" | "pending" | "expired" = "unavailable",
) =>
  ProductSurfaceHostUnavailable.make({
    reason,
    message: "The local product surface is unavailable.",
  });

const productSurfaceFailure = (error: unknown) => {
  if (error instanceof ProductSurfaceHostUnavailable) return error;
  if (HttpClientError.isHttpClientError(error)) {
    switch (error.response?.status) {
      case 404:
        return productSurfaceUnavailable("not-found");
      case 409:
        return productSurfaceUnavailable("pending");
      case 410:
        return productSurfaceUnavailable("expired");
    }
  }
  return productSurfaceUnavailable();
};

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
    role: InteractiveAgentRole,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly completeShellRequest: (
    sessionId: string,
    role: InteractiveAgentRole,
    requestId: string,
    result: BunCommandResult,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly completeProductActionRequest: (
    sessionId: string,
    requestId: string,
    result: ProductActionResult,
  ) => Effect.Effect<void, FlectUnavailableError>;
  readonly diagnoseRecovery: (
    sessionId: string,
    reason: RecoveryReason,
  ) => Effect.Effect<GuardianDiagnostic, FlectUnavailableError | SessionBusy>;
  readonly productSurfaceSummary: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceSummary, ProductSurfaceHostUnavailable>;
  readonly approveProductSurface: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceSummary, ProductSurfaceHostUnavailable>;
  readonly resolveProductSurface: (
    capabilityId: string,
  ) => Effect.Effect<ResolvedProductSurface, ProductSurfaceHostUnavailable>;
  readonly revokeProductSurface: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceRevoked, ProductSurfaceHostUnavailable>;
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

      const cancel = Effect.fn("Flect.Client.cancel")(
        (sessionId: string, role: InteractiveAgentRole) =>
          HttpClientRequest.post(
            `/sessions/${encodeURIComponent(sessionId)}/cancel`,
          ).pipe(
            HttpClientRequest.schemaBodyJson(CancelRequest)(
              CancelRequest.make({ role }),
            ),
            Effect.flatMap(transport.execute),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(CancelResponse, strictOptions),
            ),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      );

      const completeShellRequest = Effect.fn(
        "Flect.Client.completeShellRequest",
      )(
        (
          sessionId: string,
          role: InteractiveAgentRole,
          requestId: string,
          result: BunCommandResult,
        ) =>
          HttpClientRequest.post(
            `/sessions/${encodeURIComponent(sessionId)}/shell-results`,
          ).pipe(
            HttpClientRequest.schemaBodyJson(AgentShellResultRequest)(
              AgentShellResultRequest.make({ role, requestId, result }),
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

      const completeProductActionRequest = Effect.fn(
        "Flect.Client.completeProductActionRequest",
      )((sessionId: string, requestId: string, result: ProductActionResult) =>
        HttpClientRequest.post(
          `/sessions/${encodeURIComponent(sessionId)}/product-action-results`,
        ).pipe(
          HttpClientRequest.schemaBodyJson(AgentProductActionResultRequest)(
            AgentProductActionResultRequest.make({
              role: "app",
              requestId,
              result,
            }),
          ),
          Effect.flatMap(transport.execute),
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              AgentProductActionResultAccepted,
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

      const productSurfacePath = (capabilityId: string) =>
        `/product-surfaces/${encodeURIComponent(capabilityId)}`;

      const productSurfaceSummary = Effect.fn(
        "Flect.Client.productSurfaceSummary",
      )((capabilityId: string) =>
        transport.get(productSurfacePath(capabilityId)).pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              ProductSurfaceSummary,
              strictOptions,
            ),
          ),
          Effect.flatMap((summary) =>
            summary.capabilityId === capabilityId
              ? Effect.succeed(summary)
              : Effect.fail(productSurfaceUnavailable()),
          ),
          Effect.mapError(productSurfaceFailure),
        ),
      );

      const approveProductSurface = Effect.fn(
        "Flect.Client.approveProductSurface",
      )((capabilityId: string) =>
        HttpClientRequest.post(
          `${productSurfacePath(capabilityId)}/approve`,
        ).pipe(
          transport.execute,
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              ProductSurfaceSummary,
              strictOptions,
            ),
          ),
          Effect.flatMap((summary) =>
            summary.capabilityId === capabilityId
              ? Effect.succeed(summary)
              : Effect.fail(productSurfaceUnavailable()),
          ),
          Effect.mapError(productSurfaceFailure),
        ),
      );

      const resolveProductSurface = Effect.fn(
        "Flect.Client.resolveProductSurface",
      )((capabilityId: string) =>
        transport.get(`${productSurfacePath(capabilityId)}/resolve`).pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              ResolvedProductSurface,
              strictOptions,
            ),
          ),
          Effect.flatMap((resolved) =>
            resolved.capabilityId === capabilityId
              ? Effect.succeed(resolved)
              : Effect.fail(productSurfaceUnavailable()),
          ),
          Effect.mapError(productSurfaceFailure),
        ),
      );

      const revokeProductSurface = Effect.fn(
        "Flect.Client.revokeProductSurface",
      )((capabilityId: string) =>
        HttpClientRequest.delete(productSurfacePath(capabilityId)).pipe(
          transport.execute,
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              ProductSurfaceRevoked,
              strictOptions,
            ),
          ),
          Effect.flatMap((revoked) =>
            revoked.capabilityId === capabilityId
              ? Effect.succeed(revoked)
              : Effect.fail(productSurfaceUnavailable()),
          ),
          Effect.mapError(productSurfaceFailure),
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
        completeProductActionRequest,
        diagnoseRecovery,
        productSurfaceSummary,
        approveProductSurface,
        resolveProductSurface,
        revokeProductSurface,
      };
    }),
  );
