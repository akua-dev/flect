import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Fiber, Layer, Result, Stream } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import {
	makeProductEventsLayer,
	type ProductEventConnector
} from '../../packages/product/src/host/product-events';
import {
	AuthorizedProductOperation,
	ProductCapabilityAllowChoice,
	ProductCapabilityManifest,
	ProductCapabilityRequestContext,
	type ProductJson,
	ProductOperationFailure,
	ProductOperationInvocation
} from '../../packages/product/src/product-capability';
import {
	type ProductEventFailure,
	ProductEventPolicy,
	ProductEventRequest
} from '../../packages/product/src/product-events';
import {
	makeProductCapabilityBrokerLayer,
	ProductCapabilityBroker
} from './product-capability-broker';
import { ProductCapabilityDecisionStore } from './product-capability-decision-store';
import { makeProductEventRegistryLayer, ProductEventRegistry } from './product-event-registry';

const capabilityId = 'product.projects.watch';
const operationId = 'projects.watch';
const policyId = 'reference.events.projects';

const manifest = ProductCapabilityManifest.make({
	version: 1,
	id: capabilityId,
	name: 'Watch projects',
	description: 'Observe bounded project status changes.',
	operationIds: [operationId],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['session']
});

const context = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'revision-projects-1',
	capabilities: [{ capabilityId, required: true }]
});

const invocation = (input: ProductJson = null) =>
	ProductOperationInvocation.make({
		version: 1,
		operationId,
		input
	});

const policy = ProductEventPolicy.make({
	version: 1,
	id: policyId,
	operationId,
	bufferCapacity: 4,
	eventBytes: 1_024,
	reconnectAttempts: 0,
	reconnectDelayMs: 100,
	sequenceResume: true
});

const makeLayer = (connector: ProductEventConnector) => {
	const authorize = vi.fn((input: ProductJson) => {
		if (
			typeof input === 'object' &&
			input !== null &&
			Reflect.get(input, 'productDenied') === true
		) {
			return Effect.fail(
				ProductOperationFailure.make({
					operationId,
					reason: 'product-denied',
					message: 'The product denied this operation.'
				})
			);
		}
		const widened =
			typeof input === 'object' && input !== null && Reflect.get(input, 'widen') === true;
		return Effect.succeed(
			AuthorizedProductOperation.make({
				version: 1,
				capabilityId,
				operationId,
				resourceIds: [widened ? 'projects.administration' : 'projects.workspace'],
				dataClassIds: ['projects.summary']
			})
		);
	});
	const request = vi.fn(() =>
		Effect.succeed(
			ProductEventRequest.make({
				version: 1,
				policyId,
				input: { projectId: 'one' }
			})
		)
	);
	const store = Layer.succeed(ProductCapabilityDecisionStore)({
		load: () => Effect.succeed({ decisions: [] }),
		save: () => Effect.void
	});
	const broker = makeProductCapabilityBrokerLayer({
		manifests: [manifest]
	}).pipe(Layer.provide(store));
	const events = makeProductEventsLayer({
		policies: [policy],
		connectors: new Map([[policyId, connector]])
	});
	const dependencies = Layer.merge(broker, events);
	const registry = makeProductEventRegistryLayer({
		operations: [{ id: operationId, capabilityId, policyId, authorize, request }]
	}).pipe(Layer.provideMerge(dependencies));
	return { authorize, registry, request };
};

const grant = Effect.gen(function* () {
	const broker = yield* ProductCapabilityBroker;
	return yield* broker.decide(
		context,
		capabilityId,
		ProductCapabilityAllowChoice.make({
			type: 'allow',
			confirmationPolicy: 'session'
		})
	);
});

