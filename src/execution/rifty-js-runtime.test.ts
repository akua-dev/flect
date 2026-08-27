import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { JavaScriptExecutionRequest } from '../../shared/browser-execution';
import { makeRiftyJavaScriptTestLayer, RiftyJavaScriptExecution } from './rifty-js-runtime';

const request = JavaScriptExecutionRequest.make({
	version: 1,
	source: '40 + 2'
});

describe('RiftyJavaScriptExecution', () => {
	const success = makeRiftyJavaScriptTestLayer({
		evaluate: () => Effect.succeed({ ok: true, value: 42 }),
		stdout: ['answer\n'],
		stderr: []
	});

	it.layer(success.layer)((it) => {
		it.effect('normalizes output and releases the Worker', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyJavaScriptExecution;
				const result = yield* execution.evaluate(request);
				const releases = yield* Ref.get(success.releases);

				assert.strictEqual(result.value, 42);
				assert.strictEqual(result.stdout, 'answer\n');
				assert.strictEqual(result.stderr, '');
				assert.strictEqual(releases, 1);
			})
		);
	});

	const writtenFiles = Ref.makeUnsafe<
		Array<{
			readonly path: string;
			readonly source: string | Uint8Array;
		}>
	>([]);
	const moduleRuntime = makeRiftyJavaScriptTestLayer({
		evaluate: (source, cwd) =>
			Effect.sync(() => {
				assert.include(source, '__riftyImport');
				assert.include(source, '/workspace/.flect-build/src/index.js');
				assert.strictEqual(cwd, '/workspace');
				return { ok: true as const, value: undefined };
			}),
		writeFile: (path, source) => Ref.update(writtenFiles, (files) => [...files, { path, source }]),
		stdout: ['42\n'],
		stderr: []
	});

	it.layer(moduleRuntime.layer)((it) => {
		it.effect('writes and imports a disposable module fixture', () =>
			Effect.gen(function* () {
				yield* Ref.set(writtenFiles, []);
				const execution = yield* RiftyJavaScriptExecution;
				const output = yield* execution.runModule({
					files: {
						'/workspace/.flect-build/src/index.js': 'console.log(42);\n'
					},
					entry: '/workspace/.flect-build/src/index.js',
					cwd: '/workspace',
					args: []
				});

				assert.strictEqual(output.stdout, '42\n');
				assert.deepStrictEqual(yield* Ref.get(writtenFiles), [
					{
						path: '/workspace/.flect-build/src/index.js',
						source: 'console.log(42);\n'
					}
				]);
				assert.strictEqual(yield* Ref.get(moduleRuntime.releases), 1);
			})
		);
	});

	const rejected = makeRiftyJavaScriptTestLayer({
		evaluate: () =>
			Effect.succeed({
				ok: false,
				message: 'foreign stack and source must stay private'
			}),
		stdout: [],
		stderr: []
	});

	it.layer(rejected.layer)((it) => {
		it.effect('maps a guest failure to the stable public error', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyJavaScriptExecution;
				const error = yield* execution.evaluate(request).pipe(Effect.flip);
				const releases = yield* Ref.get(rejected.releases);

				assert.strictEqual(error._tag, 'BrowserExecutionFailed');
				assert.strictEqual(error.operation, 'javascript');
				assert.strictEqual(error.reason, 'execution');
				assert.notInclude(error.message, 'foreign stack');
				assert.strictEqual(releases, 1);
			})
		);
	});

	const stalled = makeRiftyJavaScriptTestLayer({
		evaluate: () => Effect.never,
		stdout: [],
		stderr: []
	});

	it.layer(stalled.layer)((it) => {
		it.effect('interrupts at the outer deadline and releases the Worker', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyJavaScriptExecution;
				const fiber = yield* execution.evaluate(request).pipe(Effect.forkChild);

				yield* TestClock.adjust('2 seconds');
				const error = yield* Fiber.join(fiber).pipe(Effect.flip);
				const releases = yield* Ref.get(stalled.releases);

				assert.strictEqual(error.reason, 'deadline');
				assert.strictEqual(releases, 1);
			})
		);
	});
});
