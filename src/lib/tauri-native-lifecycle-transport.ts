import { Effect, Layer, Schema } from 'effect';
import * as RpcClient from 'effect/unstable/rpc/RpcClient';
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError';
import { NativeUpdateError, NativeUpdateSnapshot } from '../../shared/native-update';
import { FlectRpcs } from '../../shared/rpc';
import {
	AgentIntegration,
	AgentIntegrationError,
	type AgentIntegrationShape
} from './agent-integration';
import { FlectUnavailableError } from './api';
import { makeGuardedNativeUpdate, NativeUpdate } from './native-update';
import { ShellLink, ShellLinkError, ShellLinkStatus } from './shell-link';
import { TauriNativeHost } from './tauri-native-host';
import { TauriProtocolLive } from './tauri-transport';
import { makeUninstall, Uninstall } from './uninstall';

const unavailable = () =>
	FlectUnavailableError.make({
		message: 'The local Flect runtime is unavailable.'
	});

const nativeUpdateUnavailable = () =>
	NativeUpdateError.make({
		reason: 'unavailable',
		message: 'Native update state is unavailable.'
	});

export const makeTauriNativeUpdateLayer = () =>
	Layer.effect(
		NativeUpdate,
		Effect.gen(function* () {
			const host = yield* TauriNativeHost;
			const snapshot = (
				command: 'native_update_status' | 'native_update_check' | 'native_update_install',
				args?: Readonly<Record<string, unknown>>
			) =>
				host.invoke(command, args).pipe(
					Effect.flatMap(
						Schema.decodeUnknownEffect(NativeUpdateSnapshot, {
							errors: 'all',
							onExcessProperty: 'error'
						})
					),
					Effect.mapError(nativeUpdateUnavailable)
				);
			return yield* makeGuardedNativeUpdate({
				status: snapshot('native_update_status'),
				check: snapshot('native_update_check'),
				install: (token) => snapshot('native_update_install', { token }),
				relaunch: host
					.invoke('native_update_relaunch')
					.pipe(Effect.asVoid, Effect.mapError(nativeUpdateUnavailable))
			});
		})
	);

export const makeTauriShellLinkLayer = () =>
	Layer.effect(
		ShellLink,
		Effect.gen(function* () {
			const host = yield* TauriNativeHost;
			const call = (command: 'shell_link_status' | 'shell_link_install' | 'shell_link_remove') =>
				host.invoke(command).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(ShellLinkStatus)),
					Effect.mapError(() =>
						ShellLinkError.make({
							reason: 'io',
							message: 'The native shell-link capability is unavailable.'
						})
					)
				);
			return {
				status: call('shell_link_status'),
				install: call('shell_link_install'),
				remove: call('shell_link_remove')
			};
		})
	);

export const nativeApplicationPath = TauriNativeHost.pipe(
	Effect.flatMap((host) => host.invoke('native_application_path')),
	Effect.flatMap(
		Schema.decodeUnknownEffect(
			Schema.String.check(
				Schema.isMinLength(11),
				Schema.isMaxLength(4096),
				Schema.isPattern(/\/Flect\.app$/)
			),
			{ errors: 'all', onExcessProperty: 'error' }
		)
	),
	Effect.mapError(() => unavailable())
);

export const makeTauriUninstallLayer = () =>
	Layer.effect(
		Uninstall,
		Effect.gen(function* () {
			const applicationPath = yield* nativeApplicationPath;
			return yield* makeUninstall({ applicationPath });
		})
	);

export const makeTauriAgentIntegrationLayer = () =>
	Layer.effect(
		AgentIntegration,
		Effect.gen(function* () {
			const rpc = yield* RpcClient.make(FlectRpcs);
			const mapError = <A, R>(
				effect: Effect.Effect<A, AgentIntegrationError | RpcClientError, R>
			) =>
				effect.pipe(
					Effect.mapError((error) =>
						error._tag === 'AgentIntegrationError'
							? error
							: AgentIntegrationError.make({
									host: 'codex',
									reason: 'io',
									message: 'The private agent integration runtime is unavailable.'
								})
					)
				);
			const statusAll = mapError(rpc.SetupAgentStatus());
			return {
				status: (host) =>
					statusAll.pipe(
						Effect.flatMap((statuses) => {
							const status = statuses.find((candidate) => candidate.host === host);
							return status === undefined
								? Effect.fail(
										AgentIntegrationError.make({
											host,
											reason: 'invalid-config',
											message: `Flect did not return ${host} integration status.`
										})
									)
								: Effect.succeed(status);
						})
					),
				statusAll,
				install: (host) => mapError(rpc.SetupAgentInstall({ host })),
				remove: (host) => mapError(rpc.SetupAgentRemove({ host }))
			} satisfies AgentIntegrationShape;
		})
	).pipe(Layer.provide(TauriProtocolLive));
