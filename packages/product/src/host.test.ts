import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Result } from 'effect';
import { ProductHttpPolicy, ProductHttpRequest } from './contracts.js';
import {
	makeProductEventsLayer,
	makeProductGraphqlLayer,
	makeProductHttpLayer,
	ProductEvents,
	ProductGraphql,
	ProductHttp
} from './host.js';

const policy = ProductHttpPolicy.make({
	id: 'sdk.http.status',
	origin: 'https://api.example.test',
	pathPrefix: '/v1',
	methods: ['GET'],
	requestHeaders: [],
	responseHeaders: ['content-type'],
	requestBytes: 0,
	responseBytes: 65_536,
	deadlineMs: 5_000
});

const request = ProductHttpRequest.make({
	version: 1,
	policyId: policy.id,
	path: '/v1/status',
	method: 'GET',
	headers: []
});

describe('@flect/product trusted host adapters', () => {
	it.effect('runs one fixed HTTPS policy through the public host barrel', () => {
		const urls: Array<string> = [];
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			urls.push(input.toString());
			return new Response('{"status":"ready"}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		return Effect.gen(function* () {
			const http = yield* ProductHttp;
			const response = yield* http.invoke(request);

			assert.strictEqual(response.status, 200);
			assert.strictEqual(fetch.mock.calls.length, 1);
			assert.strictEqual(urls[0], 'https://api.example.test/v1/status');
		}).pipe(Effect.provide(makeProductHttpLayer({ policies: [policy], fetch })));
	});

	it.effect('sanitizes a private credential callback defect', () => {
		const fetch = vi.fn(async () => new Response('private'));
		return Effect.gen(function* () {
			const http = yield* ProductHttp;
			const result = yield* http.invoke(request).pipe(Effect.result);

			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'transport');
				assert.notInclude(JSON.stringify(result.failure), 'private-host-secret');
			}
			assert.strictEqual(fetch.mock.calls.length, 0);
		}).pipe(
			Effect.provide(
				makeProductHttpLayer({
					policies: [policy],
					fetch,
					credentialHeaders: () =>
						Effect.sync(() => {
							throw new Error('private-host-secret');
						})
				})
			)
		);
	});

	it('exports GraphQL and event services without constructing transport', () => {
		assert.isFunction(makeProductGraphqlLayer);
		assert.isFunction(makeProductEventsLayer);
		assert.isDefined(ProductGraphql);
		assert.isDefined(ProductEvents);
	});
});
