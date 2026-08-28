import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Result } from 'effect';
import { TestClock } from 'effect/testing';
import {
	AuthorizedProductOperation,
	ProductCapabilityAllowChoice,
	ProductCapabilityDecision,
	ProductCapabilityDenyChoice,
	ProductCapabilityManifest,
	ProductCapabilityRequestContext
} from '../../packages/product/src/product-capability';
import {
	makeProductCapabilityBrokerLayer,
	ProductCapabilityBroker
} from './product-capability-broker';
import {
	ProductCapabilityDecisionStore,
	ProductCapabilityDecisionStoreFailure,
	type ProductCapabilityDecisionStoreShape
} from './product-capability-decision-store';

const manifest = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.projects.read',
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent'],
	maxGrantDurationMs: 86_400_000,
	maxRate: { maxInvocations: 60, intervalMs: 60_000 }
});

const request = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'revision-projects-1',
	capabilities: [{ capabilityId: 'product.projects.read', required: true }]
});

const operation = AuthorizedProductOperation.make({
	version: 1,
	capabilityId: 'product.projects.read',
	operationId: 'projects.list',
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary']
});

const makeStore = (options?: {
	readonly decisions?: ReadonlyArray<ProductCapabilityDecision>;
	readonly save?: ProductCapabilityDecisionStoreShape['save'];
}) => {
	const save = vi.fn<ProductCapabilityDecisionStoreShape['save']>(
		options?.save ?? (() => Effect.void)
	);
	return {
		layer: Layer.succeed(ProductCapabilityDecisionStore)({
			load: () => Effect.succeed({ decisions: options?.decisions ?? [] }),
			save
		}),
		save
	};
};

const makeLayer = (options?: {
	readonly decisions?: ReadonlyArray<ProductCapabilityDecision>;
	readonly save?: ProductCapabilityDecisionStoreShape['save'];
}) => {
	const store = makeStore(options);
	return {
		layer: makeProductCapabilityBrokerLayer({ manifests: [manifest] }).pipe(
			Layer.provide(store.layer)
		),
		save: store.save
	};
};

