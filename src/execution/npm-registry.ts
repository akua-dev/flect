import type { Fetcher } from '@riftydev/npm-client';
import { Data, Effect } from 'effect';

export class UntrustedNpmRegistryRequestError extends Data.TaggedError(
	'UntrustedNpmRegistryRequestError'
) {}

export const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org';

const trustedNpmRegistryFetchEffect = Effect.fn('Execution.trustedNpmRegistryFetch')(function* (
	url: Parameters<Fetcher>[0],
	init: Parameters<Fetcher>[1]
) {
	const parsed = new URL(url);
	const method = (init?.method ?? 'GET').toUpperCase();
	if (
		parsed.protocol !== 'https:' ||
		parsed.origin !== NPM_REGISTRY_ORIGIN ||
		(method !== 'GET' && method !== 'HEAD')
	) {
		return yield* Effect.fail(new UntrustedNpmRegistryRequestError());
	}
	return yield* Effect.promise(() =>
		fetch(parsed, {
			method,
			signal: init?.signal,
			credentials: 'omit',
			redirect: 'error',
			headers: {
				accept: 'application/vnd.npm.install-v1+json, application/json'
			}
		})
	);
});

export const trustedNpmRegistryFetch: Fetcher = (url, init) =>
	Effect.runPromise(
		trustedNpmRegistryFetchEffect(url, init).pipe(
			Effect.catchTag('UntrustedNpmRegistryRequestError', () =>
				Effect.fail(new Error('The trusted npm registry broker denied the request.'))
			)
		)
	);
