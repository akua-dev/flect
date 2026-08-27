// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from '@effect/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime, Stream, SubscriptionRef } from 'effect';
import { ProviderAuthSummary } from '../../shared/contracts';
import { FlectCommandReceipt, FlectWorkspaceSnapshot, SetMode } from '../../shared/control';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import { RevisionId, ShapingSnapshot } from '../../shared/revisions';
import type { ProviderAuthUiState } from '../lib/agent-workspace';
import {
	FlectWorkspaceController,
	type FlectWorkspaceControllerShape
} from '../lib/workspace-controller';
import { useWorkspace, type WorkspaceRuntime } from './use-workspace';

const initial = FlectWorkspaceSnapshot.make({
	version: 1,
	workspaceId: 'workspace-hook-default',
	sequence: 0,
	phase: 'ready',
	mode: 'edit',
	document: defaultInterfaceDocument,
	shaping: ShapingSnapshot.make({
		version: 1,
		active: {
			version: 1,
			id: RevisionId.make('built-in'),
			status: 'accepted',
			source: 'built-in',
			document: defaultInterfaceDocument,
			createdAt: 0
		},
		lastKnownGood: {
			version: 1,
			id: RevisionId.make('built-in'),
			status: 'accepted',
			source: 'built-in',
			document: defaultInterfaceDocument,
			createdAt: 0
		},
		safeMode: false,
		disabledExtensions: [],
		lastEvent: {
			version: 1,
			sequence: 0,
			type: 'initialized',
			revisionId: RevisionId.make('built-in')
		}
	}),
	agent: {
		models: [],
		favoriteModels: [],
		externalExtensions: { app: false, shaper: false },
		app: {
			role: 'app',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		},
		previewApp: {
			role: 'app',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		},
		shaper: {
			role: 'shaper',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		}
	},
	rail: { collapsed: false, width: 400 },
	control: { enabled: false, clients: [] },
	operations: []
});

const makeRuntime = () => {
	let externalMode = (_mode: 'edit' | 'run') => Effect.void;
	let externalProviderAuth = (_connected: boolean) => Effect.void;
	const dispatch = vi.fn<FlectWorkspaceControllerShape['dispatch']>();
	const loginProvider = vi.fn<FlectWorkspaceControllerShape['loginProvider']>(() => Effect.void);
	const layer = Layer.effect(
		FlectWorkspaceController,
		Effect.gen(function* () {
			const state = yield* SubscriptionRef.make(initial);
			const providerAuthState = yield* SubscriptionRef.make<ProviderAuthUiState>({ providers: [] });
			const continuityState = yield* SubscriptionRef.make({
				drafts: { acceptedUse: '', candidateUse: '', shape: '' },
				generation: 0,
				revisionSequence: 0
			});
			externalMode = (mode) =>
				SubscriptionRef.update(state, (current) =>
					FlectWorkspaceSnapshot.make({
						...current,
						sequence: current.sequence + 1,
						mode
					})
				);
			externalProviderAuth = (connected) =>
				SubscriptionRef.set(providerAuthState, {
					providers: [
						ProviderAuthSummary.make({
							version: 1,
							id: 'openai-codex',
							name: 'OpenAI Codex',
							status: connected ? 'connected' : 'disconnected',
							methods: []
						})
					]
				});
			dispatch.mockImplementation((envelope) =>
				SubscriptionRef.update(state, (current) =>
					FlectWorkspaceSnapshot.make({
						...current,
						sequence: current.sequence + 1,
						mode: envelope.command.type === 'set-mode' ? envelope.command.mode : current.mode
					})
				).pipe(
					Effect.as(
						FlectCommandReceipt.make({
							version: 1,
							commandId: envelope.commandId,
							workspaceId: envelope.workspaceId,
							operationId: 'operation-hook-dispatch',
							sequence: 1,
							status: 'completed',
							...(envelope.command.type === 'invoke-product-operation'
								? { result: { projects: ['one'] } }
								: {})
						})
					)
				)
			);
			return {
				snapshot: SubscriptionRef.get(state),
				changes: SubscriptionRef.changes(state),
				events: Stream.empty,
				providerAuth: SubscriptionRef.get(providerAuthState),
				providerAuthChanges: SubscriptionRef.changes(providerAuthState),
				continuity: SubscriptionRef.get(continuityState),
				continuityChanges: SubscriptionRef.changes(continuityState),
				setDraft: (key, value) =>
					SubscriptionRef.update(continuityState, (current) => ({
						...current,
						drafts: { ...current.drafts, [key]: value }
					})),
				exportContinuity: Effect.succeed('{}'),
				exportRepository: Effect.succeed(new Uint8Array([1])),
				readShareExport: () => Effect.succeed(new Uint8Array([1])),
				discardContinuity: Effect.void,
				retryContinuity: Effect.void,
				dispatch,
				connectClient: () => Effect.void,
				disconnectClient: () => Effect.void,
				selectReasoning: () => Effect.void,
				loginProvider,
				replyProviderAuth: () => Effect.void,
				cancelProviderAuth: () => Effect.void,
				refreshProviderAuth: Effect.void,
				logoutProvider: () => Effect.void
			} satisfies FlectWorkspaceControllerShape;
		})
	);
	const runtime: WorkspaceRuntime = ManagedRuntime.make(layer);
	return {
		dispatch,
		loginProvider,
		runtime,
		setExternalMode: (mode: 'edit' | 'run') => externalMode(mode),
		setExternalProviderAuth: (connected: boolean) => externalProviderAuth(connected)
	};
};

