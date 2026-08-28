import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Context, Effect, Layer, Stream } from 'effect';
import * as RpcClient from 'effect/unstable/rpc/RpcClient';
import { RpcClientDefect, RpcClientError } from 'effect/unstable/rpc/RpcClientError';
import type { FromClientEncoded, FromServerEncoded } from 'effect/unstable/rpc/RpcMessage';
import type { FlectWorkspaceEvent, FlectWorkspaceSnapshot } from '../../shared/control';
import type { ControlCommandCompletion } from '../../shared/control-channel';
import { encodeInterfaceDocument } from '../../shared/interface-document';
import { FlectRpcs } from '../../shared/rpc';
import { FlectClient, type FlectClientShape, FlectUnavailableError } from './api';
import { TauriNativeHost } from './tauri-native-host';
import {
	WorkspaceControlTransport,
	type WorkspaceControlTransportShape
} from './workspace-control-transport';

const unavailable = () =>
	FlectUnavailableError.make({
		message: 'The local Flect runtime is unavailable.'
	});

const rpcTransportError = () =>
	new RpcClientError({
		reason: new RpcClientDefect({
			message: 'The private desktop runtime transport failed.',
			cause: undefined
		})
	});

const hasRequestId = (value: object): value is object & { readonly requestId: string | number } =>
	'requestId' in value &&
	(typeof value.requestId === 'string' || typeof value.requestId === 'number');

const isFromServerEncoded = (payload: unknown): payload is FromServerEncoded => {
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!('_tag' in payload) ||
		typeof payload._tag !== 'string'
	) {
		return false;
	}

	switch (payload._tag) {
		case 'Pong':
			return true;
		case 'Defect':
			return 'defect' in payload;
		case 'Chunk':
			return (
				hasRequestId(payload) &&
				'values' in payload &&
				Array.isArray(payload.values) &&
				payload.values.length > 0
			);
		case 'Exit':
			return (
				hasRequestId(payload) &&
				'exit' in payload &&
				typeof payload.exit === 'object' &&
				payload.exit !== null &&
				'_tag' in payload.exit &&
				(payload.exit._tag === 'Success' || payload.exit._tag === 'Failure')
			);
		case 'ClientProtocolError':
			return (
				'error' in payload &&
				typeof payload.error === 'object' &&
				payload.error !== null &&
				'_tag' in payload.error &&
				payload.error._tag === 'RpcClientError' &&
				'reason' in payload.error &&
				typeof payload.error.reason === 'object' &&
				payload.error.reason !== null &&
				'_tag' in payload.error.reason &&
				payload.error.reason._tag === 'RpcClientDefect' &&
				'message' in payload.error.reason &&
				typeof payload.error.reason.message === 'string'
			);
		default:
			return false;
	}
};

export interface TauriBridgeShape {
	readonly listen: (
		handler: (payload: unknown) => void
	) => Effect.Effect<Effect.Effect<void>, FlectUnavailableError>;
	readonly send: (request: FromClientEncoded) => Effect.Effect<void, FlectUnavailableError>;
}

export class TauriBridge extends Context.Service<TauriBridge, TauriBridgeShape>()(
	'flect/TauriBridge'
) {}

export const TauriNativeHostLive = Layer.succeed(TauriNativeHost)({
	invoke: Effect.fn('TauriNativeHost.invoke')((command, args) =>
		Effect.tryPromise({
			try: () => invoke<unknown>(command, args),
			catch: unavailable
		})
	)
});

export const TauriBridgeLive = Layer.succeed(TauriBridge)({
	listen: Effect.fn('TauriBridge.listen')((handler) =>
		Effect.tryPromise({
			try: () =>
				listen<unknown>('flect://rpc', (event) => {
					handler(event.payload);
				}),
			catch: unavailable
		}).pipe(
			Effect.map((unlisten) =>
				Effect.try({
					try: () => unlisten(),
					catch: unavailable
				}).pipe(Effect.catch(() => Effect.void))
			)
		)
	),
	send: Effect.fn('TauriBridge.send')((request) =>
		Effect.tryPromise({
			try: () => invoke<undefined>('rpc_send', { request }),
			catch: unavailable
		})
	)
});

export const TauriProtocolLive = Layer.effect(
	RpcClient.Protocol,
	RpcClient.Protocol.make((writeResponse, clientIds) =>
		Effect.gen(function* () {
			const bridge = yield* TauriBridge;
			const knownClientIds = new Set<number>();
			const unlisten = yield* bridge.listen((payload) => {
				if (!isFromServerEncoded(payload)) {
					return;
				}
				const recipients = clientIds.size > 0 ? clientIds : knownClientIds;
				for (const clientId of recipients) {
					Effect.runFork(writeResponse(clientId, payload));
				}
			});
			yield* Effect.addFinalizer(() => unlisten);

			return {
				send: (clientId, request) =>
					Effect.sync(() => {
						knownClientIds.add(clientId);
					}).pipe(Effect.andThen(bridge.send(request)), Effect.mapError(rpcTransportError)),
				supportsAck: true,
				supportsTransferables: false
			};
		})
	)
);