describe('ProductEventRegistry', () => {
	it.effect('denies an ungranted stream before product policy or connector', () =>
		Effect.gen(function* () {
			let opened = false;
			const connector: ProductEventConnector = {
				open: () =>
					Effect.sync(() => {
						opened = true;
					})
			};
			const { authorize, registry, request } = makeLayer(connector);
			const result = yield* Effect.gen(function* () {
				return yield* (yield* ProductEventRegistry)
					.subscribe(context, invocation())
					.pipe(Stream.runCollect, Effect.result);
			}).pipe(Effect.provide(registry));

			assert.isTrue(Result.isFailure(result));
			assert.strictEqual(authorize.mock.calls.length, 0);
			assert.strictEqual(request.mock.calls.length, 0);
			assert.isFalse(opened);
		})
	);

	it.effect('keeps product denial and user scope authoritative', () =>
		Effect.gen(function* () {
			let opened = false;
			const connector: ProductEventConnector = {
				open: () =>
					Effect.sync(() => {
						opened = true;
					})
			};
			const { registry } = makeLayer(connector);
			yield* Effect.gen(function* () {
				yield* grant;
				const service = yield* ProductEventRegistry;
				const deniedInputs: ReadonlyArray<ProductJson> = [{ productDenied: true }, { widen: true }];
				for (const input of deniedInputs) {
					const error = yield* service
						.subscribe(context, invocation(input))
						.pipe(Stream.runDrain, Effect.flip);
					assert.include(['product-denied', 'denied'], error.reason);
				}
			}).pipe(Effect.provide(registry));
			assert.isFalse(opened);
		})
	);

	it.effect('streams only after grant and exact product authorization', () =>
		Effect.gen(function* () {
			const connector: ProductEventConnector = {
				open: ({ emit }) =>
					Effect.gen(function* () {
						yield* emit({
							version: 1,
							policyId,
							sequence: '1',
							payload: { status: 'ready' }
						});
					})
			};
			const { registry } = makeLayer(connector);
			const events = yield* Effect.gen(function* () {
				yield* grant;
				return yield* (yield* ProductEventRegistry)
					.subscribe(context, invocation())
					.pipe(Stream.runCollect);
			}).pipe(Effect.provide(registry));

			assert.deepStrictEqual(
				Array.from(events, (event) => event.payload),
				[{ status: 'ready' }]
			);
		})
	);

	it.effect('revokes an idle stream and aborts its owned connector', () =>
		Effect.gen(function* () {
			let aborted = false;
			const connector: ProductEventConnector = {
				open: ({ signal }) =>
					Effect.callback<undefined, ProductEventFailure>((resume) => {
						const onAbort = () => {
							aborted = true;
							resume(Effect.succeed(undefined));
						};
						signal.addEventListener('abort', onAbort, { once: true });
						return Effect.sync(() => signal.removeEventListener('abort', onAbort));
					})
			};
			const { registry } = makeLayer(connector);
			const error = yield* Effect.gen(function* () {
				const decision = yield* grant;
				const service = yield* ProductEventRegistry;
				const running = yield* service
					.subscribe(context, invocation())
					.pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
				yield* Effect.yieldNow;
				yield* (yield* ProductCapabilityBroker).revoke(decision.decisionId ?? 'missing');
				yield* TestClock.adjust('100 millis');
				return yield* Fiber.join(running).pipe(Effect.flip);
			}).pipe(Effect.provide(registry));

			assert.strictEqual(error.reason, 'revoked');
			assert.isTrue(aborted);
		})
	);

	it.effect('caller cancellation releases the connector without public failure', () =>
		Effect.gen(function* () {
			let aborted = false;
			const connector: ProductEventConnector = {
				open: ({ signal }) =>
					Effect.callback<undefined, ProductEventFailure>((resume) => {
						const onAbort = () => {
							aborted = true;
							resume(Effect.succeed(undefined));
						};
						signal.addEventListener('abort', onAbort, { once: true });
						return Effect.sync(() => signal.removeEventListener('abort', onAbort));
					})
			};
			const { registry } = makeLayer(connector);
			yield* Effect.gen(function* () {
				yield* grant;
				const running = yield* (yield* ProductEventRegistry)
					.subscribe(context, invocation())
					.pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
				yield* Effect.yieldNow;
				yield* Fiber.interrupt(running);
			}).pipe(Effect.provide(registry));

			assert.isTrue(aborted);
		})
	);
});
