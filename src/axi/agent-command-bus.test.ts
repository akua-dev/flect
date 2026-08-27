import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import { AgentCommandSource } from '../../shared/control';
import { AgentCommandBus, AgentCommandBusLive, AgentGatewayResult } from './agent-command-bus';

const source = AgentCommandSource.make({
	kind: 'agent',
	role: 'app',
	sessionId: 'session-bus-0001',
	parentOperationId: 'operation-bus-0001',
	requestId: 'tool-bus-1'
});

describe('AgentCommandBus', () => {
	it.effect('delivers a response to the exact caller', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const caller = yield* bus.submit(source, { type: 'inspect' }).pipe(Effect.forkChild);
			const request = yield* bus.take;
			assert.strictEqual(request.source.requestId, source.requestId);
			yield* Deferred.succeed(
				request.response,
				AgentGatewayResult.make({ type: 'inspect', value: { sequence: 7 } })
			);
			const result = yield* Fiber.join(caller);
			assert.strictEqual(result.type, 'inspect');
		}).pipe(Effect.provide(AgentCommandBusLive))
	);

	it.effect('rejects a request when the bounded queue is full', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const fibers = yield* Effect.forEach(
				Array.from({ length: 32 }, (_, index) => index),
				(index) =>
					bus
						.submit(
							AgentCommandSource.make({
								...source,
								requestId: `tool-capacity-${index}`
							}),
							{ type: 'inspect' }
						)
						.pipe(Effect.forkChild)
			);
			yield* Effect.yieldNow;
			const error = yield* bus
				.submit(
					AgentCommandSource.make({
						...source,
						requestId: 'tool-capacity-overflow'
					}),
					{ type: 'inspect' }
				)
				.pipe(Effect.flip);
			assert.strictEqual(error._tag, 'AgentCommandBusError');
			if (error._tag === 'AgentCommandBusError') {
				assert.strictEqual(error.reason, 'capacity');
			}
			yield* Effect.forEach(fibers, Fiber.interrupt, { discard: true });
		}).pipe(Effect.provide(AgentCommandBusLive))
	);

	it.effect('times out and removes an unanswered request', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const caller = yield* bus.submit(source, { type: 'inspect' }).pipe(Effect.forkChild);
			yield* TestClock.adjust('30 seconds');
			const error = yield* Fiber.join(caller).pipe(Effect.flip);
			assert.strictEqual(error._tag, 'AgentCommandBusError');
			if (error._tag === 'AgentCommandBusError') {
				assert.strictEqual(error.reason, 'timeout');
			}
		}).pipe(Effect.provide(AgentCommandBusLive))
	);

	it.effect('shutdown fails every pending caller and future submission', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const first = yield* bus.submit(source, { type: 'inspect' }).pipe(Effect.forkChild);
			const second = yield* bus
				.submit(AgentCommandSource.make({ ...source, requestId: 'tool-bus-2' }), { type: 'logs' })
				.pipe(Effect.forkChild);
			yield* Effect.yieldNow;
			yield* bus.shutdown;
			const failures = yield* Effect.forEach([first, second], (fiber) =>
				Fiber.join(fiber).pipe(Effect.flip)
			);
			const reasons = failures.map((error) => {
				assert.strictEqual(error._tag, 'AgentCommandBusError');
				return error._tag === 'AgentCommandBusError' ? error.reason : 'unexpected';
			});
			assert.deepStrictEqual(reasons, ['unavailable', 'unavailable']);
			const future = yield* bus.submit(source, { type: 'inspect' }).pipe(Effect.flip);
			assert.strictEqual(future._tag, 'AgentCommandBusError');
			if (future._tag === 'AgentCommandBusError') {
				assert.strictEqual(future.reason, 'unavailable');
			}
		}).pipe(Effect.provide(AgentCommandBusLive))
	);
});
