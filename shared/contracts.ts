import { Effect, Schema, type SchemaAST } from 'effect';
import { BunCommandResult } from './bun-command';
import { InterfaceDocument, InvalidInterfaceDocument } from './interface-document';

const NonEmptyText = Schema.Trim.check(Schema.isMinLength(1));
const PromptText = NonEmptyText.check(Schema.isMaxLength(100_000));
const ShapingInstruction = NonEmptyText.check(Schema.isMaxLength(4_000));
const DiagnosticText = NonEmptyText.check(Schema.isMaxLength(4_000));
const ShellRequestId = Schema.String.check(
	Schema.isMinLength(7),
	Schema.isMaxLength(80),
	Schema.isPattern(/^shell-[a-z0-9-]+$/)
);
const ShellCommandText = NonEmptyText.check(Schema.isMaxLength(262_144));
const BoundedLabel = NonEmptyText.check(Schema.isMaxLength(120));
const ProviderId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(100),
	Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)
);
const AuthLoginId = Schema.String.check(
	Schema.isMinLength(14),
	Schema.isMaxLength(80),
	Schema.isPattern(/^login-[a-z0-9-]+$/)
);
const AuthPromptId = Schema.String.check(
	Schema.isMinLength(15),
	Schema.isMaxLength(80),
	Schema.isPattern(/^prompt-[a-z0-9-]+$/)
);
const AuthOptionId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-zA-Z0-9._:-]+$/)
);
const isPublicAuthUrl = (value: string) => {
	try {
		const url = new URL(value);
		if (url.username || url.password) {
			return false;
		}
		return (
			url.protocol === 'https:' ||
			(url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
		);
	} catch {
		return false;
	}
};
const PublicAuthUrl = Schema.Trim.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(2_048),
	Schema.makeFilter(isPublicAuthUrl, {
		expected: 'an HTTPS or loopback HTTP URL without credentials'
	})
);

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export class ContractDecodeError extends Schema.TaggedErrorClass<ContractDecodeError>()(
	'ContractDecodeError',
	{
		message: Schema.Literal('Invalid contract value.')
	}
) {}

const invalidContract = () => new ContractDecodeError({ message: 'Invalid contract value.' });

export class ModelSummary extends Schema.Class<ModelSummary>('ModelSummary')({
	provider: ProviderId,
	id: NonEmptyText,
	name: NonEmptyText,
	reasoningLevels: Schema.Array(
		Schema.Literals(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
	).check(Schema.isMinLength(1), Schema.isMaxLength(7))
}) {}

export const ReasoningLevel = Schema.Literals([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max'
]);
export type ReasoningLevel = typeof ReasoningLevel.Type;

export class RuntimeStatus extends Schema.Class<RuntimeStatus>('RuntimeStatus')({
	version: Schema.Literal(1),
	status: Schema.Literals(['ready', 'unavailable']),
	message: Schema.optionalKey(NonEmptyText)
}) {}

export class ModelSelection extends Schema.Class<ModelSelection>('ModelSelection')({
	provider: NonEmptyText,
	id: NonEmptyText
}) {}

export class ExternalPiExtensionSelection extends Schema.Class<ExternalPiExtensionSelection>(
	'ExternalPiExtensionSelection'
)({
	app: Schema.Boolean,
	shaper: Schema.Boolean
}) {}

export class SessionSelection extends Schema.Class<SessionSelection>('SessionSelection')({
	model: Schema.optionalKey(ModelSelection),
	reasoningLevel: Schema.optionalKey(ReasoningLevel),
	externalExtensions: Schema.optionalKey(ExternalPiExtensionSelection)
}) {}

export const ProviderAuthMethodType = Schema.Literals(['api_key', 'oauth']);
export type ProviderAuthMethodType = typeof ProviderAuthMethodType.Type;

export class ProviderAuthMethodSummary extends Schema.Class<ProviderAuthMethodSummary>(
	'ProviderAuthMethodSummary'
)({
	type: ProviderAuthMethodType,
	label: BoundedLabel
}) {}

export class ProviderAuthSummary extends Schema.Class<ProviderAuthSummary>('ProviderAuthSummary')({
	version: Schema.Literal(1),
	id: ProviderId,
	name: BoundedLabel,
	status: Schema.Literals(['connected', 'disconnected', 'needs-attention', 'checking']),
	sourceLabel: Schema.optionalKey(
		Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(240))
	),
	credentialType: Schema.optionalKey(ProviderAuthMethodType),
	methods: Schema.Array(ProviderAuthMethodSummary).check(Schema.isMaxLength(2))
}) {}

