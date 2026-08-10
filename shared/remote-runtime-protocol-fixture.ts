import { Schema } from "effect";

const Id = Schema.String.check(
  Schema.isMinLength(8),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const KeyEpoch = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export class RemoteProtocolFixtureState extends Schema.Class<RemoteProtocolFixtureState>(
  "RemoteProtocolFixtureState",
)({
  phase: Schema.Literals([
    "unpaired",
    "pairing",
    "active",
    "reconnecting",
    "revoked",
    "lost",
  ]),
  deviceId: Schema.optionalKey(Id),
  runtimeId: Schema.optionalKey(Id),
  sessionId: Schema.optionalKey(Id),
  keyEpoch: KeyEpoch,
  lastReceivedSequence: Sequence,
  interruptedOperationIds: Schema.Array(Id).check(
    Schema.isMaxLength(32),
    Schema.isUnique(),
  ),
}) {}

export type RemoteProtocolFixtureEvent =
  | {
      readonly type: "start-pairing";
      readonly deviceId: string;
      readonly runtimeId: string;
    }
  | { readonly type: "confirm-pairing"; readonly sessionId: string }
  | {
      readonly type: "accept-frame";
      readonly keyEpoch: number;
      readonly sequence: number;
    }
  | { readonly type: "disconnect" }
  | {
      readonly type: "resume";
      readonly sessionId: string;
      readonly keyEpoch: number;
    }
  | { readonly type: "interrupt"; readonly operationId: string }
  | { readonly type: "revoke" }
  | { readonly type: "lose-device" }
  | { readonly type: "recover"; readonly keyEpoch: number };

export class RemoteProtocolFixtureFailure extends Schema.TaggedErrorClass<RemoteProtocolFixtureFailure>()(
  "RemoteProtocolFixtureFailure",
  {
    reason: Schema.Literals([
      "illegal-transition",
      "replay",
      "wrong-key-epoch",
      "revoked",
    ]),
    message: Schema.Literal("The remote protocol fixture rejected the event."),
  },
) {}

const failure = (reason: RemoteProtocolFixtureFailure["reason"]) =>
  RemoteProtocolFixtureFailure.make({
    reason,
    message: "The remote protocol fixture rejected the event.",
  });

const withState = (
  state: RemoteProtocolFixtureState,
  patch: Partial<RemoteProtocolFixtureState>,
) => {
  const next = { ...state, ...patch };
  return RemoteProtocolFixtureState.make({
    phase: next.phase,
    keyEpoch: next.keyEpoch,
    lastReceivedSequence: next.lastReceivedSequence,
    interruptedOperationIds: next.interruptedOperationIds,
    ...(next.deviceId === undefined ? {} : { deviceId: next.deviceId }),
    ...(next.runtimeId === undefined ? {} : { runtimeId: next.runtimeId }),
    ...(next.sessionId === undefined ? {} : { sessionId: next.sessionId }),
  });
};

export const initialRemoteProtocolFixtureState = () =>
  RemoteProtocolFixtureState.make({
    phase: "unpaired",
    keyEpoch: 1,
    lastReceivedSequence: 0,
    interruptedOperationIds: [],
  });

export const advanceRemoteProtocolFixture = (
  state: RemoteProtocolFixtureState,
  event: RemoteProtocolFixtureEvent,
): RemoteProtocolFixtureState | RemoteProtocolFixtureFailure => {
  if (state.phase === "revoked" && event.type !== "recover") {
    return failure("revoked");
  }
  switch (event.type) {
    case "start-pairing":
      return state.phase === "unpaired"
        ? withState(state, {
            phase: "pairing",
            deviceId: event.deviceId,
            runtimeId: event.runtimeId,
          })
        : failure("illegal-transition");
    case "confirm-pairing":
      return state.phase === "pairing"
        ? withState(state, { phase: "active", sessionId: event.sessionId })
        : failure("illegal-transition");
    case "accept-frame":
      if (state.phase !== "active") return failure("illegal-transition");
      if (event.keyEpoch !== state.keyEpoch) return failure("wrong-key-epoch");
      return event.sequence <= state.lastReceivedSequence
        ? failure("replay")
        : withState(state, { lastReceivedSequence: event.sequence });
    case "disconnect":
      return state.phase === "active"
        ? withState(state, { phase: "reconnecting", sessionId: undefined })
        : failure("illegal-transition");
    case "resume":
      if (state.phase !== "reconnecting") return failure("illegal-transition");
      return event.keyEpoch === state.keyEpoch
        ? withState(state, { phase: "active", sessionId: event.sessionId })
        : failure("wrong-key-epoch");
    case "interrupt":
      return state.phase === "active" || state.phase === "reconnecting"
        ? withState(state, {
            interruptedOperationIds: state.interruptedOperationIds.includes(
              event.operationId,
            )
              ? state.interruptedOperationIds
              : [...state.interruptedOperationIds, event.operationId],
          })
        : failure("illegal-transition");
    case "revoke":
      return withState(state, { phase: "revoked", sessionId: undefined });
    case "lose-device":
      return state.phase === "unpaired"
        ? failure("illegal-transition")
        : withState(state, { phase: "lost", sessionId: undefined });
    case "recover":
      return (state.phase === "lost" || state.phase === "revoked") &&
        event.keyEpoch > state.keyEpoch
        ? RemoteProtocolFixtureState.make({
            phase: "unpaired",
            keyEpoch: event.keyEpoch,
            lastReceivedSequence: 0,
            interruptedOperationIds: [],
          })
        : failure("illegal-transition");
  }
};
