import { assert, describe, it } from '@effect/vitest';
import { Effect, Ref } from 'effect';
import {
	type BunCommandFailed,
	BunCommandRequest,
	BunCommandResult
} from '../../shared/bun-command';
import { BunCommand, type BunOperationCall, makeBunCommandTestLayer } from './bun-command';

const request = (...argv: ReadonlyArray<string>) =>
	BunCommandRequest.make({
		version: 1,
		argv,
		cwd: '/workspace'
	});

const successfulResult = BunCommandResult.make({
	version: 1,
	exitCode: 0,
	stdout: 'ok\n',
	stderr: ''
});

describe('BunCommand', () => {
	const calls = Ref.makeUnsafe<Array<BunOperationCall>>([]);
	const layer = makeBunCommandTestLayer((call) =>
		Ref.update(calls, (current) => [...current, call]).pipe(Effect.as(successfulResult))
	);

	it.layer(layer)((it) => {
		it.effect('routes the supported surface and aliases exactly once', () =>
			Effect.gen(function* () {
				yield* Ref.set(calls, []);
				const command = yield* BunCommand;

				for (const argv of [
					['run', 'src/index.ts'],
					['build', 'src/index.ts'],
					['install'],
					['i'],
					['add', 'flect-fixture@1.0.0'],
					['remove', 'flect-fixture'],
					['rm', 'flect-fixture'],
					['stop'],
					['src/index.ts']
				]) {
					const result = yield* command.execute(request(...argv));
					assert.strictEqual(result.exitCode, 0);
				}

				assert.deepStrictEqual(yield* Ref.get(calls), [
					{
						operation: 'run',
						args: ['src/index.ts'],
						cwd: '/workspace'
					},
					{
						operation: 'build',
						args: ['src/index.ts'],
						cwd: '/workspace'
					},
					{ operation: 'install', args: [], cwd: '/workspace' },
					{ operation: 'install', args: [], cwd: '/workspace' },
					{
						operation: 'add',
						args: ['flect-fixture@1.0.0'],
						cwd: '/workspace'
					},
					{
						operation: 'remove',
						args: ['flect-fixture'],
						cwd: '/workspace'
					},
					{
						operation: 'remove',
						args: ['flect-fixture'],
						cwd: '/workspace'
					},
					{ operation: 'stop', args: [], cwd: '/workspace' },
					{
						operation: 'run',
						args: ['src/index.ts'],
						cwd: '/workspace'
					}
				]);
			})
		);

		it.effect('returns stable help, version, and unsupported output', () =>
			Effect.gen(function* () {
				yield* Ref.set(calls, []);
				const command = yield* BunCommand;

				const help = yield* command.execute(request('--help'));
				const version = yield* command.execute(request('--version'));
				assert.strictEqual(help.exitCode, 0);
				assert.include(help.stdout, 'flect-browser');
				assert.include(help.stdout, 'run');
				assert.include(help.stdout, 'transpiler: compatible');
				assert.strictEqual(version.stdout, 'flect-browser/1\n');

				for (const name of ['test', 'x', 'publish', 'repl', 'wat']) {
					const result = yield* command.execute(request(name));
					assert.strictEqual(result.exitCode, 1);
					assert.include(result.stderr, 'unsupported');
					assert.include(result.stderr, name);
				}
				const option = yield* command.execute(request('--smol'));
				assert.strictEqual(option.exitCode, 1);
				assert.include(option.stderr, 'unsupported');
				assert.deepStrictEqual(yield* Ref.get(calls), []);
			})
		);
	});

	it.effect('redacts adapter defects from the public failure', () =>
		Effect.gen(function* () {
			const defectLayer = makeBunCommandTestLayer(() =>
				Effect.die(new Error('foreign stack /workspace/private.ts registry-secret-token'))
			);
			const error = yield* Effect.gen(function* () {
				const command = yield* BunCommand;
				return yield* command.execute(request('run', 'src/index.ts'));
			}).pipe(Effect.provide(defectLayer), Effect.flip);

			assert.strictEqual(error._tag, 'BunCommandFailed');
			assert.strictEqual(error.reason, 'execution');
			assert.notInclude(error.message, 'private.ts');
			assert.notInclude(error.message, 'registry-secret-token');
		})
	);

	it.effect('preserves already-sanitized typed failures', () =>
		Effect.gen(function* () {
			const expected = {
				_tag: 'BunCommandFailed',
				reason: 'workspace',
				message: 'The disposable workspace is unavailable.'
			} as BunCommandFailed;
			const failureLayer = makeBunCommandTestLayer(() => Effect.fail(expected));
			const error = yield* Effect.gen(function* () {
				const command = yield* BunCommand;
				return yield* command.execute(request('run', 'src/index.ts'));
			}).pipe(Effect.provide(failureLayer), Effect.flip);

			assert.deepStrictEqual(error, expected);
		})
	);
});