export class AuthLoginRequest extends Schema.Class<AuthLoginRequest>('AuthLoginRequest')({
	providerId: ProviderId,
	method: ProviderAuthMethodType
}) {}

export class AuthSelectionReply extends Schema.Class<AuthSelectionReply>('AuthSelectionReply')({
	loginId: AuthLoginId,
	promptId: AuthPromptId,
	optionId: AuthOptionId
}) {}

export class AuthLoginReference extends Schema.Class<AuthLoginReference>('AuthLoginReference')({
	loginId: AuthLoginId
}) {}

export class AuthInfoLink extends Schema.Class<AuthInfoLink>('AuthInfoLink')({
	url: PublicAuthUrl,
	label: Schema.optionalKey(BoundedLabel)
}) {}

export class AuthSelectOption extends Schema.Class<AuthSelectOption>('AuthSelectOption')({
	id: AuthOptionId,
	label: BoundedLabel,
	description: Schema.optionalKey(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(240)))
}) {}

const AuthEventBase = {
	loginId: AuthLoginId
};

export class AuthStarted extends Schema.Class<AuthStarted>('AuthStarted')({
	type: Schema.Literal('auth_started'),
	...AuthEventBase,
	providerId: ProviderId
}) {}

export class AuthInfo extends Schema.Class<AuthInfo>('AuthInfo')({
	type: Schema.Literal('auth_info'),
	...AuthEventBase,
	message: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
	links: Schema.optionalKey(Schema.Array(AuthInfoLink).check(Schema.isMaxLength(8)))
}) {}

export class AuthUrl extends Schema.Class<AuthUrl>('AuthUrl')({
	type: Schema.Literal('auth_url'),
	...AuthEventBase,
	url: PublicAuthUrl,
	instructions: Schema.optionalKey(
		Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500))
	)
}) {}

export class AuthDeviceCode extends Schema.Class<AuthDeviceCode>('AuthDeviceCode')({
	type: Schema.Literal('auth_device_code'),
	...AuthEventBase,
	userCode: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	verificationUrl: PublicAuthUrl,
	intervalSeconds: Schema.optionalKey(
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3_600 }))
	),
	expiresInSeconds: Schema.optionalKey(
		Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 86_400 }))
	)
}) {}

export class AuthSelectionRequired extends Schema.Class<AuthSelectionRequired>(
	'AuthSelectionRequired'
)({
	type: Schema.Literal('auth_selection_required'),
	...AuthEventBase,
	promptId: AuthPromptId,
	message: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
	options: Schema.Array(AuthSelectOption).check(Schema.isMinLength(1), Schema.isMaxLength(20))
}) {}

export class AuthProtectedEntry extends Schema.Class<AuthProtectedEntry>('AuthProtectedEntry')({
	type: Schema.Literal('auth_protected_entry'),
	...AuthEventBase,
	promptId: AuthPromptId,
	label: BoundedLabel,
	url: PublicAuthUrl
}) {}

export class AuthProgress extends Schema.Class<AuthProgress>('AuthProgress')({
	type: Schema.Literal('auth_progress'),
	...AuthEventBase,
	message: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500))
}) {}

export class AuthConnected extends Schema.Class<AuthConnected>('AuthConnected')({
	type: Schema.Literal('auth_connected'),
	...AuthEventBase,
	providerId: ProviderId
}) {}

export class AuthCancelled extends Schema.Class<AuthCancelled>('AuthCancelled')({
	type: Schema.Literal('auth_cancelled'),
	...AuthEventBase
}) {}

export class AuthFailed extends Schema.Class<AuthFailed>('AuthFailed')({
	type: Schema.Literal('auth_failed'),
	...AuthEventBase,
	code: Schema.Literals([
		'denied',
		'expired',
		'unsupported',
		'malformed',
		'entry-unavailable',
		'provider-failed'
	]),
	message: Schema.Literal('Provider authentication could not be completed.')
}) {}

