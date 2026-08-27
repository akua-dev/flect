import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { ShellPreferencesValue } from './shell-preferences';

const decode = Schema.decodeUnknownEffect(ShellPreferencesValue, {
	errors: 'all',
	onExcessProperty: 'error'
});

describe('ShellPreferencesValue', () => {
	it.effect('decodes a bounded versioned preference value', () =>
		Effect.gen(function* () {
			const value = yield* decode({
				version: 1,
				railWidth: 440,
				railCollapsed: false,
				modelFavorites: ['openai-codex/gpt-5.6']
			});

			expect(value).toEqual(
				ShellPreferencesValue.make({
					version: 1,
					railWidth: 440,
					railCollapsed: false,
					modelFavorites: ['openai-codex/gpt-5.6']
				})
			);
		})
	);

	it.effect('rejects invalid widths, excess fields, and oversized favorites', () =>
		Effect.gen(function* () {
			const base = {
				version: 1,
				railCollapsed: false,
				modelFavorites: []
			};

			yield* decode({ ...base, railWidth: 339 }).pipe(Effect.flip);
			yield* decode({ ...base, railWidth: 521 }).pipe(Effect.flip);
			yield* decode({ ...base, railWidth: 400, credential: 'secret' }).pipe(Effect.flip);
			yield* decode({
				...base,
				railWidth: 400,
				modelFavorites: Array.from({ length: 25 }, (_, index) => `${index}`)
			}).pipe(Effect.flip);
		})
	);
});
