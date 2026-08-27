import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import {
	type GitWorkspaceLockManager,
	type GitWorkspaceWorker,
	makeGitWorkspace
} from './git-workspace';

class HangingWorker implements GitWorkspaceWorker {
	terminated = false;

	addEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}

	removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}

	postMessage(_message: unknown) {}

	terminate() {
		this.terminated = true;
	}
}

class RespondingWorker implements GitWorkspaceWorker {
	terminated = false;
	private readonly messageListeners = new Set<EventListenerOrEventListenerObject>();

	addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		if (type === 'message') this.messageListeners.add(listener);
	}

	removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		if (type === 'message') this.messageListeners.delete(listener);
	}

	postMessage(message: unknown) {
		const requestId: unknown =
			typeof message === 'object' && message !== null ? Reflect.get(message, 'id') : undefined;
		if (typeof requestId !== 'string') {
			throw new Error('Expected a git-workspace worker request with a string id.');
		}
		const event = new MessageEvent('message', {
			data: {
				type: 'success',
				id: requestId,
				result: { type: 'opened', variant: 'asyncify', existed: true }
			}
		});
		queueMicrotask(() => {
			for (const listener of this.messageListeners) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
	}

	terminate() {
		this.terminated = true;
	}
}

describe('GitWorkspace worker lifecycle', () => {
	it.effect('recycles the Wasm worker before long sessions exhaust it', () =>
		Effect.gen(function* () {
			const workers: Array<RespondingWorker> = [];
			const git = yield* makeGitWorkspace({
				maxWorkerOperations: 2,
				lockManager: {
					request: async <A>(
						_name: string,
						_options: LockOptions,
						callback: (lock: Lock | null) => Promise<A>
					): Promise<Awaited<A>> => await callback(null)
				},
				makeWorker: () => {
					const worker = new RespondingWorker();
					workers.push(worker);
					return worker;
				}
			});

			yield* git.open({ workspaceId: 'rotation' });
			yield* git.open({ workspaceId: 'rotation' });
			assert.strictEqual(workers.length, 1);
			assert.isTrue(workers[0]?.terminated === true);

			yield* git.open({ workspaceId: 'rotation' });
			assert.strictEqual(workers.length, 2);
			assert.isFalse(workers[1]?.terminated === true);
		})
	);

	it.effect('never hands a queued concurrent request a recycled worker', () =>
		Effect.gen(function* () {
			const workers: Array<RespondingWorker> = [];
			const git = yield* makeGitWorkspace({
				maxWorkerOperations: 1,
				lockManager: {
					request: async <A>(
						_name: string,
						_options: LockOptions,
						callback: (lock: Lock | null) => Promise<A>
					): Promise<Awaited<A>> => await callback(null)
				},
				makeWorker: () => {
					const worker = new RespondingWorker();
					workers.push(worker);
					return worker;
				}
			});

			yield* Effect.all(
				[git.open({ workspaceId: 'rotation' }), git.open({ workspaceId: 'rotation' })],
				{ concurrency: 'unbounded' }
			);

			assert.strictEqual(workers.length, 2);
			assert.isTrue(workers.every((worker) => worker.terminated));
		})
	);

	it.effect('terminates before releasing the lock after a timeout', () =>
		Effect.gen(function* () {
			const workers: Array<HangingWorker> = [];
			let lockReleasedAfterTermination = false;
			const lockManager: GitWorkspaceLockManager = {
				request: async <A>(
					_name: string,
					_options: LockOptions,
					callback: (lock: Lock | null) => Promise<A>
				): Promise<Awaited<A>> => {
					try {
						return await callback(null);
					} finally {
						lockReleasedAfterTermination = workers[0]?.terminated === true;
					}
				}
			};
			const git = yield* makeGitWorkspace({
				deadline: '1 millis',
				lockManager,
				makeWorker: () => {
					const worker = new HangingWorker();
					workers.push(worker);
					return worker;
				}
			});

			const first = yield* git.open({ workspaceId: 'default' }).pipe(Effect.forkChild);
			yield* TestClock.adjust('1 second');
			const firstError = yield* Fiber.join(first).pipe(Effect.flip);

			assert.strictEqual(firstError.reason, 'interrupted');
			assert.strictEqual(workers.length, 1);
			assert.isTrue(workers[0]?.terminated === true);
			assert.isTrue(lockReleasedAfterTermination);

			const second = yield* git.open({ workspaceId: 'default' }).pipe(Effect.forkChild);
			yield* TestClock.adjust('1 second');
			yield* Fiber.join(second).pipe(Effect.flip);

			assert.strictEqual(workers.length, 2);
			assert.isTrue(workers[1]?.terminated === true);
		})
	);
});
