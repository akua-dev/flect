import { assert, describe, it } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';
import {
	AuthorizedProductOperation,
	ProductCapabilityManifest,
	type ProductJson,
	ProductOperationFailure
} from './contracts.js';
import {
	defineProductIntegration,
	isProductIntegration,
	ProductIntegrationFailure,
	type ProductIntegrationInput,
	type ProductOperationDefinition
} from './integration.js';

const archive = new TextEncoder().encode('reference-capsule');
const archiveSha256 = '77ef986b6e6a2cf0ee10237668552e5f2ab4c5a890142e1f110a2cb436d20359';

const capability = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.reference.status',
	name: 'Read status',
	description: 'Read deterministic product status.',
	operationIds: ['reference.status'],
	resourceIds: ['reference.workspace'],
	dataClassIds: ['reference.status'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
});

const denied = () =>
	ProductOperationFailure.make({
		operationId: 'reference.status',
		reason: 'product-denied',
		message: 'The product denied this operation.'
	});

const operation: ProductOperationDefinition = {
	id: 'reference.status',
	capabilityId: capability.id,
	authorize: () =>
		Effect.succeed(
			AuthorizedProductOperation.make({
				version: 1,
				capabilityId: capability.id,
				operationId: 'reference.status',
				resourceIds: ['reference.workspace'],
				dataClassIds: ['reference.status']
			})
		),
	execute: (): Effect.Effect<ProductJson, ProductOperationFailure> =>
		Effect.succeed({ status: 'ready' })
};

const metadata = {
	version: 1,
	descriptor: {
		version: 1,
		id: 'dev.flect.reference',
		name: 'Reference product',
		description: 'A deterministic SDK reference product.',
		integrationVersion: '1.0.0',
		revision: 'reference-v1',
		productApiVersion: 1,
		connection: 'offline',
		authenticationOwner: 'none',
		compatibility: {
			flect: '>=0.2.0 <1.0.0',
			platforms: ['browser', 'macos']
		},
		inference: {
			allowedOwners: ['user', 'product'],
			defaultOwner: 'user'
		}
	},
	experience: {
		version: 1,
		capsuleId: 'dev.flect.reference',
		capsuleVersion: '1.0.0',
		archiveSha256,
		provenanceRevision: 'reference-v1',
		appExtensionIds: ['reference-app-guide'],
		shaperExtensionIds: ['reference-shaper-guide']
	},
	capabilities: [capability],
	migrations: []
};

const input = (overrides: Partial<ProductIntegrationInput> = {}): ProductIntegrationInput => ({
	metadata,
	operations: [operation],
	events: [],
	selectedInferenceOwner: 'user',
	loadRecommendedExperience: Effect.succeed(archive),
	...overrides
});

describe('@flect/product integration', () => {
	it.effect('validates and brands one complete integration', () =>
		Effect.gen(function* () {
			const integration = yield* defineProductIntegration(input());

			assert.isTrue(isProductIntegration(integration));
			assert.strictEqual(integration.metadata.descriptor.id, metadata.descriptor.id);
			assert.strictEqual(integration.selectedInferenceOwner, 'user');
			assert.strictEqual(
				new TextDecoder().decode(yield* integration.loadRecommendedExperience),
				'reference-capsule'
			);
			assert.match(integration.capabilityDigest, /^[0-9a-f]{64}$/);
			assert.match(integration.extensionDigest, /^[0-9a-f]{64}$/);
		})
	);

	it.effect('rejects invalid metadata and cross references', () =>
		Effect.gen(function* () {
			const cases: ReadonlyArray<ProductIntegrationInput> = [
				input({
					metadata: {
						...metadata,
						descriptor: {
							...metadata.descriptor,
							connection: 'offline',
							authenticationOwner: 'host'
						}
					}
				}),
				input({
					metadata: {
						...metadata,
						descriptor: {
							...metadata.descriptor,
							inference: {
								allowedOwners: ['user'],
								defaultOwner: 'product'
							}
						}
					}
				}),
				input({ operations: [operation, operation] }),
				input({
					operations: [{ ...operation, capabilityId: 'product.unknown.read' }]
				}),
				input({
					metadata: {
						...metadata,
						experience: {
							...metadata.experience,
							archiveSha256: 'a'.repeat(64)
						}
					}
				})
			];

			for (const candidate of cases) {
				const result = yield* defineProductIntegration(candidate).pipe(Effect.result);
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) {
					assert.isTrue(Schema.is(ProductIntegrationFailure)(result.failure));
					assert.notInclude(JSON.stringify(result.failure), 'reference-capsule');
				}
			}
		})
	);

	it.effect('sanitizes a private archive-loader defect', () =>
		Effect.gen(function* () {
			const result = yield* defineProductIntegration(
				input({
					loadRecommendedExperience: Effect.die(new Error('private-host-secret'))
				})
			).pipe(Effect.result);

			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'invalid-experience');
				assert.notInclude(JSON.stringify(result.failure), 'private-host-secret');
			}
		})
	);

	it.effect('keeps inference choice outside product authorization', () =>
		Effect.gen(function* () {
			const authorizations: Array<string> = [];
			const authorize = (candidate: ProductOperationDefinition) => ({
				...candidate,
				authorize: (value: ProductJson) => {
					authorizations.push(JSON.stringify(value));
					return candidate.authorize(value);
				}
			});
			const user = yield* defineProductIntegration(input({ operations: [authorize(operation)] }));
			const product = yield* defineProductIntegration(
				input({
					operations: [authorize(operation)],
					selectedInferenceOwner: 'product'
				})
			);

			yield* user.operations[0]?.authorize({});
			yield* product.operations[0]?.authorize({});
			assert.deepStrictEqual(authorizations, ['{}', '{}']);
		})
	);

	it.effect('represents product denial without executing transport', () =>
		Effect.gen(function* () {
			let executions = 0;
			const rejecting: ProductOperationDefinition = {
				...operation,
				authorize: () => Effect.fail(denied()),
				execute: () => {
					executions += 1;
					return Effect.succeed({ status: 'should-not-run' });
				}
			};
			const integration = yield* defineProductIntegration(input({ operations: [rejecting] }));
			const result = yield* integration.operations[0]?.authorize({}).pipe(Effect.result);

			assert.isTrue(Result.isFailure(result));
			assert.strictEqual(executions, 0);
		})
	);
});
