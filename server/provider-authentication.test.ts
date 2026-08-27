import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Layer, Redacted, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import {
	AuthLoginReference,
	AuthLoginRequest,
	AuthSelectionReply,
	type AuthSelectionRequired
} from '../shared/contracts';
import {
	ProtectedPromptHost,
	ProviderAuthAdapter,
	type ProviderAuthAdapterShape,
	ProviderAuthentication,
	ProviderAuthenticationLive
} from './provider-authentication';

const provider = {
	id: 'openai-codex',
	name: 'OpenAI Codex',
	methods: [{ type: 'oauth' as const, label: 'ChatGPT subscription' }]
};

const makeLayer = (options: {
	readonly providers?: ReadonlyArray<typeof provider>;
	readonly check?: ProviderAuthAdapterShape['check'];
	readonly credentials?: ProviderAuthAdapterShape['credentials'];
	readonly login?: ProviderAuthAdapterShape['login'];
	readonly logout?: ProviderAuthAdapterShape['logout'];
	readonly refresh?: ProviderAuthAdapterShape['refresh'];
}) => {
	const adapter = Layer.succeed(ProviderAuthAdapter)({
		providers: Effect.succeed(options.providers ?? [provider]),
		credentials:
			options.credentials ??
			Effect.succeed([{ providerId: 'openai-codex', type: 'oauth' as const }]),
		check: options.check ?? (() => Effect.succeed({ type: 'oauth' as const, source: 'OAuth' })),
		login: options.login ?? (() => Effect.void),
		logout: options.logout ?? (() => Effect.void),
		refresh: options.refresh ?? Effect.void
	});
	const promptHost = Layer.succeed(ProtectedPromptHost)({
		open: () =>
			Effect.succeed({
				url: 'http://127.0.0.1:43123/entry/one-use-path',
				value: Effect.succeed(Redacted.make('protected-entry-value')),
				close: Effect.void
			})
	});
	return ProviderAuthenticationLive.pipe(Layer.provide(Layer.merge(adapter, promptHost)));
};

