import {
	Cause,
	Clock,
	Context,
	Effect,
	Equal,
	Exit,
	Fiber,
	Layer,
	Ref,
	Schema,
	Semaphore,
	Stream,
	SubscriptionRef
} from 'effect';
import { BunCommandResult } from '../../shared/bun-command';
import {
	type AuthLoginEvent,
	type AuthLoginReference,
	type AuthLoginRequest,
	type AuthSelectionReply,
	ExternalPiExtensionSelection,
	type FlectEvent,
	type InteractiveAgentRole,
	InterfaceEditRequested,
	ModelSelection,
	type ModelSummary,
	type ProviderAuthSummary,
	type ReasoningLevel,
	type RecoveryReason,
	type SessionBusy,
	SessionSelection,
	type ShapeEvent
} from '../../shared/contracts';
import {
	type AgentCommandSource,
	AgentWorkspaceSnapshot,
	CommandRejected,
	ConversationMessage,
	type FlectCommandSource,
	OperationRecord,
	RoleConversationSnapshot,
	ToolActivity
} from '../../shared/control';
import type { InterfaceDocument } from '../../shared/interface-document';
import type { RevisionId, ShapingSnapshot } from '../../shared/revisions';
import type { RoleContinuityRecord } from '../../shared/role-continuity';
import { SandboxedShell } from '../shell/sandboxed-shell-service';
import { FlectClient, FlectUnavailableError } from './api';
import { OperationJournal, OperationJournalInput } from './operation-journal';
import { restoreAgentContinuity } from './role-continuity';

export class OperationContext extends Schema.Class<OperationContext>('OperationContext')({
	operationId: OperationRecord.fields.operationId,
	commandId: OperationRecord.fields.commandId,
	workspaceId: OperationRecord.fields.workspaceId,
	source: OperationRecord.fields.source
}) {}

export class AgentTurnCancelled extends Schema.TaggedErrorClass<AgentTurnCancelled>()(
	'AgentTurnCancelled',
	{
		role: Schema.Literals(['app', 'shaper']),
		message: Schema.Literal('The agent response was cancelled.')
	}
) {}

export class AgentPromptOutcome extends Schema.Class<AgentPromptOutcome>('AgentPromptOutcome')({
	editRequest: Schema.optionalKey(InterfaceEditRequested)
}) {}

export type AgentWorkspaceError = AgentTurnCancelled | FlectUnavailableError | SessionBusy;

export interface ProviderAuthUiState {
	readonly providers: ReadonlyArray<ProviderAuthSummary>;
	readonly event?: AuthLoginEvent;
}

export type ShaperTurnOutcome =
	| { readonly kind: 'document'; readonly document: InterfaceDocument }
	| {
			readonly kind: 'app';
			readonly archive: Uint8Array;
			readonly name: string;
	  };

export type ShaperTurnConclusion =
	| { readonly kind: 'completed'; readonly name: string }
	| { readonly kind: 'failed'; readonly reason: string };

