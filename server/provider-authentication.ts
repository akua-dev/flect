import type {
	AuthEvent as PiAuthEvent,
	AuthInteraction as PiAuthInteraction,
	AuthPrompt as PiAuthPrompt
} from '@earendil-works/pi-ai';
import { Context, Deferred, Effect, Fiber, Layer, Queue, Redacted, Ref, Stream } from 'effect';
import {
	AuthCancelled,
	AuthConnected,
	AuthDeviceCode,
	AuthFailed,
	type AuthLoginEvent,
	type AuthLoginReference,
	type AuthLoginRequest,
	AuthProgress,
	AuthProtectedEntry,
	type AuthSelectionReply,
	AuthSelectionRequired,
	AuthStarted,
	AuthUrl,
	ProviderAuthBusy,
	type ProviderAuthMethodType,
	ProviderAuthOperationFailed,
	ProviderAuthPromptUnavailable,
	ProviderAuthSummary,
	ProviderAuthUnavailable
} from '../shared/contracts';
import { PiModelRuntime } from './pi-model-runtime';

export interface ProviderAuthDescriptor {
	readonly id: string;
	readonly name: string;
	readonly methods: ReadonlyArray<{
		readonly type: ProviderAuthMethodType;
		readonly label: string;
	}>;
}

export interface ProviderCredentialInfo {
	readonly providerId: string;
	readonly type: ProviderAuthMethodType;
}

export interface ProviderAuthCheck {
	readonly type: ProviderAuthMethodType;
	readonly source?: string;
}

export interface ProviderAuthAdapterShape {
	readonly providers: Effect.Effect<
		ReadonlyArray<ProviderAuthDescriptor>,
		ProviderAuthOperationFailed
	>;
	readonly credentials: Effect.Effect<
		ReadonlyArray<ProviderCredentialInfo>,
		ProviderAuthOperationFailed
	>;
	readonly check: (
		providerId: string
	) => Effect.Effect<ProviderAuthCheck | undefined, ProviderAuthOperationFailed>;
	readonly login: (
		providerId: string,
		method: ProviderAuthMethodType,
		interaction: PiAuthInteraction
	) => Effect.Effect<void, ProviderAuthOperationFailed>;
	readonly logout: (providerId: string) => Effect.Effect<void, ProviderAuthOperationFailed>;
	readonly refresh: Effect.Effect<void, ProviderAuthOperationFailed>;
}

export class ProviderAuthAdapter extends Context.Service<
	ProviderAuthAdapter,
	ProviderAuthAdapterShape
>()('flect/server/ProviderAuthAdapter') {}

const adapterFailure = (operation: ProviderAuthOperationFailed['operation']) =>
	ProviderAuthOperationFailed.make({
		operation,
		message: 'Provider authentication could not be completed.'
	});

export const ProviderAuthAdapterLive = Layer.effect(
	ProviderAuthAdapter,
	Effect.gen(function* () {
		const runtime = yield* PiModelRuntime;
		return {
			providers: Effect.sync(() =>
				runtime.getProviders().map((provider) => ({
					id: provider.id,
					name: provider.name,
					methods: [
						...(provider.auth.oauth === undefined
							? []
							: [
									{
										type: 'oauth' as const,
										label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name
									}
								]),
						...(provider.auth.apiKey?.login === undefined
							? []
							: [
									{
										type: 'api_key' as const,
										label: provider.auth.apiKey.name
									}
								])
					]
				}))
			),
			credentials: Effect.tryPromise({
				try: () => runtime.listCredentials(),
				catch: () => adapterFailure('status')
			}),
			check: (providerId) =>
				Effect.tryPromise({
					try: () => runtime.checkAuth(providerId),
					catch: () => adapterFailure('status')
				}),
			login: (providerId, method, interaction) =>
				Effect.tryPromise({
					try: () => runtime.login(providerId, method, interaction),
					catch: () => adapterFailure('login')
				}).pipe(Effect.asVoid),
			logout: (providerId) =>
				Effect.tryPromise({
					try: () => runtime.logout(providerId),
					catch: () => adapterFailure('logout')
				}),
			refresh: Effect.tryPromise({
				try: () => runtime.refresh({ allowNetwork: true }),
				catch: () => adapterFailure('refresh')
			}).pipe(Effect.asVoid)
		} satisfies ProviderAuthAdapterShape;
	})
);

