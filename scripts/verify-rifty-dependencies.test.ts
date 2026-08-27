import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
	makeVerifyRiftyDependencies,
	RIFTY_DEPENDENCIES,
	verifyRiftyDependencies
} from './verify-rifty-dependencies';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);

describe('Rifty dependency pins', () => {
	it.effect('accepts the four exact published artifacts', () =>
		Effect.gen(function* () {
			const verified = yield* verifyRiftyDependencies;

			assert.deepStrictEqual(
				verified.map((entry) => entry.name),
				[...RIFTY_DEPENDENCIES]
			);
			assert.isTrue(verified.every((entry) => entry.version === '0.2.0'));
			assert.isTrue(verified.every((entry) => entry.license === 'MIT'));
		}).pipe(Effect.provide(platform))
	);

	it.effect('rejects an artifact outside the exact approved pin', () =>
		Effect.gen(function* () {
			const error = yield* makeVerifyRiftyDependencies(() =>
				Effect.succeed({
					name: '@riftydev/vfs',
					version: '0.2.1',
					license: 'MIT',
					repository: {
						type: 'git',
						url: 'git+https://github.com/vanilla-wave/rifty.git'
					}
				})
			).pipe(Effect.flip);

			assert.strictEqual(error._tag, 'RiftyDependencyVerificationFailed');
			assert.notInclude(error.message, '0.2.1');
		}).pipe(Effect.provide(platform))
	);
});
