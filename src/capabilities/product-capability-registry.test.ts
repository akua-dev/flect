import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
	AuthorizedProductOperation,
	ProductCapabilityAllowChoice,
	ProductCapabilityProjection,
	ProductCapabilityRequestContext,
	ProductOperationFailure,
	ProductOperationSummary
} from '../../shared/product-capability';
import { ProductCapabilityBroker } from './product-capability-broker';
import {
	makeProductCapabilityRegistryLayer,
	ProductCapabilityRegistry
} from './product-capability-registry';

const context = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'revision-projects-1',
	capabilities: [{ capabilityId: 'product.projects.read', required: true }]
});

const projection = ProductCapabilityProjection.make({
	version: 1,
	scopeId: context.scopeId,
	workspaceId: context.workspaceId,
	requestDigest: context.requestDigest,
	revision: context.revision,
	capabilityId: 'product.projects.read',
	state: 'granted',
	availability: 'available',
	requested: true,
	required: true,
	confirmationPolicies: ['session'],
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	decisionId: 'decision-test-0001',
	confirmationPolicy: 'session'
});

const makeLayer = () => {
	const decide = vi.fn(() => Effect.succeed(projection));
	const revoke = vi.fn(() => Effect.void);
	const broker = Layer.succeed(ProductCapabilityBroker)({
		catalog: () => Effect.succeed([projection]),
		decide,
		inspectReservation: () => Effect.die('not used'),
		revoke,
		reserve: () => Effect.die('not used'),
		validate: () => Effect.die('not used'),
		withReservation: (_reservation, _operation, effect) => effect,
		warnings: Effect.succeed([])
	});
	const registry = makeProductCapabilityRegistryLayer({
		operations: [
			{
				id: 'projects.list',
				capabilityId: 'product.projects.read',
				authorize: () =>
					Effect.succeed(
						AuthorizedProductOperation.make({
							version: 1,
							capabilityId: 'product.projects.read',
							operationId: 'projects.list',
							resourceIds: ['projects.workspace'],
							dataClassIds: ['projects.summary']
						})
					),
				execute: () =>
					Effect.fail(
						ProductOperationFailure.make({
							operationId: 'projects.list',
							reason: 'invalid-output',
							message: 'The product operation returned an invalid result.'
						})
					)
			}
		]
	}).pipe(Layer.provide(broker));
	return { decide, registry, revoke };
};

describe('ProductCapabilityRegistry', () => {
	it.effect('projects broker permissions into the operation catalog', () => {
		const { registry } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			assert.deepStrictEqual(yield* service.permissions(context), [projection]);
			assert.deepStrictEqual(yield* service.catalog(context), [
				ProductOperationSummary.make({
					version: 1,
					id: 'projects.list',
					capabilityId: 'product.projects.read',
					permission: projection
				})
			]);
		}).pipe(Effect.provide(registry));
	});

	it.effect('delegates protected decisions and revocation to the broker', () => {
		const { decide, registry, revoke } = makeLayer();
		const choice = ProductCapabilityAllowChoice.make({
			type: 'allow',
			confirmationPolicy: 'session'
		});
		return Effect.gen(function* () {
			const service = yield* ProductCapabilityRegistry;
			assert.strictEqual(
				yield* service.decide(context, 'product.projects.read', choice),
				projection
			);
			yield* service.revoke('decision-test-0001');
			assert.deepStrictEqual(decide.mock.calls[0], [context, 'product.projects.read', choice]);
			assert.deepStrictEqual(revoke.mock.calls[0], ['decision-test-0001']);
		}).pipe(Effect.provide(registry));
	});
});
