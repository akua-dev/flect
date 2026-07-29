import { Effect, Schema } from "effect";

const DisplayText = (maximum: number) =>
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(maximum));

export class InterfaceDocument extends Schema.Class<InterfaceDocument>(
  "InterfaceDocument",
)({
  version: Schema.Literal(1),
  headline: DisplayText(80),
  placeholder: DisplayText(120),
  secondaryActions: Schema.Array(
    Schema.Literals(["open", "extensions", "connect"]),
  ).check(Schema.isMaxLength(3)),
}) {}

export const defaultInterfaceDocument: InterfaceDocument = Object.freeze(
  new InterfaceDocument({
    version: 1,
    headline: "What should we shape?",
    placeholder: "Build, change, or connect anything",
    secondaryActions: ["open", "extensions", "connect"],
  }),
);

const decodeDocument = Schema.decodeUnknownEffect(InterfaceDocument, {
  errors: "all",
  onExcessProperty: "error",
});

export const decodeInterfaceDocument = Effect.fn(
  "Flect.InterfaceDocument.decode",
)(function* (raw: string | null | undefined) {
  if (raw === null || raw === undefined) {
    return defaultInterfaceDocument;
  }

  const decoded = Effect.try({
    try: () => JSON.parse(raw),
    catch: () => undefined,
  }).pipe(
    Effect.flatMap((input) => decodeDocument(input)),
    Effect.orElseSucceed(() => defaultInterfaceDocument),
  );

  return yield* decoded;
});
