import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber, Layer } from 'effect';
import {
	BrowserBuildArtifact,
	BrowserBuildFailureFrame,
	BrowserBuildRequest,
	BrowserBuildWorkerFailure,
	BrowserBuildWorkerSuccess
} from '../../shared/browser-build';
import { BrowserBuild, type BrowserBuildWorker, makeBrowserBuildLayer } from './browser-build';
import { BrowserBuildStore } from './browser-build-store';

const encoder = new TextEncoder();
const digest = 'a'.repeat(64);
const request = BrowserBuildRequest.make({
	version: 1,
	buildId: 'build-test-1',
	sourceRevision: 'flect/proposal/test',
	entrypoint: 'src/main.tsx',
	files: [
		{
			path: 'src/main.tsx',
			contents: encoder.encode("document.body.textContent = 'ready';")
		}
	]
});

class FakeWorker implements BrowserBuildWorker {
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	terminated = false;

	constructor(
		readonly response: BrowserBuildWorkerSuccess | BrowserBuildWorkerFailure | 'pending'
	) {}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message: unknown) {
		const response = this.response;
		if (response === 'pending') {
			return;
		}
		if (
			typeof message !== 'object' ||
			message === null ||
			!('id' in message) ||
			typeof message.id !== 'string'
		) {
			throw new TypeError('The fake Worker received an invalid request.');
		}
		queueMicrotask(() => {
			const event = new MessageEvent('message', {
				data: { ...response, id: message.id }
			});
			for (const listener of this.listeners.get('message') ?? []) {
				if (typeof listener === 'function') {
					listener(event);
				} else {
					listener.handleEvent(event);
				}
			}
		});
	}

	terminate() {
		this.terminated = true;
	}
}

const artifact = BrowserBuildArtifact.make({
	version: 1,
	buildId: request.buildId,
	sourceRevision: request.sourceRevision,
	inputDigest: digest,
	artifactDigest: 'b'.repeat(64),
	outputs: [
		{
			path: 'app.js',
			kind: 'chunk',
			contents: encoder.encode("document.body.textContent = 'ready';")
		}
	]
});

const storeLayer = Layer.succeed(BrowserBuildStore)({
	load: Effect.succeed(undefined),
	save: () => Effect.void
});

describe('BrowserBuild', () => {
	it.effect('retains the last successful artifact after a later build fails', () =>
		Effect.gen(function* () {
			const workers = [
				new FakeWorker(
					BrowserBuildWorkerSuccess.make({
						type: 'success',
						id: 'request-placeholder',
						artifact
					})
				),
				new FakeWorker(
					BrowserBuildWorkerFailure.make({
						type: 'failure',
						id: 'request-placeholder',
						error: BrowserBuildFailureFrame.make({
							buildId: request.buildId,
							reason: 'compile',
							message: 'The source did not compile.'
						})
					})
				)
			];
			const layer = makeBrowserBuildLayer({
				makeWorker: () => workers.shift() as FakeWorker,
				crossOriginIsolated: () => true
			}).pipe(Layer.provideMerge(storeLayer));

			const result = yield* Effect.gen(function* () {
				const build = yield* BrowserBuild;
				const first = yield* build.compile(request);
				const failure = yield* build.compile(request).pipe(Effect.flip);
				const retained = yield* build.lastSuccessful;
				return { first, failure, retained };
			}).pipe(Effect.provide(layer));

			assert.deepStrictEqual(result.first, artifact);
			assert.strictEqual(result.failure.reason, 'compile');
			assert.deepStrictEqual(result.retained, artifact);
			assert.isTrue(workers.length === 0);
		})
	);

	it.effect('terminates its worker when a build is interrupted', () =>
		Effect.gen(function* () {
			const worker = new FakeWorker('pending');
			const layer = makeBrowserBuildLayer({
				makeWorker: () => worker,
				crossOriginIsolated: () => true
			}).pipe(Layer.provideMerge(storeLayer));
			const fiber = yield* Effect.gen(function* () {
				const build = yield* BrowserBuild;
				return yield* build.compile(request);
			}).pipe(Effect.provide(layer), Effect.forkChild({ startImmediately: true }));

			yield* Fiber.interrupt(fiber);
			assert.isTrue(worker.terminated);
		})
	);

	it.effect('fails before Worker creation without cross-origin isolation', () =>
		Effect.gen(function* () {
			let workerCreated = false;
			const layer = makeBrowserBuildLayer({
				makeWorker: () => {
					workerCreated = true;
					return new FakeWorker('pending');
				},
				crossOriginIsolated: () => false
			}).pipe(Layer.provideMerge(storeLayer));
			const error = yield* Effect.gen(function* () {
				const build = yield* BrowserBuild;
				return yield* build.compile(request);
			}).pipe(Effect.provide(layer), Effect.flip);

			assert.strictEqual(error.reason, 'unsupported');
			assert.isFalse(workerCreated);
		})
	);
});
