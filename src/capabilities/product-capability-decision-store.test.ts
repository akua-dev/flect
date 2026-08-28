import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
	ProductCapabilityDecision,
	ProductCapabilityManifest
} from '../../packages/product/src/product-capability';
import { InterfaceStorage, InterfaceStorageError } from '../lib/interface-store';
import {
	makeProductCapabilityDecisionStoreLayer,
	ProductCapabilityDecisionStore
} from './product-capability-decision-store';

const V1_KEY = 'flect.product-capability-grants.v1';
const V2_KEY = 'flect.product-capability-decisions.v2';

const manifest = ProductCapabilityManifest.make({
	version: 1,
	id: 'product.projects.read',
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['session', 'workspace', 'persistent']
});

const context = {
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	manifest
};

const durableDecision = ProductCapabilityDecision.make({
	version: 2,
	decisionId: 'decision-persisted-0001',
	scopeId: 'dev.akua.projects',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	capabilityId: 'product.projects.read',
	status: 'granted',
	confirmationPolicy: 'persistent',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	createdAtMillis: 1,
	updatedAtMillis: 1,
	authority: 'protected-user'
});

const makeStorage = (initial: Readonly<Record<string, string>> = {}) => {
	const values = new Map(Object.entries(initial));
	const write = vi.fn((key: string, value: string) =>
		Effect.sync(() => {
			values.set(key, value);
		})
	);
	const remove = vi.fn((key: string) =>
		Effect.sync(() => {
			values.delete(key);
		})
	);
	const layer = Layer.succeed(InterfaceStorage)({
		read: (key) => Effect.succeed(values.get(key) ?? null),
		write,
		remove
	});
	return { layer, remove, values, write };
};