describe('ProductCapabilityBroker', () => {
	it.effect('projects available, requested, denied, granted, and revoked states', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			const available = yield* broker.catalog(
				ProductCapabilityRequestContext.make({
					...request,
					capabilities: []
				})
			);
			assert.strictEqual(available[0]?.state, 'available');
			assert.isFalse(available[0]?.requested);

			const requested = yield* broker.catalog(request);
			assert.strictEqual(requested[0]?.state, 'requested');

			const denied = yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityDenyChoice.make({ type: 'deny' })
			);
			assert.strictEqual(denied.state, 'denied');

			const granted = yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			assert.strictEqual(granted.state, 'granted');
			assert.strictEqual(granted.confirmationPolicy, 'session');

			yield* broker.revoke(granted.decisionId ?? 'missing');
			const revoked = yield* broker.catalog(request);
			assert.strictEqual(revoked[0]?.state, 'revoked');
		}).pipe(Effect.provide(layer));
	});

	it.effect('consumes once and resets a bounded rate window with TestClock', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'once'
				})
			);
			yield* broker.reserve(request, operation);
			const consumed = yield* Effect.result(broker.reserve(request, operation));
			assert.isTrue(Result.isFailure(consumed));
			if (Result.isFailure(consumed)) {
				assert.strictEqual(consumed.failure.reason, 'expired');
			}

			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session',
					rateLimit: { maxInvocations: 1, intervalMs: 1_000 }
				})
			);
			yield* broker.reserve(request, operation);
			const limited = yield* Effect.result(broker.reserve(request, operation));
			assert.isTrue(Result.isFailure(limited));
			if (Result.isFailure(limited)) {
				assert.strictEqual(limited.failure.reason, 'rate-limited');
			}
			yield* TestClock.adjust('1 second');
			yield* broker.reserve(request, operation);
		}).pipe(Effect.provide(layer));
	});

	it.effect('expires a duration grant deterministically', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session',
					durationMs: 1_000
				})
			);
			assert.strictEqual((yield* broker.catalog(request))[0]?.state, 'granted');
			yield* TestClock.adjust('1 second');
			assert.strictEqual((yield* broker.catalog(request))[0]?.state, 'expired');
		}).pipe(Effect.provide(layer));
	});

	it.effect('allows only one concurrent reservation for a once decision', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'once'
				})
			);
			const results = yield* Effect.all(
				[
					Effect.result(broker.reserve(request, operation)),
					Effect.result(broker.reserve(request, operation))
				],
				{ concurrency: 'unbounded' }
			);
			assert.strictEqual(results.filter((result) => Result.isSuccess(result)).length, 1);
			assert.strictEqual(results.filter((result) => Result.isFailure(result)).length, 1);
		}).pipe(Effect.provide(layer));
	});

	it.effect('keeps durable authority unchanged when revocation cannot persist', () => {
		const durable = ProductCapabilityDecision.make({
			version: 2,
			decisionId: 'decision-durable-0001',
			scopeId: request.scopeId,
			requestDigest: request.requestDigest,
			capabilityId: 'product.projects.read',
			status: 'granted',
			confirmationPolicy: 'persistent',
			operationIds: ['projects.list'],
			resourceIds: ['projects.workspace'],
			dataClassIds: ['projects.summary'],
			createdAtMillis: 0,
			updatedAtMillis: 0,
			authority: 'protected-user'
		});
		const { layer } = makeLayer({
			decisions: [durable],
			save: () =>
				Effect.fail(
					ProductCapabilityDecisionStoreFailure.make({
						reason: 'persistence-failed',
						message: 'The product capability decisions could not be saved.'
					})
				)
		});
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			assert.strictEqual((yield* broker.catalog(request))[0]?.state, 'granted');
			const failed = yield* Effect.result(broker.revoke(durable.decisionId));
			assert.isTrue(Result.isFailure(failed));
			assert.strictEqual((yield* broker.catalog(request))[0]?.state, 'granted');
		}).pipe(Effect.provide(layer));
	});

	it.effect('denies scope widening and invalidates an old request digest', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const widened = yield* Effect.result(
				broker.reserve(
					request,
					AuthorizedProductOperation.make({
						...operation,
						resourceIds: ['projects.administration']
					})
				)
			);
			assert.isTrue(Result.isFailure(widened));
			if (Result.isFailure(widened)) {
				assert.strictEqual(widened.failure.reason, 'denied');
			}

			const changed = ProductCapabilityRequestContext.make({
				...request,
				requestDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
				revision: 'revision-projects-2'
			});
			assert.strictEqual((yield* broker.catalog(changed))[0]?.state, 'requested');
			const stale = yield* Effect.result(broker.reserve(changed, operation));
			assert.isTrue(Result.isFailure(stale));
		}).pipe(Effect.provide(layer));
	});

	it.effect('invalidates an exact reservation after revocation', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			const granted = yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const reservation = yield* broker.reserve(request, operation);
			yield* broker.inspectReservation(reservation);

			yield* broker.revoke(granted.decisionId ?? 'missing');
			const revoked = yield* broker.inspectReservation(reservation).pipe(Effect.flip);
			assert.strictEqual(revoked.reason, 'revoked');
		}).pipe(Effect.provide(layer));
	});

	it.effect('invalidates an exact reservation after expiry or replacement', () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const broker = yield* ProductCapabilityBroker;
			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session',
					durationMs: 1_000
				})
			);
			const expiring = yield* broker.reserve(request, operation);
			yield* TestClock.adjust('1 second');
			const expired = yield* broker.inspectReservation(expiring).pipe(Effect.flip);
			assert.strictEqual(expired.reason, 'expired');

			yield* broker.decide(
				request,
				'product.projects.read',
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const replaced = yield* broker.inspectReservation(expiring).pipe(Effect.flip);
			assert.strictEqual(replaced.reason, 'denied');
		}).pipe(Effect.provide(layer));
	});
});
