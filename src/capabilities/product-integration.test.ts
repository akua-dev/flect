import { assert, describe, it } from '@effect/vitest';
import {
	AuthorizedProductOperation,
	defineProductIntegration,
	ProductCapabilityManifest,
	type ProductIntegrationInput,
	ProductOperationFailure
} from '@flect/product';
import { Effect, Layer } from 'effect';
import {
	ProductCapabilityAllowChoice,
	ProductCapabilityRequestContext,
	ProductOperationInvocation
} from '../../shared/product-capability';
import { ProductCapabilityBroker } from './product-capability-broker';
import { ProductCapabilityDecisionStore } from './product-capability-decision-store';
import { ProductCapabilityRegistry } from './product-capability-registry';
import { makeProductEventsLayer } from './product-events';
import { makeProductIntegrationRuntimeLayer } from './product-integration';

const archive = new TextEncoder().encode('bridge-capsule');
const archiveSha256 = '2bb1e97e43b968230d5468d580cf6e631e7bb4c593b39dd657bac19e9e6ab487';
const capability = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.bridge.read',
	name: 'Read bridge status',
	description: "Read one status through Flect's protected runtime.",
	operationIds: ['bridge.read'],
	resourceIds: ['bridge.workspace'],
	dataClassIds: ['bridge.status'],
	confirmationPolicies: ['session']
});

const operation = {
	id: 'bridge.read',
	capabilityId: capability.id,
	authorize: () =>
		Effect.succeed(
			AuthorizedProductOperation.make({
				version: 1,
				capabilityId: capability.id,
				operationId: 'bridge.read',
				resourceIds: ['bridge.workspace'],
				dataClassIds: ['bridge.status']
			})
		),
	execute: () => Effect.succeed({ status: 'ready' })
} satisfies ProductIntegrationInput['operations'][number];

const integrationInput: ProductIntegrationInput = {
	metadata: {
		version: 1,
		descriptor: {
			version: 1,
			id: 'dev.flect.bridge',
			name: 'Bridge reference',
			description: 'A protected runtime bridge reference.',
			integrationVersion: '1.0.0',
			revision: 'bridge-v1',
			productApiVersion: 1,
			connection: 'offline',
			authenticationOwner: 'none',
			compatibility: {
				flect: '>=0.2.0 <1.0.0',
				platforms: ['browser', 'macos']
			},
			inference: { allowedOwners: ['user'], defaultOwner: 'user' }
		},
		experience: {
			version: 1,
			capsuleId: 'dev.flect.bridge',
			capsuleVersion: '1.0.0',
			archiveSha256,
			provenanceRevision: 'bridge-v1',
			appExtensionIds: [],
			shaperExtensionIds: []
		},
		capabilities: [capability],
		migrations: []
	},
	operations: [operation],
	events: [],
	selectedInferenceOwner: 'user',
	loadRecommendedExperience: Effect.succeed(archive)
};

const context = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.flect.bridge',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'bridge-v1',
	capabilities: [{ capabilityId: capability.id, required: true }]
});

describe('ProductIntegrationRuntime', () => {
	it.effect("runs a public SDK integration through Flect's protected broker", () =>
		Effect.gen(function* () {
			const integration = yield* defineProductIntegration(integrationInput);
			const decisionStore = Layer.succeed(ProductCapabilityDecisionStore)({
				load: () => Effect.succeed({ decisions: [] }),
				save: () => Effect.void
			});
			const runtime = makeProductIntegrationRuntimeLayer({
				integration,
				events: makeProductEventsLayer({
					policies: [],
					connectors: new Map()
				})
			}).pipe(Layer.provide(decisionStore));
			const output = yield* Effect.gen(function* () {
				const broker = yield* ProductCapabilityBroker;
				const registry = yield* ProductCapabilityRegistry;
				yield* broker.decide(
					context,
					capability.id,
					ProductCapabilityAllowChoice.make({
						type: 'allow',
						confirmationPolicy: 'session'
					})
				);
				return yield* registry.invoke(
					context,
					ProductOperationInvocation.make({
						version: 1,
						operationId: 'bridge.read',
						input: null
					})
				);
			}).pipe(Effect.provide(runtime));

			assert.deepStrictEqual(output, { status: 'ready' });
		})
	);

	it.effect('keeps product denial authoritative before execution', () =>
		Effect.gen(function* () {
			let executions = 0;
			const integration = yield* defineProductIntegration({
				...integrationInput,
				operations: [
					{
						...operation,
						authorize: () =>
							Effect.fail(
								ProductOperationFailure.make({
									operationId: 'bridge.read',
									reason: 'product-denied',
									message: 'The product denied this operation.'
								})
							),
						execute: () => {
							executions += 1;
							return Effect.succeed({ status: 'unexpected' });
						}
					}
				]
			});
			const decisionStore = Layer.succeed(ProductCapabilityDecisionStore)({
				load: () => Effect.succeed({ decisions: [] }),
				save: () => Effect.void
			});
			const runtime = makeProductIntegrationRuntimeLayer({
				integration,
				events: makeProductEventsLayer({ policies: [], connectors: new Map() })
			}).pipe(Layer.provide(decisionStore));
			yield* Effect.gen(function* () {
				const broker = yield* ProductCapabilityBroker;
				const registry = yield* ProductCapabilityRegistry;
				yield* broker.decide(
					context,
					capability.id,
					ProductCapabilityAllowChoice.make({
						type: 'allow',
						confirmationPolicy: 'session'
					})
				);
				return yield* registry.invoke(
					context,
					ProductOperationInvocation.make({
						version: 1,
						operationId: 'bridge.read',
						input: null
					})
				);
			}).pipe(Effect.provide(runtime), Effect.result);

			assert.strictEqual(executions, 0);
		})
	);
});
