import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import type { BunCommandFailed } from '../../shared/bun-command';
import {
	BunModuleExecution,
	type BunModuleRuntimeRequest,
	type BunWorkspace,
	containsBunServeCall,
	makeBunModuleExecutionTestLayer
} from './bun-module-execution';

const workspace: BunWorkspace = {
	files: {
		'/workspace/package.json':
			'{\n  "name": "fixture",\n  "private": true,\n  "type": "module"\n}\n',
		'/workspace/src/index.ts': 'export const answer: number = 42;\nconsole.log(answer);\n'
	}
};

const operation = {
	cwd: '/workspace',
	args: ['src/index.ts'],
	workspace
} as const;

const executionFailure = {
	_tag: 'BunCommandFailed',
	reason: 'execution',
	message: 'The module failed safely.'
} as BunCommandFailed;

describe('BunModuleExecution', () => {
	it.effect('transforms, runs, builds, and releases a scoped runtime', () =>
		Effect.gen(function* () {
			const releases = yield* Ref.make(0);
			const calls = yield* Ref.make<Array<BunModuleRuntimeRequest>>([]);
			const layer = makeBunModuleExecutionTestLayer((request) =>
				Effect.scoped(
					Effect.acquireRelease(
						Ref.update(calls, (current) => [...current, request]),
						() => Ref.update(releases, (count) => count + 1)
					).pipe(
						Effect.as({
							stdout: '42\n',
							stderr: ''
						})
					)
				)
			);

			const [run, build] = yield* Effect.gen(function* () {
				const execution = yield* BunModuleExecution;
				return [yield* execution.run(operation), yield* execution.build(operation)] as const;
			}).pipe(Effect.provide(layer));

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, '42\n');
			assert.strictEqual(build.result.stdout, '/workspace/.flect-build/src/index.js\n');
			assert.strictEqual(yield* Ref.get(releases), 1);

			const [runtimeRequest] = yield* Ref.get(calls);
			assert.strictEqual(runtimeRequest.entry, '/workspace/.flect-build/src/index.js');
			assert.include(
				runtimeRequest.files['/workspace/.flect-build/src/index.js'] ?? '',
				'const answer = 42'
			);
			assert.notInclude(
				runtimeRequest.files['/workspace/.flect-build/src/index.js'] ?? '',
				': number'
			);
			assert.strictEqual(build.delta.files.length, 1);
			assert.strictEqual(build.delta.files[0]?.operation, 'write');
		})
	);

	it.effect('detects executable Bun.serve forms without matching text', () =>
		Effect.sync(() => {
			assert.isFalse(containsBunServeCall('const text = "Bun.serve";'));
			assert.isFalse(containsBunServeCall('// Bun.serve({ fetch });'));
			assert.isTrue(containsBunServeCall('Bun.serve({ fetch });'));
			assert.isTrue(containsBunServeCall('Bun["serve"]({ fetch });'));
			assert.isTrue(containsBunServeCall('const serve = Bun.serve; serve({ fetch });'));
			assert.isTrue(containsBunServeCall('const { serve: start } = Bun; start({ fetch });'));
		})
	);

	it.effect('rejects CommonJS entry files', () =>
		Effect.gen(function* () {
			const layer = makeBunModuleExecutionTestLayer(() =>
				Effect.succeed({ stdout: '', stderr: '' })
			);
			const error = yield* Effect.gen(function* () {
				const execution = yield* BunModuleExecution;
				return yield* execution.build({
					cwd: '/workspace',
					args: ['index.cjs'],
					workspace: {
						files: {
							'/workspace/package.json': '{"type":"module"}',
							'/workspace/index.cjs': 'module.exports = {};\n'
						}
					}
				});
			}).pipe(Effect.provide(layer), Effect.flip);

			assert.strictEqual(error.reason, 'workspace');
		})
	);

	it.effect('releases the runtime after a guest failure', () =>
		Effect.gen(function* () {
			const releases = yield* Ref.make(0);
			const layer = makeBunModuleExecutionTestLayer(() =>
				Effect.scoped(
					Effect.acquireRelease(Effect.void, () => Ref.update(releases, (count) => count + 1)).pipe(
						Effect.flatMap(() => Effect.fail(executionFailure))
					)
				)
			);

			const error = yield* Effect.gen(function* () {
				const execution = yield* BunModuleExecution;
				return yield* execution.run(operation);
			}).pipe(Effect.provide(layer), Effect.flip);

			assert.strictEqual(error.reason, 'execution');
			assert.strictEqual(yield* Ref.get(releases), 1);
		})
	);

	it.effect('enforces the outer deadline and releases the runtime', () =>
		Effect.gen(function* () {
			const releases = yield* Ref.make(0);
			const started = yield* Deferred.make<undefined>();
			const layer = makeBunModuleExecutionTestLayer(() =>
				Effect.scoped(
					Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
						Ref.update(releases, (count) => count + 1)
					).pipe(Effect.flatMap(() => Effect.never))
				)
			);

			const fiber = yield* Effect.gen(function* () {
				const execution = yield* BunModuleExecution;
				return yield* execution.run(operation);
			}).pipe(Effect.provide(layer), Effect.forkChild);

			yield* Deferred.await(started);
			yield* TestClock.adjust('5 seconds');
			const error = yield* Fiber.join(fiber).pipe(Effect.flip);

			assert.strictEqual(error.reason, 'deadline');
			assert.strictEqual(yield* Ref.get(releases), 1);
		})
	);

	it.effect('stops the active run and waits for runtime release', () =>
		Effect.gen(function* () {
			const releases = yield* Ref.make(0);
			const started = yield* Deferred.make<undefined>();
			const layer = makeBunModuleExecutionTestLayer(() =>
				Effect.scoped(
					Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
						Ref.update(releases, (count) => count + 1)
					).pipe(Effect.flatMap(() => Effect.never))
				)
			);

			const program = Effect.gen(function* () {
				const execution = yield* BunModuleExecution;
				const running = yield* execution.run(operation).pipe(Effect.forkChild);
				yield* Deferred.await(started);
				const stopped = yield* execution.stop();
				const runError = yield* Fiber.join(running).pipe(Effect.flip);
				return { stopped, runError };
			});
			const { stopped, runError } = yield* program.pipe(Effect.provide(layer));

			assert.strictEqual(stopped.exitCode, 0);
			assert.include(stopped.stdout, 'Stopped');
			assert.strictEqual(runError.reason, 'cancelled');
			assert.strictEqual(yield* Ref.get(releases), 1);
		})
	);
});
