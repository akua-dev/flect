import { Clock, Context, Effect, Layer, Ref, Semaphore, Stream } from "effect";
import {
  ControlClientSummary,
  type FlectCommandError,
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
    const reconcilePermit = yield* Semaphore.make(1);

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
            yield* transport.publishSnapshot(snapshot);
            return;
          }
          if (!snapshot.control.enabled && active) {
            if (yield* Ref.get(revocationInFlight)) {
              return;
            }
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

    const runNext = Effect.fn("Flect.ControlBridge.runNext")(function* () {
      if (!(yield* Ref.get(enabled))) {
        yield* Effect.sleep("100 millis");
        return;
      }
      const snapshot = yield* controller.snapshot;
      const envelope = yield* transport.nextCommand(snapshot.workspaceId);
      if (envelope.command.type === "disable-control") {
        yield* Ref.set(revocationInFlight, true);
        yield* runEnvelope(envelope);
        return;
      }
      yield* runEnvelope(envelope).pipe(Effect.forkScoped);
    });

    yield* reconcile().pipe(Effect.catch(() => Effect.void));
    yield* controller.changes.pipe(
      Stream.runForEach(() =>
        reconcile().pipe(Effect.catch(() => Effect.void)),
      ),
      Effect.forkScoped,
    );
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
      runNext().pipe(Effect.catch(() => Effect.sleep("200 millis"))),
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
