import { Effect, Layer, Option, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
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
  ShapeRequest,
  ShapeResponse,
  TurnBusy,
  TurnError,
} from "../shared/contracts";
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

const runtimeJson = HttpServerResponse.schemaJson(RuntimeStatus);
const modelsJson = HttpServerResponse.schemaJson(ModelsResponse);
const sessionJson = HttpServerResponse.schemaJson(SessionResponse);
const closeJson = HttpServerResponse.schemaJson(CloseSessionResponse);
const cancelJson = HttpServerResponse.schemaJson(CancelResponse);
const shapeJson = HttpServerResponse.schemaJson(ShapeResponse);
const guardianJson = HttpServerResponse.schemaJson(GuardianDiagnostic);
const publicErrorJson = HttpServerResponse.schemaJson(PublicErrorResponse);
const encodeEventJson = Schema.encodeEffect(Schema.fromJsonString(FlectEvent));

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
    if (Option.isNone(path)) {
      return yield* invalidRequest();
    }

    const runtime = yield* FlectRuntime;
    yield* runtime.cancel(path.value.sessionId);
    return yield* cancelJson(
      new CancelResponse({ version: 1, status: "cancelled" }),
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
  }).pipe(Effect.catch(() => runtimeFailure())),
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

    const runtime = yield* FlectRuntime;
    const document = yield* runtime.shape(
      path.value.sessionId,
      shape.value.instruction,
      shape.value.document,
    );
    return yield* shapeJson(new ShapeResponse({ version: 1, document }));
  }).pipe(
    Effect.catchTag("SessionBusy", () =>
      publicError("The session is busy.", 409),
    ),
    Effect.catch(() => runtimeFailure()),
  ),
);

const makeOriginMiddleware = (allowedOrigins: ReadonlySet<string>) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const origin = request.headers.origin;
        if (origin && !allowedOrigins.has(origin)) {
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
    guardianRoute,
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
    HttpRouter.provideRequest(Layer.succeed(FlectRuntime)(runtime)),
  );
  return HttpRouter.toWebHandler(appLayer, { disableLogger: true });
}