describe('ProductCapabilityDecisionStore', () => {
	it.effect('round-trips a strict normalized v2 decision record', () => {
		const storage = makeStorage({
			[V2_KEY]: JSON.stringify({
				version: 2,
				decisions: [durableDecision]
			})
		});
		const layer = makeProductCapabilityDecisionStoreLayer.pipe(Layer.provide(storage.layer));
		return Effect.gen(function* () {
			const store = yield* ProductCapabilityDecisionStore;
			const loaded = yield* store.load([]);
			assert.deepStrictEqual(loaded.decisions, [durableDecision]);
			assert.isUndefined(loaded.warning);

			yield* store.save([
				ProductCapabilityDecision.make({
					...durableDecision,
					decisionId: 'decision-persisted-0002'
				}),
				durableDecision
			]);
			assert.strictEqual(
				storage.values.get(V2_KEY),
				JSON.stringify({
					version: 2,
					decisions: [
						durableDecision,
						{ ...durableDecision, decisionId: 'decision-persisted-0002' }
					]
				})
			);
		}).pipe(Effect.provide(layer));
	});

	it.effect('fails closed when a v2 record is malformed or excessive', () => {
		const storage = makeStorage({
			[V2_KEY]: JSON.stringify({
				version: 2,
				decisions: [durableDecision],
				ambientAuthority: true
			}),
			[V1_KEY]: JSON.stringify({
				version: 1,
				states: [
					{
						scopeId: 'dev.akua.projects',
						capabilityId: 'product.projects.read',
						granted: true
					}
				]
			})
		});
		return Effect.gen(function* () {
			const store = yield* ProductCapabilityDecisionStore;
			const loaded = yield* store.load([context]);
			assert.deepStrictEqual(loaded.decisions, []);
			assert.strictEqual(loaded.warning?.reason, 'invalid-record');
			assert.strictEqual(storage.write.mock.calls.length, 0);
		}).pipe(
			Effect.provide(makeProductCapabilityDecisionStoreLayer.pipe(Layer.provide(storage.layer)))
		);
	});

	it.effect('migrates only a matched and currently bounded v1 decision', () => {
		const storage = makeStorage({
			[V1_KEY]: JSON.stringify({
				version: 1,
				states: [
					{
						scopeId: 'dev.akua.projects',
						capabilityId: 'product.projects.read',
						granted: true
					},
					{
						scopeId: 'dev.akua.unknown',
						capabilityId: 'product.projects.read',
						granted: true
					}
				]
			})
		});
		return Effect.gen(function* () {
			const store = yield* ProductCapabilityDecisionStore;
			const loaded = yield* store.load([context]);
			assert.strictEqual(loaded.decisions.length, 1);
			assert.strictEqual(loaded.decisions[0]?.status, 'granted');
			assert.strictEqual(loaded.decisions[0]?.confirmationPolicy, 'persistent');
			assert.deepStrictEqual(loaded.decisions[0]?.operationIds, ['projects.list']);
			assert.strictEqual(loaded.decisions[0]?.requestDigest, context.requestDigest);
			assert.isTrue(storage.values.has(V2_KEY));
			assert.isTrue(storage.values.has(V1_KEY));
			assert.strictEqual(storage.remove.mock.calls.length, 0);

			const completed = yield* store.load([
				context,
				{
					...context,
					scopeId: 'dev.akua.unknown',
					requestDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
				}
			]);
			assert.strictEqual(completed.decisions.length, 2);
			assert.isFalse(storage.values.has(V1_KEY));
		}).pipe(
			Effect.provide(makeProductCapabilityDecisionStoreLayer.pipe(Layer.provide(storage.layer)))
		);
	});

	it.effect('migrates false to revoked and never invents a disallowed policy', () => {
		const storage = makeStorage({
			[V1_KEY]: JSON.stringify({
				version: 1,
				states: [
					{
						scopeId: 'dev.akua.projects',
						capabilityId: 'product.projects.read',
						granted: false
					}
				]
			})
		});
		const sessionOnly = {
			...context,
			manifest: ProductCapabilityManifest.make({
				...manifest,
				confirmationPolicies: ['session']
			})
		};
		return Effect.gen(function* () {
			const store = yield* ProductCapabilityDecisionStore;
			const withoutPersistent = yield* store.load([sessionOnly]);
			assert.deepStrictEqual(withoutPersistent.decisions, []);
			assert.isTrue(storage.values.has(V1_KEY));

			const migrated = yield* store.load([context]);
			assert.strictEqual(migrated.decisions[0]?.status, 'revoked');
			assert.isFalse(storage.values.has(V1_KEY));
			assert.strictEqual(storage.remove.mock.calls[0]?.[0], V1_KEY);
		}).pipe(
			Effect.provide(makeProductCapabilityDecisionStoreLayer.pipe(Layer.provide(storage.layer)))
		);
	});

	it.effect('keeps v1 and returns no migrated authority when v2 save fails', () => {
		const storage = makeStorage({
			[V1_KEY]: JSON.stringify({
				version: 1,
				states: [
					{
						scopeId: 'dev.akua.projects',
						capabilityId: 'product.projects.read',
						granted: true
					}
				]
			})
		});
		const failedStorage = Layer.succeed(InterfaceStorage)({
			read: (key) => Effect.succeed(storage.values.get(key) ?? null),
			write: () =>
				Effect.fail(
					InterfaceStorageError.make({
						message: 'Interface storage is unavailable.'
					})
				),
			remove: storage.remove
		});
		return Effect.gen(function* () {
			const store = yield* ProductCapabilityDecisionStore;
			const loaded = yield* store.load([context]);
			assert.deepStrictEqual(loaded.decisions, []);
			assert.strictEqual(loaded.warning?.reason, 'persistence-failed');
			assert.isTrue(storage.values.has(V1_KEY));
			assert.strictEqual(storage.remove.mock.calls.length, 0);
		}).pipe(
			Effect.provide(makeProductCapabilityDecisionStoreLayer.pipe(Layer.provide(failedStorage)))
		);
	});
});
