import { createServer } from 'node:http';
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer';
import { Deferred, Effect, Exit, Layer, Option, Redacted, Scope, Stream } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { ProviderAuthOperationFailed } from '../shared/contracts';
import { ProtectedPromptHost, type ProtectedPromptLease } from './provider-authentication';

const MAX_FORM_BYTES = 8 * 1024;
const MAX_VALUE_BYTES = 4 * 1024;

const entryFailure = () =>
	ProviderAuthOperationFailed.make({
		operation: 'reply',
		message: 'Provider authentication could not be completed.'
	});

const responseHeaders = (nonce: string) => ({
	'cache-control': 'no-store, max-age=0',
	'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
	'cross-origin-opener-policy': 'same-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	pragma: 'no-cache',
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY'
});

const entryHtml = (nonce: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Flect secure provider entry</title>
  <style nonce="${nonce}">
    :root{color-scheme:light dark;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f5f5f7;color:#1d1d1f}
    main{box-sizing:border-box;width:min(30rem,calc(100% - 2rem));padding:2rem;border:1px solid #d2d2d7;border-radius:1.25rem;background:#fff;box-shadow:0 1.25rem 4rem #00000014}
    h1{margin:0 0 .5rem;font-size:1.5rem;letter-spacing:-.025em}p{margin:.5rem 0 1.25rem;color:#6e6e73}
    label{display:block;margin-bottom:.45rem;font-weight:600}input{box-sizing:border-box;width:100%;min-height:3rem;padding:.7rem .8rem;border:1px solid #86868b;border-radius:.7rem;background:#fff;color:#1d1d1f;font:inherit}
    button{width:100%;min-height:3rem;margin-top:1rem;border:0;border-radius:.7rem;background:#1d1d1f;color:#fff;font:600 1rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
    small{display:block;margin-top:1rem;color:#6e6e73}@media(prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}main{border-color:#424245;background:#1d1d1f}p,small{color:#a1a1a6}input{border-color:#6e6e73;background:#2c2c2e;color:#fff}button{background:#f5f5f7;color:#1d1d1f}}
  </style>
</head>
<body>
  <main>
    <h1>Continue securely</h1>
    <p>This value goes directly to Pi’s local runtime. Flect’s interface cannot read or store it.</p>
    <form method="post">
      <label for="value">Provider information</label>
      <input id="value" name="value" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required autofocus>
      <button type="submit">Continue</button>
    </form>
    <small>You can close this page to cancel.</small>
  </main>
</body>
</html>`;

const fixedPage = (title: string, message: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

/**
 * Reads the request body up to `MAX_FORM_BYTES`, draining the remainder of
 * the stream without retaining it when the body is oversized (matching the
 * previous `node:http` reader, which kept consuming chunks after the cap was
 * hit instead of destroying the connection). Returns `undefined` when the
 * body exceeded the cap.
 */
const readBoundedBody = (request: HttpServerRequest.HttpServerRequest) =>
	Stream.runFold(
		request.stream,
		() => ({ chunks: [] as ReadonlyArray<Uint8Array>, size: 0, tooLarge: false }),
		(state, chunk: Uint8Array) => {
			const size = state.size + chunk.byteLength;
			return size > MAX_FORM_BYTES
				? { chunks: state.chunks, size, tooLarge: true }
				: { chunks: [...state.chunks, chunk], size, tooLarge: false };
		}
	).pipe(
		Effect.map((state) => {
			if (state.tooLarge) {
				return undefined;
			}
			const body = new Uint8Array(state.size);
			let offset = 0;
			for (const chunk of state.chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return new TextDecoder().decode(body);
		})
	);

const isLoopbackRemote = (request: HttpServerRequest.HttpServerRequest) => {
	const remoteAddress = Option.getOrElse(request.remoteAddress, () => '');
	return remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1';
};

const html = (body: string, headers: Record<string, string>, status = 200) =>
	Effect.succeed(
		HttpServerResponse.text(body, { status, contentType: 'text/html; charset=utf-8', headers })
	);

const plain = (body: string, headers: Record<string, string>, status: number) =>
	Effect.succeed(HttpServerResponse.text(body, { status, headers }));

export const ProtectedPromptHostLive = Layer.succeed(ProtectedPromptHost)({
	open: (input) =>
		Effect.gen(function* () {
			const submission = yield* Deferred.make<
				Redacted.Redacted<string>,
				ProviderAuthOperationFailed
			>();
			const valueRef: {
				consumed: boolean;
				closed: boolean;
			} = { consumed: false, closed: false };
			const path = `/entry/${crypto.randomUUID()}`;
			const nonce = crypto.randomUUID().replaceAll('-', '');

			// One `node:http` `createServer` call is the socket constructor
			// `@effect/platform-node`'s `NodeHttpServer` requires — every request,
			// header, and response after that goes through
			// `HttpServerRequest`/`HttpServerResponse`. `open` returns a lease with
			// its own explicit `close`, not an Effect-scoped resource, so the server
			// lives in a manually owned `Scope` closed by that `close` effect
			// (on consumption, abort, or the 10-minute timeout below) instead of the
			// ambient fiber scope.
			const scope = yield* Scope.make();
			const server = yield* NodeHttpServer.make(() => createServer(), {
				host: '127.0.0.1',
				port: 0
			}).pipe(Scope.provide(scope), Effect.mapError(entryFailure));
			if (server.address._tag !== 'TcpAddress') {
				yield* Scope.close(scope, Exit.fail(entryFailure()));
				return yield* Effect.fail(entryFailure());
			}
			const origin = `http://127.0.0.1:${server.address.port}`;

			const close = Effect.gen(function* () {
				if (valueRef.closed) {
					return;
				}
				valueRef.closed = true;
				if (input.signal !== undefined) {
					input.signal.removeEventListener('abort', abortListener);
				}
				yield* Deferred.fail(submission, entryFailure());
				yield* Scope.close(scope, Exit.succeed(undefined));
			});

			// `close` closes `scope`, and every request fiber runs as a descendant
			// of `scope` (forked by `NodeHttpServer`'s own `serve` machinery). A
			// rejection branch below runs *inside* that request fiber, so awaiting
			// `close` inline there would make `Scope.close` wait on its own fiber
			// and hang. Forking it detached lets the already-built rejection
			// response still return and get written, while the listener and any
			// other pending work tear down independently.
			const terminate = Effect.forkDetach(close);

			const handleEntry = Effect.fn('CredentialPromptHost.handleEntry')(function* (
				request: HttpServerRequest.HttpServerRequest
			) {
				const headers = responseHeaders(nonce);
				if (!isLoopbackRemote(request)) {
					yield* terminate;
					return yield* plain('Request rejected', headers, 400);
				}

				const requestUrl = new URL(request.url, origin);
				if (requestUrl.pathname !== path) {
					return yield* plain('Not found', headers, 404);
				}

				if (request.method === 'GET') {
					if (valueRef.consumed || valueRef.closed) {
						return yield* html(
							fixedPage('Entry expired', 'Return to Flect and try again.'),
							headers,
							410
						);
					}
					return yield* html(entryHtml(nonce), headers);
				}

				if (request.method !== 'POST') {
					yield* terminate;
					return yield* plain('Method not allowed', { ...headers, allow: 'GET, POST' }, 405);
				}

				const contentType = request.headers['content-type'] ?? '';
				if (
					request.headers.origin !== origin ||
					!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')
				) {
					yield* terminate;
					return yield* plain('Request rejected', headers, 400);
				}

				if (valueRef.consumed || valueRef.closed) {
					return yield* html(
						fixedPage('Entry expired', 'Return to Flect and try again.'),
						headers,
						410
					);
				}

				const declaredLength = request.headers['content-length'];
				if (
					declaredLength !== undefined &&
					(!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_FORM_BYTES)
				) {
					yield* terminate;
					return yield* plain('Request rejected', headers, 400);
				}

				const body = yield* readBoundedBody(request).pipe(Effect.orDie);
				const value = body === undefined ? undefined : new URLSearchParams(body).get('value');
				if (
					value === undefined ||
					value === null ||
					value.length === 0 ||
					new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES
				) {
					yield* terminate;
					return yield* plain('Request rejected', headers, 400);
				}

				valueRef.consumed = true;
				const response = yield* html(
					fixedPage(
						'Continue in Flect',
						'Provider information was delivered to Pi’s local runtime. You can close this page.'
					),
					headers
				);
				yield* Deferred.succeed(submission, Redacted.make(value, { label: 'provider credential' }));
				return response;
			});

			const httpApp = Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				return yield* handleEntry(request);
			}).pipe(
				Effect.catchDefect(() =>
					Effect.gen(function* () {
						yield* terminate;
						return yield* plain('Request rejected', responseHeaders(nonce), 400);
					})
				)
			);
			yield* server.serve(httpApp).pipe(Effect.forkScoped, Scope.provide(scope));

			const abortListener = () => {
				Effect.runFork(close);
			};
			if (input.signal !== undefined) {
				input.signal.addEventListener('abort', abortListener, { once: true });
				if (input.signal.aborted) {
					yield* close;
				}
			}
			const value = Deferred.await(submission).pipe(
				Effect.timeoutOrElse({
					duration: '10 minutes',
					orElse: () => Effect.fail(entryFailure())
				}),
				Effect.ensuring(close)
			);

			return {
				url: `${origin}${path}`,
				value,
				close
			} satisfies ProtectedPromptLease;
		})
});
