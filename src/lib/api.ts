import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from 'effect';
import {
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse
} from 'effect/unstable/http';
import type { BunCommandResult } from '../../shared/bun-command';
import {
	AgentShellResultAccepted,
	AgentShellResultRequest,
	AuthLoginEvent,
	AuthLoginReference,
	AuthLoginRequest,
	AuthSelectionReply,
	CancelRequest,
	CancelResponse,
	CloseSessionResponse,
	decodePromptRequest,
	FlectEvent,
	GuardianDiagnostic,
	type InteractiveAgentRole,
	type ModelSummary,
	ModelsResponse,
	PromptRequest,
	ProviderAuthResponse,
	type ProviderAuthSummary,
	type RecoveryReason,
	RecoveryRequest,
	RuntimeStatus,
	SessionBusy,
	SessionResponse,
	SessionSelection,
	ShapeEvent,
	ShapeRequest
} from '../../shared/contracts';
import { encodeInterfaceDocument, type InterfaceDocument } from '../../shared/interface-document';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const ProviderLogoutRequest = Schema.Struct({
	providerId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
});

export class FlectUnavailableError extends Schema.TaggedErrorClass<FlectUnavailableError>()(
	'FlectUnavailableError',
	{
		message: Schema.Literal('The local Flect runtime is unavailable.')
	}
) {}

const unavailable = () =>
	new FlectUnavailableError({
		message: 'The local Flect runtime is unavailable.'
	});

const isSessionBusy = (error: unknown): error is SessionBusy =>
	typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'SessionBusy';

const shapeFailure = (sessionId: string) => (error: unknown) =>
	isSessionBusy(error)
		? error
		: HttpClientError.isHttpClientError(error) && error.response?.status === 409
			? new SessionBusy({
					sessionId,
					message: 'The session is busy.'
				})
			: unavailable();

const diagnoseFailure = (sessionId: string) => (error: unknown) =>
	HttpClientError.isHttpClientError(error) && error.response?.status === 409
		? new SessionBusy({
				sessionId,
				message: 'The session is busy.'
			})
		: unavailable();

