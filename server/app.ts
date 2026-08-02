import { Effect, Layer, Option, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  AgentProductActionResultAccepted,
  AgentProductActionResultRequest,
  AgentShellResultAccepted,
  AgentShellResultRequest,
  CancelRequest,
  CancelResponse,
  CloseSessionResponse,
  FlectEvent,
  GuardianDiagnostic,
  ModelsResponse,
  PromptRequest,
  PublicErrorResponse,
  RecoveryRequest,
  RuntimeStatus,
  SessionResponse,
  SessionSelection,
  ShapeBusy,
  ShapeError,
  ShapeEvent,
  ShapeRequest,
  TurnBusy,
  TurnError,
} from "../shared/contracts";
import { validateInterfaceDocument } from "../shared/interface-document";
import {
  ProductSurfaceRegistration,
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../shared/product-surface";
import {
  ProductSurfaceRegistry,
  type ProductSurfaceRegistryError,
  ProductSurfaceRegistryLive,
} from "./product-surface-registry";
import { FlectRuntime, type FlectRuntimeShape } from "./runtime";

const defaultAllowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:3210",
  "http://localhost:3210",
]);

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

class SessionPathParams extends Schema.Class<SessionPathParams>(
  "SessionPathParams",
)({
  sessionId: Schema.NonEmptyString,
}) {}

class ProductSurfacePathParams extends Schema.Class<ProductSurfacePathParams>(
  "ProductSurfacePathParams",
)({
  capabilityId: Schema.NonEmptyString,
}) {}

const runtimeJson = HttpServerResponse.schemaJson(RuntimeStatus);
const modelsJson = HttpServerResponse.schemaJson(ModelsResponse);
const sessionJson = HttpServerResponse.schemaJson(SessionResponse);
const closeJson = HttpServerResponse.schemaJson(CloseSessionResponse);
const cancelJson = HttpServerResponse.schemaJson(CancelResponse);
const guardianJson = HttpServerResponse.schemaJson(GuardianDiagnostic);
const shellResultJson = HttpServerResponse.schemaJson(AgentShellResultAccepted);
const productActionResultJson = HttpServerResponse.schemaJson(
  AgentProductActionResultAccepted,
);
const productSurfaceSummaryJson = HttpServerResponse.schemaJson(
  ProductSurfaceSummary,
);
const resolvedProductSurfaceJson = HttpServerResponse.schemaJson(
  ResolvedProductSurface,
);
const productSurfaceRevokedJson = HttpServerResponse.schemaJson(
  ProductSurfaceRevoked,
);
const publicErrorJson = HttpServerResponse.schemaJson(PublicErrorResponse);
const encodeEventJson = Schema.encodeEffect(Schema.fromJsonString(FlectEvent));
const encodeShapeEventJson = Schema.encodeEffect(
  Schema.fromJsonString(ShapeEvent),
);

const publicError = Effect.fn("Flect.Http.publicError")(
  (message: string, status: number) =>
    publicErrorJson(new PublicErrorResponse({ version: 1, error: message }), {
      status,
    }).pipe(Effect.orDie),
);

const invalidRequest = () => publicError("Invalid request", 400);
const runtimeFailure = () =>
  publicError("The local runtime could not complete this request.", 500);

const decodeBody = <A, R>(schema: Schema.ConstraintDecoder<A, R>) =>
  HttpServerRequest.schemaBodyJson(schema, strictOptions).pipe(Effect.option);

const sessionPath = HttpRouter.schemaPathParams(
  SessionPathParams,
  strictOptions,
).pipe(Effect.option);

const productSurfacePath = HttpRouter.schemaPathParams(
  ProductSurfacePathParams,
  strictOptions,
).pipe(Effect.option);

const productSurfaceFailure = (error: ProductSurfaceRegistryError) => {
  switch (error.code) {
    case "not-found":
      return publicError("Product surface not found", 404);
    case "expired":
      return publicError("Product surface expired", 410);
    case "pending":
      return publicError("Product surface approval required", 409);
    case "conflict":
      return publicError("Product surface registration conflict", 409);
  }
};

