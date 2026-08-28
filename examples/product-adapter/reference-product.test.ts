import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Result, Stream } from 'effect';
import type { ProductEventConnector } from '../../packages/product/src/host/product-events';
import {
	ProductCapabilityAllowChoice,
	ProductOperationInvocation
} from '../../packages/product/src/product-capability';
import {
	ProductCapabilityDecisionStore,
	type ProductCapabilityDecisionStoreShape
} from '../../src/capabilities/product-capability-decision-store';
import {
	ProductCapabilityRegistry,
	type ProductCapabilityRegistryShape
} from '../../src/capabilities/product-capability-registry';
import { ProductEventRegistry } from '../../src/capabilities/product-event-registry';
import {
	makeReferenceProductLayer,
	REFERENCE_CAPABILITIES,
	REFERENCE_OPERATIONS,
	referenceProductContext
} from './reference-product';

const secret = 'reference-host-secret-never-public';

const decisionStore = Layer.succeed(ProductCapabilityDecisionStore)({
	load: () => Effect.succeed({ decisions: [] }),
	save: () => Effect.void
} satisfies ProductCapabilityDecisionStoreShape);

const allow = ProductCapabilityAllowChoice.make({
	type: 'allow',
	confirmationPolicy: 'session'
});

const invocation = (operationId: string, input: object = {}) =>
	ProductOperationInvocation.make({ version: 1, operationId, input });

const makeFixture = (options?: {
	readonly inferenceOwner?: 'user' | 'product';
	readonly denyOperation?: string;
}) => {
	const bodies: Array<string> = [];
	const authorizationHeaders: Array<string | null> = [];
	const authorizations: Array<string> = [];
	const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		const requestBody = init?.body;
		const body = requestBody instanceof Uint8Array ? new TextDecoder().decode(requestBody) : '';
		bodies.push(body);
		authorizationHeaders.push(new Headers(init?.headers).get('authorization'));
		if (body.includes('ReferenceProjects')) {
			return new Response(
				JSON.stringify({
					data: {
						projects: [{ id: 'alpha', name: 'Alpha', status: 'active' }]
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}
		return new Response(
			JSON.stringify({
				data: { archiveProject: { id: 'alpha', status: 'archived' } }
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
	});
	const connector: ProductEventConnector = {
		open: ({ emit }) =>
			Effect.gen(function* () {
				yield* emit({
					version: 1,
					policyId: 'reference.projects.events.v1',
					sequence: '1',
					payload: { projectId: 'alpha', status: 'active' }
				});
				yield* emit({
					version: 1,
					policyId: 'reference.projects.events.v1',
					sequence: '2',
					payload: { projectId: 'alpha', status: 'archived' }
				});
				return yield* Effect.never;
			})
	};
	const layer = makeReferenceProductLayer({
		inferenceOwner: options?.inferenceOwner ?? 'user',
		fetch,
		credentialHeaders: (policyId) =>
			Effect.succeed(
				policyId === 'reference.projects.archive.v1'
					? [{ name: 'authorization', value: `Bearer ${secret}` }]
					: []
			),
		authorize: ({ operationId }) => {
			authorizations.push(operationId);
			return Effect.succeed(operationId !== options?.denyOperation);
		},
		eventConnector: connector
	}).pipe(Layer.provide(decisionStore));
	return { authorizationHeaders, authorizations, bodies, fetch, layer };
};

const grant = (registry: ProductCapabilityRegistryShape, capabilityId: string) =>
	registry.decide(referenceProductContext, capabilityId, allow);

describe('reference product adapter', () => {
	it.effect('composes offline, fixed GraphQL, authenticated mutation, and event operations', () => {
		const fixture = makeFixture();
		return Effect.gen(function* () {
			const registry = yield* ProductCapabilityRegistry;
			const events = yield* ProductEventRegistry;
			for (const capabilityId of Object.values(REFERENCE_CAPABILITIES)) {
				yield* grant(registry, capabilityId);
			}

			const status = yield* registry.invoke(
				referenceProductContext,
				invocation(REFERENCE_OPERATIONS.status)
			);
			const projects = yield* registry.invoke(
				referenceProductContext,
				invocation(REFERENCE_OPERATIONS.list, {
					workspaceId: 'reference-workspace'
				})
			);
			const archived = yield* registry.invoke(
				referenceProductContext,
				invocation(REFERENCE_OPERATIONS.archive, { projectId: 'alpha' })
			);
			const delivered = yield* events
				.subscribe(
					referenceProductContext,
					invocation(REFERENCE_OPERATIONS.subscribe, {
						workspaceId: 'reference-workspace'
					})
				)
				.pipe(Stream.take(2), Stream.runCollect);

			assert.deepStrictEqual(status, { status: 'ready' });
			assert.deepStrictEqual(projects, {
				projects: [{ id: 'alpha', name: 'Alpha', status: 'active' }]
			});
			assert.deepStrictEqual(archived, {
				archiveProject: { id: 'alpha', status: 'archived' }
			});
			assert.deepStrictEqual(
				[...delivered].map((event) => event.sequence),
				['1', '2']
			);
			assert.deepStrictEqual(fixture.authorizationHeaders, [null, `Bearer ${secret}`]);
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect('lets product denial defeat a user grant before transport', () => {
		const fixture = makeFixture({
			denyOperation: REFERENCE_OPERATIONS.archive
		});
		return Effect.gen(function* () {
			const registry = yield* ProductCapabilityRegistry;
			yield* grant(registry, REFERENCE_CAPABILITIES.write);
			const result = yield* registry
				.invoke(
					referenceProductContext,
					invocation(REFERENCE_OPERATIONS.archive, { projectId: 'alpha' })
				)
				.pipe(Effect.result);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'product-denied');
				assert.notInclude(JSON.stringify(result.failure), secret);
			}
			assert.strictEqual(fixture.fetch.mock.calls.length, 0);
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect('keeps credentials out of public encoded values and request bodies', () => {
		const fixture = makeFixture();
		return Effect.gen(function* () {
			const registry = yield* ProductCapabilityRegistry;
			yield* grant(registry, REFERENCE_CAPABILITIES.write);
			const output = yield* registry.invoke(
				referenceProductContext,
				invocation(REFERENCE_OPERATIONS.archive, { projectId: 'alpha' })
			);
			assert.notInclude(JSON.stringify(output), secret);
			assert.notInclude(JSON.stringify(fixture.bodies), secret);
			assert.strictEqual(fixture.authorizationHeaders[0], `Bearer ${secret}`);
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect('keeps product authorization identical across inference owners', () => {
		const user = makeFixture({ inferenceOwner: 'user' });
		const product = makeFixture({ inferenceOwner: 'product' });
		const run = (layer: typeof user.layer) =>
			Effect.gen(function* () {
				const registry = yield* ProductCapabilityRegistry;
				yield* grant(registry, REFERENCE_CAPABILITIES.read);
				return yield* registry.invoke(
					referenceProductContext,
					invocation(REFERENCE_OPERATIONS.list, {
						workspaceId: 'reference-workspace'
					})
				);
			}).pipe(Effect.provide(layer));
		return Effect.gen(function* () {
			assert.deepStrictEqual(yield* run(user.layer), yield* run(product.layer));
			assert.deepStrictEqual(user.authorizations, product.authorizations);
		});
	});
});
