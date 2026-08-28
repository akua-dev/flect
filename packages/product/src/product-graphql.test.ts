import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema, type SchemaAST } from 'effect';
import {
	ProductGraphqlFailure,
	ProductGraphqlPolicy,
	ProductGraphqlRequest,
	ProductGraphqlResponse
} from './product-graphql';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const policy = {
	version: 1,
	id: 'reference.graphql.projects',
	endpoint: 'https://api.example.test/graphql',
	operationId: 'projects.list',
	operationName: 'ProjectsList',
	operationType: 'query',
	documentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	requestBytes: 65_536,
	responseBytes: 1_048_576,
	deadlineMs: 5_000
};

describe('product GraphQL contracts', () => {
	it.effect('decodes a strict fixed-document policy and bounded request', () =>
		Effect.gen(function* () {
			const decodedPolicy = yield* Schema.decodeUnknownEffect(ProductGraphqlPolicy, strict)(policy);
			const request = yield* Schema.decodeUnknownEffect(
				ProductGraphqlRequest,
				strict
			)({
				version: 1,
				policyId: policy.id,
				variables: { limit: 20 }
			});

			assert.strictEqual(decodedPolicy.operationName, 'ProjectsList');
			assert.deepStrictEqual(request.variables, { limit: 20 });
		})
	);

	it.effect('rejects unsafe endpoints, malformed metadata, and excess fields', () =>
		Effect.gen(function* () {
			for (const invalid of [
				{ ...policy, endpoint: 'http://api.example.test/graphql' },
				{
					...policy,
					endpoint: 'https://user:secret@api.example.test/graphql'
				},
				{ ...policy, endpoint: 'https://api.example.test/graphql#private' },
				{ ...policy, operationId: 'Projects List' },
				{ ...policy, operationName: 'projects-list' },
				{ ...policy, documentSha256: 'ABCDEF' },
				{ ...policy, requestBytes: 0 },
				{ ...policy, responseBytes: 8 * 1024 * 1024 + 1 },
				{ ...policy, deadlineMs: 99 },
				{ ...policy, credential: 'Bearer private' }
			]) {
				const error = yield* Schema.decodeUnknownEffect(
					ProductGraphqlPolicy,
					strict
				)(invalid).pipe(Effect.flip);
				assert.strictEqual(error._tag, 'SchemaError');
			}
		})
	);

	it.effect('rejects oversized variables before transport', () =>
		Schema.decodeUnknownEffect(
			ProductGraphqlRequest,
			strict
		)({
			version: 1,
			policyId: policy.id,
			variables: { value: 'x'.repeat(1024 * 1024) }
		}).pipe(
			Effect.flip,
			Effect.tap((error) => Effect.sync(() => assert.strictEqual(error._tag, 'SchemaError')))
		)
	);

	it.effect('decodes only public bounded GraphQL output', () =>
		Effect.gen(function* () {
			const response = yield* Schema.decodeUnknownEffect(
				ProductGraphqlResponse,
				strict
			)({
				version: 1,
				data: { projects: [{ id: 'one' }] },
				errors: [{ code: 'PROJECT_ARCHIVED', message: 'Project unavailable.' }]
			});
			assert.deepStrictEqual(response.data, { projects: [{ id: 'one' }] });

			for (const invalid of [
				{ version: 1 },
				{
					version: 1,
					errors: [{ code: 'PRIVATE', message: 'Denied', stack: 'secret' }]
				},
				{
					version: 1,
					errors: [{ code: 'X'.repeat(81), message: 'Denied' }]
				}
			]) {
				const error = yield* Schema.decodeUnknownEffect(
					ProductGraphqlResponse,
					strict
				)(invalid).pipe(Effect.flip);
				assert.strictEqual(error._tag, 'SchemaError');
			}
		})
	);

	it('keeps public failures closed and credential-free', () => {
		const failure = ProductGraphqlFailure.make({
			policyId: policy.id,
			reason: 'product-denied',
			message: 'The product GraphQL operation failed safely.'
		});

		assert.deepStrictEqual(JSON.parse(JSON.stringify(failure)), {
			_tag: 'ProductGraphqlFailure',
			policyId: policy.id,
			reason: 'product-denied',
			message: 'The product GraphQL operation failed safely.'
		});
		assert.notInclude(JSON.stringify(failure), 'credential');
	});
});
