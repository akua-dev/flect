import { Context, Effect, Layer } from "effect";
import {
  type NativeAccentColor,
  NativePlatformCapabilityFailure,
} from "../../shared/native-platform";

export const nativePlatformUnavailable = (
  reason: NativePlatformCapabilityFailure["reason"],
) =>
  NativePlatformCapabilityFailure.make({
    reason,
    message: "The native platform capability is unavailable.",
  });

export interface NativePlatformShape {
  readonly systemAccentColor: Effect.Effect<
    NativeAccentColor,
    NativePlatformCapabilityFailure
  >;
  readonly startWindowDrag: Effect.Effect<
    void,
    NativePlatformCapabilityFailure
  >;
}

export class NativePlatform extends Context.Service<
  NativePlatform,
  NativePlatformShape
>()("flect/NativePlatform") {}

export const NativePlatformUnavailableLive = Layer.succeed(NativePlatform)({
  systemAccentColor: Effect.fail(nativePlatformUnavailable("unavailable")),
  startWindowDrag: Effect.fail(nativePlatformUnavailable("unavailable")),
});
