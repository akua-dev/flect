import {
  Cause,
  Context,
  Effect,
  Layer,
  Queue,
  Schema,
  type SchemaAST,
  Stream,
  SynchronizedRef,
} from "effect";
import {
  ProductEvent,
  ProductEventFailure,
  ProductEventPolicy,
  ProductEventRequest,
} from "../product-events.js";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const encoder = new TextEncoder();

export interface ProductEventConnector {
  readonly open: (options: {
    readonly request: ProductEventRequest;
    readonly resumeAfter?: string;
    readonly signal: AbortSignal;
    readonly emit: (event: unknown) => Effect.Effect<void, ProductEventFailure>;
  }) => Effect.Effect<void, ProductEventFailure>;
}

export interface ProductEventsShape {
  readonly subscribe: (
    request: ProductEventRequest,
  ) => Stream.Stream<ProductEvent, ProductEventFailure>;
}

export class ProductEvents extends Context.Service<
  ProductEvents,
  ProductEventsShape
>()("flect/ProductEvents") {}

const failure = (policyId: string, reason: ProductEventFailure["reason"]) =>
  ProductEventFailure.make({
    policyId,
    reason,
    message: "The product event stream failed safely.",
  });

const sanitizeConnector = (
  policyId: string,
  effect: Effect.Effect<void, ProductEventFailure>,
) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : (() => {
            const failures = cause.reasons.filter(Cause.isFailReason);
            const error = failures[0]?.error;
            return failures.length === cause.reasons.length &&
              Schema.is(ProductEventFailure)(error)
              ? Effect.fail(error)
              : Effect.fail(failure(policyId, "transport"));
          })(),
    ),
  );

export const makeProductEventsLayer = (options: {
  readonly policies: ReadonlyArray<ProductEventPolicy>;
  readonly connectors: ReadonlyMap<string, ProductEventConnector>;
}) =>
  Layer.effect(
    ProductEvents,
    Effect.gen(function* () {
      const policies = new Map<string, ProductEventPolicy>();
      for (const candidate of options.policies) {
        const policy = yield* Schema.decodeUnknownEffect(
          ProductEventPolicy,
          strict,
        )(candidate).pipe(
          Effect.mapError(() => failure(candidate.id, "invalid-policy")),
        );
        if (policies.has(policy.id) || !options.connectors.has(policy.id)) {
          return yield* Effect.fail(failure(policy.id, "invalid-policy"));
        }
        policies.set(policy.id, policy);
      }

      const subscribe = (candidate: ProductEventRequest) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(
              ProductEventRequest,
              strict,
            )(candidate).pipe(
              Effect.mapError(() =>
                failure(candidate.policyId, "invalid-policy"),
              ),
            );
            const policy = policies.get(request.policyId);
            const connector = options.connectors.get(request.policyId);
            if (policy === undefined || connector === undefined) {
              return yield* Effect.fail(
                failure(request.policyId, "invalid-policy"),
              );
            }
            if (!policy.sequenceResume && request.resumeAfter !== undefined) {
              return yield* Effect.fail(failure(policy.id, "denied"));
            }
            const queue = yield* Queue.bounded<
              ProductEvent,
              ProductEventFailure | Cause.Done
            >(policy.bufferCapacity);
            const cursor = yield* SynchronizedRef.make(request.resumeAfter);
            const controller = new AbortController();

            const emit = Effect.fn("Flect.ProductEvents.emit")(function* (
              candidateEvent: unknown,
            ) {
              const event = yield* Schema.decodeUnknownEffect(
                ProductEvent,
                strict,
              )(candidateEvent).pipe(
                Effect.mapError(() => failure(policy.id, "invalid-event")),
              );
              if (
                event.policyId !== policy.id ||
                encoder.encode(JSON.stringify(event)).byteLength >
                  policy.eventBytes
              ) {
                return yield* Effect.fail(failure(policy.id, "invalid-event"));
              }
              yield* SynchronizedRef.updateEffect(cursor, (previous) => {
                if (
                  previous !== undefined &&
                  BigInt(event.sequence) <= BigInt(previous)
                ) {
                  return Effect.fail(failure(policy.id, "sequence-violation"));
                }
                return Queue.offer(queue, event).pipe(
                  Effect.flatMap((accepted) =>
                    accepted
                      ? Effect.succeed(event.sequence)
                      : Effect.fail(failure(policy.id, "overflow")),
                  ),
                );
              });
            });

            const produce = Effect.gen(function* () {
              let reconnects = 0;
              while (true) {
                const resumeAfter = policy.sequenceResume
                  ? yield* SynchronizedRef.get(cursor)
                  : undefined;
                const result = yield* sanitizeConnector(
                  policy.id,
                  connector.open({
                    request,
                    ...(resumeAfter === undefined ? {} : { resumeAfter }),
                    signal: controller.signal,
                    emit,
                  }),
                ).pipe(Effect.result);
                if (result._tag === "Success") {
                  yield* Queue.end(queue);
                  return;
                }
                if (result.failure.reason !== "transport") {
                  yield* Queue.fail(queue, result.failure);
                  return;
                }
                if (reconnects >= policy.reconnectAttempts) {
                  yield* Queue.fail(
                    queue,
                    failure(policy.id, "reconnect-exhausted"),
                  );
                  return;
                }
                reconnects += 1;
                yield* Effect.sleep(policy.reconnectDelayMs);
              }
            });

            yield* produce.pipe(Effect.forkScoped({ startImmediately: true }));
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => controller.abort()),
            );
            return Stream.fromQueue(queue);
          }),
        );

      return { subscribe };
    }),
  );
