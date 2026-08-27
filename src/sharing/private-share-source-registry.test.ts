import { assert, describe, it } from '@effect/vitest';
import { Cause, Effect } from 'effect';
import { SharePrivateSource } from '../../packages/product/src/share';
import {
	makePrivateShareSourceRegistryLayer,
	PrivateShareSourceRegistry,
	PrivateShareSourceRegistryLive
} from './private-share-source-registry';

describe('private share source registry', () => {
	it.effect('loads host-composed adapters before the interface starts', () =>
		Effect.gen(function* () {
			const registry = yield* PrivateShareSourceRegistry;
			assert.deepStrictEqual(
				(yield* registry.list).map((source) => source.id),
				['host-library']
			);
			const bytes = yield* registry.open(
				SharePrivateSource.make({
					_tag: 'private',
					adapterId: 'host-library',
					reference: 'weather/team'
				})
			);
			assert.strictEqual(new TextDecoder().decode(bytes), 'weather/team');
		}).pipe(
			Effect.provide(
				makePrivateShareSourceRegistryLayer({
					sources: [
						{
							id: 'host-library',
							name: 'Host library',
							open: (reference) => Effect.succeed(new TextEncoder().encode(reference))
						}
					]
				})
			)
		)
	);

	it.effect('registers trusted closures without exposing credentials', () =>
		Effect.gen(function* () {
			const registry = yield* PrivateShareSourceRegistry;
			yield* registry.register({
				id: 'company-share',
				name: 'Company share',
				open: (reference) =>
					Effect.succeed(new TextEncoder().encode(`archive:${reference}:private-token`))
			});
			const available = yield* registry.list;
			assert.deepStrictEqual(
				available.map((source) => ({ id: source.id, name: source.name })),
				[{ id: 'company-share', name: 'Company share' }]
			);
			assert.notInclude(JSON.stringify(available), 'private-token');
			const bytes = yield* registry.open(
				SharePrivateSource.make({
					_tag: 'private',
					adapterId: 'company-share',
					reference: 'card/1.0.0'
				})
			);
			assert.include(new TextDecoder().decode(bytes), 'card/1.0.0');
		}).pipe(Effect.provide(PrivateShareSourceRegistryLive))
	);

	it.effect('rejects duplicate, missing, invalid, and defective adapters safely', () =>
		Effect.gen(function* () {
			const registry = yield* PrivateShareSourceRegistry;
			yield* registry.register({
				id: 'company-share',
				name: 'Company share',
				open: () => Effect.failCause(Cause.die(new Error('private-company-token')))
			});
			const duplicate = yield* registry
				.register({
					id: 'company-share',
					name: 'Duplicate',
					open: () => Effect.succeed(new Uint8Array())
				})
				.pipe(Effect.flip);
			const missing = yield* registry
				.open(
					SharePrivateSource.make({
						_tag: 'private',
						adapterId: 'missing',
						reference: 'card'
					})
				)
				.pipe(Effect.flip);
			const defective = yield* registry
				.open(
					SharePrivateSource.make({
						_tag: 'private',
						adapterId: 'company-share',
						reference: 'card'
					})
				)
				.pipe(Effect.flip);

			for (const result of [duplicate, missing, defective]) {
				assert.notInclude(JSON.stringify(result), 'private-company-token');
			}
		}).pipe(Effect.provide(PrivateShareSourceRegistryLive))
	);
});
