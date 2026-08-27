import { getCurrentWindow } from '@tauri-apps/api/window';
import { Effect, Layer, Schema } from 'effect';
import { NativeAccentColor } from '../../shared/native-platform';
import { NativePlatform, nativePlatformUnavailable } from './native-platform';
import { TauriNativeHost } from './tauri-native-host';

export const makeTauriNativePlatformLayer = () =>
	Layer.effect(
		NativePlatform,
		Effect.gen(function* () {
			const host = yield* TauriNativeHost;
			return {
				systemAccentColor: host.invoke('native_system_accent_color').pipe(
					Effect.mapError(() => nativePlatformUnavailable('unavailable')),
					Effect.flatMap((result) =>
						Schema.decodeUnknownEffect(NativeAccentColor, {
							errors: 'all',
							onExcessProperty: 'error'
						})(result).pipe(Effect.mapError(() => nativePlatformUnavailable('invalid-result')))
					)
				),
				startWindowDrag: Effect.tryPromise({
					try: () => getCurrentWindow().startDragging(),
					catch: () => nativePlatformUnavailable('unavailable')
				})
			};
		})
	);
