import { Context, Effect, Layer, Ref } from "effect";
import {
  NativeUpdateError,
  NativeUpdateSnapshot,
} from "../../shared/native-update";

export interface NativeUpdateShape {
  readonly status: Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
  readonly check: Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
  readonly install: (
    token: string,
  ) => Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
  readonly relaunch: Effect.Effect<void, NativeUpdateError>;
}

export type NativeUpdateAdapterShape = NativeUpdateShape;

export class NativeUpdate extends Context.Service<
  NativeUpdate,
  NativeUpdateShape
>()("flect/NativeUpdate") {}

const stale = () =>
  NativeUpdateError.make({
    reason: "stale",
    message: "This Flect update is no longer the reviewed candidate.",
  });

const candidateToken = (snapshot: NativeUpdateSnapshot) =>
  snapshot.state === "available" ||
  snapshot.state === "downloading" ||
  snapshot.state === "installing" ||
  snapshot.state === "ready-to-relaunch"
    ? snapshot.candidate.token
    : undefined;

export const makeGuardedNativeUpdate = Effect.fn(
  "Flect.NativeUpdate.makeGuarded",
)(function* (
  adapter: NativeUpdateAdapterShape,
): Effect.fn.Return<NativeUpdateShape> {
  const reviewedToken = yield* Ref.make<string | undefined>(undefined);
  const check = adapter.check.pipe(
    Effect.tap((snapshot) => Ref.set(reviewedToken, candidateToken(snapshot))),
  );
  const install = Effect.fn("Flect.NativeUpdate.install")(function* (
    token: string,
  ) {
    const claimed = yield* Ref.modify(reviewedToken, (current) =>
      current === token
        ? ([true, undefined] as const)
        : ([false, current] as const),
    );
    if (!claimed) {
      return yield* Effect.fail(stale());
    }
    return yield* adapter.install(token);
  });

  return {
    status: adapter.status,
    check,
    install,
    relaunch: adapter.relaunch,
  };
});

export const makeGuardedNativeUpdateLayer = (
  adapter: NativeUpdateAdapterShape,
) => Layer.effect(NativeUpdate, makeGuardedNativeUpdate(adapter));

const browserUnavailable = NativeUpdateSnapshot.make({
  version: 1,
  state: "unavailable",
  installedVersion: "0.2.0",
  reason: "browser",
});

export const NativeUpdateUnavailableLive = Layer.succeed(NativeUpdate)({
  status: Effect.succeed(browserUnavailable),
  check: Effect.succeed(browserUnavailable),
  install: () => Effect.fail(stale()),
  relaunch: Effect.fail(
    NativeUpdateError.make({
      reason: "unavailable",
      message: "Native updates are unavailable in browser Flect.",
    }),
  ),
});