describe('useWorkspace', () => {
	it('starts provider login through the private controller action', async () => {
		const { loginProvider, runtime } = makeRuntime();
		const { result, unmount } = renderHook(() => useWorkspace(runtime));
		await waitFor(() => expect(result.current.snapshot).toBeDefined());

		act(() => {
			result.current.loginProvider({
				providerId: 'openai-codex',
				method: 'oauth'
			});
		});
		await waitFor(() =>
			expect(loginProvider).toHaveBeenCalledWith({
				providerId: 'openai-codex',
				method: 'oauth'
			})
		);
		unmount();
		await runtime.dispose();
	});

	it('dispatches user commands and renders outside state changes reactively', async () => {
		const { dispatch, runtime, setExternalMode, setExternalProviderAuth } = makeRuntime();
		const { result, unmount } = renderHook(() => useWorkspace(runtime));
		await waitFor(() => expect(result.current.snapshot?.mode).toBe('edit'));

		await act(async () => {
			await runtime.runPromise(setExternalProviderAuth(true));
		});
		await waitFor(() => expect(result.current.providerAuth.providers[0]?.status).toBe('connected'));
		expect(JSON.stringify(result.current.snapshot)).not.toContain('openai-codex');

		await act(async () => {
			await result.current.dispatch(SetMode.make({ type: 'set-mode', mode: 'run' }));
		});
		expect(dispatch.mock.calls[0]?.[0].source).toEqual({ kind: 'user' });
		await waitFor(() => expect(result.current.snapshot?.mode).toBe('run'));

		await act(async () => {
			await runtime.runPromise(setExternalMode('edit'));
		});
		await waitFor(() => expect(result.current.snapshot?.mode).toBe('edit'));

		unmount();
		await runtime.dispose();
	});

	it('adapts a capsule intent into a role-bound command and correlated result', async () => {
		const { dispatch, runtime } = makeRuntime();
		const { result, unmount } = renderHook(() => useWorkspace(runtime));
		await waitFor(() => expect(result.current.snapshot).toBeDefined());

		const outcome = await result.current.invokeCapsuleIntent('dev.akua.projects', 'accepted', {
			version: 1,
			type: 'intent',
			id: 'intent-projects1',
			action: 'projects.list',
			input: { limit: 2 }
		});

		expect(outcome).toEqual({
			version: 1,
			type: 'intent-result',
			id: 'intent-projects1',
			ok: true,
			output: { projects: ['one'] }
		});
		expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
			source: {
				kind: 'capsule',
				capsuleId: 'dev.akua.projects',
				binding: 'accepted',
				intentId: 'intent-projects1'
			},
			command: {
				type: 'invoke-product-operation',
				operationId: 'projects.list',
				input: { limit: 2 }
			}
		});

		unmount();
		await runtime.dispose();
	});
});
