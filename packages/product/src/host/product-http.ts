import { Cause, Context, Effect, Layer, Schema } from 'effect';
import {
	ProductHttpFailure,
	type ProductHttpHeader,
	type ProductHttpPolicy,
	type ProductHttpRequest,
	ProductHttpResponse
} from '../product-http.js';

export interface ProductHttpShape {
	readonly invoke: (
		request: ProductHttpRequest
	) => Effect.Effect<ProductHttpResponse, ProductHttpFailure>;
}

export class ProductHttp extends Context.Service<ProductHttp, ProductHttpShape>()(
	'flect/ProductHttp'
) {}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const failed = (policyId: string, reason: ProductHttpFailure['reason']) =>
	ProductHttpFailure.make({
		policyId,
		reason,
		message: 'The product request failed safely.'
	});

const validPolicy = (policy: ProductHttpPolicy) => {
	try {
		const origin = new URL(policy.origin);
		return (
			origin.protocol === 'https:' &&
			origin.origin === policy.origin &&
			origin.pathname === '/' &&
			origin.search === '' &&
			origin.hash === '' &&
			new Set(policy.methods).size === policy.methods.length &&
			new Set(policy.requestHeaders.map((name) => name.toLowerCase())).size ===
				policy.requestHeaders.length &&
			new Set(policy.responseHeaders.map((name) => name.toLowerCase())).size ===
				policy.responseHeaders.length
		);
	} catch {
		return false;
	}
};

const boundedBody = (
	response: Response,
	policy: ProductHttpPolicy
): Effect.Effect<Uint8Array, ProductHttpFailure> =>
	Effect.tryPromise({
		try: async (signal) => {
			const reader = response.body?.getReader();
			if (reader === undefined) return new Uint8Array();
			const chunks: Array<Uint8Array> = [];
			let total = 0;
			const cancel = () => void reader.cancel();
			signal.addEventListener('abort', cancel, { once: true });
			try {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					total += chunk.value.byteLength;
					if (total > policy.responseBytes) {
						await reader.cancel();
						throw failed(policy.id, 'oversized-response');
					}
					chunks.push(chunk.value);
				}
			} finally {
				signal.removeEventListener('abort', cancel);
			}
			const body = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return body;
		},
		catch: (error) =>
			Schema.is(ProductHttpFailure)(error) ? error : failed(policy.id, 'transport')
	});

export const makeProductHttpLayer = (options: {
	readonly policies: ReadonlyArray<ProductHttpPolicy>;
	readonly fetch?: Fetch;
	readonly credentialHeaders?: (
		policyId: string
	) => Effect.Effect<ReadonlyArray<ProductHttpHeader>>;
}) => {
	const policies = new Map(options.policies.map((policy) => [policy.id, policy]));
	const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	const credentials = options.credentialHeaders ?? (() => Effect.succeed([]));

	return Layer.succeed(ProductHttp)({
		invoke: Effect.fn('Flect.ProductHttp.invoke')((request) =>
			Effect.gen(function* () {
				const policy = policies.get(request.policyId);
				if (policy === undefined || !validPolicy(policy)) {
					return yield* Effect.fail(failed(request.policyId, 'invalid-policy'));
				}
				if (
					!policy.methods.includes(request.method) ||
					(request.body?.byteLength ?? 0) > policy.requestBytes
				) {
					return yield* Effect.fail(
						failed(
							policy.id,
							(request.body?.byteLength ?? 0) > policy.requestBytes ? 'oversized-request' : 'denied'
						)
					);
				}
				let url: URL;
				try {
					if (/^[a-z][a-z0-9+.-]*:/i.test(request.path) || request.path.startsWith('//')) {
						throw new Error('absolute URL');
					}
					url = new URL(request.path, `${policy.origin}/`);
				} catch {
					return yield* Effect.fail(failed(policy.id, 'denied'));
				}
				if (
					url.origin !== policy.origin ||
					url.hash !== '' ||
					(url.pathname !== policy.pathPrefix && !url.pathname.startsWith(`${policy.pathPrefix}/`))
				) {
					return yield* Effect.fail(failed(policy.id, 'denied'));
				}
				const allowed = new Set(policy.requestHeaders.map((name) => name.toLowerCase()));
				const seen = new Set<string>();
				const headers = new Headers();
				for (const header of request.headers) {
					const name = header.name.toLowerCase();
					if (
						seen.has(name) ||
						!allowed.has(name) ||
						['authorization', 'cookie', 'host', 'content-length'].includes(name)
					) {
						return yield* Effect.fail(failed(policy.id, 'denied'));
					}
					seen.add(name);
					headers.set(name, header.value);
				}
				const credentialValues = yield* credentials(policy.id).pipe(
					Effect.catchCause((cause) =>
						Cause.hasInterrupts(cause)
							? Effect.failCause(cause)
							: Effect.fail(failed(policy.id, 'transport'))
					)
				);
				for (const header of credentialValues) {
					headers.set(header.name, header.value);
				}
				const transport = Effect.tryPromise({
					try: (signal) =>
						fetch(url, {
							method: request.method,
							headers,
							...(request.body === undefined ? {} : { body: Uint8Array.from(request.body) }),
							credentials: 'omit',
							redirect: 'error',
							signal
						}),
					catch: () => failed(policy.id, 'transport')
				}).pipe(
					Effect.flatMap((response) =>
						boundedBody(response, policy).pipe(
							Effect.map((body) =>
								ProductHttpResponse.make({
									version: 1,
									status: response.status,
									headers: policy.responseHeaders.flatMap((name) => {
										const value = response.headers.get(name);
										return value === null ? [] : [{ name: name.toLowerCase(), value }];
									}),
									body
								})
							)
						)
					)
				);
				return yield* transport.pipe(
					Effect.timeoutOrElse({
						duration: policy.deadlineMs,
						orElse: () => Effect.fail(failed(policy.id, 'deadline'))
					})
				);
			})
		)
	});
};