export const AuthLoginEvent = Schema.Union([
	AuthStarted,
	AuthInfo,
	AuthUrl,
	AuthDeviceCode,
	AuthSelectionRequired,
	AuthProtectedEntry,
	AuthProgress,
	AuthConnected,
	AuthCancelled,
	AuthFailed
]);
export type AuthLoginEvent = typeof AuthLoginEvent.Type;

export class ProviderAuthResponse extends Schema.Class<ProviderAuthResponse>(
	'ProviderAuthResponse'
)({
	version: Schema.Literal(1),
	providers: Schema.Array(ProviderAuthSummary).check(Schema.isMaxLength(100))
}) {}

export const InteractiveAgentRole = Schema.Literals(['app', 'shaper']);
export type InteractiveAgentRole = typeof InteractiveAgentRole.Type;

export class PromptRequest extends Schema.Class<PromptRequest>('PromptRequest')({
	text: PromptText
}) {}

export class ShapeRequest extends Schema.Class<ShapeRequest>('ShapeRequest')({
	instruction: ShapingInstruction,
	document: Schema.Unknown
}) {}

export class ShapeResponse extends Schema.Class<ShapeResponse>('ShapeResponse')({
	version: Schema.Literal(1),
	document: InterfaceDocument
}) {}

export const RecoveryReason = Schema.Literals([
	'rollback-failed',
	'invalid-interface',
	'extension-disabled'
]);
export type RecoveryReason = typeof RecoveryReason.Type;

export class RecoveryRequest extends Schema.Class<RecoveryRequest>('RecoveryRequest')({
	reason: RecoveryReason
}) {}

export class GuardianDiagnostic extends Schema.Class<GuardianDiagnostic>('GuardianDiagnostic')({
	version: Schema.Literal(1),
	message: DiagnosticText
}) {}

export class TurnStarted extends Schema.Class<TurnStarted>('TurnStarted')({
	type: Schema.Literal('turn_started')
}) {}

export class TextDelta extends Schema.Class<TextDelta>('TextDelta')({
	type: Schema.Literal('text_delta'),
	delta: Schema.String
}) {}

export class TurnCompleted extends Schema.Class<TurnCompleted>('TurnCompleted')({
	type: Schema.Literal('turn_completed')
}) {}

export class TurnCancelled extends Schema.Class<TurnCancelled>('TurnCancelled')({
	type: Schema.Literal('cancelled')
}) {}

export class TurnError extends Schema.Class<TurnError>('TurnError')({
	type: Schema.Literal('error'),
	message: NonEmptyText
}) {}

export class TurnBusy extends Schema.Class<TurnBusy>('TurnBusy')({
	type: Schema.Literal('busy'),
	message: Schema.Literal('The session is busy.')
}) {}

export class AgentShellRequest extends Schema.Class<AgentShellRequest>('AgentShellRequest')({
	type: Schema.Literal('shell_request'),
	requestId: ShellRequestId,
	command: ShellCommandText
}) {}

const ToolCallId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));

export class InterfaceEditRequested extends Schema.Class<InterfaceEditRequested>(
	'InterfaceEditRequested'
)({
	type: Schema.Literal('interface_edit_requested'),
	requestId: ToolCallId,
	instruction: ShapingInstruction
}) {}
const ToolName = NonEmptyText.check(Schema.isMaxLength(80));
const EventTimestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class ValidationIssue extends Schema.Class<ValidationIssue>('ValidationIssue')({
	path: Schema.Array(Schema.Union([Schema.String, Schema.Int])).check(Schema.isMaxLength(16)),
	code: Schema.Literals([
		'required',
		'invalid-type',
		'invalid-value',
		'excess-property',
		'constraint',
		'duplicate-id',
		'invalid-tree'
	]),
	message: NonEmptyText.check(Schema.isMaxLength(240))
}) {}

export class ToolExecutionStarted extends Schema.Class<ToolExecutionStarted>(
	'ToolExecutionStarted'
)({
	type: Schema.Literal('tool_execution_started'),
	role: InteractiveAgentRole,
	callId: ToolCallId,
	toolName: ToolName,
	startedAt: EventTimestamp,
	inputSummary: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000)))
}) {}

export class ToolExecutionUpdated extends Schema.Class<ToolExecutionUpdated>(
	'ToolExecutionUpdated'
)({
	type: Schema.Literal('tool_execution_updated'),
	role: InteractiveAgentRole,
	callId: ToolCallId,
	toolName: ToolName,
	updatedAt: EventTimestamp,
	output: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8_000)))
}) {}

