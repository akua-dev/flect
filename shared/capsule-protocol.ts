import { Effect, Schema, type SchemaAST } from "effect";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const Id = Schema.String.check(
  Schema.isMinLength(9),
  Schema.isMaxLength(100),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);
const Action = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.-]*$/),
);

export class CapsuleReady extends Schema.Class<CapsuleReady>("CapsuleReady")({
  version: Schema.Literal(1),
  type: Schema.Literal("ready"),
}) {}

export class CapsuleResize extends Schema.Class<CapsuleResize>("CapsuleResize")(
  {
    version: Schema.Literal(1),
    type: Schema.Literal("resize"),
    height: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
  },
) {}

export class CapsuleIntent extends Schema.Class<CapsuleIntent>("CapsuleIntent")(
  {
    version: Schema.Literal(1),
    type: Schema.Literal("intent"),
    id: Id,
    action: Action,
    input: Schema.Json,
  },
) {}

export const CapsuleMessage = Schema.Union([
  CapsuleReady,
  CapsuleResize,
  CapsuleIntent,
]);
export type CapsuleMessage = typeof CapsuleMessage.Type;

export class InvalidCapsuleMessage extends Schema.TaggedErrorClass<InvalidCapsuleMessage>()(
  "InvalidCapsuleMessage",
  { message: Schema.Literal("The capsule message is invalid.") },
) {}

const invalid = () =>
  InvalidCapsuleMessage.make({ message: "The capsule message is invalid." });

const encodedSize = (input: unknown) =>
  Effect.try({
    try: () => new TextEncoder().encode(JSON.stringify(input)).byteLength,
    catch: invalid,
  });

const decode = Schema.decodeUnknownEffect(CapsuleMessage, strict);

export const decodeCapsuleMessage = Effect.fn("Flect.Capsule.decodeMessage")(
  (input: unknown) => {
    return encodedSize(input).pipe(
      Effect.filterOrFail((bytes) => bytes <= 64 * 1024, invalid),
      Effect.flatMap(() => decode(input)),
      Effect.mapError(invalid),
    );
  },
);

export class CapsuleVisibility extends Schema.Class<CapsuleVisibility>(
  "CapsuleVisibility",
)({
  version: Schema.Literal(1),
  type: Schema.Literal("visibility"),
  visible: Schema.Boolean,
}) {}

export class CapsuleFocus extends Schema.Class<CapsuleFocus>("CapsuleFocus")({
  version: Schema.Literal(1),
  type: Schema.Literal("focus"),
}) {}

export class CapsuleDispose extends Schema.Class<CapsuleDispose>(
  "CapsuleDispose",
)({
  version: Schema.Literal(1),
  type: Schema.Literal("dispose"),
}) {}

export class CapsuleIntentFailure extends Schema.Class<CapsuleIntentFailure>(
  "CapsuleIntentFailure",
)({
  code: Schema.Literals(["unavailable", "denied", "failed", "invalid-result"]),
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
}) {}

export class CapsuleIntentSucceeded extends Schema.Class<CapsuleIntentSucceeded>(
  "CapsuleIntentSucceeded",
)({
  version: Schema.Literal(1),
  type: Schema.Literal("intent-result"),
  id: Id,
  ok: Schema.Literal(true),
  output: Schema.Json,
}) {}

export class CapsuleIntentFailed extends Schema.Class<CapsuleIntentFailed>(
  "CapsuleIntentFailed",
)({
  version: Schema.Literal(1),
  type: Schema.Literal("intent-result"),
  id: Id,
  ok: Schema.Literal(false),
  error: CapsuleIntentFailure,
}) {}

export const CapsuleIntentOutcome = Schema.Union([
  CapsuleIntentSucceeded,
  CapsuleIntentFailed,
]);
export type CapsuleIntentOutcome = typeof CapsuleIntentOutcome.Type;

export const CapsuleHostMessage = Schema.Union([
  CapsuleVisibility,
  CapsuleFocus,
  CapsuleDispose,
  CapsuleIntentSucceeded,
  CapsuleIntentFailed,
]);
export type CapsuleHostMessage = typeof CapsuleHostMessage.Type;

const decodeHost = Schema.decodeUnknownEffect(CapsuleHostMessage, strict);

export const decodeCapsuleHostMessage = Effect.fn(
  "Flect.Capsule.decodeHostMessage",
)((input: unknown) =>
  encodedSize(input).pipe(
    Effect.filterOrFail((bytes) => bytes <= 64 * 1024, invalid),
    Effect.flatMap(() => decodeHost(input)),
    Effect.mapError(invalid),
  ),
);
