import { Effect, Layer, Option, Schema, type SchemaAST, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  AgentShellResultAccepted,
  AgentShellResultRequest,
  AuthFailed,
  AuthLoginEvent,
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  CancelRequest,
  CancelResponse,
  CloseSessionResponse,
  FlectEvent,
  GuardianDiagnostic,
  ModelsResponse,
  PromptRequest,
  ProviderAuthResponse,
  ProviderAuthSummary,
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
import {
  ControlAck,
  ControlBrokerStatus,
  ControlCommandCompletion,
  ControlCommandsResponse,
  ControlEventPublication,
  ControlNextCommandRequest,
  ControlSnapshotPublication,
  ControlWorkspaceRegistration,
} from "../shared/control-channel";
import { validateInterfaceDocument } from "../shared/interface-document";
import {
  ControlBrokerLive,
  FlectControlBroker,
  type FlectControlBrokerShape,
} from "./control-broker";
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
const guardianJson = HttpServerResponse.schemaJson(GuardianDiagnostic);
const shellResultJson = HttpServerResponse.schemaJson(AgentShellResultAccepted);
const providerAuthJson = HttpServerResponse.schemaJson(ProviderAuthResponse);
const publicErrorJson = HttpServerResponse.schemaJson(PublicErrorResponse);
const controlStatusJson = HttpServerResponse.schemaJson(ControlBrokerStatus);
const controlAckJson = HttpServerResponse.schemaJson(ControlAck);
const controlCommandsJson = HttpServerResponse.schemaJson(
  ControlCommandsResponse,
);
const encodeEventJson = Schema.encodeEffect(Schema.fromJsonString(FlectEvent));
const encodeShapeEventJson = Schema.encodeEffect(
  Schema.fromJsonString(ShapeEvent),
);
const encodeAuthEventJson = Schema.encodeEffect(
  Schema.fromJsonString(AuthLoginEvent),
);
const ProviderLogoutRequest = Schema.Struct({
  providerId: ProviderAuthSummary.fields.id,
});

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

const makeProviderAuthRoutes = (allowedOrigins: ReadonlySet<string>) => {
  const requireMutationOrigin = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return requireControlOrigin(request, allowedOrigins);
  });

  const mutation = <A, R, E, R2>(
    schema: Schema.ConstraintDecoder<A, R>,
    use: (
      runtime: FlectRuntimeShape,
      input: A,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R2>,
  ) =>
    Effect.gen(function* () {
      if (!(yield* requireMutationOrigin)) {
        return yield* publicError("Origin not allowed", 403);
      }
      const input = yield* decodeBody(schema);
      if (Option.isNone(input)) {
        return yield* invalidRequest();
      }
      const runtime = yield* FlectRuntime;
      return yield* use(runtime, input.value);
    }).pipe(Effect.catch(() => runtimeFailure()));

  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/api/auth/providers",
      Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const providers = yield* runtime.providerAuth;
        return yield* providerAuthJson(
          ProviderAuthResponse.make({ version: 1, providers }),
        );
      }).pipe(Effect.catch(() => runtimeFailure())),
    ),
    HttpRouter.add(
      "POST",
      "/api/auth/login",
      mutation(AuthLoginRequest, (runtime, request) => {
        const events = runtime.loginProvider(request).pipe(
          Stream.catch(() =>
            Stream.succeed(
              AuthFailed.make({
                type: "auth_failed",
                loginId: "login-runtime-failure",
                code: "provider-failed",
                message: "Provider authentication could not be completed.",
              }),
            ),
          ),
          Stream.mapEffect((event) => encodeAuthEventJson(event)),
          Stream.map((json) => `data: ${json}\n\n`),
          Stream.encodeText,
        );
        return Effect.succeed(
          HttpServerResponse.stream(events, {
            contentType: "text/event-stream; charset=utf-8",
            headers: { "cache-control": "no-store" },
          }),
        );
      }),
    ),
    HttpRouter.add(
      "POST",
      "/api/auth/reply",
      mutation(AuthSelectionReply, (runtime, reply) =>
        runtime
          .replyProviderAuth(reply)
          .pipe(Effect.as(HttpServerResponse.empty())),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/auth/cancel",
      mutation(AuthLoginReference, (runtime, reference) =>
        runtime
          .cancelProviderAuth(reference)
          .pipe(Effect.as(HttpServerResponse.empty())),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/auth/refresh",
      Effect.gen(function* () {
        if (!(yield* requireMutationOrigin)) {
          return yield* publicError("Origin not allowed", 403);
        }
        const runtime = yield* FlectRuntime;
        const providers = yield* runtime.refreshProviderAuth;
        return yield* providerAuthJson(
          ProviderAuthResponse.make({ version: 1, providers }),
        );
      }).pipe(Effect.catch(() => runtimeFailure())),
    ),
    HttpRouter.add(
      "POST",
      "/api/auth/logout",
      mutation(ProviderLogoutRequest, (runtime, { providerId }) =>
        runtime
          .logoutProvider(providerId)
          .pipe(
            Effect.flatMap((providers) =>
              providerAuthJson(
                ProviderAuthResponse.make({ version: 1, providers }),
              ),
            ),
          ),
      ),
    ),
  );
};

