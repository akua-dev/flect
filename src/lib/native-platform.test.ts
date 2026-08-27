import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Result } from 'effect';
import { FlectUnavailableError } from './api';
import { NativePlatform, NativePlatformUnavailableLive } from './native-platform';
import { TauriNativeHost } from './tauri-native-host';
import { makeTauriNativePlatformLayer } from './tauri-native-platform';

const readAccent = Effect.flatMap(NativePlatform, (platform) => platform.systemAccentColor);

describe('NativePlatform', () => {
	it.effect('returns typed unavailability in a browser', () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(readAccent);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'unavailable');
			}
		}).pipe(Effect.provide(NativePlatformUnavailableLive))
	);

	it.effect('decodes the bounded native accent result', () => {
		const host = Layer.succeed(TauriNativeHost)({
			invoke: () =>
				Effect.succeed({
					version: 1,
					platform: 'macos',
					css: '#0A84FF',
					contrastText: '#000000'
				})
		});
		return Effect.gen(function* () {
			const accent = yield* readAccent;
			assert.strictEqual(accent.css, '#0A84FF');
			assert.strictEqual(accent.platform, 'macos');
		}).pipe(Effect.provide(makeTauriNativePlatformLayer().pipe(Layer.provide(host))));
	});

	it.effect('rejects malformed native output', () => {
		const host = Layer.succeed(TauriNativeHost)({
			invoke: () => Effect.succeed({ css: 'blue' })
		});
		return Effect.gen(function* () {
			const result = yield* Effect.result(readAccent);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'invalid-result');
			}
		}).pipe(Effect.provide(makeTauriNativePlatformLayer().pipe(Layer.provide(host))));
	});

	it.effect('does not expose native transport failures', () => {
		const host = Layer.succeed(TauriNativeHost)({
			invoke: () =>
				Effect.fail(
					FlectUnavailableError.make({
						message: 'The local Flect runtime is unavailable.'
					})
				)
		});
		return Effect.gen(function* () {
			const result = yield* Effect.result(readAccent);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'unavailable');
			}
		}).pipe(Effect.provide(makeTauriNativePlatformLayer().pipe(Layer.provide(host))));
	});
});
