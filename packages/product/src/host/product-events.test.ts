import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import { ProductEventFailure, ProductEventPolicy, ProductEventRequest } from '../product-events';
import {
	makeProductEventsLayer,
	type ProductEventConnector,
	ProductEvents
} from './product-events';

const policy = (overrides: Partial<ProductEventPolicy> = {}) =>
	ProductEventPolicy.make({
		version: 1,
		id: 'reference.events.projects',
		operationId: 'projects.watch',
		bufferCapacity: 2,
		eventBytes: 1_024,
		reconnectAttempts: 2,
		reconnectDelayMs: 100,
		sequenceResume: true,
		...overrides
	});

const request = (policyId = 'reference.events.projects') =>
	ProductEventRequest.make({
		version: 1,
		policyId,
		input: { projectId: 'one' }
	});

const transportFailure = (policyId = 'reference.events.projects') =>
	ProductEventFailure.make({
		policyId,
		reason: 'transport',
		message: 'The product event stream failed safely.'
	});

const layerFor = (connector: ProductEventConnector, selectedPolicy = policy()) =>
	makeProductEventsLayer({
		policies: [selectedPolicy],
		connectors: new Map([[selectedPolicy.id, connector]])
	});

describe('ProductEvents', () => {
	it.effect('streams decoded ordered events from a registered connector', () =>
		Effect.gen(function* () {
			const connector: ProductEventConnector = {
				open: ({ emit }) =>
					Effect.gen(function* () {
						yield* emit({
							version: 1,
							policyId: policy().id,
							sequence: '1',
							payload: { status: 'queued' }
						});
						yield* emit({
							version: 1,
							policyId: policy().id,
							sequence: '2',
							payload: { status: 'ready' }
						});
					})
			};
			const events = yield* Effect.gen(function* () {
				return yield* (yield* ProductEvents).subscribe(request()).pipe(Stream.runCollect);
			}).pipe(Effect.provide(layerFor(connector)));

			assert.deepStrictEqual(
				Array.from(events, (event) => [event.sequence, event.payload]),
				[
					['1', { status: 'queued' }],
					['2', { status: 'ready' }]
				]
			);
		})
	);

	it.effect('rejects unknown policy before opening a connector', () =>
		Effect.gen(function* () {
			let opened = false;
			const connector: ProductEventConnector = {
				open: () =>
					Effect.sync(() => {
						opened = true;
					})
			};
			const error = yield* Effect.gen(function* () {
				return yield* (yield* ProductEvents)
					.subscribe(request('unknown.events'))
					.pipe(Stream.runCollect);
			}).pipe(Effect.provide(layerFor(connector)), Effect.flip);

			assert.strictEqual(error.reason, 'invalid-policy');
			assert.isFalse(opened);
		})
	);

	it.effect('fails duplicate, regressing, mismatched, and oversized events closed', () =>
		Effect.gen(function* () {
			const fixtures: ReadonlyArray<readonly [string, string]> = [
				['2', '2'],
				['2', '1'],
				['1', 'mismatched'],
				['1', 'oversized']
			];
			for (const [first, second] of fixtures) {
				const connector: ProductEventConnector = {
					open: ({ emit }) =>
						Effect.gen(function* () {
							yield* emit({
								version: 1,
								policyId: policy().id,
								sequence: first,
								payload: { value: 'one' }
							});
							yield* emit({
								version: 1,
								policyId: second === 'mismatched' ? 'another.events.policy' : policy().id,
								sequence: second === 'mismatched' || second === 'oversized' ? '3' : second,
								payload: second === 'oversized' ? { value: 'x'.repeat(2_000) } : { value: 'two' }
							});
						})
				};
				const error = yield* Effect.gen(function* () {
					return yield* (yield* ProductEvents).subscribe(request()).pipe(Stream.runCollect);
				}).pipe(Effect.provide(layerFor(connector)), Effect.flip);
				assert.include(['sequence-violation', 'invalid-event'], error.reason);
				assert.isTrue(Schema.is(ProductEventFailure)(error));
			}
		})
	);

	it.effect('reconnects with the last sequence and stops at the declared bound', () =>
		Effect.gen(function* () {
			const cursors: Array<string | undefined> = [];
			let attempts = 0;
			const connector: ProductEventConnector = {
				open: ({ emit, resumeAfter }) =>
					Effect.gen(function* () {
						attempts += 1;
						cursors.push(resumeAfter);
						if (attempts === 1) {
							yield* emit({
								version: 1,
								policyId: policy().id,
								sequence: '1',
								payload: { status: 'first' }
							});
							return yield* Effect.fail(transportFailure());
						}
						yield* emit({
							version: 1,
							policyId: policy().id,
							sequence: '2',
							payload: { status: 'resumed' }
						});
					})
			};
			const running = yield* Effect.gen(function* () {
				return yield* (yield* ProductEvents).subscribe(request()).pipe(Stream.runCollect);
			}).pipe(Effect.provide(layerFor(connector)), Effect.forkChild({ startImmediately: true }));
			yield* Effect.yieldNow;
			yield* TestClock.adjust('100 millis');
			const events = yield* Fiber.join(running);

			assert.deepStrictEqual(cursors, [undefined, '1']);
			assert.deepStrictEqual(
				Array.from(events, (event) => event.sequence),
				['1', '2']
			);

			attempts = 0;
			const failing: ProductEventConnector = {
				open: () =>
					Effect.sync(() => {
						attempts += 1;
					}).pipe(Effect.andThen(Effect.fail(transportFailure())))
			};
			const exhausted = yield* Effect.gen(function* () {
				return yield* (yield* ProductEvents).subscribe(request()).pipe(Stream.runDrain);
			}).pipe(Effect.provide(layerFor(failing)), Effect.forkChild({ startImmediately: true }));
			yield* Effect.yieldNow;
			yield* TestClock.adjust('200 millis');
			const exhaustedError = yield* Fiber.join(exhausted).pipe(Effect.flip);
			assert.strictEqual(attempts, 3);
			assert.strictEqual(exhaustedError.reason, 'reconnect-exhausted');
		})
	);

	it.effect('backpressures at policy capacity and aborts owned work on cancellation', () =>
		Effect.gen(function* () {
			const firstObserved = yield* Deferred.make<undefined>();
			const releaseConsumer = yield* Deferred.make<undefined>();
			const stages: Array<number> = [];
			let aborted = false;
			const connector: ProductEventConnector = {
				open: ({ emit, signal }) =>
					Effect.gen(function* () {
						for (const sequence of ['1', '2', '3']) {
							yield* emit({
								version: 1,
								policyId: policy().id,
								sequence,
								payload: { sequence }
							});
							stages.push(Number(sequence));
						}
						yield* Effect.callback<undefined>((resume) => {
							const onAbort = () => {
								aborted = true;
								resume(Effect.succeed(undefined));
							};
							signal.addEventListener('abort', onAbort, { once: true });
							return Effect.sync(() => signal.removeEventListener('abort', onAbort));
						});
					})
			};
			const running = yield* Effect.gen(function* () {
				return yield* (yield* ProductEvents)
					.subscribe(request())
					.pipe(
						Stream.runForEach((event) =>
							event.sequence === '1'
								? Deferred.succeed(firstObserved, undefined).pipe(
										Effect.andThen(Deferred.await(releaseConsumer))
									)
								: Effect.void
						)
					);
			}).pipe(
				Effect.provide(layerFor(connector, policy({ bufferCapacity: 1 }))),
				Effect.forkChild({ startImmediately: true })
			);
			yield* Deferred.await(firstObserved);
			yield* Effect.yieldNow;
			assert.deepStrictEqual(stages, [1, 2]);
			yield* Deferred.succeed(releaseConsumer, undefined);
			while (stages.length < 3) yield* Effect.yieldNow;
			yield* Fiber.interrupt(running);

			assert.deepStrictEqual(stages, [1, 2, 3]);
			assert.isTrue(aborted);
		})
	);
});
