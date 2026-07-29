import { Effect, Schema, type SchemaAST } from "effect";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const IdentifierText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);

export const ExtensionCapability = Schema.Literals([
  "interface:read",
  "interface:propose",
]);
export type ExtensionCapability = typeof ExtensionCapability.Type;

export class ExtensionManifest extends Schema.Class<ExtensionManifest>(
  "ExtensionManifest",
)({
  version: Schema.Literal(1),
  id: IdentifierText,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  source: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256 * 1024),
  ),
  capabilities: Schema.Array(ExtensionCapability).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2),
  ),
}) {}

export class InvalidExtensionManifest extends Schema.TaggedErrorClass<InvalidExtensionManifest>()(
  "InvalidExtensionManifest",
  {
    message: Schema.Literal("The extension manifest is invalid."),
  },
) {}

const invalidManifest = () =>
  InvalidExtensionManifest.make({
    message: "The extension manifest is invalid.",
  });

export const validateExtensionManifest = Effect.fn(
  "Flect.ExtensionManifest.validate",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    ExtensionManifest,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidManifest)),
);