export interface AgentWorkspaceShape {
	readonly snapshot: Effect.Effect<AgentWorkspaceSnapshot>;
	readonly changes: Stream.Stream<AgentWorkspaceSnapshot>;
	readonly providerAuth: Effect.Effect<ProviderAuthUiState>;
	readonly providerAuthChanges: Stream.Stream<ProviderAuthUiState>;
	readonly restoreContinuity: (
		record: RoleContinuityRecord,
		shaping: ShapingSnapshot
	) => Effect.Effect<void>;
	readonly refresh: Effect.Effect<void>;
	readonly selectModel: (selection: ModelSelection | undefined) => Effect.Effect<void>;
	readonly selectReasoning: (reasoningLevel: ReasoningLevel | undefined) => Effect.Effect<void>;
	readonly loginProvider: (request: AuthLoginRequest) => Effect.Effect<void, FlectUnavailableError>;
	readonly replyProviderAuth: (
		reply: AuthSelectionReply
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly cancelProviderAuth: (
		reference: AuthLoginReference
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly refreshProviderAuth: Effect.Effect<void, FlectUnavailableError>;
	readonly logoutProvider: (providerId: string) => Effect.Effect<void, FlectUnavailableError>;
	readonly setModelFavorite: (selection: ModelSelection, favorite: boolean) => Effect.Effect<void>;
	readonly setExternalExtensions: (
		role: InteractiveAgentRole,
		enabled: boolean
	) => Effect.Effect<void>;
	readonly proposeShaperInterface: (
		source: AgentCommandSource,
		document: InterfaceDocument
	) => Effect.Effect<
		{
			readonly status: 'proposed' | 'duplicate';
			readonly document: InterfaceDocument;
		},
		CommandRejected
	>;
	readonly proposeShaperApp: (
		source: AgentCommandSource,
		archive: Uint8Array,
		name: string
	) => Effect.Effect<
		{
			readonly status: 'proposed' | 'duplicate';
			readonly name: string;
		},
		CommandRejected
	>;
	readonly submitAppPrompt: (
		operation: OperationContext,
		text: string
	) => Effect.Effect<AgentPromptOutcome, AgentWorkspaceError>;
	readonly submitPreviewPrompt: (
		operation: OperationContext,
		text: string,
		document: InterfaceDocument,
		revisionId: RevisionId
	) => Effect.Effect<AgentPromptOutcome, AgentWorkspaceError>;
	readonly submitShaperInstruction: (
		operation: OperationContext,
		instruction: string,
		document: InterfaceDocument,
		visibleInstruction?: string
	) => Effect.Effect<ShaperTurnOutcome, AgentWorkspaceError>;
	readonly concludeShaperTurn: (
		operation: OperationContext,
		conclusion: ShaperTurnConclusion
	) => Effect.Effect<void>;
	readonly cancel: (role: InteractiveAgentRole) => Effect.Effect<void, FlectUnavailableError>;
	readonly cancelPreview: Effect.Effect<void, FlectUnavailableError>;
	readonly releasePreview: Effect.Effect<void>;
	readonly diagnoseRecovery: (
		reason: RecoveryReason
	) => Effect.Effect<{ readonly version: 1; readonly message: string }, AgentWorkspaceError>;
	readonly close: Effect.Effect<void>;
}

export class AgentWorkspace extends Context.Service<AgentWorkspace, AgentWorkspaceShape>()(
	'flect/AgentWorkspace'
) {}

type SessionHandle = {
	readonly id: string;
	readonly selectionKey: string;
};

type RoleFibers = {
	readonly app?: Fiber.Fiber<unknown, unknown>;
	readonly previewApp?: Fiber.Fiber<unknown, unknown>;
	readonly shaper?: Fiber.Fiber<unknown, unknown>;
};

type ConversationSlot = InteractiveAgentRole | 'previewApp';

const unavailable = () =>
	FlectUnavailableError.make({
		message: 'The local Flect runtime is unavailable.'
	});

const cancelled = (role: InteractiveAgentRole) =>
	AgentTurnCancelled.make({
		role,
		message: 'The agent response was cancelled.'
	});

const roleSnapshot = (role: InteractiveAgentRole, status: RoleConversationSnapshot['status']) =>
	RoleConversationSnapshot.make({
		role,
		status,
		messages: [],
		activities: [],
		lastPrompt: ''
	});

const initialSnapshot = AgentWorkspaceSnapshot.make({
	models: [],
	favoriteModels: [],
	externalExtensions: ExternalPiExtensionSelection.make({
		app: false,
		shaper: false
	}),
	app: roleSnapshot('app', 'booting'),
	previewApp: roleSnapshot('app', 'booting'),
	shaper: roleSnapshot('shaper', 'booting')
});

const selectionKey = (
	selected: ModelSummary | undefined,
	reasoningLevel: ReasoningLevel | undefined,
	extensions: ExternalPiExtensionSelection
) =>
	JSON.stringify([
		selected?.provider ?? 'auto',
		selected?.id ?? 'auto',
		reasoningLevel ?? 'auto',
		extensions.app,
		extensions.shaper
	]);

const sessionSelection = (
	selected: ModelSummary | undefined,
	reasoningLevel: ReasoningLevel | undefined,
	extensions: ExternalPiExtensionSelection
) =>
	SessionSelection.make({
		...(selected === undefined
			? {}
			: {
					model: ModelSelection.make({
						provider: selected.provider,
						id: selected.id
					})
				}),
		...(reasoningLevel === undefined ? {} : { reasoningLevel }),
		...(extensions.app || extensions.shaper ? { externalExtensions: extensions } : {})
	});

const roleFor = (snapshot: AgentWorkspaceSnapshot, role: InteractiveAgentRole) =>
	role === 'app' ? snapshot.app : snapshot.shaper;

const conversationFor = (snapshot: AgentWorkspaceSnapshot, slot: ConversationSlot) =>
	slot === 'previewApp' ? snapshot.previewApp : slot === 'app' ? snapshot.app : snapshot.shaper;

const runtimeRoleFor = (slot: ConversationSlot): InteractiveAgentRole =>
	slot === 'previewApp' ? 'app' : slot;

const requiredRoleFields = (current: RoleConversationSnapshot) => ({
	role: current.role,
	status: current.status,
	messages: current.messages,
	activities: current.activities,
	lastPrompt: current.lastPrompt
});

const requiredWorkspaceFields = (current: AgentWorkspaceSnapshot) => ({
	models: current.models,
	...(current.reasoningLevel === undefined ? {} : { reasoningLevel: current.reasoningLevel }),
	favoriteModels: current.favoriteModels,
	externalExtensions: current.externalExtensions,
	app: current.app,
	previewApp: current.previewApp,
	shaper: current.shaper
});

const workspaceFieldsWithoutReasoning = (current: AgentWorkspaceSnapshot) => {
	const { reasoningLevel: _reasoningLevel, ...fields } = requiredWorkspaceFields(current);
	return fields;
};

const withRole = (
	snapshot: AgentWorkspaceSnapshot,
	role: InteractiveAgentRole,
	next: RoleConversationSnapshot
) =>
	AgentWorkspaceSnapshot.make({
		...snapshot,
		...(role === 'app' ? { app: next } : { shaper: next })
	});

const withConversation = (
	snapshot: AgentWorkspaceSnapshot,
	slot: ConversationSlot,
	next: RoleConversationSnapshot
) =>
	AgentWorkspaceSnapshot.make({
		...snapshot,
		...(slot === 'previewApp'
			? { previewApp: next }
			: slot === 'app'
				? { app: next }
				: { shaper: next })
	});

const boundedMessages = (
	messages: ReadonlyArray<ConversationMessage>,
	next: ReadonlyArray<ConversationMessage>
) => [...messages, ...next].slice(-12);

const boundedActivities = (activities: ReadonlyArray<ToolActivity>, next: ToolActivity) =>
	[...activities, next].slice(-8);

const message = (
	role: 'user' | 'assistant',
	content: string,
	source: FlectCommandSource,
	createdAt: number,
	turnId: string
) =>
	ConversationMessage.make({
		version: 1,
		id: `message-${crypto.randomUUID()}`,
		turnId,
		role,
		content,
		createdAt,
		source
	});

const previewPrompt = (text: string, document: InterfaceDocument, revisionId: RevisionId) => {
	const encoded = JSON.stringify(document);
	const boundedDocument =
		encoded.length <= 40_000
			? encoded
			: `${encoded.slice(0, 40_000)}\n[public interface projection truncated]`;
	return `You are using a validated Flect candidate through Preview App Agent.
Answer questions and help operate only the public candidate context below.
Do not reshape, Keep, Reject, activate, or claim access to Shaper, Guardian,
credentials, host resources, or accepted-product history.

Candidate revision: ${revisionId}
Public candidate interface:
${boundedDocument}

User request:
${text}`;
};

export const AgentWorkspaceLive = Layer.effect(
	AgentWorkspace,
	Effect.gen(function* () {
		const client = yield* FlectClient;
		const shell = yield* SandboxedShell;
		const journal = yield* OperationJournal;
		const state = yield* SubscriptionRef.make(initialSnapshot);
		const providerAuthState = yield* SubscriptionRef.make<ProviderAuthUiState>({
			providers: []
		});
		const session = yield* Ref.make<SessionHandle | undefined>(undefined);
		const previewSession = yield* Ref.make<SessionHandle | undefined>(undefined);
		const fibers = yield* Ref.make<RoleFibers>({});
		const sessionPermit = yield* Semaphore.make(1);
		const shaperProposals = yield* Ref.make<
			ReadonlyMap<
				string,
				{
					readonly requestId?: string;
					readonly document?: InterfaceDocument;
					readonly app?: {
						readonly archive: Uint8Array;
						readonly name: string;
					};
				}
			>
		>(new Map());

		const beginShaperProposal = (operationId: string) =>
			Ref.update(shaperProposals, (current) => {
				const next = new Map(current);
				next.set(operationId, {});
				return next;
			});

		const clearShaperProposal = (operationId: string) =>
			Ref.update(shaperProposals, (current) => {
				const next = new Map(current);
				next.delete(operationId);
				return next;
			});

		const proposeShaperInterface = Effect.fn('AgentWorkspace.proposeShaperInterface')(function* (
			source: AgentCommandSource,
			document: InterfaceDocument
		) {
			if (source.role !== 'shaper') {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'Only Shaper can propose an interface.'
					})
				);
			}
			const current = yield* Ref.get(shaperProposals);
			const latch = current.get(source.parentOperationId);
			if (latch === undefined) {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'No Shaper proposal turn is active.'
					})
				);
			}
			if (latch.app !== undefined) {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'This Shaper turn already proposed an authored app.'
					})
				);
			}
			if (latch.document !== undefined) {
				if (Equal.equals(latch.document, document)) {
					return { status: 'duplicate', document } as const;
				}
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'This Shaper turn already proposed another interface.'
					})
				);
			}
			yield* Ref.update(shaperProposals, (proposals) => {
				const next = new Map(proposals);
				next.set(source.parentOperationId, {
					requestId: source.requestId,
					document
				});
				return next;
			});
			return { status: 'proposed', document } as const;
		});

		const proposeShaperApp = Effect.fn('AgentWorkspace.proposeShaperApp')(function* (
			source: AgentCommandSource,
			archive: Uint8Array,
			name: string
		) {
			if (source.role !== 'shaper') {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'Only Shaper can propose an authored app.'
					})
				);
			}
			const current = yield* Ref.get(shaperProposals);
			const latch = current.get(source.parentOperationId);
			if (latch === undefined) {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'No Shaper proposal turn is active.'
					})
				);
			}
			if (latch.document !== undefined) {
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'This Shaper turn already proposed an interface.'
					})
				);
			}
			if (latch.app !== undefined) {
				const equalBytes =
					latch.app.archive.byteLength === archive.byteLength &&
					latch.app.archive.every((byte, index) => byte === archive[index]);
				if (equalBytes) {
					return { status: 'duplicate', name } as const;
				}
				return yield* Effect.fail(
					CommandRejected.make({
						message: 'This Shaper turn already proposed another app.'
					})
				);
			}
			yield* Ref.update(shaperProposals, (proposals) => {
				const next = new Map(proposals);
				next.set(source.parentOperationId, {
					requestId: source.requestId,
					app: { archive, name }
				});
				return next;
			});
			return { status: 'proposed', name } as const;
		});

		const updateRole = (
			role: InteractiveAgentRole,
			update: (current: RoleConversationSnapshot) => RoleConversationSnapshot
		) =>
			SubscriptionRef.update(state, (current) =>
				withRole(current, role, update(roleFor(current, role)))
			);

		const updateConversation = (
			slot: ConversationSlot,
			update: (current: RoleConversationSnapshot) => RoleConversationSnapshot
		) =>
			SubscriptionRef.update(state, (current) =>
				withConversation(current, slot, update(conversationFor(current, slot)))
			);

		const appendJournal = (
			operation: OperationContext,
			input: Omit<
				typeof OperationJournalInput.Type,
				'version' | 'operationId' | 'commandId' | 'workspaceId' | 'source'
			>
		) =>
			journal
				.append(
					OperationJournalInput.make({
						version: 1,
						operationId: operation.operationId,
						commandId: operation.commandId,
						workspaceId: operation.workspaceId,
						source: operation.source,
						...(operation.source.kind === 'control'
							? { clientId: operation.source.clientId }
							: operation.source.kind === 'agent'
								? {
										role: operation.source.role,
										sessionId: operation.source.sessionId,
										toolCallId: operation.source.requestId
									}
								: {}),
						...input
					})
				)
				.pipe(Effect.asVoid);

		const interruptFibers = Effect.fn('AgentWorkspace.interruptFibers')(function* () {
			const active = yield* Ref.getAndSet(fibers, {});
			yield* Effect.forEach(
				[active.app, active.previewApp, active.shaper].filter(
					(fiber): fiber is Fiber.Fiber<unknown, unknown> => fiber !== undefined
				),
				Fiber.interrupt,
				{ concurrency: 'unbounded', discard: true }
			);
		});

		const releaseSession = Effect.fn('AgentWorkspace.releaseSession')(function* () {
			const current = yield* Ref.getAndSet(session, undefined);
			if (current !== undefined) {
				yield* client.closeSession(current.id).pipe(Effect.catch(() => Effect.void));
			}
		});

		const releasePreviewSession = Effect.fn('AgentWorkspace.releasePreviewSession')(function* () {
			const current = yield* Ref.getAndSet(previewSession, undefined);
			if (current !== undefined) {
				yield* client.closeSession(current.id).pipe(Effect.catch(() => Effect.void));
			}
		});

		const resetSession = interruptFibers().pipe(
			Effect.andThen(
				Effect.all([releaseSession(), releasePreviewSession()], {
					concurrency: 'unbounded',
					discard: true
				})
			)
		);

		const ensureSession = Effect.fn('AgentWorkspace.ensureSession')(() =>
			sessionPermit.withPermits(1)(
				Effect.gen(function* () {
					const snapshot = yield* SubscriptionRef.get(state);
					const key = selectionKey(
						snapshot.selectedModel,
						snapshot.reasoningLevel,
						snapshot.externalExtensions
					);
					const current = yield* Ref.get(session);
					if (current?.selectionKey === key) {
						return current.id;
					}
					if (current !== undefined) {
						yield* releaseSession();
					}
					const id = yield* client.createSession(
						sessionSelection(
							snapshot.selectedModel,
							snapshot.reasoningLevel,
							snapshot.externalExtensions
						)
					);
					yield* Ref.set(session, { id, selectionKey: key });
					return id;
				})
			)
		);

		const ensurePreviewSession = Effect.fn('AgentWorkspace.ensurePreviewSession')(() =>
			sessionPermit.withPermits(1)(
				Effect.gen(function* () {
					const snapshot = yield* SubscriptionRef.get(state);
					const previewExtensions = ExternalPiExtensionSelection.make({
						app: snapshot.externalExtensions.app,
						shaper: false
					});
					const key = selectionKey(
						snapshot.selectedModel,
						snapshot.reasoningLevel,
						previewExtensions
					);
					const current = yield* Ref.get(previewSession);
					if (current?.selectionKey === key) {
						return current.id;
					}
					if (current !== undefined) {
						yield* releasePreviewSession();
					}
					const id = yield* client.createSession(
						sessionSelection(snapshot.selectedModel, snapshot.reasoningLevel, previewExtensions)
					);
					yield* Ref.set(previewSession, { id, selectionKey: key });
					return id;
				})
			)
		);

		const setOperationalStatus = (
			role: InteractiveAgentRole,
			status: RoleConversationSnapshot['status'],
			error?: string
		) =>
			updateRole(role, (current) =>
				RoleConversationSnapshot.make({
					...requiredRoleFields(current),
					status,
					...(error === undefined ? {} : { error })
				})
			);

		const setConversationStatus = (
			slot: ConversationSlot,
			status: RoleConversationSnapshot['status'],
			error?: string
		) =>
			updateConversation(slot, (current) =>
				RoleConversationSnapshot.make({
					...requiredRoleFields(current),
					status,
					...(error === undefined ? {} : { error })
				})
			);

		const finishCancelledActivities = Effect.fn('AgentWorkspace.finishCancelledActivities')(
			function* (role: InteractiveAgentRole) {
				const completedAt = yield* Clock.currentTimeMillis;
				yield* updateRole(role, (current) =>
					RoleConversationSnapshot.make({
						...current,
						activities: current.activities.map((activity) => {
							if (activity.phase !== 'running') {
								return activity;
							}
							const cancellationOutput =
								activity.toolName === 'bash'
									? 'bash: operation cancelled\n'
									: 'Tool operation cancelled\n';
							const output = `${activity.output ?? ''}${cancellationOutput}`.slice(-8_000);
							return ToolActivity.make({
								...activity,
								phase: 'failed',
								updatedAt: completedAt,
								completedAt,
								durationMs: Math.max(0, completedAt - activity.startedAt),
								exitCode: 130,
								output,
								resultSummary: activity.toolName === 'bash' ? 'Command cancelled' : 'Tool cancelled'
							});
						})
					})
				);
			}
		);

		const upsertToolActivity = Effect.fn('AgentWorkspace.upsertToolActivity')(function* (
			operation: OperationContext,
			event: Extract<
				FlectEvent | ShapeEvent,
				{
					readonly type:
						| 'tool_execution_started'
						| 'tool_execution_updated'
						| 'tool_execution_completed';
				}
			>,
			slot: ConversationSlot = event.role,
			revisionId?: RevisionId
		) {
			const role = runtimeRoleFor(slot);
			const current = yield* SubscriptionRef.get(state);
			const conversation = conversationFor(current, slot);
			const existing = conversation.activities.find((activity) => activity.callId === event.callId);
			let activity: ToolActivity;
			switch (event.type) {
				case 'tool_execution_started':
					activity = ToolActivity.make({
						version: 1,
						id: existing?.id ?? `activity-${crypto.randomUUID()}`,
						callId: event.callId,
						operationId: operation.operationId,
						turnId: operation.operationId,
						role,
						toolName: event.toolName,
						phase: 'running',
						startedAt: event.startedAt,
						updatedAt: event.startedAt,
						...(event.inputSummary === undefined ? {} : { resultSummary: event.inputSummary })
					});
					break;
				case 'tool_execution_updated':
					activity = ToolActivity.make({
						...(existing ??
							ToolActivity.make({
								version: 1,
								id: `activity-${crypto.randomUUID()}`,
								callId: event.callId,
								operationId: operation.operationId,
								turnId: operation.operationId,
								role,
								toolName: event.toolName,
								phase: 'running',
								startedAt: event.updatedAt,
								updatedAt: event.updatedAt
							})),
						updatedAt: event.updatedAt,
						...(event.output === undefined ? {} : { output: event.output })
					});
					break;
				case 'tool_execution_completed': {
					const failedShellExit =
						existing?.toolName === 'bash' &&
						existing.exitCode !== undefined &&
						existing.exitCode !== 0;
					activity = ToolActivity.make({
						...(existing ??
							ToolActivity.make({
								version: 1,
								id: `activity-${crypto.randomUUID()}`,
								callId: event.callId,
								operationId: operation.operationId,
								turnId: operation.operationId,
								role,
								toolName: event.toolName,
								phase: 'running',
								startedAt: Math.max(0, event.completedAt - event.durationMs),
								updatedAt: event.completedAt
							})),
						phase: event.status === 'succeeded' && !failedShellExit ? 'succeeded' : 'failed',
						updatedAt: event.completedAt,
						completedAt: event.completedAt,
						durationMs: event.durationMs,
						...(failedShellExit
							? {}
							: event.resultSummary === undefined
								? {}
								: { resultSummary: event.resultSummary }),
						...(event.output === undefined ? {} : { output: event.output }),
						...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
						...(event.previewUrl === undefined ? {} : { previewUrl: event.previewUrl })
					});
					break;
				}
			}

			yield* updateConversation(slot, (roleState) =>
				RoleConversationSnapshot.make({
					...roleState,
					activities:
						existing === undefined
							? boundedActivities(roleState.activities, activity)
							: roleState.activities.map((candidate) =>
									candidate.callId === event.callId ? activity : candidate
								)
				})
			);
			yield* appendJournal(operation, {
				category: 'tool',
				phase:
					event.type === 'tool_execution_started'
						? 'started'
						: event.type === 'tool_execution_updated'
							? 'updated'
							: activity.phase === 'failed'
								? 'failed'
								: 'succeeded',
				summary:
					event.type === 'tool_execution_started'
						? `${event.toolName} started`
						: event.type === 'tool_execution_updated'
							? `${event.toolName} updated`
							: `${event.toolName} ${activity.phase}`,
				role,
				...(revisionId === undefined ? {} : { revisionId }),
				toolCallId: event.callId,
				tool: activity
			});
		});

		const recordExternalExtensionFailure = Effect.fn(
			'AgentWorkspace.recordExternalExtensionFailure'
		)(function* (
			operation: OperationContext,
			event: Extract<FlectEvent | ShapeEvent, { readonly type: 'external_extension_failed' }>,
			slot: ConversationSlot = event.role,
			revisionId?: RevisionId
		) {
			const now = yield* Clock.currentTimeMillis;
			const role = runtimeRoleFor(slot);
			const activity = ToolActivity.make({
				version: 1,
				id: `activity-${crypto.randomUUID()}`,
				callId: event.failureId,
				operationId: operation.operationId,
				turnId: operation.operationId,
				role,
				toolName: 'Trusted Pi extension',
				phase: 'failed',
				startedAt: now,
				updatedAt: now,
				completedAt: now,
				durationMs: 0,
				resultSummary: event.message,
				output: event.recovery
			});
			yield* updateConversation(slot, (current) =>
				RoleConversationSnapshot.make({
					...current,
					activities: boundedActivities(current.activities, activity)
				})
			);
			yield* appendJournal(operation, {
				category: 'tool',
				phase: 'failed',
				summary: `Trusted Pi extension failed during ${event.stage}`,
				role,
				...(revisionId === undefined ? {} : { revisionId }),
				toolCallId: event.failureId,
				tool: activity
			});
		});

		const executeShellRequest = Effect.fn('AgentWorkspace.executeShellRequest')(function* (
			operation: OperationContext,
			sessionId: string,
			slot: ConversationSlot,
			event: Extract<FlectEvent | ShapeEvent, { readonly type: 'shell_request' }>
		) {
			const role = runtimeRoleFor(slot);
			const now = yield* Clock.currentTimeMillis;
			const snapshot = yield* SubscriptionRef.get(state);
			const roleState = conversationFor(snapshot, slot);
			const pending = [...roleState.activities]
				.reverse()
				.find(
					(activity) =>
						activity.toolName === 'bash' &&
						activity.phase === 'running' &&
						activity.command === undefined
				);
			const activity =
				pending === undefined
					? ToolActivity.make({
							version: 1,
							id: `activity-${crypto.randomUUID()}`,
							callId: event.requestId,
							operationId: operation.operationId,
							turnId: operation.operationId,
							role,
							toolName: 'bash',
							phase: 'running',
							startedAt: now,
							updatedAt: now,
							command: event.command
						})
					: ToolActivity.make({
							...pending,
							updatedAt: now,
							command: event.command
						});
			yield* updateConversation(slot, (current) =>
				RoleConversationSnapshot.make({
					...current,
					activities:
						pending === undefined
							? boundedActivities(current.activities, activity)
							: current.activities.map((candidate) =>
									candidate.id === pending.id ? activity : candidate
								)
				})
			);
			const result = yield* shell
				.execute(slot, event.command, {
					agentContext: {
						sessionId,
						parentOperationId: operation.operationId,
						requestId: event.requestId,
						...(slot === 'previewApp'
							? { binding: 'candidate' }
							: slot === 'app'
								? { binding: 'accepted' }
								: {})
					}
				})
				.pipe(
					Effect.catch(() =>
						Effect.succeed(
							BunCommandResult.make({
								version: 1,
								exitCode: 1,
								stdout: '',
								stderr: 'bash: command failed safely\n'
							})
						)
					)
				);
			const completedAt = yield* Clock.currentTimeMillis;
			const output = `${result.stdout}${result.stderr}`.slice(-8_000);
			const completionPhase = result.exitCode === 0 ? 'succeeded' : 'failed';
			const completedActivity = ToolActivity.make({
				...activity,
				phase: completionPhase,
				updatedAt: completedAt,
				completedAt,
				durationMs: Math.max(0, completedAt - activity.startedAt),
				exitCode: result.exitCode,
				...(output.length === 0 ? {} : { output }),
				resultSummary:
					result.exitCode === 0
						? 'Command completed'
						: `Command exited with code ${result.exitCode}`
			});
			yield* updateConversation(slot, (current) =>
				RoleConversationSnapshot.make({
					...current,
					activities: current.activities.map((candidate) =>
						candidate.id === activity.id ? completedActivity : candidate
					)
				})
			);
			yield* client.completeShellRequest(sessionId, role, event.requestId, result);
		});

		const addValidationActivity = Effect.fn('AgentWorkspace.addValidationActivity')(function* (
			operation: OperationContext,
			event: Extract<ShapeEvent, { readonly type: 'proposal_validation_failed' }>
		) {
			const now = yield* Clock.currentTimeMillis;
			const activity = ToolActivity.make({
				version: 1,
				id: `activity-${crypto.randomUUID()}`,
				callId: `proposal-validation-${event.attempt}-${crypto.randomUUID()}`,
				operationId: operation.operationId,
				turnId: operation.operationId,
				role: 'shaper',
				toolName: 'flect',
				phase: 'failed',
				startedAt: now,
				updatedAt: now,
				completedAt: now,
				durationMs: 0,
				resultSummary: `Proposal validation failed on attempt ${event.attempt}`,
				validationIssues: event.issues
			});
			yield* updateRole('shaper', (current) =>
				RoleConversationSnapshot.make({
					...current,
					activities: boundedActivities(current.activities, activity)
				})
			);
			yield* appendJournal(operation, {
				category: 'validation',
				phase: 'failed',
				summary: `Proposal validation failed on attempt ${event.attempt}`,
				role: 'shaper',
				toolCallId: activity.callId,
				validationIssues: event.issues,
				tool: activity
			});
		});

		const refresh = Effect.fn('AgentWorkspace.refresh')(function* () {
			yield* resetSession;
			yield* SubscriptionRef.update(state, (current) =>
				AgentWorkspaceSnapshot.make({
					...current,
					app: RoleConversationSnapshot.make({
						...requiredRoleFields(current.app),
						status: 'booting'
					}),
					previewApp: RoleConversationSnapshot.make({
						...requiredRoleFields(current.previewApp),
						status: 'booting'
					}),
					shaper: RoleConversationSnapshot.make({
						...requiredRoleFields(current.shaper),
						status: 'booting'
					})
				})
			);
			yield* Effect.gen(function* () {
				const [runtime, models, providers] = yield* Effect.all(
					[client.status, client.models, client.providerAuth],
					{ concurrency: 'unbounded' }
				);
				if (runtime.status !== 'ready') {
					return yield* Effect.fail(unavailable());
				}
				yield* SubscriptionRef.update(providerAuthState, (current) => ({
					...current,
					providers
				}));
				yield* SubscriptionRef.update(state, (current) => {
					const status = models.length === 0 ? 'setup-required' : 'ready';
					const error =
						models.length === 0 ? 'Sign in to a Pi provider, then try again.' : undefined;
					const selectedModel =
						current.selectedModel === undefined
							? undefined
							: models.find(
									(candidate) =>
										candidate.provider === current.selectedModel?.provider &&
										candidate.id === current.selectedModel.id
								);
					const reasoningModel = selectedModel ?? models[0];
					const reasoningLevel =
						current.reasoningLevel !== undefined &&
						reasoningModel?.reasoningLevels.includes(current.reasoningLevel)
							? current.reasoningLevel
							: undefined;
					return AgentWorkspaceSnapshot.make({
						...workspaceFieldsWithoutReasoning(current),
						models,
						...(selectedModel === undefined ? {} : { selectedModel }),
						...(reasoningLevel === undefined ? {} : { reasoningLevel }),
						app: RoleConversationSnapshot.make({
							...requiredRoleFields(current.app),
							status,
							...(error === undefined ? {} : { error })
						}),
						previewApp: RoleConversationSnapshot.make({
							...requiredRoleFields(current.previewApp),
							status,
							...(error === undefined ? {} : { error })
						}),
						shaper: RoleConversationSnapshot.make({
							...requiredRoleFields(current.shaper),
							status,
							...(error === undefined ? {} : { error })
						})
					});
				});
			}).pipe(
				Effect.catch(() =>
					Effect.all(
						[
							SubscriptionRef.set(providerAuthState, { providers: [] }),
							SubscriptionRef.update(state, (current) =>
								AgentWorkspaceSnapshot.make({
									...requiredWorkspaceFields(current),
									models: [],
									app: RoleConversationSnapshot.make({
										...requiredRoleFields(current.app),
										status: 'unavailable',
										error: 'Start the local Flect runtime to continue.'
									}),
									previewApp: RoleConversationSnapshot.make({
										...requiredRoleFields(current.previewApp),
										status: 'unavailable',
										error: 'Start the local Flect runtime to continue.'
									}),
									shaper: RoleConversationSnapshot.make({
										...requiredRoleFields(current.shaper),
										status: 'unavailable',
										error: 'Start the local Flect runtime to continue.'
									})
								})
							)
						],
						{ discard: true }
					)
				)
			);
		});

		const selectModel = Effect.fn('AgentWorkspace.selectModel')(function* (
			selection: ModelSelection | undefined
		) {
			yield* resetSession;
			yield* SubscriptionRef.update(state, (current) => {
				const selectedModel =
					selection === undefined
						? undefined
						: current.models.find(
								(candidate) =>
									candidate.provider === selection.provider && candidate.id === selection.id
							);
				const reasoningModel = selectedModel ?? current.models[0];
				const reasoningLevel =
					current.reasoningLevel !== undefined &&
					reasoningModel?.reasoningLevels.includes(current.reasoningLevel)
						? current.reasoningLevel
						: undefined;
				return AgentWorkspaceSnapshot.make({
					...workspaceFieldsWithoutReasoning(current),
					...(selectedModel === undefined ? {} : { selectedModel }),
					...(reasoningLevel === undefined ? {} : { reasoningLevel }),
					app: RoleConversationSnapshot.make({
						...requiredRoleFields(current.app),
						status:
							current.app.status === 'setup-required' || current.app.status === 'unavailable'
								? current.app.status
								: 'ready'
					}),
					previewApp: RoleConversationSnapshot.make({
						...requiredRoleFields(current.previewApp),
						status:
							current.previewApp.status === 'setup-required' ||
							current.previewApp.status === 'unavailable'
								? current.previewApp.status
								: 'ready'
					}),
					shaper: RoleConversationSnapshot.make({
						...requiredRoleFields(current.shaper),
						status:
							current.shaper.status === 'setup-required' || current.shaper.status === 'unavailable'
								? current.shaper.status
								: 'ready'
					})
				});
			});
		});

		const selectReasoning = Effect.fn('AgentWorkspace.selectReasoning')(function* (
			reasoningLevel: ReasoningLevel | undefined
		) {
			const current = yield* SubscriptionRef.get(state);
			const model = current.selectedModel ?? current.models[0];
			if (reasoningLevel !== undefined && !model?.reasoningLevels.includes(reasoningLevel)) {
				return;
			}
			if (current.reasoningLevel === reasoningLevel) {
				return;
			}
			yield* resetSession;
			yield* SubscriptionRef.update(state, (snapshot) =>
				AgentWorkspaceSnapshot.make({
					...workspaceFieldsWithoutReasoning(snapshot),
					...(snapshot.selectedModel === undefined
						? {}
						: { selectedModel: snapshot.selectedModel }),
					...(reasoningLevel === undefined ? {} : { reasoningLevel })
				})
			);
		});

		const updateProviders = (providers: ReadonlyArray<ProviderAuthSummary>) =>
			SubscriptionRef.update(providerAuthState, (current) => ({
				...current,
				providers
			}));

		const loginProvider = Effect.fn('AgentWorkspace.loginProvider')(function* (
			request: AuthLoginRequest
		) {
			yield* client.loginProvider(request).pipe(
				Stream.runForEach((event: AuthLoginEvent) =>
					SubscriptionRef.update(providerAuthState, (current) => ({
						...current,
						event
					}))
				),
				Effect.mapError(unavailable)
			);
			const providers = yield* client.refreshProviderAuth;
			yield* updateProviders(providers);
			yield* refresh();
		});

		const replyProviderAuth = (reply: AuthSelectionReply) => client.replyProviderAuth(reply);

		const cancelProviderAuth = (reference: AuthLoginReference) =>
			client.cancelProviderAuth(reference);

		const refreshProviderAuth = Effect.gen(function* () {
			const providers = yield* client.refreshProviderAuth;
			yield* updateProviders(providers);
		});

		const logoutProvider = Effect.fn('AgentWorkspace.logoutProvider')(function* (
			providerId: string
		) {
			yield* resetSession;
			const providers = yield* client.logoutProvider(providerId);
			yield* updateProviders(providers);
			yield* refresh();
		});

		const setModelFavorite = Effect.fn('AgentWorkspace.setModelFavorite')(function* (
			selection: ModelSelection,
			favorite: boolean
		) {
			const current = yield* SubscriptionRef.get(state);
			const exists = current.favoriteModels.some(
				(candidate) => candidate.provider === selection.provider && candidate.id === selection.id
			);
			if (exists === favorite) {
				return;
			}
			yield* SubscriptionRef.update(state, (snapshot) => {
				return AgentWorkspaceSnapshot.make({
					...snapshot,
					favoriteModels: favorite
						? [...snapshot.favoriteModels, selection].slice(-100)
						: snapshot.favoriteModels.filter(
								(candidate) =>
									candidate.provider !== selection.provider || candidate.id !== selection.id
							)
				});
			});
		});

		const setExternalExtensions = Effect.fn('AgentWorkspace.setExternalExtensions')(function* (
			role: InteractiveAgentRole,
			enabled: boolean
		) {
			const current = yield* SubscriptionRef.get(state);
			if (current.externalExtensions[role] === enabled) {
				return;
			}
			yield* resetSession;
			yield* SubscriptionRef.update(state, (snapshot) =>
				AgentWorkspaceSnapshot.make({
					...snapshot,
					externalExtensions: ExternalPiExtensionSelection.make({
						...snapshot.externalExtensions,
						[role]: enabled
					}),
					app: RoleConversationSnapshot.make({
						...requiredRoleFields(snapshot.app),
						status:
							snapshot.app.status === 'setup-required' || snapshot.app.status === 'unavailable'
								? snapshot.app.status
								: 'ready'
					}),
					previewApp: RoleConversationSnapshot.make({
						...requiredRoleFields(snapshot.previewApp),
						status:
							snapshot.previewApp.status === 'setup-required' ||
							snapshot.previewApp.status === 'unavailable'
								? snapshot.previewApp.status
								: 'ready'
					}),
					shaper: RoleConversationSnapshot.make({
						...requiredRoleFields(snapshot.shaper),
						status:
							snapshot.shaper.status === 'setup-required' ||
							snapshot.shaper.status === 'unavailable'
								? snapshot.shaper.status
								: 'ready'
					})
				})
			);
		});

		const claimRole = Effect.fn('AgentWorkspace.claimRole')(function* (
			slot: ConversationSlot,
			prompt: string,
			source: FlectCommandSource,
			includeAssistant: boolean,
			turnId: string
		) {
			const now = yield* Clock.currentTimeMillis;
			const assistantId = `message-${crypto.randomUUID()}`;
			const claimed = yield* SubscriptionRef.modify(state, (current) => {
				const conversation = conversationFor(current, slot);
				if (conversation.status !== 'ready' && conversation.status !== 'error') {
					return [false, current];
				}
				const user = message('user', prompt, source, now, turnId);
				const nextMessages = includeAssistant
					? [
							user,
							ConversationMessage.make({
								version: 1,
								id: assistantId,
								turnId,
								role: 'assistant',
								content: '',
								createdAt: now,
								source
							})
						]
					: [user];
				const next = RoleConversationSnapshot.make({
					...requiredRoleFields(conversation),
					status: 'submitting',
					lastPrompt: prompt,
					messages: boundedMessages(conversation.messages, nextMessages)
				});
				return [true, withConversation(current, slot, next)];
			});
			if (!claimed) {
				return yield* Effect.fail(unavailable());
			}
			return assistantId;
		});

		const setRoleFiber = (
			role: ConversationSlot,
			fiber: Fiber.Fiber<unknown, unknown> | undefined
		) =>
			Ref.update(fibers, (current) => ({
				...current,
				[role]: fiber
			}));

		const awaitRoleFiber = Effect.fn('AgentWorkspace.awaitRoleFiber')(function* <A, E>(
			role: ConversationSlot,
			fiber: Fiber.Fiber<A, E>
		) {
			const exit = yield* Fiber.await(fiber);
			return yield* Exit.match(exit, {
				onSuccess: Effect.succeed,
				onFailure: (cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.fail(cancelled(runtimeRoleFor(role)))
						: Effect.failCause(cause)
			});
		});

		const submitAppPrompt = Effect.fn('AgentWorkspace.submitAppPrompt')(function* (
			operation: OperationContext,
			text: string
		) {
			const prompt = text.trim();
			if (prompt.length === 0) {
				return yield* Effect.fail(unavailable());
			}
			const assistantId = yield* claimRole(
				'app',
				prompt,
				operation.source,
				true,
				operation.operationId
			);
			yield* appendJournal(operation, {
				category: 'turn',
				phase: 'started',
				summary: 'App turn started',
				role: 'app'
			});
			const editRequest = yield* Ref.make<InterfaceEditRequested | undefined>(undefined);

			const request = Effect.gen(function* () {
				const sessionId = yield* ensureSession();
				yield* client.prompt(sessionId, prompt).pipe(
					Stream.runForEach((event) => {
						switch (event.type) {
							case 'shell_request':
								return executeShellRequest(operation, sessionId, 'app', event);
							case 'interface_edit_requested':
								return Ref.update(editRequest, (current) => current ?? event);
							case 'external_extension_failed':
								return recordExternalExtensionFailure(operation, event);
							case 'tool_execution_started':
							case 'tool_execution_updated':
							case 'tool_execution_completed':
								return upsertToolActivity(operation, event);
							case 'turn_started':
								return setOperationalStatus('app', 'streaming');
							case 'text_delta':
								return updateRole('app', (current) =>
									RoleConversationSnapshot.make({
										...current,
										messages: current.messages.map((candidate) =>
											candidate.id === assistantId
												? ConversationMessage.make({
														...candidate,
														content: candidate.content + event.delta
													})
												: candidate
										)
									})
								);
							case 'turn_completed':
							case 'cancelled':
								return Effect.void;
							case 'error':
							case 'busy':
								return setOperationalStatus('app', 'error', event.message).pipe(
									Effect.andThen(event.type === 'error' ? releaseSession() : Effect.void)
								);
						}
					}),
					Effect.tapError((error) =>
						error._tag === 'SessionBusy' ? Effect.void : releaseSession()
					)
				);
				yield* setOperationalStatus('app', 'ready');
				yield* appendJournal(operation, {
					category: 'turn',
					phase: 'succeeded',
					summary: 'App turn completed',
					role: 'app',
					sessionId
				});
				const requested = yield* Ref.get(editRequest);
				return AgentPromptOutcome.make({
					...(requested === undefined ? {} : { editRequest: requested })
				});
			}).pipe(
				Effect.tapError((error) =>
					setOperationalStatus('app', 'error', error.message).pipe(
						Effect.andThen(
							appendJournal(operation, {
								category: 'turn',
								phase: 'failed',
								summary: 'App turn failed',
								role: 'app'
							})
						)
					)
				)
			);

			const fiber = yield* request.pipe(Effect.forkChild({ startImmediately: true }));
			yield* setRoleFiber('app', fiber);
			return yield* awaitRoleFiber('app', fiber).pipe(
				Effect.ensuring(setRoleFiber('app', undefined))
			);
		});

		const submitPreviewPrompt = Effect.fn('AgentWorkspace.submitPreviewPrompt')(function* (
			operation: OperationContext,
			text: string,
			document: InterfaceDocument,
			revisionId: RevisionId
		) {
			const prompt = text.trim();
			if (prompt.length === 0) {
				return yield* Effect.fail(unavailable());
			}
			const assistantId = yield* claimRole(
				'previewApp',
				prompt,
				operation.source,
				true,
				operation.operationId
			);
			yield* appendJournal(operation, {
				category: 'turn',
				phase: 'started',
				summary: 'Preview App turn started',
				role: 'app',
				revisionId
			});
			const editRequest = yield* Ref.make<InterfaceEditRequested | undefined>(undefined);

			const request = Effect.gen(function* () {
				const sessionId = yield* ensurePreviewSession();
				yield* client.prompt(sessionId, previewPrompt(prompt, document, revisionId)).pipe(
					Stream.runForEach((event) => {
						switch (event.type) {
							case 'shell_request':
								return executeShellRequest(operation, sessionId, 'previewApp', event);
							case 'interface_edit_requested':
								return Ref.update(editRequest, (current) => current ?? event);
							case 'external_extension_failed':
								return recordExternalExtensionFailure(operation, event, 'previewApp', revisionId);
							case 'tool_execution_started':
							case 'tool_execution_updated':
							case 'tool_execution_completed':
								return upsertToolActivity(operation, event, 'previewApp', revisionId);
							case 'turn_started':
								return setConversationStatus('previewApp', 'streaming');
							case 'text_delta':
								return updateConversation('previewApp', (current) =>
									RoleConversationSnapshot.make({
										...current,
										messages: current.messages.map((candidate) =>
											candidate.id === assistantId
												? ConversationMessage.make({
														...candidate,
														content: candidate.content + event.delta
													})
												: candidate
										)
									})
								);
							case 'turn_completed':
							case 'cancelled':
								return Effect.void;
							case 'error':
							case 'busy':
								return setConversationStatus('previewApp', 'error', event.message).pipe(
									Effect.andThen(event.type === 'error' ? releasePreviewSession() : Effect.void)
								);
						}
					}),
					Effect.tapError((error) =>
						error._tag === 'SessionBusy' ? Effect.void : releasePreviewSession()
					)
				);
				yield* setConversationStatus('previewApp', 'ready');
				yield* appendJournal(operation, {
					category: 'turn',
					phase: 'succeeded',
					summary: 'Preview App turn completed',
					role: 'app',
					sessionId,
					revisionId
				});
				const requested = yield* Ref.get(editRequest);
				return AgentPromptOutcome.make({
					...(requested === undefined ? {} : { editRequest: requested })
				});
			}).pipe(
				Effect.tapError((error) =>
					setConversationStatus('previewApp', 'error', error.message).pipe(
						Effect.andThen(
							appendJournal(operation, {
								category: 'turn',
								phase: 'failed',
								summary: 'Preview App turn failed',
								role: 'app',
								revisionId
							})
						)
					)
				)
			);

			const fiber = yield* request.pipe(Effect.forkChild({ startImmediately: true }));
			yield* setRoleFiber('previewApp', fiber);
			return yield* awaitRoleFiber('previewApp', fiber).pipe(
				Effect.ensuring(setRoleFiber('previewApp', undefined))
			);
		});

		const submitShaperInstruction = Effect.fn('AgentWorkspace.submitShaperInstruction')(function* (
			operation: OperationContext,
			instruction: string,
			document: InterfaceDocument,
			visibleInstruction?: string
		) {
			const prompt = instruction.trim();
			if (prompt.length === 0) {
				return yield* Effect.fail(unavailable());
			}
			yield* claimRole(
				'shaper',
				visibleInstruction?.trim() || prompt,
				operation.source,
				false,
				operation.operationId
			);
			yield* appendJournal(operation, {
				category: 'turn',
				phase: 'started',
				summary: 'Shaper turn started',
				role: 'shaper'
			});
			yield* beginShaperProposal(operation.operationId);

			const request = Effect.gen(function* () {
				const sessionId = yield* ensureSession();
				const runShapeAttempt = (instruction: string) =>
					client.shape(sessionId, instruction, document).pipe(
						Stream.tap((event) => {
							switch (event.type) {
								case 'shell_request':
									return executeShellRequest(operation, sessionId, 'shaper', event);
								case 'external_extension_failed':
									return recordExternalExtensionFailure(operation, event);
								case 'tool_execution_started':
								case 'tool_execution_updated':
								case 'tool_execution_completed':
									return upsertToolActivity(operation, event);
								case 'proposal_validation_failed':
									return addValidationActivity(operation, event);
								case 'shape_completed':
								case 'shape_busy':
								case 'shape_error':
									return Effect.void;
							}
						}),
						Stream.runDrain,
						Effect.tapError((error) =>
							error._tag === 'SessionBusy' ? Effect.void : releaseSession()
						)
					);
				const latchedOutcome = () =>
					Ref.get(shaperProposals).pipe(
						Effect.map((proposals): ShaperTurnOutcome | undefined => {
							const latch = proposals.get(operation.operationId);
							if (latch?.app !== undefined) {
								return { kind: 'app', ...latch.app };
							}
							if (latch?.document !== undefined) {
								return { kind: 'document', document: latch.document };
							}
							return undefined;
						})
					);
				yield* runShapeAttempt(prompt);
				let latched = yield* latchedOutcome();
				if (latched === undefined) {
					yield* runShapeAttempt(
						'No valid proposal reached Flect. Inspect the prior Bash output. For a schema interface, correct /workspace/interface.json, validate it, then run flect interface propose /workspace/interface.json as your final action. For an authored web app, correct the source under /workspace/project, then run flect app propose /workspace/project as your final action.'
					);
					latched = yield* latchedOutcome();
				}
				const candidate = latched ?? (yield* Effect.fail(unavailable()));
				if (candidate.kind === 'document') {
					const now = yield* Clock.currentTimeMillis;
					yield* updateRole('shaper', (current) =>
						RoleConversationSnapshot.make({
							...requiredRoleFields(current),
							status: 'ready',
							messages: boundedMessages(current.messages, [
								message(
									'assistant',
									`Change complete: ${candidate.document.name}`,
									operation.source,
									now,
									operation.operationId
								)
							])
						})
					);
				} else {
					// An authored app is accepted by the controller after this turn
					// returns. The controller confirms success or failure through
					// concludeShaperTurn, so the conversation never claims completion
					// before the canvas actually changed.
					yield* setOperationalStatus('shaper', 'ready');
				}
				yield* appendJournal(operation, {
					category: 'turn',
					phase: 'succeeded',
					summary: 'Shaper turn completed',
					role: 'shaper',
					sessionId
				});
				return candidate;
			}).pipe(
				Effect.ensuring(clearShaperProposal(operation.operationId)),
				Effect.tapError((error) =>
					setOperationalStatus('shaper', 'error', error.message).pipe(
						Effect.andThen(
							appendJournal(operation, {
								category: 'turn',
								phase: 'failed',
								summary: 'Shaper turn failed',
								role: 'shaper'
							})
						)
					)
				)
			);

			const fiber = yield* request.pipe(Effect.forkChild({ startImmediately: true }));
			yield* setRoleFiber('shaper', fiber);
			return yield* awaitRoleFiber('shaper', fiber).pipe(
				Effect.ensuring(setRoleFiber('shaper', undefined))
			);
		});

		const concludeShaperTurn = Effect.fn('AgentWorkspace.concludeShaperTurn')(function* (
			operation: OperationContext,
			conclusion: ShaperTurnConclusion
		) {
			const now = yield* Clock.currentTimeMillis;
			if (conclusion.kind === 'completed') {
				yield* updateRole('shaper', (current) =>
					RoleConversationSnapshot.make({
						...requiredRoleFields(current),
						status: 'ready',
						messages: boundedMessages(current.messages, [
							message(
								'assistant',
								`Change complete: ${conclusion.name}`,
								operation.source,
								now,
								operation.operationId
							)
						])
					})
				);
				return;
			}
			const reason =
				conclusion.reason.trim().slice(0, 300) || 'The change could not be applied safely.';
			yield* updateRole('shaper', (current) =>
				RoleConversationSnapshot.make({
					...requiredRoleFields(current),
					status: 'error',
					error: reason,
					messages: boundedMessages(current.messages, [
						message(
							'assistant',
							`The app could not be activated: ${reason} Your previous canvas is unchanged.`,
							operation.source,
							now,
							operation.operationId
						)
					])
				})
			);
		});

		const cancel = Effect.fn('AgentWorkspace.cancel')(function* (role: InteractiveAgentRole) {
			yield* setOperationalStatus(role, 'cancelling');
			const currentSession = yield* Ref.get(session);
			const active = yield* Ref.get(fibers);
			const fiber = role === 'app' ? active.app : active.shaper;
			yield* Effect.gen(function* () {
				if (currentSession !== undefined) {
					yield* client.cancel(currentSession.id, role);
				}
				yield* finishCancelledActivities(role);
				if (fiber !== undefined) {
					yield* Fiber.interrupt(fiber).pipe(Effect.forkDetach);
				}
				yield* setRoleFiber(role, undefined);
				yield* setOperationalStatus(role, 'ready');
			}).pipe(
				Effect.tapError(() =>
					setOperationalStatus(role, 'cancelling', 'The response could not be stopped. Try again.')
				)
			);
		});

		const cancelPreview = Effect.fn('AgentWorkspace.cancelPreview')(function* () {
			yield* setConversationStatus('previewApp', 'cancelling');
			const currentSession = yield* Ref.get(previewSession);
			const active = yield* Ref.get(fibers);
			const fiber = active.previewApp;
			yield* Effect.all(
				[
					currentSession === undefined ? Effect.void : client.cancel(currentSession.id, 'app'),
					fiber === undefined ? Effect.void : Fiber.interrupt(fiber)
				],
				{ concurrency: 'unbounded', discard: true }
			).pipe(
				Effect.andThen(setConversationStatus('previewApp', 'ready')),
				Effect.catch(() =>
					setConversationStatus(
						'previewApp',
						'cancelling',
						'The response could not be stopped. Try again.'
					)
				)
			);
		});

		const releasePreview = Effect.fn('AgentWorkspace.releasePreview')(function* () {
			const active = yield* Ref.get(fibers);
			if (active.previewApp !== undefined) {
				yield* Fiber.interrupt(active.previewApp);
				yield* setRoleFiber('previewApp', undefined);
			}
			yield* releasePreviewSession();
			yield* updateConversation('previewApp', (current) =>
				roleSnapshot(
					'app',
					current.status === 'setup-required' || current.status === 'unavailable'
						? current.status
						: 'ready'
				)
			);
		});

		const diagnoseRecovery = Effect.fn('AgentWorkspace.diagnoseRecovery')(function* (
			reason: RecoveryReason
		) {
			const sessionId = yield* ensureSession();
			return yield* client
				.diagnoseRecovery(sessionId, reason)
				.pipe(
					Effect.tapError((error) =>
						error._tag === 'SessionBusy' ? Effect.void : releaseSession()
					)
				);
		});

		const close = interruptFibers().pipe(
			Effect.andThen(
				Effect.all([releaseSession(), releasePreviewSession()], {
					concurrency: 'unbounded',
					discard: true
				})
			)
		);
		yield* Effect.addFinalizer(() => close);

		return {
			snapshot: SubscriptionRef.get(state),
			changes: SubscriptionRef.changes(state),
			providerAuth: SubscriptionRef.get(providerAuthState),
			providerAuthChanges: SubscriptionRef.changes(providerAuthState),
			restoreContinuity: (record, shaping) =>
				SubscriptionRef.update(state, (current) =>
					restoreAgentContinuity(current, record, shaping)
				),
			refresh: refresh(),
			selectModel,
			selectReasoning,
			loginProvider,
			replyProviderAuth,
			cancelProviderAuth,
			refreshProviderAuth,
			logoutProvider,
			setModelFavorite,
			setExternalExtensions,
			proposeShaperInterface,
			proposeShaperApp,
			submitAppPrompt,
			submitPreviewPrompt,
			submitShaperInstruction,
			concludeShaperTurn,
			cancel,
			cancelPreview: cancelPreview(),
			releasePreview: releasePreview(),
			diagnoseRecovery,
			close
		};
	})
);