const runtimeRoute = HttpRouter.add(
  "GET",
  "/api/runtime",
  Effect.gen(function* () {
    const runtime = yield* FlectRuntime;
    const status = yield* runtime.status;
    return yield* runtimeJson(status);
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const modelsRoute = HttpRouter.add(
  "GET",
  "/api/models",
  Effect.gen(function* () {
    const runtime = yield* FlectRuntime;
    const models = yield* runtime.listModels;
    return yield* modelsJson(new ModelsResponse({ version: 1, models }));
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const createSessionRoute = HttpRouter.add(
  "POST",
  "/api/sessions",
  Effect.gen(function* () {
    const decoded = yield* decodeBody(SessionSelection);
    if (Option.isNone(decoded)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    const sessionId = yield* runtime.createSession(decoded.value);
    return yield* sessionJson(new SessionResponse({ version: 1, sessionId }), {
      status: 201,
    });
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const promptRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/prompts",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const prompt = yield* decodeBody(PromptRequest);
    if (Option.isNone(path) || Option.isNone(prompt)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    const fallback =
      'data: {"type":"error","message":"The local runtime could not complete this request."}\n\n';
    const events = runtime.prompt(path.value.sessionId, prompt.value.text).pipe(
      Stream.catchTag("SessionBusy", () =>
        Stream.succeed(
          new TurnBusy({
            type: "busy",
            message: "The session is busy.",
          }),
        ),
      ),
      Stream.catch(() =>
        Stream.succeed(
          new TurnError({
            type: "error",
            message: "The local runtime could not complete this request.",
          }),
        ),
      ),
      Stream.mapEffect((event) => encodeEventJson(event)),
      Stream.map((json) => `data: ${json}\n\n`),
      Stream.catch(() => Stream.succeed(fallback)),
      Stream.encodeText,
    );

    return HttpServerResponse.stream(events, {
      contentType: "text/event-stream; charset=utf-8",
      headers: {
        "cache-control": "no-store",
      },
    });
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const closeSessionRoute = HttpRouter.add(
  "DELETE",
  "/api/sessions/:sessionId",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    yield* runtime.closeSession(path.value.sessionId);
    return yield* closeJson(
      new CloseSessionResponse({ version: 1, status: "closed" }),
    );
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const cancelRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/cancel",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const cancel = yield* decodeBody(CancelRequest);
    if (Option.isNone(path) || Option.isNone(cancel)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    yield* runtime.cancel(path.value.sessionId, cancel.value.role);
    return yield* cancelJson(
      new CancelResponse({ version: 1, status: "cancelled" }),
    );
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const shellResultRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/shell-results",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const shell = yield* decodeBody(AgentShellResultRequest);
    if (Option.isNone(path) || Option.isNone(shell)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    yield* runtime.completeShellRequest(
      path.value.sessionId,
      shell.value.role,
      shell.value.requestId,
      shell.value.result,
    );
    return yield* shellResultJson(
      AgentShellResultAccepted.make({
        version: 1,
        status: "accepted",
      }),
    );
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const productActionResultRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/product-action-results",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const action = yield* decodeBody(AgentProductActionResultRequest);
    if (Option.isNone(path) || Option.isNone(action)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    yield* runtime.completeProductActionRequest(
      path.value.sessionId,
      action.value.requestId,
      action.value.result,
    );
    return yield* productActionResultJson(
      AgentProductActionResultAccepted.make({
        version: 1,
        status: "accepted",
      }),
    );
  }).pipe(Effect.catch(() => runtimeFailure())),
);

const guardianRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/guardian",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const recovery = yield* decodeBody(RecoveryRequest);
    if (Option.isNone(path) || Option.isNone(recovery)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    const diagnostic = yield* runtime.diagnoseRecovery(
      path.value.sessionId,
      recovery.value.reason,
    );
    return yield* guardianJson(diagnostic);
  }).pipe(
    Effect.catchTag("SessionBusy", () =>
      publicError("The session is busy.", 409),
    ),
    Effect.catch(() => runtimeFailure()),
  ),
);

const shapeRoute = HttpRouter.add(
  "POST",
  "/api/sessions/:sessionId/shape",
  Effect.gen(function* () {
    const path = yield* sessionPath;
    const shape = yield* decodeBody(ShapeRequest);
    if (Option.isNone(path) || Option.isNone(shape)) {
      return yield* invalidRequest();
    }
    const document = yield* validateInterfaceDocument(shape.value.document);

    const runtime = yield* FlectRuntime;
    const events = runtime
      .shape(path.value.sessionId, shape.value.instruction, document)
      .pipe(
        Stream.catchTag("SessionBusy", () =>
          Stream.succeed(
            new ShapeBusy({
              type: "shape_busy",
              message: "The session is busy.",
            }),
          ),
        ),
        Stream.catch(() =>
          Stream.succeed(
            new ShapeError({
              type: "shape_error",
              message:
                "The local Flect runtime could not complete this request.",
            }),
          ),
        ),
        Stream.mapEffect((event) => encodeShapeEventJson(event)),
        Stream.map((json) => `data: ${json}\n\n`),
        Stream.encodeText,
      );
    return HttpServerResponse.stream(events, {
      contentType: "text/event-stream; charset=utf-8",
      headers: { "cache-control": "no-store" },
    });
  }).pipe(
    Effect.catchTag("InvalidInterfaceDocument", () => invalidRequest()),
    Effect.catch(() => runtimeFailure()),
  ),
);

const registerProductSurfaceRoute = HttpRouter.add(
  "POST",
  "/api/product-surfaces",
  Effect.gen(function* () {
    const registration = yield* decodeBody(ProductSurfaceRegistration);
    if (Option.isNone(registration)) {
      return yield* invalidRequest();
    }
    const registry = yield* ProductSurfaceRegistry;
    const registered = yield* registry.register(registration.value);
    return yield* productSurfaceSummaryJson(registered, { status: 201 });
  }).pipe(
    Effect.catchTag("ProductSurfaceRegistryError", productSurfaceFailure),
    Effect.catch(() => runtimeFailure()),
  ),
);

const productSurfaceSummaryRoute = HttpRouter.add(
  "GET",
  "/api/product-surfaces/:capabilityId",
  Effect.gen(function* () {
    const path = yield* productSurfacePath;
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }
    const registry = yield* ProductSurfaceRegistry;
    return yield* productSurfaceSummaryJson(
      yield* registry.getSummary(path.value.capabilityId),
    );
  }).pipe(
    Effect.catchTag("ProductSurfaceRegistryError", productSurfaceFailure),
    Effect.catch(() => runtimeFailure()),
  ),
);

const approveProductSurfaceRoute = HttpRouter.add(
  "POST",
  "/api/product-surfaces/:capabilityId/approve",
  Effect.gen(function* () {
    const path = yield* productSurfacePath;
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }
    const registry = yield* ProductSurfaceRegistry;
    return yield* productSurfaceSummaryJson(
      yield* registry.approve(path.value.capabilityId),
    );
  }).pipe(
    Effect.catchTag("ProductSurfaceRegistryError", productSurfaceFailure),
    Effect.catch(() => runtimeFailure()),
  ),
);

const resolveProductSurfaceRoute = HttpRouter.add(
  "GET",
  "/api/product-surfaces/:capabilityId/resolve",
  Effect.gen(function* () {
    const path = yield* productSurfacePath;
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }
    const registry = yield* ProductSurfaceRegistry;
    return yield* resolvedProductSurfaceJson(
      yield* registry.resolve(path.value.capabilityId),
    );
  }).pipe(
    Effect.catchTag("ProductSurfaceRegistryError", productSurfaceFailure),
    Effect.catch(() => runtimeFailure()),
  ),
);

const revokeProductSurfaceRoute = HttpRouter.add(
  "DELETE",
  "/api/product-surfaces/:capabilityId",
  Effect.gen(function* () {
    const path = yield* productSurfacePath;
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }
    const registry = yield* ProductSurfaceRegistry;
    return yield* productSurfaceRevokedJson(
      yield* registry.revoke(path.value.capabilityId),
    );
  }).pipe(
    Effect.catchTag("ProductSurfaceRegistryError", productSurfaceFailure),
    Effect.catch(() => runtimeFailure()),
  ),
);

const makeOriginMiddleware = (allowedOrigins: ReadonlySet<string>) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const origin = request.headers.origin;
        if (origin !== undefined && !allowedOrigins.has(origin)) {
          return yield* publicError("Origin not allowed", 403);
        }
        return yield* httpEffect;
      }),
    { global: true },
  );

export const makeFlectHttpApp = (
  allowedOrigins: ReadonlySet<string> = defaultAllowedOrigins,
) =>
  Layer.mergeAll(
    runtimeRoute,
    modelsRoute,
    createSessionRoute,
    closeSessionRoute,
    promptRoute,
    shapeRoute,
    cancelRoute,
    shellResultRoute,
    productActionResultRoute,
    guardianRoute,
    registerProductSurfaceRoute,
    productSurfaceSummaryRoute,
    approveProductSurfaceRoute,
    resolveProductSurfaceRoute,
    revokeProductSurfaceRoute,
    makeOriginMiddleware(allowedOrigins),
  );

export interface FlectWebApp {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

export function createApp(
  runtime: FlectRuntimeShape,
  allowedOrigins: ReadonlySet<string> = defaultAllowedOrigins,
): FlectWebApp {
  const appLayer = makeFlectHttpApp(allowedOrigins).pipe(
    HttpRouter.provideRequest(
      Layer.merge(
        Layer.succeed(FlectRuntime)(runtime),
        ProductSurfaceRegistryLive,
      ),
    ),
  );
  return HttpRouter.toWebHandler(appLayer, { disableLogger: true });
}
