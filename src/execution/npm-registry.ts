import type { Fetcher } from '@riftydev/npm-client';

export const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org';

export const trustedNpmRegistryFetch: Fetcher = (url, init) => {
	const parsed = new URL(url);
	const method = (init?.method ?? 'GET').toUpperCase();
	if (
		parsed.protocol !== 'https:' ||
		parsed.origin !== NPM_REGISTRY_ORIGIN ||
		(method !== 'GET' && method !== 'HEAD')
	) {
		return Promise.reject(new Error('The trusted npm registry broker denied the request.'));
	}
	return fetch(parsed, {
		method,
		signal: init?.signal,
		credentials: 'omit',
		redirect: 'error',
		headers: {
			accept: 'application/vnd.npm.install-v1+json, application/json'
		}
	});
};
