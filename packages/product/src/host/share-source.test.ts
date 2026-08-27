import { assert, describe, it } from '@effect/vitest';
import { Cause, Effect, Result } from 'effect';
import { SharePrivateSource } from '../share.js';
import { makePrivateShareSourcesLayer, PrivateShareSources } from './share-source.js';

describe('@flect/product private share sources', () => {
	it.effect('keeps callback credentials private and sanitizes defects', () =>
		Effect.gen(function* () {
			const sources = yield* PrivateShareSources;
			const available = yield* sources.list;
			assert.deepStrictEqual(
				available.map((source) => ({ id: source.id, name: source.name })),
				[{ id: 'company-share', name: 'Company share' }]
			);

			const result = yield* sources
				.open(
					SharePrivateSource.make({
						_tag: 'private',
						adapterId: 'company-share',
						reference: 'workbench/1.0.0'
					})
				)
				.pipe(Effect.result);

			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'adapter');
				assert.strictEqual(result.failure.message, 'The private share source could not be opened.');
				assert.notInclude(JSON.stringify(result.failure), 'private-company-token');
			}
		}).pipe(
			Effect.provide(
				makePrivateShareSourcesLayer({
					sources: [
						{
							id: 'company-share',
							name: 'Company share',
							open: () => Effect.failCause(Cause.die(new Error('private-company-token')))
						}
					]
				})
			)
		)
	);

	it.effect('rejects duplicate adapter IDs and unknown adapters', () =>
		Effect.gen(function* () {
			const duplicate = yield* Effect.scoped(
				Effect.gen(function* () {
					return yield* PrivateShareSources;
				}).pipe(
					Effect.provide(
						makePrivateShareSourcesLayer({
							sources: [
								{
									id: 'company-share',
									name: 'Company share',
									open: () => Effect.succeed(new Uint8Array())
								},
								{
									id: 'company-share',
									name: 'Duplicate',
									open: () => Effect.succeed(new Uint8Array())
								}
							]
						})
					),
					Effect.result
				)
			);
			assert.isTrue(Result.isFailure(duplicate));

			const sources = yield* PrivateShareSources;
			const missing = yield* sources
				.open(
					SharePrivateSource.make({
						_tag: 'private',
						adapterId: 'missing-share',
						reference: 'workbench/1.0.0'
					})
				)
				.pipe(Effect.result);
			assert.isTrue(Result.isFailure(missing));
			if (Result.isFailure(missing)) {
				assert.strictEqual(missing.failure.reason, 'missing-adapter');
			}
		}).pipe(Effect.provide(makePrivateShareSourcesLayer({ sources: [] })))
	);
});