export interface ProtectedPromptLease {
	readonly url: string;
	readonly value: Effect.Effect<Redacted.Redacted<string>, ProviderAuthOperationFailed>;
	readonly close: Effect.Effect<void>;
}

export interface ProtectedPromptHostShape {
	readonly open: (input: {
		readonly loginId: string;
		readonly promptId: string;
		readonly label: string;
		readonly signal?: AbortSignal;
	}) => Effect.Effect<ProtectedPromptLease, ProviderAuthOperationFailed>;
}

export class ProtectedPromptHost extends Context.Service<
	ProtectedPromptHost,
	ProtectedPromptHostShape
>()('flect/server/ProtectedPromptHost') {}

type ProviderAuthenticationError =
	| ProviderAuthUnavailable
	| ProviderAuthBusy
	| ProviderAuthPromptUnavailable
	| ProviderAuthOperationFailed;

export interface ProviderAuthenticationShape {
	readonly providers: Effect.Effect<
		ReadonlyArray<ProviderAuthSummary>,
		ProviderAuthOperationFailed
	>;
	readonly login: (
		request: AuthLoginRequest
	) => Stream.Stream<AuthLoginEvent, ProviderAuthenticationError>;
	readonly reply: (reply: AuthSelectionReply) => Effect.Effect<void, ProviderAuthPromptUnavailable>;
	readonly cancel: (
		reference: AuthLoginReference
	) => Effect.Effect<void, ProviderAuthPromptUnavailable>;
	readonly refresh: Effect.Effect<ReadonlyArray<ProviderAuthSummary>, ProviderAuthOperationFailed>;
	readonly logout: (
		providerId: string
	) => Effect.Effect<ReadonlyArray<ProviderAuthSummary>, ProviderAuthenticationError>;
}

export class ProviderAuthentication extends Context.Service<
	ProviderAuthentication,
	ProviderAuthenticationShape
>()('flect/server/ProviderAuthentication') {}

type PendingSelection = {
	readonly promptId: string;
	readonly options: ReadonlyMap<string, string>;
	readonly response: Deferred.Deferred<string, ProviderAuthPromptUnavailable>;
};

type ActiveLogin = {
	readonly loginId: string;
	readonly providerId: string;
	readonly controller: AbortController;
	readonly events: Queue.Queue<AuthLoginEvent>;
	readonly pending: Ref.Ref<PendingSelection | undefined>;
	readonly terminal: Ref.Ref<boolean>;
	readonly fiber: Ref.Ref<Fiber.Fiber<void, never> | undefined>;
};

type AuthNotificationRequest =
	| {
			readonly type: 'notify';
			readonly event: PiAuthEvent;
	  }
	| {
			readonly type: 'barrier';
			readonly ready: Deferred.Deferred<undefined>;
	  };

const promptUnavailable = () =>
	ProviderAuthPromptUnavailable.make({
		message: 'The provider login prompt is no longer available.'
	});

const bounded = (value: string, maximum: number, fallback: string) => {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length === 0 ? fallback : normalized.slice(0, maximum);
};

const publicSourceLabel = (
	check: ProviderAuthCheck,
	stored: ProviderCredentialInfo | undefined
) => {
	if (stored !== undefined || check.type === 'oauth') {
		return 'Pi credential store';
	}
	const source = check.source?.trim();
	if (source !== undefined && /^[A-Z][A-Z0-9_]{1,119}$/.test(source)) {
		return `Environment: ${source}`;
	}
	return 'Configured by Pi';
};

