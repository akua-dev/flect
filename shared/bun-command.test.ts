import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema, type SchemaAST } from 'effect';
import { BunCommandRequest, BunCommandResult, BunCompatibility } from './bun-command';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const decodeRequest = Schema.decodeUnknownEffect(BunCommandRequest, strict);
const decodeResult = Schema.decodeUnknownEffect(BunCommandResult, strict);

const expectRejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.match({
			onFailure: () => Effect.void,
			onSuccess: () => Effect.die('invalid value was accepted')
		})
	);

describe('Bun command contracts', () => {
	it.effect('round-trips a command request and compatibility report', () =>
		Effect.gen(function* () {
			const run = yield* decodeRequest({
				version: 1,
				argv: ['run', 'src/index.ts'],
				cwd: '/workspace'
			});
			const compatibility = BunCompatibility.make({
				version: 1,
				implementation: 'flect-browser',
				transpiler: 'compatible',
				commands: ['run', 'build', 'install', 'add', 'remove', 'stop']
			});

			assert.deepStrictEqual(run.argv, ['run', 'src/index.ts']);
			assert.strictEqual(compatibility.implementation, 'flect-browser');
		})
	);

	it.effect('rejects excess properties and invalid argument bounds', () =>
		Effect.gen(function* () {
			yield* expectRejected(
				decodeRequest({
					version: 1,
					argv: ['run'],
					cwd: '/workspace',
					unexpected: true
				})
			);
			yield* expectRejected(decodeRequest({ version: 1, argv: [], cwd: '/workspace' }));
			yield* expectRejected(
				decodeRequest({
					version: 1,
					argv: Array.from({ length: 129 }, () => 'run'),
					cwd: '/workspace'
				})
			);
			yield* expectRejected(
				decodeRequest({
					version: 1,
					argv: ['x'.repeat(4_097)],
					cwd: '/workspace'
				})
			);
		})
	);

	it.effect('rejects cwd traversal and oversized output', () =>
		Effect.gen(function* () {
			for (const cwd of ['/', '/tmp', '/workspace/../secret']) {
				yield* expectRejected(decodeRequest({ version: 1, argv: ['run'], cwd }));
			}
			yield* expectRejected(
				decodeResult({
					version: 1,
					exitCode: 0,
					stdout: 'x'.repeat(1_048_577),
					stderr: ''
				})
			);
		})
	);
});