export class ToolExecutionCompleted extends Schema.Class<ToolExecutionCompleted>(
	'ToolExecutionCompleted'
)({
	type: Schema.Literal('tool_execution_completed'),
	role: InteractiveAgentRole,
	callId: ToolCallId,
	toolName: ToolName,
	completedAt: EventTimestamp,
	durationMs: EventTimestamp,
	status: Schema.Literals(['succeeded', 'failed']),
	resultSummary: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
	output: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8_000))),
	exitCode: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
	previewUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_048)))
}) {}

export class ExternalPiExtensionFailed extends Schema.Class<ExternalPiExtensionFailed>(
	'ExternalPiExtensionFailed'
)({
	type: Schema.Literal('external_extension_failed'),
	role: InteractiveAgentRole,
	failureId: ToolCallId,
	stage: Schema.Literals(['load', 'turn']),
	message: Schema.Literal('A trusted Pi extension failed.'),
	recovery: Schema.Literal('Disable trusted Pi extensions for this agent and retry.')
}) {}

export class ProposalValidationFailed extends Schema.Class<ProposalValidationFailed>(
	'ProposalValidationFailed'
)({
	type: Schema.Literal('proposal_validation_failed'),
	attempt: Schema.Literals([1, 2]),
	issues: Schema.Array(ValidationIssue).check(Schema.isMinLength(1), Schema.isMaxLength(40))
}) {}

export class ShapeCompleted extends Schema.Class<ShapeCompleted>('ShapeCompleted')({
	type: Schema.Literal('shape_completed'),
	document: Schema.optionalKey(InterfaceDocument)
}) {}

export class ShapeBusy extends Schema.Class<ShapeBusy>('ShapeBusy')({
	type: Schema.Literal('shape_busy'),
	message: Schema.Literal('The session is busy.')
}) {}

export class ShapeError extends Schema.Class<ShapeError>('ShapeError')({
	type: Schema.Literal('shape_error'),
	message: Schema.Literal('The local Flect runtime could not complete this request.')
}) {}

export const ShapeEvent = Schema.Union([
	AgentShellRequest,
	ToolExecutionStarted,
	ToolExecutionUpdated,
	ToolExecutionCompleted,
	ExternalPiExtensionFailed,
	ProposalValidationFailed,
	ShapeCompleted,
	ShapeBusy,
	ShapeError
]);
export type ShapeEvent = typeof ShapeEvent.Type;

export const FlectEvent = Schema.Union([
	TurnStarted,
	TextDelta,
	AgentShellRequest,
	InterfaceEditRequested,
	ToolExecutionStarted,
	ToolExecutionUpdated,
	ToolExecutionCompleted,
	ExternalPiExtensionFailed,
	TurnCompleted,
	TurnCancelled,
	TurnError,
	TurnBusy
]);
export type FlectEvent = typeof FlectEvent.Type;

export class ModelsResponse extends Schema.Class<ModelsResponse>('ModelsResponse')({
	version: Schema.Literal(1),
	models: Schema.Array(ModelSummary)
}) {}

export class SessionResponse extends Schema.Class<SessionResponse>('SessionResponse')({
	version: Schema.Literal(1),
	sessionId: NonEmptyText
}) {}

export class CancelResponse extends Schema.Class<CancelResponse>('CancelResponse')({
	version: Schema.Literal(1),
	status: Schema.Literal('cancelled')
}) {}

export class CancelRequest extends Schema.Class<CancelRequest>('CancelRequest')({
	role: InteractiveAgentRole
}) {}

export class PublicErrorResponse extends Schema.Class<PublicErrorResponse>('PublicErrorResponse')({
	version: Schema.Literal(1),
	error: NonEmptyText
}) {}

export class SessionNotFound extends Schema.TaggedErrorClass<SessionNotFound>()('SessionNotFound', {
	sessionId: NonEmptyText,
	message: Schema.Literal('Session not found.')
}) {}

export class AgentShellResultRequest extends Schema.Class<AgentShellResultRequest>(
	'AgentShellResultRequest'
)({
	role: InteractiveAgentRole,
	requestId: ShellRequestId,
	result: BunCommandResult
}) {}

export class AgentShellResultAccepted extends Schema.Class<AgentShellResultAccepted>(
	'AgentShellResultAccepted'
)({
	version: Schema.Literal(1),
	status: Schema.Literal('accepted')
}) {}

