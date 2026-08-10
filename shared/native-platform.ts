import { Schema } from "effect";

export class NativeAccentColor extends Schema.Class<NativeAccentColor>(
  "NativeAccentColor",
)({
  version: Schema.Literal(1),
  platform: Schema.Literal("macos"),
  css: Schema.String.check(Schema.isPattern(/^#[0-9A-F]{6}$/)),
  contrastText: Schema.Literals(["#000000", "#FFFFFF"]),
}) {}

export class NativePlatformCapabilityFailure extends Schema.TaggedErrorClass<NativePlatformCapabilityFailure>()(
  "NativePlatformCapabilityFailure",
  {
    reason: Schema.Literals(["unavailable", "denied", "invalid-result"]),
    message: Schema.Literal("The native platform capability is unavailable."),
  },
) {}