const requireControlOrigin = (
  request: HttpServerRequest.HttpServerRequest,
  allowedOrigins: ReadonlySet<string>,
) =>
  request.headers.origin !== undefined &&
  allowedOrigins.has(request.headers.origin);

const makeControlRoutes = (allowedOrigins: ReadonlySet<string>) => {
  const protectedRoute = <A, R, E, R2>(
    schema: Schema.ConstraintDecoder<A, R>,
    use: (
      broker: FlectControlBrokerShape,
      input: A,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R2>,
  ) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!requireControlOrigin(request, allowedOrigins)) {
        return yield* publicError("Origin not allowed", 403);
      }
      const body = yield* decodeBody(schema);
      if (Option.isNone(body)) {
        return yield* invalidRequest();
      }
      const broker = yield* FlectControlBroker;
      return yield* use(broker, body.value);
    }).pipe(Effect.catch(() => runtimeFailure()));

  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/api/control/status",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!requireControlOrigin(request, allowedOrigins)) {
          return yield* publicError("Origin not allowed", 403);
        }
        const broker = yield* FlectControlBroker;
        return yield* controlStatusJson(yield* broker.status);
      }).pipe(Effect.catch(() => runtimeFailure())),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/enable",
      protectedRoute(ControlWorkspaceRegistration, (broker, input) =>
        broker.enable(input.snapshot).pipe(Effect.flatMap(controlStatusJson)),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/disable",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!requireControlOrigin(request, allowedOrigins)) {
          return yield* publicError("Origin not allowed", 403);
        }
        const broker = yield* FlectControlBroker;
        yield* broker.disable;
        return yield* controlAckJson(
          ControlAck.make({ version: 1, status: "accepted" }),
        );
      }).pipe(Effect.catch(() => runtimeFailure())),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/snapshot",
      protectedRoute(ControlSnapshotPublication, (broker, input) =>
        broker
          .publishSnapshot(input.snapshot)
          .pipe(
            Effect.andThen(
              controlAckJson(
                ControlAck.make({ version: 1, status: "accepted" }),
              ),
            ),
          ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/event",
      protectedRoute(ControlEventPublication, (broker, input) =>
        broker
          .publishEvent(input.event)
          .pipe(
            Effect.andThen(
              controlAckJson(
                ControlAck.make({ version: 1, status: "accepted" }),
              ),
            ),
          ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/commands/next",
      protectedRoute(ControlNextCommandRequest, (broker, input) =>
        broker.nextCommand(input.workspaceId).pipe(
          Effect.matchEffect({
            onFailure: () =>
              controlCommandsJson(
                ControlCommandsResponse.make({
                  version: 1,
                }),
              ),
            onSuccess: (command) =>
              controlCommandsJson(
                ControlCommandsResponse.make({
                  version: 1,
                  command,
                }),
              ),
          }),
        ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/control/commands/complete",
      protectedRoute(ControlCommandCompletion, (broker, input) =>
        broker
          .complete(input)
          .pipe(
            Effect.andThen(
              controlAckJson(
                ControlAck.make({ version: 1, status: "accepted" }),
              ),
            ),
          ),
      ),
    ),
  );
};

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
    guardianRoute,
    makeProviderAuthRoutes(allowedOrigins),
    makeControlRoutes(allowedOrigins),
    makeOriginMiddleware(allowedOrigins),
  ).pipe(HttpRouter.provideRequest(ControlBrokerLive));

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
