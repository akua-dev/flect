import { Schema } from "effect";

export class ShellPreferencesValue extends Schema.Class<ShellPreferencesValue>(
  "ShellPreferencesValue",
)({
  version: Schema.Literal(1),
  railWidth: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 340, maximum: 520 }),
  ),
  railCollapsed: Schema.Boolean,
  modelFavorites: Schema.Array(Schema.String).check(Schema.isMaxLength(24)),
}) {}
