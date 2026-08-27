import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Fiber, Schema } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import {
	ProductHttpFailure,
	ProductHttpPolicy,
	ProductHttpRequest
} from '../../shared/product-http';
import { makeProductHttpLayer, ProductHttp } from './product-http';

const encoder = new TextEncoder();
const policy = ProductHttpPolicy.make({
	id: 'projects.read',
	origin: 'https://api.example.com',
	pathPrefix: '/v1/projects',
	methods: ['GET'],
	requestHeaders: ['accept', 'x-client-version'],
	responseHeaders: ['content-type', 'etag'],
	requestBytes: 1_024,
	responseBytes: 32,
	deadlineMs: 100
});

const request = (overrides: Partial<ProductHttpRequest> = {}) =>
	ProductHttpRequest.make({
		version: 1,
		policyId: policy.id,
		path: '/v1/projects?limit=2',
		method: 'GET',
		headers: [{ name: 'accept', value: 'application/json' }],
		...overrides
	});

describe('ProductHttp', () => {
	it.effect('rejects path, method, and secret-header authority before fetch', () =>
		Effect.gen(function* () {
			const fetch = vi.fn(() => Promise.resolve(new Response('never')));
			const layer = makeProductHttpLayer({ policies: [policy], fetch });
			const adapter = yield* ProductHttp.pipe(Effect.provide(layer));

			for (const denied of [
				request({ path: '/v1/users' }),
				request({ method: 'DELETE' }),
				request({ headers: [{ name: 'authorization', value: 'attacker' }] }),
				request({ path: 'https://evil.example/v1/projects' })
			]) {
				const error = yield* adapter.invoke(denied).pipe(Effect.flip);
				assert.strictEqual(error.reason, 'denied');
				assert.strictEqual(error.message, 'The product request failed safely.');
			}
			assert.strictEqual(fetch.mock.calls.length, 0);
		})
	);

	it.effect('injects host credentials privately and returns only bounded safe output', () =>
		Effect.gen(function* () {
			let observed: Request | undefined;
			const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				observed = new Request(input, init);
				return Promise.resolve(
					new Response('{"projects":["one"]}', {
						status: 200,
						headers: {
							'content-type': 'application/json',
							etag: '"revision-1"',
							'set-cookie': 'secret=cookie'
						}
					})
				);
			});
			const layer = makeProductHttpLayer({
				policies: [policy],
				fetch,
				credentialHeaders: () =>
					Effect.succeed([{ name: 'authorization', value: 'Bearer host-secret' }])
			});
			const response = yield* Effect.gen(function* () {
				return yield* (yield* ProductHttp).invoke(request());
			}).pipe(Effect.provide(layer));

			assert.strictEqual(observed?.url, 'https://api.example.com/v1/projects?limit=2');
			assert.strictEqual(observed?.headers.get('authorization'), 'Bearer host-secret');
			assert.deepStrictEqual(
				response.headers.map(({ name }) => name),
				['content-type', 'etag']
			);
			assert.strictEqual(new TextDecoder().decode(response.body), '{"projects":["one"]}');
			assert.notInclude(JSON.stringify(response), 'host-secret');
			assert.notInclude(JSON.stringify(response), 'secret=cookie');
		})
	);

	it.effect('cancels oversized responses and reports only a typed failure', () =>
		Effect.gen(function* () {
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.enqueue(encoder.encode('x'.repeat(40)));
				},
				cancel() {
					cancelled = true;
				}
			});
			const layer = makeProductHttpLayer({
				policies: [policy],
				fetch: () => Promise.resolve(new Response(body))
			});
			const error = yield* Effect.gen(function* () {
				return yield* (yield* ProductHttp).invoke(request());
			}).pipe(Effect.provide(layer), Effect.flip);

			assert.strictEqual(error.reason, 'oversized-response');
			assert.isTrue(cancelled);
			assert.isTrue(Schema.is(ProductHttpFailure)(error));
		})
	);

	it.effect('aborts transport at the policy deadline', () =>
		Effect.gen(function* () {
			let aborted = false;
			const layer = makeProductHttpLayer({
				policies: [policy],
				fetch: (_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							aborted = true;
							reject(new DOMException('aborted', 'AbortError'));
						});
					})
			});
			const running = yield* Effect.forkScoped(
				Effect.gen(function* () {
					return yield* (yield* ProductHttp).invoke(request());
				}).pipe(Effect.provide(layer), Effect.flip)
			);
			yield* TestClock.adjust('100 millis');
			const error = yield* Fiber.join(running);

			assert.strictEqual(error.reason, 'deadline');
			assert.isTrue(aborted);
		})
	);
});
