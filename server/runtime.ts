import { Context, type Effect, type Stream } from 'effect';
import type { BunCommandResult } from '../shared/bun-command';
import type {
	AuthLoginEvent,
	AuthLoginReference,
	AuthLoginRequest,
	AuthSelectionReply,
	FlectEvent,
	FlectRuntimeError,
	GuardianDiagnostic,
	InteractiveAgentRole,
	ModelSummary,
	ProviderAuthSummary,
	RecoveryReason,
	RuntimeStatus,
	SessionSelection,
	ShapeEvent
} from '../shared/contracts';

export interface FlectRuntimeShape {
	readonly status: Effect.Effect<RuntimeStatus>;
	readonly listModels: Effect.Effect<ReadonlyArray<ModelSummary>, FlectRuntimeError>;
	readonly providerAuth: Effect.Effect<ReadonlyArray<ProviderAuthSummary>, FlectRuntimeError>;
	readonly loginProvider: (
		request: AuthLoginRequest
	) => Stream.Stream<AuthLoginEvent, FlectRuntimeError>;
	readonly replyProviderAuth: (reply: AuthSelectionReply) => Effect.Effect<void, FlectRuntimeError>;
	readonly cancelProviderAuth: (
		reference: AuthLoginReference
	) => Effect.Effect<void, FlectRuntimeError>;
	readonly refreshProviderAuth: Effect.Effect<
		ReadonlyArray<ProviderAuthSummary>,
		FlectRuntimeError
	>;
	readonly logoutProvider: (
		providerId: string
	) => Effect.Effect<ReadonlyArray<ProviderAuthSummary>, FlectRuntimeError>;
	readonly createSession: (selection: SessionSelection) => Effect.Effect<string, FlectRuntimeError>;
	readonly closeSession: (sessionId: string) => Effect.Effect<void, FlectRuntimeError>;
	readonly prompt: (
		sessionId: string,
		text: string
	) => Stream.Stream<FlectEvent, FlectRuntimeError>;
	readonly shape: (
		sessionId: string,
		instruction: string,
		document: unknown
	) => Stream.Stream<ShapeEvent, FlectRuntimeError>;
	readonly cancel: (
		sessionId: string,
		role: InteractiveAgentRole
	) => Effect.Effect<void, FlectRuntimeError>;
	readonly completeShellRequest: (
		sessionId: string,
		role: InteractiveAgentRole,
		requestId: string,
		result: BunCommandResult
	) => Effect.Effect<void, FlectRuntimeError>;
	readonly diagnoseRecovery: (
		sessionId: string,
		reason: RecoveryReason
	) => Effect.Effect<GuardianDiagnostic, FlectRuntimeError>;
}

export class FlectRuntime extends Context.Service<FlectRuntime, FlectRuntimeShape>()(
	'flect/server/FlectRuntime'
) {}
