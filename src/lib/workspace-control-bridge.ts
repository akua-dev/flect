import {
  Clock,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Ref,
  Result,
  Semaphore,
  Stream,
} from "effect";
import {
  ControlClientSummary,
  DisableControl,
  FlectCommandEnvelope,
  type FlectCommandError,
  UserCommandSource,
  WorkspaceUnavailable,
} from "../../shared/control";
import {
  ControlCommandCompletion,
  ControlCommandFailed,
  ControlCommandSucceeded,
} from "../../shared/control-channel";
import { WorkspaceControlTransport } from "./workspace-control-transport";
import { FlectWorkspaceController } from "./workspace-controller";

export interface WorkspaceControlBridgeShape {
  readonly ready: Effect.Effect<void>;
}

export class WorkspaceControlBridge extends Context.Service<
  WorkspaceControlBridge,
  WorkspaceControlBridgeShape
>()("flect/WorkspaceControlBridge") {}

const unavailable = () =>
  WorkspaceUnavailable.make({
    message: "The Flect workspace is unavailable.",
  });

export const WorkspaceControlBridgeLive = Layer.effect(
  WorkspaceControlBridge,
  Effect.gen(function* () {
    const controller = yield* FlectWorkspaceController;
    const transport = yield* WorkspaceControlTransport;
    const enabled = yield* Ref.make(false);
    const revocationInFlight = yield* Ref.make(false);
    const activeCommandFibers = yield* Ref.make<
      ReadonlySet<Fiber.Fiber<unknown, unknown>>
    >(new Set());
    const reconcilePermit = yield* Semaphore.make(1);
    const commandLaunchPermit = yield* Semaphore.make(1);

    const interruptActiveCommands = Effect.fn(
      "Flect.ControlBridge.interruptActiveCommands",
    )(function* () {
      const fibers = yield* Ref.get(activeCommandFibers);
      yield* Fiber.interruptAll(fibers);
      yield* Ref.set(activeCommandFibers, new Set());
    });

    const confirmTransportRevocation = Effect.fn(
      "Flect.ControlBridge.confirmTransportRevocation",
    )(function* () {
      yield* commandLaunchPermit.withPermits(1)(
        Effect.gen(function* () {
          yield* Ref.set(revocationInFlight, true);
          yield* Effect.gen(function* () {
            yield* interruptActiveCommands();
            const snapshot = yield* controller.snapshot;
            if (snapshot.control.enabled) {
              yield* controller.dispatch(
                FlectCommandEnvelope.make({
                  version: 1,
                  commandId: `cmd-control-revoked-${crypto.randomUUID()}`,
                  workspaceId: snapshot.workspaceId,
                  source: UserCommandSource.make({ kind: "user" }),
                  command: DisableControl.make({ type: "disable-control" }),
                }),
              );
            }
            yield* transport.disable;
            yield* Ref.set(enabled, false);
          }).pipe(Effect.ensuring(Ref.set(revocationInFlight, false)));
        }),
      );
    });

    const reconcileTransportFailure = Effect.fn(
      "Flect.ControlBridge.reconcileTransportFailure",
    )(function* () {
      const status = yield* transport.status.pipe(Effect.result);
      if (Result.isFailure(status) || status.success.enabled) {
        return;
      }
      yield* confirmTransportRevocation().pipe(
        Effect.catch(() =>
          Effect.logWarning(
            "Flect control revocation cleanup is still pending.",
          ),
        ),
      );
    });

    const reconcile = Effect.fn("Flect.ControlBridge.reconcile")(() =>
      reconcilePermit.withPermits(1)(
        Effect.gen(function* () {
          const snapshot = yield* controller.snapshot;
          const active = yield* Ref.get(enabled);
          if (snapshot.control.enabled && !active) {
            yield* transport.enable(snapshot);
            yield* Ref.set(enabled, true);
            return;
          }
          if (snapshot.control.enabled && active) {
            yield* transport
              .publishSnapshot(snapshot)
              .pipe(Effect.catch(() => reconcileTransportFailure()));
            return;
          }
          if (!snapshot.control.enabled && active) {
            if (yield* Ref.get(revocationInFlight)) {
              return;
            }
            yield* interruptActiveCommands();
            yield* transport.disable;
            yield* Ref.set(enabled, false);
          }
        }),
      ),
    );

    const completeFailure = (commandId: string, error: FlectCommandError) =>
      transport.complete(
        ControlCommandCompletion.make({
          commandId,
          outcome: ControlCommandFailed.make({
            status: "failed",
            error,
          }),
        }),
      );

    const runEnvelope = Effect.fn("Flect.ControlBridge.runEnvelope")(
      function* (envelope) {
        if (envelope.source.kind !== "control") {
          yield* completeFailure(envelope.commandId, unavailable());
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        yield* controller.connectClient(
          ControlClientSummary.make({
            id: envelope.source.clientId,
            name: envelope.source.clientName,
            connectedAt: now,
            lastSeenAt: now,
          }),
        );
        const revoking = envelope.command.type === "disable-control";
        if (revoking && !(yield* Ref.get(revocationInFlight))) {
          yield* Ref.set(revocationInFlight, true);
        }
        yield* controller.dispatch(envelope).pipe(
          Effect.matchEffect({
            onFailure: (error) => completeFailure(envelope.commandId, error),
            onSuccess: (receipt) =>
              transport.complete(
                ControlCommandCompletion.make({
                  commandId: envelope.commandId,
                  outcome: ControlCommandSucceeded.make({
                    status: "succeeded",
                    receipt,
                  }),
                }),
              ),
          }),
          Effect.ensuring(
            revoking
              ? Ref.set(revocationInFlight, false).pipe(
                  Effect.andThen(
                    reconcile().pipe(Effect.catch(() => Effect.void)),
                  ),
                )
              : Effect.void,
          ),
        );
      },
    );

    const startTrackedEnvelope = Effect.fn(
      "Flect.ControlBridge.startTrackedEnvelope",
    )(function* (envelope) {
      const start = yield* Deferred.make<void>();
      let trackedFiber: Fiber.Fiber<unknown, unknown> | undefined;
      yield* commandLaunchPermit.withPermits(1)(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            Deferred.await(start).pipe(
              Effect.andThen(runEnvelope(envelope)),
              Effect.ensuring(
                Ref.update(activeCommandFibers, (current) => {
                  const next = new Set(current);
                  if (trackedFiber !== undefined) next.delete(trackedFiber);
                  return next;
                }),
              ),
            ),
          );
          trackedFiber = fiber;
          yield* Ref.update(activeCommandFibers, (current) =>
            new Set(current).add(fiber),
          );
          yield* Deferred.succeed(start, undefined);
        }),
      );
    });

    const runNext = Effect.fn("Flect.ControlBridge.runNext")(function* () {
      if (!(yield* Ref.get(enabled))) {
        yield* Effect.sleep("100 millis");
        return;
      }
      const snapshot = yield* controller.snapshot;
      const envelope = yield* transport.nextCommand(snapshot.workspaceId);
      if (envelope.command.type === "disable-control") {
        yield* commandLaunchPermit.withPermits(1)(
          Effect.gen(function* () {
            yield* Ref.set(revocationInFlight, true);
            yield* interruptActiveCommands();
            yield* runEnvelope(envelope);
          }),
        );
        return;
      }
      yield* startTrackedEnvelope(envelope);
    });

    const reconcileObserved = reconcile().pipe(
      Effect.catch(() =>
        Effect.logWarning("Flect control transport reconciliation failed."),
      ),
    );

    yield* reconcileObserved;
    // A semantic event is sufficient to trigger reconciliation. The event
    // stream is bounded and does not retain obsolete full workspace snapshots.
    yield* controller.events.pipe(
      Stream.runForEach(() => reconcileObserved),
      Effect.forkScoped,
    );
    yield* Effect.forever(
      Effect.sleep("1 second").pipe(Effect.andThen(reconcileObserved)),
    ).pipe(Effect.forkScoped);
    yield* controller.events.pipe(
      Stream.runForEach((event) =>
        Ref.get(enabled).pipe(
          Effect.flatMap((active) =>
            active
              ? Ref.get(revocationInFlight).pipe(
                  Effect.flatMap((revoking) =>
                    revoking ? Effect.void : transport.publishEvent(event),
                  ),
                )
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
        ),
      ),
      Effect.forkScoped,
    );
    yield* Effect.forever(
      runNext().pipe(
        Effect.catch(() =>
          reconcileTransportFailure().pipe(
            Effect.andThen(Effect.sleep("200 millis")),
          ),
        ),
      ),
    ).pipe(Effect.forkScoped);
    yield* Effect.addFinalizer(() =>
      Ref.get(enabled).pipe(
        Effect.flatMap((active) =>
          active
            ? transport.disable.pipe(Effect.catch(() => Effect.void))
            : Effect.void,
        ),
      ),
    );

    return { ready: Effect.void };
  }),
);
