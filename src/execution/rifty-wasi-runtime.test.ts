import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { WasiExecutionRequest } from '../../shared/browser-execution';
import { NOOP_WASI_MODULE } from './fixtures/noop-wasi';
import {
	makeRiftyWasiTestLayer,
	makeRiftyWasiWorkerHandle,
	RiftyWasiExecution
} from './rifty-wasi-runtime';

const request = WasiExecutionRequest.make({
	version: 1,
	module: NOOP_WASI_MODULE,
	args: ['flect-test'],
	env: {}
});

describe('RiftyWasiExecution', () => {
	const success = makeRiftyWasiTestLayer({
		run: () =>
			Effect.succeed({
				version: 1,
				exitCode: 0,
				stdout: '',
				stderr: ''
			})
	});

	it.layer(success.layer)((it) => {
		it.effect('returns the exit code and releases the Worker', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyWasiExecution;
				const result = yield* execution.run(request);

				assert.strictEqual(result.exitCode, 0);
				assert.strictEqual(yield* Ref.get(success.releases), 1);
			})
		);
	});

	const malformed = makeRiftyWasiTestLayer({
		run: () => Effect.fail('malformed-response')
	});

	it.layer(malformed.layer)((it) => {
		it.effect('rejects a malformed Worker response', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyWasiExecution;
				const error = yield* execution.run(request).pipe(Effect.flip);

				assert.strictEqual(error.reason, 'invalid-result');
				assert.strictEqual(yield* Ref.get(malformed.releases), 1);
			})
		);
	});

	const stalled = makeRiftyWasiTestLayer({
		run: () => Effect.never
	});

	it.layer(stalled.layer)((it) => {
		it.effect('terminates at the deadline', () =>
			Effect.gen(function* () {
				const execution = yield* RiftyWasiExecution;
				const fiber = yield* execution.run(request).pipe(Effect.forkChild);
				yield* TestClock.adjust('2 seconds');
				const error = yield* Fiber.join(fiber).pipe(Effect.flip);

				assert.strictEqual(error.reason, 'deadline');
				assert.strictEqual(yield* Ref.get(stalled.releases), 1);
			})
		);
	});

	it.effect('maps a synchronous postMessage failure to worker failure', () => {
		const worker = {
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			postMessage: () => {
				throw new DOMException('Could not clone', 'DataCloneError');
			}
		} satisfies Pick<Worker, 'addEventListener' | 'removeEventListener' | 'postMessage'>;

		return Effect.gen(function* () {
			const error = yield* makeRiftyWasiWorkerHandle(worker).run(request).pipe(Effect.flip);
			assert.strictEqual(error.reason, 'worker');
		});
	});
});