export const makeTauriFlectClientLayer = () =>
	Layer.effect(
		FlectClient,
		Effect.gen(function* () {
			const rpc = yield* RpcClient.make(FlectRpcs);

			// oxlint-disable effecttsgo/missing-effect-context -- false positive: `tsc -b`
			// confirms every property below resolves to R = never (FlectRpcs declares no
			// middleware/context requirements); effecttsgo cannot fully resolve the nested
			// conditional/mapped `RpcClient.From<Rpcs, E>` generic across this many
			// differently-shaped properties and falls back to reporting `unknown`. See the
			// escalations list in the conformance burn-down report.
			return {
				status: rpc.GetRuntime().pipe(Effect.mapError(unavailable)),
				models: rpc.ListModels().pipe(Effect.mapError(unavailable)),
				providerAuth: rpc.ListProviderAuth().pipe(Effect.mapError(unavailable)),
				loginProvider: (request) => rpc.LoginProvider(request).pipe(Stream.mapError(unavailable)),
				replyProviderAuth: (reply) =>
					rpc.ReplyProviderAuthSelection(reply).pipe(Effect.mapError(unavailable), Effect.asVoid),
				cancelProviderAuth: (reference) =>
					rpc.CancelProviderAuth(reference).pipe(Effect.mapError(unavailable), Effect.asVoid),
				refreshProviderAuth: rpc.RefreshProviderAuth().pipe(Effect.mapError(unavailable)),
				logoutProvider: (providerId) =>
					rpc.LogoutProvider({ providerId }).pipe(Effect.mapError(unavailable)),
				createSession: (selection) =>
					rpc.CreateSession(selection).pipe(Effect.mapError(unavailable)),
				closeSession: (sessionId) =>
					rpc.CloseSession({ sessionId }).pipe(Effect.mapError(unavailable)),
				prompt: (sessionId, text) =>
					rpc
						.Prompt({ sessionId, text })
						.pipe(
							Stream.mapError((error) => (error._tag === 'SessionBusy' ? error : unavailable()))
						),
				shape: (sessionId, instruction, document) =>
					Stream.unwrap(
						encodeInterfaceDocument(document).pipe(
							Effect.mapError(unavailable),
							Effect.map((encodedDocument) =>
								rpc
									.Shape({
										sessionId,
										instruction,
										document: encodedDocument
									})
									.pipe(
										Stream.mapError((error) =>
											error._tag === 'SessionBusy' ? error : unavailable()
										)
									)
							)
						)
					),
				cancel: (sessionId, role) =>
					rpc.Cancel({ sessionId, role }).pipe(Effect.mapError(unavailable), Effect.asVoid),
				completeShellRequest: (sessionId, role, requestId, result) =>
					rpc
						.CompleteShellRequest({ sessionId, role, requestId, result })
						.pipe(Effect.mapError(unavailable), Effect.asVoid),
				diagnoseRecovery: (sessionId, reason) =>
					rpc
						.DiagnoseRecovery({ sessionId, reason })
						.pipe(
							Effect.mapError((error) => (error._tag === 'SessionBusy' ? error : unavailable()))
						)
			} satisfies FlectClientShape;
			// oxlint-enable effecttsgo/missing-effect-context
		})
	).pipe(Layer.provide(TauriProtocolLive));

export const makeTauriWorkspaceControlTransportLayer = () =>
	Layer.effect(
		WorkspaceControlTransport,
		Effect.gen(function* () {
			const rpc = yield* RpcClient.make(FlectRpcs);

			// oxlint-disable effecttsgo/missing-effect-context -- false positive, same cause
			// as makeTauriFlectClientLayer above: `tsc -b` confirms R = never throughout.
			return {
				enable: (snapshot: FlectWorkspaceSnapshot) =>
					rpc.ControlEnable({ snapshot }).pipe(Effect.mapError(unavailable)),
				status: rpc.ControlStatus().pipe(Effect.mapError(unavailable)),
				disable: rpc.ControlDisable().pipe(Effect.mapError(unavailable), Effect.asVoid),
				publishSnapshot: (snapshot: FlectWorkspaceSnapshot) =>
					rpc
						.ControlPublishSnapshot({ snapshot })
						.pipe(Effect.mapError(unavailable), Effect.asVoid),
				publishEvent: (event: FlectWorkspaceEvent) =>
					rpc.ControlPublishEvent({ event }).pipe(Effect.mapError(unavailable), Effect.asVoid),
				nextCommand: (workspaceId: string) =>
					rpc.ControlNextCommand({ workspaceId }).pipe(Effect.mapError(unavailable)),
				complete: (completion: ControlCommandCompletion) =>
					rpc.ControlComplete({ completion }).pipe(Effect.mapError(unavailable), Effect.asVoid)
			} satisfies WorkspaceControlTransportShape;
			// oxlint-enable effecttsgo/missing-effect-context
		})
	).pipe(Layer.provide(TauriProtocolLive));