describe('ProviderAuthentication', () => {
	it.effect('projects configured Pi state without credential material', () =>
		Effect.gen(function* () {
			const auth = yield* ProviderAuthentication;
			const providers = yield* auth.providers;

			assert.strictEqual(providers.length, 1);
			assert.deepInclude(providers[0], {
				version: 1,
				id: 'openai-codex',
				name: 'OpenAI Codex',
				status: 'connected',
				sourceLabel: 'Pi credential store',
				credentialType: 'oauth'
			});
			assert.deepInclude(providers[0]?.methods[0], {
				type: 'oauth',
				label: 'ChatGPT subscription'
			});
			assert.notInclude(JSON.stringify(providers), 'secret');
		}).pipe(Effect.provide(makeLayer({})))
	);

	it.effect('correlates a safe selection and completes one login', () =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<string>();
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: (_providerId, _method, interaction) =>
					Effect.tryPromise({
						try: async () => {
							interaction.notify({
								type: 'auth_url',
								url: 'https://auth.openai.com/authorize',
								instructions: 'provider-native-copy-is-not-forwarded'
							});
							const choice = await interaction.prompt({
								type: 'select',
								message: 'Select OpenAI Codex login method:',
								options: [
									{ id: 'browser', label: 'Browser login' },
									{ id: 'device', label: 'Device code' }
								]
							});
							await Effect.runPromise(Deferred.succeed(selected, choice));
						},
						catch: () => new Error('fake login failed')
					}).pipe(Effect.orDie)
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const events = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(
						Stream.tap((event) =>
							event.type === 'auth_selection_required'
								? auth.reply(
										AuthSelectionReply.make({
											loginId: event.loginId,
											promptId: event.promptId,
											optionId: 'browser'
										})
									)
								: Effect.void
						),
						Stream.runCollect
					);

				assert.strictEqual(yield* Deferred.await(selected), 'browser');
				assert.deepStrictEqual(
					[...events].map((event) => event.type),
					['auth_started', 'auth_url', 'auth_selection_required', 'auth_connected']
				);
				assert.notInclude(JSON.stringify(events), 'provider-native-copy');
				const selection = [...events].find(
					(event): event is AuthSelectionRequired => event.type === 'auth_selection_required'
				);
				assert.isDefined(selection);
				const stale = yield* auth
					.reply(
						AuthSelectionReply.make({
							loginId: selection.loginId,
							promptId: selection.promptId,
							optionId: 'browser'
						})
					)
					.pipe(Effect.flip);
				assert.strictEqual(stale._tag, 'ProviderAuthPromptUnavailable');
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('rejects a duplicate login and cancels the active prompt', () =>
		Effect.gen(function* () {
			const selectionReady = yield* Deferred.make<AuthSelectionRequired>();
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: (_providerId, _method, interaction) =>
					Effect.tryPromise({
						try: () =>
							interaction.prompt({
								type: 'select',
								message: 'Choose an account',
								options: [{ id: 'account', label: 'Account' }]
							}),
						catch: () => new Error('fake login cancelled')
					}).pipe(Effect.asVoid, Effect.orDie)
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const first = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(
						Stream.tap((event) =>
							event.type === 'auth_selection_required'
								? Deferred.succeed(selectionReady, event).pipe(Effect.asVoid)
								: Effect.void
						),
						Stream.runCollect,
						Effect.forkChild
					);
				const selection = yield* Deferred.await(selectionReady);
				const duplicate = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(Stream.runDrain, Effect.flip);
				assert.strictEqual(duplicate._tag, 'ProviderAuthBusy');

				yield* auth.cancel(AuthLoginReference.make({ loginId: selection.loginId }));
				const events = yield* Fiber.join(first);
				assert.deepStrictEqual(
					[...events].map((event) => event.type),
					['auth_started', 'auth_selection_required', 'auth_cancelled']
				);
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('maps malformed provider option ids without changing the reply', () =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<string>();
			const malformedId = `unsafe option ${'x'.repeat(100)}`;
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: (_providerId, _method, interaction) =>
					Effect.tryPromise({
						try: async () => {
							const value = await interaction.prompt({
								type: 'select',
								message: 'Choose an account',
								options: [{ id: malformedId, label: 'Account' }]
							});
							await Effect.runPromise(Deferred.succeed(selected, value));
						},
						catch: () => new Error('fake login failed')
					}).pipe(Effect.orDie)
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(
						Stream.tap((event) =>
							event.type === 'auth_selection_required'
								? auth.reply(
										AuthSelectionReply.make({
											loginId: event.loginId,
											promptId: event.promptId,
											optionId: event.options[0]?.id ?? 'missing'
										})
									)
								: Effect.void
						),
						Stream.runDrain
					);
				assert.strictEqual(yield* Deferred.await(selected), malformedId);
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('routes every free-text prompt through the protected host', () =>
		Effect.gen(function* () {
			const received = yield* Deferred.make<string>();
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: (_providerId, _method, interaction) =>
					Effect.tryPromise({
						try: async () => {
							const value = await interaction.prompt({
								type: 'secret',
								message: 'Enter an API key'
							});
							await Effect.runPromise(Deferred.succeed(received, value));
						},
						catch: () => new Error('fake login failed')
					}).pipe(Effect.orDie)
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const events = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(Stream.runCollect);

				assert.strictEqual(yield* Deferred.await(received), 'protected-entry-value');
				assert.deepStrictEqual(
					[...events].map((event) => event.type),
					['auth_started', 'auth_protected_entry', 'auth_connected']
				);
				assert.notInclude(JSON.stringify(events), 'protected-entry-value');
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('fails closed on malformed public URLs without leaking provider copy', () =>
		Effect.gen(function* () {
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: (_providerId, _method, interaction) =>
					Effect.sync(() => {
						interaction.notify({
							type: 'auth_url',
							url: 'javascript:provider-secret-canary',
							instructions: 'provider-secret-canary'
						});
					})
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const events = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(Stream.runCollect);

				assert.deepStrictEqual(
					[...events].map((event) => event.type),
					['auth_started', 'auth_failed']
				);
				assert.strictEqual(events[1]?.type, 'auth_failed');
				if (events[1]?.type === 'auth_failed') {
					assert.strictEqual(events[1].code, 'malformed');
				}
				assert.notInclude(JSON.stringify(events), 'provider-secret-canary');
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('expires a login after the bounded lifetime', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<undefined>();
			const layer = makeLayer({
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: () => Effect.never
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const collecting = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					)
					.pipe(
						Stream.tap((event) =>
							event.type === 'auth_started' ? Deferred.succeed(started, undefined) : Effect.void
						),
						Stream.runCollect,
						Effect.forkChild
					);
				yield* Deferred.await(started);
				yield* TestClock.adjust('10 minutes');
				const events = yield* Fiber.join(collecting);
				assert.deepStrictEqual(
					[...events].map((event) => event.type),
					['auth_started', 'auth_failed']
				);
				assert.strictEqual(events[1]?.type, 'auth_failed');
				if (events[1]?.type === 'auth_failed') {
					assert.strictEqual(events[1].code, 'expired');
				}
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('bounds concurrent logins across different providers', () =>
		Effect.gen(function* () {
			const providers = Array.from({ length: 5 }, (_, index) => ({
				...provider,
				id: `provider-${index + 1}`,
				name: `Provider ${index + 1}`
			}));
			const layer = makeLayer({
				providers,
				credentials: Effect.succeed([]),
				check: () => Effect.succeed(undefined),
				login: () => Effect.never
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				const started = yield* Effect.forEach(providers.slice(0, 4), () =>
					Deferred.make<undefined>()
				);
				const fibers = yield* Effect.forEach(providers.slice(0, 4), (candidate, index) =>
					auth
						.login(
							AuthLoginRequest.make({
								providerId: candidate.id,
								method: 'oauth'
							})
						)
						.pipe(
							Stream.tap((event) => {
								const deferred = started[index];
								return event.type === 'auth_started' && deferred !== undefined
									? Deferred.succeed(deferred, undefined)
									: Effect.void;
							}),
							Stream.runDrain,
							Effect.forkChild
						)
				);
				yield* Effect.forEach(started, Deferred.await, { discard: true });

				const fifth = yield* auth
					.login(
						AuthLoginRequest.make({
							providerId: providers[4]?.id ?? 'provider-5',
							method: 'oauth'
						})
					)
					.pipe(Stream.runDrain, Effect.flip);
				assert.strictEqual(fifth._tag, 'ProviderAuthBusy');
				yield* Effect.forEach(fibers, Fiber.interrupt, { discard: true });
			}).pipe(Effect.provide(layer));
		})
	);

	it.effect('refreshes and logs out only through the Pi adapter', () =>
		Effect.gen(function* () {
			let refreshes = 0;
			let loggedOut = '';
			const layer = makeLayer({
				refresh: Effect.sync(() => {
					refreshes += 1;
				}),
				logout: (providerId) =>
					Effect.sync(() => {
						loggedOut = providerId;
					})
			});
			yield* Effect.gen(function* () {
				const auth = yield* ProviderAuthentication;
				yield* auth.refresh;
				yield* auth.logout('openai-codex');
				assert.strictEqual(refreshes, 1);
				assert.strictEqual(loggedOut, 'openai-codex');
				const unavailable = yield* auth.logout('unknown-provider').pipe(Effect.flip);
				assert.strictEqual(unavailable._tag, 'ProviderAuthUnavailable');
			}).pipe(Effect.provide(layer));
		})
	);
});
