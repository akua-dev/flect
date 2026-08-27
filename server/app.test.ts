import { describe, expect, it, vi } from '@effect/vitest';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { BunCommandResult } from '../shared/bun-command';
import {
	AgentShellRequest,
	AuthConnected,
	AuthStarted,
	GuardianDiagnostic,
	ModelSummary,
	ModelsResponse,
	ProviderAuthSummary,
	RuntimeStatus,
	SessionBusy,
	SessionSelection,
	ShapeCompleted,
	TextDelta,
	TurnCompleted,
	TurnStarted
} from '../shared/contracts';
import { defaultInterfaceDocument, InterfaceDocument } from '../shared/interface-document';
import { createApp, type FlectWebApp } from './app';
import type { FlectRuntimeShape } from './runtime';

function createFakeRuntime(): FlectRuntimeShape {
	return {
		status: Effect.succeed(new RuntimeStatus({ version: 1, status: 'ready' })),
		listModels: Effect.succeed([
			new ModelSummary({
				provider: 'openai-codex',
				id: 'gpt-5.6',
				name: 'GPT-5.6',
				reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh']
			})
		]),
		providerAuth: Effect.succeed([
			ProviderAuthSummary.make({
				version: 1,
				id: 'openai-codex',
				name: 'OpenAI Codex',
				status: 'disconnected',
				methods: [{ type: 'oauth', label: 'Sign in' }]
			})
		]),
		loginProvider: ({ providerId }) =>
			Stream.make(
				AuthStarted.make({
					type: 'auth_started',
					loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
					providerId
				}),
				AuthConnected.make({
					type: 'auth_connected',
					loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
					providerId
				})
			),
		replyProviderAuth: vi.fn(() => Effect.void),
		cancelProviderAuth: vi.fn(() => Effect.void),
		refreshProviderAuth: Effect.succeed([]),
		logoutProvider: vi.fn(() => Effect.succeed([])),
		createSession: vi.fn(() => Effect.succeed('session-1')),
		closeSession: vi.fn(() => Effect.void),
		prompt: vi.fn(() =>
			Stream.make(
				new TurnStarted({ type: 'turn_started' }),
				new TextDelta({ type: 'text_delta', delta: 'Shaped' }),
				new TurnCompleted({ type: 'turn_completed' })
			)
		),
		shape: vi.fn(() =>
			Stream.succeed(
				ShapeCompleted.make({
					type: 'shape_completed',
					document: InterfaceDocument.make({
						...defaultInterfaceDocument,
						name: 'Focused Flect'
					})
				})
			)
		),
		cancel: vi.fn(() => Effect.void),
		completeShellRequest: vi.fn(() => Effect.void),
		diagnoseRecovery: vi.fn(() =>
			Effect.succeed(
				new GuardianDiagnostic({
					version: 1,
					message: 'The protected launcher remains available.'
				})
			)
		)
	};
}

const useApp = (runtime: FlectRuntimeShape) =>
	Effect.acquireRelease(
		Effect.sync(() => createApp(runtime)),
		(app) => Effect.promise(() => app.dispose())
	);

const send = (app: FlectWebApp, request: Request) => Effect.promise(() => app.handler(request));

const readJson = (response: Response) => Effect.promise(() => response.json());

const readText = (response: Response) => Effect.promise(() => response.text());

function request(
	path: string,
	init?: RequestInit,
	origin: string | null = 'http://127.0.0.1:5173'
) {
	const headers = new Headers(init?.headers);
	if (origin !== null) {
		headers.set('origin', origin);
	}
	if (init?.body) {
		headers.set('content-type', 'application/json');
	}
	return new Request(`http://127.0.0.1:3210${path}`, {
		...init,
		headers
	});
}

const deeplyNestedDocument = (depth: number) => {
	let node: unknown = {
		id: 'leaf',
		type: 'text',
		text: 'Too deep',
		style: 'body'
	};

	for (let index = 0; index < depth; index += 1) {
		node = {
			id: `stack-${index}`,
			type: 'stack',
			direction: 'column',
			gap: 'sm',
			children: [node]
		};
	}

	return {
		version: 2,
		name: 'Pathological depth',
		root: node
	};
};

