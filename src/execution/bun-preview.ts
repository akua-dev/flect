import {
  Context,
  type Duration,
  Effect,
  Layer,
  Ref,
  Schema,
  type SchemaAST,
  Semaphore,
} from "effect";
import { BunCommandFailed } from "../../shared/bun-command";

const BODY_LIMIT = 1_048_576;
const HEADER_LIMIT = 64;
const DEFAULT_HANDLER_DEADLINE = "2 seconds";
const STOPPED_PREVIEW_LIMIT = 256;

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const Headers = Schema.Record(
  Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[a-z0-9-]+$/),
  ),
  Schema.String.check(Schema.isMaxLength(4_096)),
).check(Schema.isMaxProperties(HEADER_LIMIT));

export class BunPreviewRequest extends Schema.Class<BunPreviewRequest>(
  "BunPreviewRequest",
)({
  version: Schema.Literal(1),
  runId: Schema.String.check(
    Schema.isMinLength(5),
    Schema.isMaxLength(80),
    Schema.isPattern(/^run-[a-z0-9-]+$/),
  ),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1_024, maximum: 65_535 })),
  method: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.isPattern(/^[A-Z]+$/),
  ),
  path: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4_096),
    Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).*$/),
  ),
  headers: Headers,
  body: Schema.String.check(Schema.isMaxLength(BODY_LIMIT)),
}) {}

export class BunPreviewResponse extends Schema.Class<BunPreviewResponse>(
  "BunPreviewResponse",
)({
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  headers: Headers,
  body: Schema.String.check(Schema.isMaxLength(BODY_LIMIT)),
}) {}

export interface BunPreviewRegistration {
  readonly runId: string;
  readonly port: number;
  readonly handler: (
    request: BunPreviewRequest,
  ) => Effect.Effect<
    BunPreviewResponse | typeof BunPreviewResponse.Encoded,
    BunCommandFailed
  >;
  readonly onTimeout?: Effect.Effect<void>;
}

export interface BunPreviewShape {
  readonly register: (
    registration: BunPreviewRegistration,
  ) => Effect.Effect<{ readonly previewUrl: string }, BunCommandFailed>;
  readonly request: (
    request: typeof BunPreviewRequest.Encoded,
  ) => Effect.Effect<BunPreviewResponse, BunCommandFailed>;
  readonly stop: (runId: string) => Effect.Effect<void, BunCommandFailed>;
}

export class BunPreview extends Context.Service<BunPreview, BunPreviewShape>()(
  "flect/BunPreview",
) {}

const previewFailure = () =>
  BunCommandFailed.make({
    reason: "preview",
    message: "The Bun-compatible preview request failed safely.",
  });

const response = (status: number, body: string) =>
  BunPreviewResponse.make({
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
  });

export const makeBunPreviewLayer = (options?: {
  readonly handlerDeadline?: Duration.Input;
}) =>
  Layer.effect(
    BunPreview,
    Effect.gen(function* () {
      const registrations = yield* Ref.make<
        ReadonlyMap<number, BunPreviewRegistration>
      >(new Map());
      const stopped = yield* Ref.make<ReadonlyMap<number, string>>(new Map());
      const mutation = yield* Semaphore.make(1);

      return {
        register: Effect.fn("Flect.BunPreview.register")((registration) =>
          mutation.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(registrations);
              if (
                current.has(registration.port) ||
                [...current.values()].some(
                  (candidate) => candidate.runId === registration.runId,
                )
              ) {
                return yield* Effect.fail(previewFailure());
              }
              const next = new Map(current);
              next.set(registration.port, registration);
              yield* Ref.set(registrations, next);
              yield* Ref.update(stopped, (currentStopped) => {
                if (!currentStopped.has(registration.port)) {
                  return currentStopped;
                }
                const nextStopped = new Map(currentStopped);
                nextStopped.delete(registration.port);
                return nextStopped;
              });
              return {
                previewUrl: `/preview/${registration.port}/`,
              };
            }),
          ),
        ),
        request: Effect.fn("Flect.BunPreview.request")((input) =>
          Schema.decodeUnknownEffect(
            BunPreviewRequest,
            strict,
          )(input).pipe(
            Effect.mapError(previewFailure),
            Effect.flatMap((request) =>
              Ref.get(registrations).pipe(
                Effect.flatMap((current) => {
                  const registration = current.get(request.port);
                  if (
                    registration === undefined ||
                    registration.runId !== request.runId
                  ) {
                    return Ref.get(stopped).pipe(
                      Effect.map((stoppedPreviews) =>
                        stoppedPreviews.get(request.port) === request.runId
                          ? response(503, "Preview stopped.")
                          : response(404, "Preview not found."),
                      ),
                    );
                  }
                  return registration.handler(request).pipe(
                    Effect.timeoutOrElse({
                      duration:
                        options?.handlerDeadline ?? DEFAULT_HANDLER_DEADLINE,
                      orElse: () =>
                        (registration.onTimeout ?? Effect.void).pipe(
                          Effect.catch(() => Effect.void),
                          Effect.as(response(504, "Preview handler timed out.")),
                        ),
                    }),
                    Effect.flatMap((value) =>
                      Schema.decodeUnknownEffect(
                        BunPreviewResponse,
                        strict,
                      )(value).pipe(
                        Effect.orElseSucceed(() =>
                          response(
                            502,
                            "Preview returned an invalid response.",
                          ),
                        ),
                      ),
                    ),
                    Effect.catch(() =>
                      Effect.succeed(response(502, "Preview handler failed.")),
                    ),
                    Effect.catchDefect(() =>
                      Effect.succeed(response(502, "Preview handler failed.")),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
        stop: Effect.fn("Flect.BunPreview.stop")((runId) =>
          mutation.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(registrations);
              const next = new Map(current);
              const stoppedPorts: Array<number> = [];
              for (const [port, registration] of current) {
                if (registration.runId === runId) {
                  next.delete(port);
                  stoppedPorts.push(port);
                }
              }
              yield* Ref.set(registrations, next);
              if (stoppedPorts.length > 0) {
                yield* Ref.update(stopped, (currentStopped) => {
                  const nextStopped = new Map(currentStopped);
                  for (const port of stoppedPorts) {
                    nextStopped.set(port, runId);
                  }
                  while (nextStopped.size > STOPPED_PREVIEW_LIMIT) {
                    const oldest = nextStopped.keys().next().value;
                    if (oldest === undefined) {
                      break;
                    }
                    nextStopped.delete(oldest);
                  }
                  return nextStopped;
                });
              }
            }),
          ),
        ),
      };
    }),
  );