const isPublicUrl = (value: string) => {
	try {
		const url = new URL(value);
		return (
			!url.username &&
			!url.password &&
			(url.protocol === 'https:' ||
				(url.protocol === 'http:' &&
					(url.hostname === '127.0.0.1' || url.hostname === 'localhost')))
		);
	} catch {
		return false;
	}
};

const isTerminal = (event: AuthLoginEvent) =>
	event.type === 'auth_connected' ||
	event.type === 'auth_cancelled' ||
	event.type === 'auth_failed';

const MAX_ACTIVE_LOGINS = 4;
const MAX_BUFFERED_AUTH_EVENTS = 32;
const LOGIN_LIFETIME = '10 minutes';

const abortEffect = (signal: AbortSignal | undefined) =>
	signal === undefined
		? Effect.never
		: Effect.callback<never, ProviderAuthPromptUnavailable>((resume) => {
				const abort = () => resume(Effect.fail(promptUnavailable()));
				if (signal.aborted) {
					abort();
					return;
				}
				signal.addEventListener('abort', abort, { once: true });
				return Effect.sync(() => signal.removeEventListener('abort', abort));
			});

export const ProviderAuthenticationLive = Layer.effect(
	ProviderAuthentication,
	Effect.gen(function* () {
		const adapter = yield* ProviderAuthAdapter;
		const promptHost = yield* ProtectedPromptHost;
		const active = yield* Ref.make<ReadonlyMap<string, ActiveLogin>>(new Map());
		const context = yield* Effect.context<never>();
		const runPromise = Effect.runPromiseWith(context);

		const providers = Effect.fn('Auth.providers')(function* (): Effect.fn.Return<
			ReadonlyArray<ProviderAuthSummary>,
			ProviderAuthOperationFailed
		> {
			const [descriptors, credentials] = yield* Effect.all([
				adapter.providers,
				adapter.credentials
			]);
			return yield* Effect.forEach(descriptors.slice(0, 100), (provider) =>
				adapter.check(provider.id).pipe(
					Effect.match({
						onFailure: () =>
							ProviderAuthSummary.make({
								version: 1,
								id: provider.id,
								name: bounded(provider.name, 120, provider.id),
								status: 'needs-attention',
								methods: provider.methods.slice(0, 2).map((method) => ({
									type: method.type,
									label: bounded(method.label, 120, 'Provider login')
								}))
							}),
						onSuccess: (check) => {
							const stored = credentials.find(
								(credential) => credential.providerId === provider.id
							);
							return ProviderAuthSummary.make({
								version: 1,
								id: provider.id,
								name: bounded(provider.name, 120, provider.id),
								status: check === undefined ? 'disconnected' : 'connected',
								...(check === undefined
									? {}
									: {
											sourceLabel: publicSourceLabel(check, stored),
											credentialType: stored?.type ?? check.type
										}),
								methods: provider.methods.slice(0, 2).map((method) => ({
									type: method.type,
									label: bounded(method.label, 120, 'Provider login')
								}))
							});
						}
					})
				)
			);
		});

		const removeActive = (entry: ActiveLogin) =>
			Ref.update(active, (current) => {
				if (current.get(entry.providerId)?.loginId !== entry.loginId) {
					return current;
				}
				const next = new Map(current);
				next.delete(entry.providerId);
				return next;
			});

		const emitTerminal = Effect.fn('Auth.emitTerminal')(function* (
			entry: ActiveLogin,
			event: AuthLoginEvent
		): Effect.fn.Return<void, never> {
			const first = yield* Ref.modify(entry.terminal, (terminal) =>
				terminal ? [false, true] : [true, true]
			);
			if (first) {
				yield* Queue.offer(entry.events, event);
			}
		});

		const cancelEntry = Effect.fn('Auth.cancelEntry')(function* (
			entry: ActiveLogin
		): Effect.fn.Return<void, never> {
			entry.controller.abort();
			const pending = yield* Ref.getAndSet(entry.pending, undefined);
			if (pending !== undefined) {
				yield* Deferred.fail(pending.response, promptUnavailable());
			}
			const fiber = yield* Ref.get(entry.fiber);
			if (fiber !== undefined) {
				yield* Fiber.interrupt(fiber);
			}
			yield* emitTerminal(
				entry,
				AuthCancelled.make({ type: 'auth_cancelled', loginId: entry.loginId })
			);
			yield* removeActive(entry);
		});

		const safeNotify = Effect.fn('Auth.notify')(function* (
			entry: ActiveLogin,
			event: PiAuthEvent
		): Effect.fn.Return<void, never> {
			switch (event.type) {
				case 'auth_url':
					if (!isPublicUrl(event.url)) {
						return yield* emitTerminal(
							entry,
							AuthFailed.make({
								type: 'auth_failed',
								loginId: entry.loginId,
								code: 'malformed',
								message: 'Provider authentication could not be completed.'
							})
						);
					}
					yield* Queue.offer(
						entry.events,
						AuthUrl.make({
							type: 'auth_url',
							loginId: entry.loginId,
							url: event.url,
							instructions: 'Open the provider page to continue.'
						})
					);
					return;
				case 'device_code':
					if (!isPublicUrl(event.verificationUri)) {
						return yield* emitTerminal(
							entry,
							AuthFailed.make({
								type: 'auth_failed',
								loginId: entry.loginId,
								code: 'malformed',
								message: 'Provider authentication could not be completed.'
							})
						);
					}
					yield* Queue.offer(
						entry.events,
						AuthDeviceCode.make({
							type: 'auth_device_code',
							loginId: entry.loginId,
							userCode: bounded(event.userCode, 100, 'Unavailable'),
							verificationUrl: event.verificationUri,
							...(event.intervalSeconds === undefined
								? {}
								: {
										intervalSeconds: Math.max(0, Math.min(3_600, Math.floor(event.intervalSeconds)))
									}),
							...(event.expiresInSeconds === undefined
								? {}
								: {
										expiresInSeconds: Math.max(
											1,
											Math.min(86_400, Math.floor(event.expiresInSeconds))
										)
									})
						})
					);
					return;
				case 'info':
					yield* Queue.offer(
						entry.events,
						AuthProgress.make({
							type: 'auth_progress',
							loginId: entry.loginId,
							message: 'Follow the provider instructions to continue.'
						})
					);
					return;
				case 'progress':
					yield* Queue.offer(
						entry.events,
						AuthProgress.make({
							type: 'auth_progress',
							loginId: entry.loginId,
							message: 'Waiting for provider authentication.'
						})
					);
			}
		});

		const prompt = Effect.fn('Auth.prompt')(function* (
			entry: ActiveLogin,
			input: PiAuthPrompt
		): Effect.fn.Return<string, ProviderAuthPromptUnavailable | ProviderAuthOperationFailed> {
			const promptId = `prompt-${crypto.randomUUID()}`;
			if (input.type === 'select') {
				const response = yield* Deferred.make<string, ProviderAuthPromptUnavailable>();
				const usedIds = new Set<string>();
				const options = input.options.slice(0, 20).map((option, index) => {
					const candidate = option.id.trim();
					const publicId =
						candidate.length > 0 &&
						candidate.length <= 80 &&
						/^[a-zA-Z0-9._:-]+$/.test(candidate) &&
						!usedIds.has(candidate)
							? candidate
							: `option-${index + 1}`;
					usedIds.add(publicId);
					return {
						publicId,
						originalId: option.id,
						label: bounded(option.label, 120, 'Provider option'),
						...(option.description === undefined
							? {}
							: {
									description: bounded(option.description, 240, 'Provider option')
								})
					};
				});
				const optionMap = new Map(options.map((option) => [option.publicId, option.originalId]));
				yield* Ref.set(entry.pending, {
					promptId,
					options: optionMap,
					response
				});
				yield* Queue.offer(
					entry.events,
					AuthSelectionRequired.make({
						type: 'auth_selection_required',
						loginId: entry.loginId,
						promptId,
						message: 'Choose how to continue with this provider.',
						options: options.map((option) => ({
							id: option.publicId,
							label: option.label,
							...(option.description === undefined ? {} : { description: option.description })
						}))
					})
				);
				return yield* Deferred.await(response).pipe(
					Effect.raceFirst(abortEffect(input.signal)),
					Effect.raceFirst(abortEffect(entry.controller.signal)),
					Effect.ensuring(Ref.set(entry.pending, undefined))
				);
			}

			const lease = yield* promptHost.open({
				loginId: entry.loginId,
				promptId,
				label: 'Enter provider information securely',
				signal: input.signal ?? entry.controller.signal
			});
			yield* Queue.offer(
				entry.events,
				AuthProtectedEntry.make({
					type: 'auth_protected_entry',
					loginId: entry.loginId,
					promptId,
					label: 'Enter provider information securely',
					url: lease.url
				})
			);
			return yield* lease.value.pipe(
				Effect.raceFirst(abortEffect(input.signal)),
				Effect.raceFirst(abortEffect(entry.controller.signal)),
				Effect.map((secret) => {
					const value = Redacted.value(secret);
					Redacted.wipeUnsafe(secret);
					return value;
				}),
				Effect.ensuring(lease.close)
			);
		});

		const login = (request: AuthLoginRequest) =>
			Stream.unwrap(
				Effect.gen(function* () {
					const descriptors = yield* adapter.providers;
					const descriptor = descriptors.find((provider) => provider.id === request.providerId);
					if (
						descriptor === undefined ||
						!descriptor.methods.some((method) => method.type === request.method)
					) {
						return yield* Effect.fail(
							ProviderAuthUnavailable.make({
								message: 'The selected provider or login method is unavailable.'
							})
						);
					}
					const loginId = `login-${crypto.randomUUID()}`;
					const entry: ActiveLogin = {
						loginId,
						providerId: request.providerId,
						controller: new AbortController(),
						events: yield* Queue.sliding<AuthLoginEvent>(MAX_BUFFERED_AUTH_EVENTS),
						pending: yield* Ref.make<PendingSelection | undefined>(undefined),
						terminal: yield* Ref.make(false),
						fiber: yield* Ref.make<Fiber.Fiber<void, never> | undefined>(undefined)
					};
					const claimed = yield* Ref.modify(active, (current) => {
						if (current.has(request.providerId) || current.size >= MAX_ACTIVE_LOGINS) {
							return [false, current] as const;
						}
						const next = new Map(current);
						next.set(request.providerId, entry);
						return [true, next] as const;
					});
					if (!claimed) {
						return yield* Effect.fail(
							ProviderAuthBusy.make({
								message: 'A provider login is already active.'
							})
						);
					}
					yield* Queue.offer(
						entry.events,
						AuthStarted.make({
							type: 'auth_started',
							loginId,
							providerId: request.providerId
						})
					);

					const notifications = yield* Queue.unbounded<AuthNotificationRequest>();
					const awaitNotifications = Effect.gen(function* () {
						const ready = yield* Deferred.make<undefined>();
						yield* Queue.offer(notifications, { type: 'barrier', ready });
						yield* Deferred.await(ready);
					});
					yield* Effect.forever(
						Queue.take(notifications).pipe(
							Effect.flatMap((notification) =>
								notification.type === 'notify'
									? safeNotify(entry, notification.event)
									: Deferred.succeed(notification.ready, undefined)
							)
						)
					).pipe(Effect.forkScoped);
					const interaction: PiAuthInteraction = {
						signal: entry.controller.signal,
						notify: (event) => {
							Effect.runSync(Queue.offer(notifications, { type: 'notify', event }));
						},
						prompt: (input) =>
							runPromise(awaitNotifications.pipe(Effect.andThen(prompt(entry, input))))
					};
					const operation = adapter.login(request.providerId, request.method, interaction).pipe(
						Effect.andThen(awaitNotifications),
						Effect.flatMap(() => adapter.refresh),
						Effect.as('completed' as const),
						Effect.timeoutOrElse({
							duration: LOGIN_LIFETIME,
							orElse: () => Effect.succeed('expired' as const)
						}),
						Effect.matchEffect({
							onFailure: () =>
								entry.controller.signal.aborted
									? emitTerminal(
											entry,
											AuthCancelled.make({
												type: 'auth_cancelled',
												loginId
											})
										)
									: emitTerminal(
											entry,
											AuthFailed.make({
												type: 'auth_failed',
												loginId,
												code: 'provider-failed',
												message: 'Provider authentication could not be completed.'
											})
										),
							onSuccess: (outcome) => {
								if (outcome === 'expired') {
									entry.controller.abort();
									return emitTerminal(
										entry,
										AuthFailed.make({
											type: 'auth_failed',
											loginId,
											code: 'expired',
											message: 'Provider authentication could not be completed.'
										})
									);
								}
								return emitTerminal(
									entry,
									AuthConnected.make({
										type: 'auth_connected',
										loginId,
										providerId: request.providerId
									})
								);
							}
						}),
						Effect.ensuring(removeActive(entry)),
						Effect.orDie
					);
					const fiber = yield* operation.pipe(Effect.forkScoped);
					yield* Ref.set(entry.fiber, fiber);
					yield* Effect.addFinalizer(() =>
						Ref.get(active).pipe(
							Effect.flatMap((current) =>
								current.get(request.providerId)?.loginId === loginId
									? cancelEntry(entry)
									: Effect.void
							)
						)
					);
					return Stream.fromQueue(entry.events).pipe(Stream.takeUntil(isTerminal));
				})
			);

		const reply = Effect.fn('Auth.reply')(function* (
			input: AuthSelectionReply
		): Effect.fn.Return<void, ProviderAuthPromptUnavailable> {
			const entries = yield* Ref.get(active);
			const entry = [...entries.values()].find((candidate) => candidate.loginId === input.loginId);
			const pending = entry === undefined ? undefined : yield* Ref.get(entry.pending);
			const selectedOption = pending?.options.get(input.optionId);
			if (
				pending === undefined ||
				pending.promptId !== input.promptId ||
				selectedOption === undefined
			) {
				return yield* Effect.fail(promptUnavailable());
			}
			yield* Deferred.succeed(pending.response, selectedOption);
		});

		const cancel = Effect.fn('Auth.cancel')(function* (
			reference: AuthLoginReference
		): Effect.fn.Return<void, ProviderAuthPromptUnavailable> {
			const entries = yield* Ref.get(active);
			const entry = [...entries.values()].find(
				(candidate) => candidate.loginId === reference.loginId
			);
			if (entry === undefined) {
				return yield* Effect.fail(promptUnavailable());
			}
			yield* cancelEntry(entry);
		});

		const refresh = adapter.refresh.pipe(Effect.flatMap(() => providers()));

		const logout = Effect.fn('Auth.logout')(function* (
			providerId: string
		): Effect.fn.Return<
			ReadonlyArray<ProviderAuthSummary>,
			ProviderAuthOperationFailed | ProviderAuthUnavailable
		> {
			const descriptors = yield* adapter.providers;
			if (!descriptors.some((provider) => provider.id === providerId)) {
				return yield* Effect.fail(
					ProviderAuthUnavailable.make({
						message: 'The selected provider or login method is unavailable.'
					})
				);
			}
			yield* adapter.logout(providerId);
			return yield* providers();
		});

		return {
			providers: providers(),
			login,
			reply,
			cancel,
			refresh,
			logout
		} satisfies ProviderAuthenticationShape;
	})
);
