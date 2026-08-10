import { Context, Effect, Layer, Schema } from "effect";
import {
  NativeAccentColor,
  NativePlatformCapabilityFailure,
} from "../../shared/native-platform";
import { TauriNativeHost } from "./tauri-native-host";

const unavailable = (reason: NativePlatformCapabilityFailure["reason"]) =>
  NativePlatformCapabilityFailure.make({
    reason,
    message: "The native platform capability is unavailable.",
  });

export interface NativePlatformShape {
  readonly systemAccentColor: Effect.Effect<
    NativeAccentColor,
    NativePlatformCapabilityFailure
  >;
}

export class NativePlatform extends Context.Service<
  NativePlatform,
  NativePlatformShape
>()("flect/NativePlatform") {}

export const NativePlatformUnavailableLive = Layer.succeed(NativePlatform)({
  systemAccentColor: Effect.fail(unavailable("unavailable")),
});

export const makeTauriNativePlatformLayer = () =>
  Layer.effect(
    NativePlatform,
    Effect.gen(function* () {
      const host = yield* TauriNativeHost;
      return {
        systemAccentColor: host.invoke("native_system_accent_color").pipe(
          Effect.mapError(() => unavailable("unavailable")),
          Effect.flatMap((result) =>
            Schema.decodeUnknownEffect(NativeAccentColor, {
              errors: "all",
              onExcessProperty: "error",
            })(result).pipe(
              Effect.mapError(() => unavailable("invalid-result")),
            ),
          ),
        ),
      };
    }),
  );