export class SessionBusy extends Schema.TaggedErrorClass<SessionBusy>()('SessionBusy', {
	sessionId: NonEmptyText,
	message: Schema.Literal('The session is busy.')
}) {}

export class CloseSessionResponse extends Schema.Class<CloseSessionResponse>(
	'CloseSessionResponse'
)({
	version: Schema.Literal(1),
	status: Schema.Literal('closed')
}) {}

export class NoModelAvailable extends Schema.TaggedErrorClass<NoModelAvailable>()(
	'NoModelAvailable',
	{
		message: Schema.Literal('No authenticated model is available.')
	}
) {}

export class PiOperationFailed extends Schema.TaggedErrorClass<PiOperationFailed>()(
	'PiOperationFailed',
	{
		operation: Schema.Literals([
			'initialize',
			'list_models',
			'create_session',
			'prompt',
			'shape',
			'cancel',
			'diagnose',
			'shell'
		]),
		message: Schema.Literal('The model runtime could not complete the request.')
	}
) {}

export class ProviderAuthUnavailable extends Schema.TaggedErrorClass<ProviderAuthUnavailable>()(
	'ProviderAuthUnavailable',
	{
		message: Schema.Literal('The selected provider or login method is unavailable.')
	}
) {}

export class ProviderAuthBusy extends Schema.TaggedErrorClass<ProviderAuthBusy>()(
	'ProviderAuthBusy',
	{
		message: Schema.Literal('A provider login is already active.')
	}
) {}

export class ProviderAuthPromptUnavailable extends Schema.TaggedErrorClass<ProviderAuthPromptUnavailable>()(
	'ProviderAuthPromptUnavailable',
	{
		message: Schema.Literal('The provider login prompt is no longer available.')
	}
) {}

export class ProviderAuthOperationFailed extends Schema.TaggedErrorClass<ProviderAuthOperationFailed>()(
	'ProviderAuthOperationFailed',
	{
		operation: Schema.Literals(['status', 'login', 'reply', 'cancel', 'refresh', 'logout']),
		message: Schema.Literal('Provider authentication could not be completed.')
	}
) {}

export const FlectRuntimeError = Schema.Union([
	SessionNotFound,
	SessionBusy,
	NoModelAvailable,
	PiOperationFailed,
	ProviderAuthUnavailable,
	ProviderAuthBusy,
	ProviderAuthPromptUnavailable,
	ProviderAuthOperationFailed,
	InvalidInterfaceDocument
]);
export type FlectRuntimeError = typeof FlectRuntimeError.Type;

export const decodeModelSummary = Effect.fn('Contracts.decodeModelSummary')((input: unknown) =>
	Schema.decodeUnknownEffect(
		ModelSummary,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeRuntimeStatus = Effect.fn('Contracts.decodeRuntimeStatus')((input: unknown) =>
	Schema.decodeUnknownEffect(
		RuntimeStatus,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeSessionSelection = Effect.fn('Contracts.decodeSessionSelection')(
	(input: unknown) =>
		Schema.decodeUnknownEffect(
			SessionSelection,
			strictOptions
		)(input).pipe(Effect.mapError(invalidContract))
);

export const decodePromptRequest = Effect.fn('Contracts.decodePromptRequest')((input: unknown) =>
	Schema.decodeUnknownEffect(
		PromptRequest,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeFlectEvent = Effect.fn('Contracts.decodeFlectEvent')((input: unknown) =>
	Schema.decodeUnknownEffect(
		FlectEvent,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeShapeEvent = Effect.fn('Contracts.decodeShapeEvent')((input: unknown) =>
	Schema.decodeUnknownEffect(
		ShapeEvent,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeModelsResponse = Effect.fn('Contracts.decodeModelsResponse')((input: unknown) =>
	Schema.decodeUnknownEffect(
		ModelsResponse,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeSessionResponse = Effect.fn('Contracts.decodeSessionResponse')(
	(input: unknown) =>
		Schema.decodeUnknownEffect(
			SessionResponse,
			strictOptions
		)(input).pipe(Effect.mapError(invalidContract))
);

export const decodeCancelResponse = Effect.fn('Contracts.decodeCancelResponse')((input: unknown) =>
	Schema.decodeUnknownEffect(
		CancelResponse,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContract))
);
