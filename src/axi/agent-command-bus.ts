import {
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
} from "effect";
import type {
  AgentCommandSource,
  FlectCommand,
  FlectCommandError,
} from "../../shared/control";
import type { InterfaceDocument } from "../../shared/interface-document";

const BUS_CAPACITY = 32;

export type AgentGatewayOperation =
  | { readonly type: "inspect" }
  | { readonly type: "logs" }
  | { readonly type: "propose-interface"; readonly document: InterfaceDocument }
  | { readonly type: "command"; readonly command: FlectCommand };

export class AgentGatewayResult extends Schema.Class<AgentGatewayResult>(
  "AgentGatewayResult",
)({
  type: Schema.Literals(["inspect", "logs", "propose-interface", "command"]),
  value: Schema.Unknown,
}) {}

export class AgentCommandBusError extends Schema.TaggedErrorClass<AgentCommandBusError>()(
  "AgentCommandBusError",
  {
    reason: Schema.Literals(["capacity", "timeout", "unavailable"]),
    message: Schema.Literals([
      "The Flect agent command queue is full.",
      "The Flect agent command timed out.",
      "The Flect agent command bus is unavailable.",
    ]),
  },
) {}

const busError = (reason: AgentCommandBusError["reason"]) =>
  AgentCommandBusError.make({
    reason,
    message:
      reason === "capacity"
        ? "The Flect agent command queue is full."
        : reason === "timeout"
          ? "The Flect agent command timed out."
          : "The Flect agent command bus is unavailable.",
  });

export interface AgentCommandRequest {
  readonly id: string;
  readonly source: AgentCommandSource;
  readonly operation: AgentGatewayOperation;
  readonly response: Deferred.Deferred<
    AgentGatewayResult,
    AgentCommandBusError | FlectCommandError
  >;
}

export interface AgentCommandBusShape {
  readonly submit: (
    source: AgentCommandSource,
    operation: AgentGatewayOperation,
  ) => Effect.Effect<
    AgentGatewayResult,
    AgentCommandBusError | FlectCommandError
  >;
  readonly take: Effect.Effect<AgentCommandRequest, AgentCommandBusError>;
  readonly shutdown: Effect.Effect<void>;
}

export class AgentCommandBus extends Context.Service<
  AgentCommandBus,
  AgentCommandBusShape
>()("flect/AgentCommandBus") {}

export const AgentCommandBusLive = Layer.effect(
  AgentCommandBus,
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<AgentCommandRequest>(BUS_CAPACITY);
    const closed = yield* Ref.make(false);
    const pending = yield* Ref.make<
      ReadonlyMap<
        string,
        Deferred.Deferred<
          AgentGatewayResult,
          AgentCommandBusError | FlectCommandError
        >
      >
    >(new Map());

    const removePending = (id: string) =>
      Ref.update(pending, (current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });

    const shutdown = Effect.fn("Flect.AgentCommandBus.shutdown")(function* () {
      const wasClosed = yield* Ref.getAndSet(closed, true);
      if (wasClosed) {
        return;
      }
      const current = yield* Ref.getAndSet(pending, new Map());
      yield* Effect.forEach(
        current.values(),
        (response) => Deferred.fail(response, busError("unavailable")),
        { discard: true },
      );
      yield* Queue.shutdown(queue);
    });

    const submit = Effect.fn("Flect.AgentCommandBus.submit")(function* (
      source: AgentCommandSource,
      operation: AgentGatewayOperation,
    ) {
      if (yield* Ref.get(closed)) {
        return yield* Effect.fail(busError("unavailable"));
      }
      const id = `agent-request-${crypto.randomUUID()}`;
      const response = yield* Deferred.make<
        AgentGatewayResult,
        AgentCommandBusError | FlectCommandError
      >();
      yield* Ref.update(pending, (current) => {
        const next = new Map(current);
        next.set(id, response);
        return next;
      });
      const accepted = Queue.offerUnsafe(queue, {
        id,
        source,
        operation,
        response,
      });
      if (!accepted) {
        yield* removePending(id);
        return yield* Effect.fail(
          busError((yield* Ref.get(closed)) ? "unavailable" : "capacity"),
        );
      }
      const timeout = busError("timeout");
      return yield* Deferred.await(response).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () =>
            Deferred.fail(response, timeout).pipe(
              Effect.andThen(Effect.fail(timeout)),
            ),
        }),
        Effect.onInterrupt(() =>
          Deferred.fail(response, busError("unavailable")).pipe(Effect.asVoid),
        ),
        Effect.ensuring(removePending(id)),
      );
    });

    const takeOpen = Effect.fn("Flect.AgentCommandBus.take")(
      function* (): Effect.fn.Return<
        AgentCommandRequest,
        AgentCommandBusError
      > {
        if (yield* Ref.get(closed)) {
          return yield* Effect.fail(busError("unavailable"));
        }
        const request = yield* Queue.take(queue);
        const completed = yield* Deferred.poll(request.response);
        return Option.isNone(completed) ? request : yield* takeOpen();
      },
    );

    yield* Effect.addFinalizer(() => shutdown());
    return { submit, take: takeOpen(), shutdown: shutdown() };
  }),
);