describe('Flect HTTP application', () => {
	it.effect('reserves workspace control routes for an allowed browser origin', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const allowed = yield* send(app, request('/api/control/status'));
			const missing = yield* send(app, request('/api/control/status', undefined, null));
			const crossOrigin = yield* send(
				app,
				request('/api/control/status', undefined, 'https://untrusted.example')
			);

			expect(allowed.status).toBe(200);
			expect(yield* readJson(allowed)).toMatchObject({
				version: 1,
				enabled: false,
				connected: false,
				url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/)
			});
			expect(missing.status).toBe(403);
			expect(crossOrigin.status).toBe(403);
		})
	);

	it.effect('accepts the Astro development origin', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const response = yield* send(
				app,
				request(
					'/api/sessions',
					{
						method: 'POST',
						body: JSON.stringify({
							model: { provider: 'openai-codex', id: 'gpt-5.6' }
						})
					},
					'http://localhost:4321'
				)
			);

			expect(response.status).toBe(201);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				sessionId: 'session-1'
			});
		})
	);

	it.effect('ends a revoked browser command poll with an empty successful response', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const response = yield* send(
				app,
				request('/api/control/commands/next', {
					method: 'POST',
					body: JSON.stringify({
						workspaceId: 'workspace-local-default'
					})
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({ version: 1 });
		})
	);

	it.effect('returns schema-encoded runtime and model responses', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const status = yield* send(app, request('/api/runtime'));
			const models = yield* send(app, request('/api/models'));

			expect(status.status).toBe(200);
			expect(yield* readJson(status)).toEqual({
				version: 1,
				status: 'ready'
			});
			expect(yield* readJson(models)).toEqual(
				new ModelsResponse({
					version: 1,
					models: [
						new ModelSummary({
							provider: 'openai-codex',
							id: 'gpt-5.6',
							name: 'GPT-5.6',
							reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh']
						})
					]
				})
			);
		})
	);

	it.effect('serves provider auth through strict same-origin mutation routes', () => {
		const runtime = createFakeRuntime();
		const loginId = 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		const promptId = 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const providers = yield* send(app, request('/api/auth/providers'));
			const login = yield* send(
				app,
				request('/api/auth/login', {
					method: 'POST',
					body: JSON.stringify({
						providerId: 'openai-codex',
						method: 'oauth'
					})
				})
			);
			const reply = yield* send(
				app,
				request('/api/auth/reply', {
					method: 'POST',
					body: JSON.stringify({
						loginId,
						promptId,
						optionId: 'account-1'
					})
				})
			);
			const cancelled = yield* send(
				app,
				request('/api/auth/cancel', {
					method: 'POST',
					body: JSON.stringify({ loginId })
				})
			);
			const refreshed = yield* send(app, request('/api/auth/refresh', { method: 'POST' }));
			const loggedOut = yield* send(
				app,
				request('/api/auth/logout', {
					method: 'POST',
					body: JSON.stringify({ providerId: 'openai-codex' })
				})
			);
			const missingOrigin = yield* send(
				app,
				request(
					'/api/auth/login',
					{
						method: 'POST',
						body: JSON.stringify({
							providerId: 'openai-codex',
							method: 'oauth'
						})
					},
					null
				)
			);
			const secretShapedReply = yield* send(
				app,
				request('/api/auth/reply', {
					method: 'POST',
					body: JSON.stringify({
						loginId,
						promptId,
						optionId: 'account-1',
						credential: 'must-not-cross-contract'
					})
				})
			);

			expect(yield* readJson(providers)).toMatchObject({
				version: 1,
				providers: [{ id: 'openai-codex', status: 'disconnected' }]
			});
			expect(login.headers.get('cache-control')).toBe('no-store');
			expect(yield* readText(login)).toContain('"type":"auth_connected"');
			expect(reply.status).toBe(204);
			expect(cancelled.status).toBe(204);
			expect(refreshed.status).toBe(200);
			expect(loggedOut.status).toBe(200);
			expect(missingOrigin.status).toBe(403);
			expect(secretShapedReply.status).toBe(400);
			expect(runtime.replyProviderAuth).toHaveBeenCalledTimes(1);
		});
	});

	it.effect('creates a selected session from a strict schema body', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions', {
					method: 'POST',
					body: JSON.stringify({
						model: { provider: 'openai-codex', id: 'gpt-5.6' }
					})
				})
			);

			expect(response.status).toBe(201);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				sessionId: 'session-1'
			});
			expect(runtime.createSession).toHaveBeenCalledWith(
				new SessionSelection({
					model: { provider: 'openai-codex', id: 'gpt-5.6' }
				})
			);
		});
	});

	it.effect('streams schema-encoded public events as SSE', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const response = yield* send(
				app,
				request('/api/sessions/session-1/prompts', {
					method: 'POST',
					body: JSON.stringify({ text: 'Shape this' })
				})
			);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/event-stream');
			expect(yield* readText(response)).toBe(
				[
					'data: {"type":"turn_started"}',
					'',
					'data: {"type":"text_delta","delta":"Shaped"}',
					'',
					'data: {"type":"turn_completed"}',
					'',
					''
				].join('\n')
			);
		})
	);

	it.effect('accepts a strict browser-shell result for the active agent', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/shell-results', {
					method: 'POST',
					body: JSON.stringify({
						role: 'app',
						requestId: 'shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
						result: {
							version: 1,
							exitCode: 0,
							stdout: '42\n',
							stderr: ''
						}
					})
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				status: 'accepted'
			});
			expect(runtime.completeShellRequest).toHaveBeenCalledWith(
				'session-1',
				'app',
				'shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
				BunCommandResult.make({
					version: 1,
					exitCode: 0,
					stdout: '42\n',
					stderr: ''
				})
			);
		});
	});

	it.effect('streams a non-destructive busy event for a prompt conflict', () => {
		const runtime = {
			...createFakeRuntime(),
			prompt: vi.fn(() =>
				Stream.fail(
					new SessionBusy({
						sessionId: 'session-1',
						message: 'The session is busy.'
					})
				)
			)
		} satisfies FlectRuntimeShape;

		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/prompts', {
					method: 'POST',
					body: JSON.stringify({ text: 'Keep talking' })
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readText(response)).toBe(
				'data: {"type":"busy","message":"The session is busy."}\n\n'
			);
		});
	});

	it.effect('cancels one selected agent role through the Effect service', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/cancel', {
					method: 'POST',
					body: JSON.stringify({ role: 'shaper' })
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				status: 'cancelled'
			});
			expect(runtime.cancel).toHaveBeenCalledWith('session-1', 'shaper');
		});
	});

	it.effect('rejects missing and unknown interactive roles', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const missingCancel = yield* send(
				app,
				request('/api/sessions/session-1/cancel', {
					method: 'POST',
					body: JSON.stringify({})
				})
			);
			const unknownCancel = yield* send(
				app,
				request('/api/sessions/session-1/cancel', {
					method: 'POST',
					body: JSON.stringify({ role: 'guardian' })
				})
			);
			const missingShellRole = yield* send(
				app,
				request('/api/sessions/session-1/shell-results', {
					method: 'POST',
					body: JSON.stringify({
						requestId: 'shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
						result: {
							version: 1,
							exitCode: 0,
							stdout: '',
							stderr: ''
						}
					})
				})
			);

			expect(missingCancel.status).toBe(400);
			expect(unknownCancel.status).toBe(400);
			expect(missingShellRole.status).toBe(400);
		})
	);

	it.effect('closes a session through the Effect service', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(app, request('/api/sessions/session-1', { method: 'DELETE' }));

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				status: 'closed'
			});
			expect(runtime.closeSession).toHaveBeenCalledWith('session-1');
		});
	});

	it.effect('returns a strictly validated interface proposal', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/shape', {
					method: 'POST',
					body: JSON.stringify({
						instruction: 'Make this more focused',
						document: defaultInterfaceDocument
					})
				})
			);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/event-stream');
			expect(yield* readText(response)).toBe(
				`data: ${JSON.stringify({
					type: 'shape_completed',
					document: {
						...defaultInterfaceDocument,
						name: 'Focused Flect'
					}
				})}\n\n`
			);
			expect(runtime.shape).toHaveBeenCalledWith(
				'session-1',
				'Make this more focused',
				defaultInterfaceDocument
			);
		});
	});

	it.effect('keeps a Shaper shell request alive until HTTP completion', () => {
		const shellSeen = Deferred.makeUnsafe<undefined>();
		const shellReleased = Deferred.makeUnsafe<undefined>();
		const requestId = 'shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		const runtime = {
			...createFakeRuntime(),
			shape: vi.fn(() =>
				Stream.succeed(
					AgentShellRequest.make({
						type: 'shell_request',
						requestId,
						command: 'bun run src/index.ts'
					})
				).pipe(
					Stream.tap(() => Deferred.succeed(shellSeen, undefined)),
					Stream.concat(
						Stream.fromEffect(Deferred.await(shellReleased)).pipe(
							Stream.map(() =>
								ShapeCompleted.make({
									type: 'shape_completed',
									document: defaultInterfaceDocument
								})
							)
						)
					)
				)
			),
			completeShellRequest: vi.fn(() =>
				Deferred.succeed(shellReleased, undefined).pipe(Effect.asVoid)
			)
		} satisfies FlectRuntimeShape;

		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/shape', {
					method: 'POST',
					body: JSON.stringify({
						instruction: 'Use the browser shell before shaping',
						document: defaultInterfaceDocument
					})
				})
			);
			const body = yield* readText(response).pipe(Effect.forkChild({ startImmediately: true }));
			yield* Deferred.await(shellSeen);

			const shellResult = yield* send(
				app,
				request('/api/sessions/session-1/shell-results', {
					method: 'POST',
					body: JSON.stringify({
						role: 'shaper',
						requestId,
						result: {
							version: 1,
							exitCode: 0,
							stdout: '42\n',
							stderr: ''
						}
					})
				})
			);

			expect(shellResult.status).toBe(200);
			const output = yield* Fiber.join(body);
			expect(output).toContain(
				'data: {"type":"shell_request","requestId":"shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2","command":"bun run src/index.ts"}'
			);
			expect(output).toContain('data: {"type":"shape_completed","document":');
			expect(runtime.completeShellRequest).toHaveBeenCalledWith(
				'session-1',
				'shaper',
				requestId,
				BunCommandResult.make({
					version: 1,
					exitCode: 0,
					stdout: '42\n',
					stderr: ''
				})
			);
		});
	});

	it.effect('returns a conflict response for a busy shaping session', () => {
		const runtime = {
			...createFakeRuntime(),
			shape: vi.fn(() =>
				Stream.fail(
					new SessionBusy({
						sessionId: 'session-1',
						message: 'The session is busy.'
					})
				)
			)
		} satisfies FlectRuntimeShape;

		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/shape', {
					method: 'POST',
					body: JSON.stringify({
						instruction: 'Make this more focused',
						document: defaultInterfaceDocument
					})
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readText(response)).toBe(
				'data: {"type":"shape_busy","message":"The session is busy."}\n\n'
			);
		});
	});

	it.effect('rejects a deep shape document before transport decoding', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/shape', {
					method: 'POST',
					body: JSON.stringify({
						instruction: 'Make this more focused',
						document: deeplyNestedDocument(2_000)
					})
				})
			);

			expect(response.status).toBe(400);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				error: 'Invalid request'
			});
			expect(runtime.shape).not.toHaveBeenCalled();
		});
	});

	it.effect('returns a narrow Guardian recovery diagnostic', () => {
		const runtime = createFakeRuntime();
		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/guardian', {
					method: 'POST',
					body: JSON.stringify({ reason: 'rollback-failed' })
				})
			);

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				message: 'The protected launcher remains available.'
			});
			expect(runtime.diagnoseRecovery).toHaveBeenCalledWith('session-1', 'rollback-failed');
		});
	});

	it.effect('returns a conflict response for a busy Guardian session', () => {
		const runtime = {
			...createFakeRuntime(),
			diagnoseRecovery: vi.fn(() =>
				Effect.fail(
					new SessionBusy({
						sessionId: 'session-1',
						message: 'The session is busy.'
					})
				)
			)
		} satisfies FlectRuntimeShape;

		return Effect.gen(function* () {
			const app = yield* useApp(runtime);
			const response = yield* send(
				app,
				request('/api/sessions/session-1/guardian', {
					method: 'POST',
					body: JSON.stringify({ reason: 'rollback-failed' })
				})
			);

			expect(response.status).toBe(409);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				error: 'The session is busy.'
			});
		});
	});

	it.effect('rejects malformed JSON, blank prompts, and excess fields', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const malformed = yield* send(app, request('/api/sessions', { method: 'POST', body: '{' }));
			const blank = yield* send(
				app,
				request('/api/sessions/session-1/prompts', {
					method: 'POST',
					body: JSON.stringify({ text: '   ' })
				})
			);
			const excessive = yield* send(
				app,
				request('/api/sessions', {
					method: 'POST',
					body: JSON.stringify({ credential: 'not-a-real-secret' })
				})
			);
			const invalidRecovery = yield* send(
				app,
				request('/api/sessions/session-1/guardian', {
					method: 'POST',
					body: JSON.stringify({ reason: 'run-arbitrary-repair' })
				})
			);

			expect(malformed.status).toBe(400);
			expect(blank.status).toBe(400);
			expect(excessive.status).toBe(400);
			expect(invalidRecovery.status).toBe(400);
			expect(yield* readJson(blank)).toEqual({
				version: 1,
				error: 'Invalid request'
			});
			expect(JSON.stringify(yield* readJson(excessive))).not.toContain('not-a-real-secret');
		})
	);

	it.effect('rejects unexpected origins in global middleware', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const response = yield* send(
				app,
				request('/api/runtime', undefined, 'https://unexpected.example')
			);

			expect(response.status).toBe(403);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				error: 'Origin not allowed'
			});
		})
	);

	it.effect('accepts requests without an origin', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const response = yield* send(app, request('/api/runtime', undefined, null));

			expect(response.status).toBe(200);
			expect(yield* readJson(response)).toEqual({
				version: 1,
				status: 'ready'
			});
		})
	);

	it.effect('never returns credential-shaped keys', () =>
		Effect.gen(function* () {
			const app = yield* useApp(createFakeRuntime());
			const responses = yield* Effect.all([
				send(app, request('/api/runtime')),
				send(app, request('/api/models')),
				send(
					app,
					request('/api/sessions', {
						method: 'POST',
						body: JSON.stringify({})
					})
				)
			]);

			for (const response of responses) {
				const body = JSON.stringify(yield* readJson(response));
				expect(body).not.toMatch(/token|secret|credential|apiKey/i);
			}
		})
	);
});
