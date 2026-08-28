import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema, type SchemaAST } from 'effect';
import {
	ProductCapabilityDecision,
	ProductCapabilityDecisionRecord,
	ProductCapabilityManifest
} from './product-capability';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const manifest = {
	version: 1,
	id: 'product.projects.read',
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent'],
	maxGrantDurationMs: 86_400_000,
	maxRate: {
		maxInvocations: 60,
		intervalMs: 60_000
	}
};

const decision = {
	version: 2,
	decisionId: 'decision-00000001',
	scopeId: 'dev.akua.projects',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	capabilityId: 'product.projects.read',
	status: 'granted',
	confirmationPolicy: 'workspace',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	expiresAtMillis: 86_400_000,
	rateLimit: {
		maxInvocations: 60,
		intervalMs: 60_000
	},
	usage: {
		totalInvocations: 1,
		windowInvocations: 1,
		windowStartedAtMillis: 1_000
	},
	createdAtMillis: 1_000,
	updatedAtMillis: 2_000,
	authority: 'protected-user'
};

describe('product capability contracts', () => {
	it.effect('decodes one strict bounded capability manifest', () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(
				ProductCapabilityManifest,
				strict
			)(manifest);

			assert.strictEqual(decoded.id, 'product.projects.read');
			assert.deepStrictEqual(decoded.confirmationPolicies, [
				'once',
				'session',
				'workspace',
				'persistent'
			]);
		})
	);

	it.effect('rejects duplicate manifest scope and excess authority', () =>
		Effect.gen(function* () {
			const duplicate = yield* Schema.decodeUnknownEffect(
				ProductCapabilityManifest,
				strict
			)({
				...manifest,
				operationIds: ['projects.list', 'projects.list']
			}).pipe(Effect.flip);
			assert.strictEqual(duplicate._tag, 'SchemaError');

			const excess = yield* Schema.decodeUnknownEffect(
				ProductCapabilityManifest,
				strict
			)({ ...manifest, ambientNetwork: true }).pipe(Effect.flip);
			assert.strictEqual(excess._tag, 'SchemaError');
		})
	);

	it.effect('decodes a workspace-scoped durable decision record', () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(
				ProductCapabilityDecisionRecord,
				strict
			)({ version: 2, decisions: [decision] });

			assert.strictEqual(decoded.decisions[0]?.status, 'granted');
			assert.strictEqual(decoded.decisions[0]?.workspaceId, 'workspace-local-default');
		})
	);

	it.effect('rejects invalid policy, time, and duplicated decision scope', () =>
		Effect.gen(function* () {
			for (const invalid of [
				{ ...decision, confirmationPolicy: 'persistent' },
				(() => {
					const { workspaceId: _, ...withoutWorkspace } = decision;
					return withoutWorkspace;
				})(),
				{ ...decision, expiresAtMillis: 999 },
				{
					...decision,
					operationIds: ['projects.list', 'projects.list']
				}
			]) {
				const error = yield* Schema.decodeUnknownEffect(
					ProductCapabilityDecision,
					strict
				)(invalid).pipe(Effect.flip);
				assert.strictEqual(error._tag, 'SchemaError');
			}
		})
	);
});
