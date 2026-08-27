import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Result } from 'effect';
import {
	AuthorizedProductOperation,
	ProductCapabilityAllowChoice,
	ProductCapabilityManifest,
	ProductCapabilityRequestContext,
	ProductOperationFailure,
	ProductOperationInvocation
} from '../../shared/product-capability';
import { makeProductCapabilityBrokerLayer } from './product-capability-broker';
import { ProductCapabilityDecisionStore } from './product-capability-decision-store';
import {
	makeProductCapabilityRegistryLayer,
	ProductCapabilityRegistry
} from './product-capability-registry';

const manifest = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.projects.read',
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
});

const context = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'revision-projects-1',
	capabilities: [{ capabilityId: manifest.id, required: true }]
});

const invocation = ProductOperationInvocation.make({
	version: 1,
	operationId: 'projects.list',
	input: null
});

const makeLayer = () => {
	const execute = vi.fn(() => Effect.succeed({ projects: ['one'] }));
	const authorize = vi.fn((input: typeof invocation.input) => {
		if (
			typeof input === 'object' &&
			input !== null &&
			Reflect.get(input, 'productDenied') === true
		) {
			return Effect.fail(
				ProductOperationFailure.make({
					operationId: 'projects.list',
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
				capabilityId: manifest.id,
				operationId: 'projects.list',
				resourceIds: [widened ? 'projects.administration' : 'projects.workspace'],
				dataClassIds: ['projects.summary']
			})
		);
	});
	const store = Layer.succeed(ProductCapabilityDecisionStore)({
		load: () => Effect.succeed({ decisions: [] }),
		save: () => Effect.void
	});
	const broker = makeProductCapabilityBrokerLayer({
		manifests: [manifest]
	}).pipe(Layer.provide(store));
	const registry = makeProductCapabilityRegistryLayer({
		operations: [
			{
				id: 'projects.list',
				capabilityId: manifest.id,
				authorize,
				execute
			}
		]
	}).pipe(Layer.provide(broker));
	return { authorize, execute, registry };
};

describe('ProductCapabilityRegistry policy', () => {
	it.effect('denies an ungranted operation before product policy or HTTP', () => {
		const { authorize, execute, registry } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			const result = yield* Effect.result(service.invoke(context, invocation));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'denied');
			}
			assert.strictEqual(authorize.mock.calls.length, 0);
			assert.strictEqual(execute.mock.calls.length, 0);
		}).pipe(Effect.provide(registry));
	});

	it.effect('keeps independent product denial authoritative after approval', () => {
		const { authorize, execute, registry } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			yield* service.decide(
				context,
				manifest.id,
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const result = yield* Effect.result(
				service.invoke(
					context,
					ProductOperationInvocation.make({
						...invocation,
						input: { productDenied: true }
					})
				)
			);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'product-denied');
			}
			assert.strictEqual(authorize.mock.calls.length, 1);
			assert.strictEqual(execute.mock.calls.length, 0);
		}).pipe(Effect.provide(registry));
	});

	it.effect('rejects policy scope widening before HTTP', () => {
		const { execute, registry } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			yield* service.decide(
				context,
				manifest.id,
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const result = yield* Effect.result(
				service.invoke(
					context,
					ProductOperationInvocation.make({
						...invocation,
						input: { widen: true }
					})
				)
			);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'denied');
			}
			assert.strictEqual(execute.mock.calls.length, 0);
		}).pipe(Effect.provide(registry));
	});

	it.effect('invokes the bounded adapter and decodes output', () => {
		const { execute, registry } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			yield* service.decide(
				context,
				manifest.id,
				ProductCapabilityAllowChoice.make({
					type: 'allow',
					confirmationPolicy: 'session'
				})
			);
			const execution = yield* service.invokeDetailed(context, invocation);
			assert.deepStrictEqual(execution.output, { projects: ['one'] });
			assert.strictEqual(execution.reservation.capabilityId, manifest.id);
			assert.strictEqual(execution.reservation.operationId, 'projects.list');
			assert.strictEqual(execution.reservation.confirmationPolicy, 'session');
			assert.deepStrictEqual(yield* service.invoke(context, invocation), {
				projects: ['one']
			});
			assert.strictEqual(execute.mock.calls.length, 2);
		}).pipe(Effect.provide(registry));
	});
});