export interface FlectClientShape {
	readonly status: Effect.Effect<RuntimeStatus, FlectUnavailableError>;
	readonly models: Effect.Effect<ReadonlyArray<ModelSummary>, FlectUnavailableError>;
	readonly providerAuth: Effect.Effect<ReadonlyArray<ProviderAuthSummary>, FlectUnavailableError>;
	readonly loginProvider: (
		request: AuthLoginRequest
	) => Stream.Stream<AuthLoginEvent, FlectUnavailableError>;
	readonly replyProviderAuth: (
		reply: AuthSelectionReply
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly cancelProviderAuth: (
		reference: AuthLoginReference
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly refreshProviderAuth: Effect.Effect<
		ReadonlyArray<ProviderAuthSummary>,
		FlectUnavailableError
	>;
	readonly logoutProvider: (
		providerId: string
	) => Effect.Effect<ReadonlyArray<ProviderAuthSummary>, FlectUnavailableError>;
	readonly createSession: (
		selection: SessionSelection
	) => Effect.Effect<string, FlectUnavailableError>;
	readonly closeSession: (sessionId: string) => Effect.Effect<void, FlectUnavailableError>;
	readonly prompt: (
		sessionId: string,
		text: string
	) => Stream.Stream<FlectEvent, FlectUnavailableError | SessionBusy>;
	readonly shape: (
		sessionId: string,
		instruction: string,
		document: InterfaceDocument
	) => Stream.Stream<ShapeEvent, FlectUnavailableError | SessionBusy>;
	readonly cancel: (
		sessionId: string,
		role: InteractiveAgentRole
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly completeShellRequest: (
		sessionId: string,
		role: InteractiveAgentRole,
		requestId: string,
		result: BunCommandResult
	) => Effect.Effect<void, FlectUnavailableError>;
	readonly diagnoseRecovery: (
		sessionId: string,
		reason: RecoveryReason
	) => Effect.Effect<GuardianDiagnostic, FlectUnavailableError | SessionBusy>;
}

export class FlectClient extends Context.Service<FlectClient, FlectClientShape>()(
	'flect/browser/FlectClient'
) {}

const decodeEventJson = Schema.decodeUnknownEffect(
	Schema.fromJsonString(FlectEvent),
	strictOptions
);

const decodeShapeEventJson = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ShapeEvent),
	strictOptions
);

const decodeAuthEventJson = Schema.decodeUnknownEffect(
	Schema.fromJsonString(AuthLoginEvent),
	strictOptions
);

export const makeFlectClientLayer = (baseUrl = '/api') =>
	Layer.effect(
		FlectClient,
		Effect.gen(function* () {
			const transport = (yield* HttpClient.HttpClient).pipe(
				HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl.replace(/\/$/, ''))),
				HttpClient.filterStatusOk
			);

			const status = transport
				.get('/runtime')
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeStatus, strictOptions)),
					Effect.mapError(unavailable)
				);

			const models = transport.get('/models').pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsResponse, strictOptions)),
				Effect.map((response) => response.models),
				Effect.mapError(unavailable)
			);

			const decodeProviders = HttpClientResponse.schemaBodyJson(
				ProviderAuthResponse,
				strictOptions
			);
			const providerAuth = transport.get('/auth/providers').pipe(
				Effect.flatMap(decodeProviders),
				Effect.map((response) => response.providers),
				Effect.mapError(unavailable)
			);

			const loginProvider = (
				request: AuthLoginRequest
			): Stream.Stream<AuthLoginEvent, FlectUnavailableError> =>
				Stream.unwrap(
					HttpClientRequest.post('/auth/login').pipe(
						HttpClientRequest.schemaBodyJson(AuthLoginRequest)(request),
						Effect.flatMap(transport.execute),
						Effect.map((response) => response.stream),
						Effect.mapError(unavailable)
					)
				).pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.filter((line) => line.startsWith('data:')),
					Stream.map((line) => line.slice(5).trimStart()),
					Stream.mapEffect((json) => decodeAuthEventJson(json).pipe(Effect.mapError(unavailable))),
					Stream.mapError(unavailable)
				);

			const replyProviderAuth = Effect.fn('Client.replyProviderAuth')((reply: AuthSelectionReply) =>
				HttpClientRequest.post('/auth/reply').pipe(
					HttpClientRequest.schemaBodyJson(AuthSelectionReply)(reply),
					Effect.flatMap(transport.execute),
					Effect.asVoid,
					Effect.mapError(unavailable)
				)
			);

			const cancelProviderAuth = Effect.fn('Client.cancelProviderAuth')(
				(reference: AuthLoginReference) =>
					HttpClientRequest.post('/auth/cancel').pipe(
						HttpClientRequest.schemaBodyJson(AuthLoginReference)(reference),
						Effect.flatMap(transport.execute),
						Effect.asVoid,
						Effect.mapError(unavailable)
					)
			);

			const refreshProviderAuth = HttpClientRequest.post('/auth/refresh').pipe(
				transport.execute,
				Effect.flatMap(decodeProviders),
				Effect.map((response) => response.providers),
				Effect.mapError(unavailable)
			);

			const logoutProvider = Effect.fn('Client.logoutProvider')((providerId: string) =>
				HttpClientRequest.post('/auth/logout').pipe(
					HttpClientRequest.schemaBodyJson(ProviderLogoutRequest)({
						providerId
					}),
					Effect.flatMap(transport.execute),
					Effect.flatMap(decodeProviders),
					Effect.map((response) => response.providers),
					Effect.mapError(unavailable)
				)
			);

			const createSession = Effect.fn('Client.createSession')((selection: SessionSelection) =>
				HttpClientRequest.post('/sessions').pipe(
					HttpClientRequest.schemaBodyJson(SessionSelection)(selection),
					Effect.flatMap(transport.execute),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(SessionResponse, strictOptions)),
					Effect.map((response) => response.sessionId),
					Effect.mapError(unavailable)
				)
			);

			const prompt = (
				sessionId: string,
				text: string
			): Stream.Stream<FlectEvent, FlectUnavailableError> => {
				const response = decodePromptRequest({ text }).pipe(
					Effect.flatMap((prompt) =>
						HttpClientRequest.post(`/sessions/${encodeURIComponent(sessionId)}/prompts`).pipe(
							HttpClientRequest.schemaBodyJson(PromptRequest)(prompt),
							Effect.flatMap(transport.execute)
						)
					),
					Effect.map((result) => result.stream),
					Effect.mapError(unavailable)
				);

				return Stream.unwrap(response).pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.filter((line) => line.startsWith('data:')),
					Stream.map((line) => line.slice(5).trimStart()),
					Stream.mapEffect((json) => decodeEventJson(json).pipe(Effect.mapError(unavailable))),
					Stream.mapError(unavailable)
				);
			};

			const closeSession = Effect.fn('Client.closeSession')((sessionId: string) =>
				HttpClientRequest.delete(`/sessions/${encodeURIComponent(sessionId)}`).pipe(
					transport.execute,
					Effect.flatMap(HttpClientResponse.schemaBodyJson(CloseSessionResponse, strictOptions)),
					Effect.asVoid,
					Effect.mapError(unavailable)
				)
			);

			const cancel = Effect.fn('Client.cancel')((sessionId: string, role: InteractiveAgentRole) =>
				HttpClientRequest.post(`/sessions/${encodeURIComponent(sessionId)}/cancel`).pipe(
					HttpClientRequest.schemaBodyJson(CancelRequest)(CancelRequest.make({ role })),
					Effect.flatMap(transport.execute),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(CancelResponse, strictOptions)),
					Effect.asVoid,
					Effect.mapError(unavailable)
				)
			);

			const completeShellRequest = Effect.fn('Client.completeShellRequest')(
				(
					sessionId: string,
					role: InteractiveAgentRole,
					requestId: string,
					result: BunCommandResult
				) =>
					HttpClientRequest.post(`/sessions/${encodeURIComponent(sessionId)}/shell-results`).pipe(
						HttpClientRequest.schemaBodyJson(AgentShellResultRequest)(
							AgentShellResultRequest.make({ role, requestId, result })
						),
						Effect.flatMap(transport.execute),
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(AgentShellResultAccepted, strictOptions)
						),
						Effect.asVoid,
						Effect.mapError(unavailable)
					)
			);

			const shape = (sessionId: string, instruction: string, document: InterfaceDocument) =>
				Stream.unwrap(
					encodeInterfaceDocument(document).pipe(
						Effect.flatMap((encodedDocument) =>
							HttpClientRequest.post(`/sessions/${encodeURIComponent(sessionId)}/shape`).pipe(
								HttpClientRequest.schemaBodyJson(ShapeRequest)(
									ShapeRequest.make({
										instruction,
										document: encodedDocument
									})
								),
								Effect.flatMap(transport.execute)
							)
						),
						Effect.map((result) => result.stream),
						Effect.mapError(shapeFailure(sessionId))
					)
				).pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.filter((line) => line.startsWith('data:')),
					Stream.map((line) => line.slice(5).trimStart()),
					Stream.mapEffect((json) =>
						decodeShapeEventJson(json).pipe(Effect.mapError(() => unavailable()))
					),
					Stream.mapError(shapeFailure(sessionId)),
					Stream.mapEffect(
						(event): Effect.Effect<ShapeEvent, FlectUnavailableError | SessionBusy> => {
							if (event.type === 'shape_busy') {
								return Effect.fail(
									new SessionBusy({
										sessionId,
										message: 'The session is busy.'
									})
								);
							}
							if (event.type === 'shape_error') {
								return Effect.fail(unavailable());
							}
							return Effect.succeed(event);
						}
					)
				);

			const diagnoseRecovery = Effect.fn('Client.diagnoseRecovery')(
				(sessionId: string, reason: RecoveryReason) =>
					HttpClientRequest.post(`/sessions/${encodeURIComponent(sessionId)}/guardian`).pipe(
						HttpClientRequest.schemaBodyJson(RecoveryRequest)(new RecoveryRequest({ reason })),
						Effect.flatMap(transport.execute),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GuardianDiagnostic, strictOptions)),
						Effect.mapError(diagnoseFailure(sessionId))
					)
			);

			return {
				status,
				models,
				providerAuth,
				loginProvider,
				replyProviderAuth,
				cancelProviderAuth,
				refreshProviderAuth,
				logoutProvider,
				createSession,
				closeSession,
				prompt,
				shape,
				cancel,
				completeShellRequest,
				diagnoseRecovery
			};
		})
	);
