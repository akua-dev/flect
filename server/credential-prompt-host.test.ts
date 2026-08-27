import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { ProtectedPromptHostLive } from './credential-prompt-host';
import { ProtectedPromptHost } from './provider-authentication';

describe('ProtectedPromptHost', () => {
	it.effect('delivers one secret directly through a no-store one-use form', () =>
		Effect.gen(function* () {
			const host = yield* ProtectedPromptHost;
			const lease = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const page = yield* Effect.promise(() => fetch(lease.url));
			const html = yield* Effect.promise(() => page.text());
			assert.strictEqual(page.status, 200);
			assert.include(page.headers.get('content-security-policy') ?? '', "default-src 'none'");
			assert.include(page.headers.get('cache-control') ?? '', 'no-store');
			assert.strictEqual(page.headers.get('referrer-policy'), 'no-referrer');
			assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
			assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
			assert.include(page.headers.get('permissions-policy') ?? '', 'usb=()');
			assert.strictEqual(new URL(lease.url).hostname, '127.0.0.1');
			assert.match(new URL(lease.url).pathname, /^\/entry\/[0-9a-f-]{36}$/);
			assert.notInclude(html, 'secret-host-canary');

			const origin = new URL(lease.url).origin;
			const submitted = yield* Effect.promise(() =>
				fetch(lease.url, {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						origin
					},
					body: new URLSearchParams({ value: 'secret-host-canary' })
				})
			);
			const submittedBody = yield* Effect.promise(() => submitted.text());
			assert.notInclude(submittedBody, 'secret-host-canary');

			const replay = yield* Effect.promise(() =>
				fetch(lease.url, {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						origin
					},
					body: new URLSearchParams({ value: 'replay-canary' })
				})
			);
			assert.strictEqual(replay.status, 410);
			const secret = yield* lease.value;
			assert.strictEqual(Redacted.value(secret), 'secret-host-canary');
			assert.notInclude(JSON.stringify(secret), 'secret-host-canary');
			Redacted.wipeUnsafe(secret);
			yield* lease.close;
		}).pipe(Effect.provide(ProtectedPromptHostLive))
	);

	it.effect('invalidates the lease after an adversarial form submission', () =>
		Effect.gen(function* () {
			const host = yield* ProtectedPromptHost;
			const lease = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const rejected = yield* Effect.promise(() =>
				fetch(lease.url, {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						origin: 'https://attacker.invalid'
					},
					body: new URLSearchParams({ value: 'cross-origin-canary' })
				})
			);
			assert.strictEqual(rejected.status, 400);
			const pending = yield* lease.value.pipe(Effect.flip, Effect.forkChild);
			assert.strictEqual((yield* Fiber.join(pending))._tag, 'ProviderAuthOperationFailed');
			yield* lease.close;
		}).pipe(Effect.provide(ProtectedPromptHostLive))
	);

	it.effect('rejects wrong methods, media types, and oversized bodies', () =>
		Effect.gen(function* () {
			const host = yield* ProtectedPromptHost;
			const wrongMethod = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const methodResponse = yield* Effect.promise(() => fetch(wrongMethod.url, { method: 'PUT' }));
			assert.strictEqual(methodResponse.status, 405);
			yield* wrongMethod.close;

			const wrongType = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const typeResponse = yield* Effect.promise(() =>
				fetch(wrongType.url, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: new URL(wrongType.url).origin
					},
					body: JSON.stringify({ value: 'type-canary' })
				})
			);
			assert.strictEqual(typeResponse.status, 400);
			yield* wrongType.close;

			const oversized = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const oversizedResponse = yield* Effect.promise(() =>
				fetch(oversized.url, {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						origin: new URL(oversized.url).origin
					},
					body: new URLSearchParams({ value: 'x'.repeat(9_000) })
				})
			);
			assert.strictEqual(oversizedResponse.status, 400);
			yield* oversized.close;
		}).pipe(Effect.provide(ProtectedPromptHostLive))
	);

	it.effect('closes and fails the waiter on cancellation or expiry', () =>
		Effect.gen(function* () {
			const host = yield* ProtectedPromptHost;
			const controller = new AbortController();
			const cancelled = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely',
				signal: controller.signal
			});
			const cancelledValue = yield* cancelled.value.pipe(Effect.flip, Effect.forkChild);
			controller.abort();
			assert.strictEqual((yield* Fiber.join(cancelledValue))._tag, 'ProviderAuthOperationFailed');

			const expired = yield* host.open({
				loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				label: 'Enter securely'
			});
			const expiredValue = yield* expired.value.pipe(Effect.flip, Effect.forkChild);
			yield* TestClock.adjust('10 minutes');
			assert.strictEqual((yield* Fiber.join(expiredValue))._tag, 'ProviderAuthOperationFailed');
		}).pipe(Effect.provide(ProtectedPromptHostLive))
	);
});
