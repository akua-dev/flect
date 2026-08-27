import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	createProductConnectionRecord,
	detachProduct,
	evaluateProductAdoption,
	ProductConnectionRecord,
	ProductHostFacts,
	ProductUserState
} from './adoption.js';
import { AuthorizedProductOperation, ProductCapabilityManifest } from './contracts.js';
import { defineProductIntegration, type ProductIntegrationInput } from './integration.js';

const archive = new TextEncoder().encode('reference-capsule');
const archiveSha256 = '77ef986b6e6a2cf0ee10237668552e5f2ab4c5a890142e1f110a2cb436d20359';
const capability = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.reference.status',
	name: 'Read status',
	description: 'Read deterministic status.',
	operationIds: ['reference.status'],
	resourceIds: ['reference.workspace'],
	dataClassIds: ['reference.status'],
	confirmationPolicies: ['session', 'workspace', 'persistent']
});

const makeInput = (options?: {
	readonly connection?: 'offline' | 'browser-direct' | 'brokered';
	readonly authenticationOwner?: 'none' | 'product' | 'host';
	readonly integrationVersion?: string;
	readonly revision?: string;
	readonly migrations?: ReadonlyArray<{
		readonly version: 1;
		readonly from: string;
		readonly to: string;
		readonly disposition: 'compatible' | 'review' | 'blocked';
	}>;
}): ProductIntegrationInput => ({
	metadata: {
		version: 1,
		descriptor: {
			version: 1,
			id: 'dev.flect.reference',
			name: 'Reference product',
			description: 'A deterministic SDK reference product.',
			integrationVersion: options?.integrationVersion ?? '1.0.0',
			revision: options?.revision ?? 'reference-v1',
			productApiVersion: 1,
			connection: options?.connection ?? 'offline',
			authenticationOwner: options?.authenticationOwner ?? 'none',
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
			provenanceRevision: options?.revision ?? 'reference-v1',
			appExtensionIds: ['reference-app-guide'],
			shaperExtensionIds: ['reference-shaper-guide']
		},
		capabilities: [capability],
		migrations: options?.migrations ?? []
	},
	operations: [
		{
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
			execute: () => Effect.succeed({ status: 'ready' })
		}
	],
	events: [],
	selectedInferenceOwner: 'user',
	loadRecommendedExperience: Effect.succeed(archive)
});

const host = ProductHostFacts.make({
	version: 1,
	flectVersion: '0.2.0',
	platform: 'browser',
	online: true,
	productSessionAvailable: true,
	brokerAvailable: true,
	nativeAuthenticationAvailable: false
});

const userState = ProductUserState.make({
	version: 1,
	productId: 'dev.flect.reference',
	forkRevision: 'refs/heads/flect/personal',
	exportedSnapshotDigest: 'b'.repeat(64),
	decisionIds: ['decision-reference-status'],
	selectedInferenceOwner: 'user'
});

const reasons = (
	snapshot: Effect.Success<ReturnType<typeof evaluateProductAdoption>>
): ReadonlyArray<string> => snapshot.diagnostics.map((diagnostic) => diagnostic.reason);

describe('@flect/product adoption diagnostics', () => {
	it.effect('returns one deterministic ready state for initial offline adoption', () =>
		Effect.gen(function* () {
			const integration = yield* defineProductIntegration(makeInput());
			const first = yield* evaluateProductAdoption({
				integration,
				host,
				connection: undefined,
				userState,
				detached: false
			});
			const second = yield* evaluateProductAdoption({
				integration,
				host,
				connection: undefined,
				userState,
				detached: false
			});

			assert.strictEqual(first.state, 'ready');
			assert.deepStrictEqual(reasons(first), ['ready']);
			assert.deepStrictEqual(first, second);
		})
	);

	it.effect('reports browser-direct offline and broker authentication failures', () =>
		Effect.gen(function* () {
			const browser = yield* defineProductIntegration(
				makeInput({
					connection: 'browser-direct',
					authenticationOwner: 'product'
				})
			);
			const broker = yield* defineProductIntegration(
				makeInput({ connection: 'brokered', authenticationOwner: 'host' })
			);
			const offline = yield* evaluateProductAdoption({
				integration: browser,
				host: ProductHostFacts.make({ ...host, online: false }),
				connection: undefined,
				userState,
				detached: false
			});
			const unavailable = yield* evaluateProductAdoption({
				integration: broker,
				host: ProductHostFacts.make({ ...host, brokerAvailable: false }),
				connection: undefined,
				userState,
				detached: false
			});

			assert.strictEqual(offline.state, 'offline');
			assert.deepStrictEqual(reasons(offline), ['offline']);
			assert.strictEqual(unavailable.state, 'blocked');
			assert.deepStrictEqual(reasons(unavailable), ['authentication-unavailable']);
		})
	);

	it.effect('orders update, migration, review, and fork diagnostics', () =>
		Effect.gen(function* () {
			const previous = yield* defineProductIntegration(makeInput());
			const connection = createProductConnectionRecord(previous);
			const updated = yield* defineProductIntegration(
				makeInput({
					integrationVersion: '1.1.0',
					revision: 'reference-v2',
					migrations: [
						{
							version: 1,
							from: '1.0.0',
							to: '1.1.0',
							disposition: 'review'
						}
					]
				})
			);
			const changed = ProductConnectionRecord.make({
				...connection,
				capabilityDigest: 'c'.repeat(64),
				extensionDigest: 'd'.repeat(64)
			});
			const snapshot = yield* evaluateProductAdoption({
				integration: updated,
				host,
				connection: changed,
				userState,
				detached: false
			});

			assert.strictEqual(snapshot.state, 'review');
			assert.deepStrictEqual(reasons(snapshot), [
				'migration-required',
				'product-update',
				'capability-review',
				'extension-review',
				'fork-preserved'
			]);
		})
	);

	it.effect('blocks incompatible host and blocked migration deterministically', () =>
		Effect.gen(function* () {
			const previous = yield* defineProductIntegration(makeInput());
			const blocked = yield* defineProductIntegration(
				makeInput({
					integrationVersion: '2.0.0',
					revision: 'reference-v2',
					migrations: [
						{
							version: 1,
							from: '1.0.0',
							to: '2.0.0',
							disposition: 'blocked'
						}
					]
				})
			);
			const snapshot = yield* evaluateProductAdoption({
				integration: blocked,
				host: ProductHostFacts.make({
					...host,
					flectVersion: '1.0.0',
					platform: 'linux'
				}),
				connection: createProductConnectionRecord(previous),
				userState,
				detached: false
			});

			assert.strictEqual(snapshot.state, 'blocked');
			assert.deepStrictEqual(reasons(snapshot).slice(0, 3), [
				'incompatible-flect',
				'incompatible-host',
				'migration-blocked'
			]);
		})
	);

	it.effect('detaches without changing user-owned references', () =>
		Effect.gen(function* () {
			const integration = yield* defineProductIntegration(makeInput());
			const connection = createProductConnectionRecord(integration);
			const snapshot = yield* detachProduct({
				integration,
				host,
				connection,
				userState
			});

			assert.strictEqual(snapshot.state, 'detached');
			assert.deepStrictEqual(reasons(snapshot), ['detached', 'fork-preserved']);
			assert.deepStrictEqual(snapshot.userState, userState);
			assert.isUndefined(snapshot.connection);
		})
	);
});
