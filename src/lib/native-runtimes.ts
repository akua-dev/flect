import { isTauri } from '@tauri-apps/api/core';
import { Layer, ManagedRuntime } from 'effect';
import type { NativeUpdateError } from '../../shared/native-update';
import type { AgentIntegration } from './agent-integration';
import type { FlectUnavailableError } from './api';
import { type NativeUpdate, NativeUpdateUnavailableLive } from './native-update';
import type { ShellLink } from './shell-link';
import {
	makeTauriAgentIntegrationLayer,
	makeTauriNativeUpdateLayer,
	makeTauriShellLinkLayer,
	makeTauriUninstallLayer
} from './tauri-native-lifecycle-transport';
import { TauriBridgeLive, TauriNativeHostLive } from './tauri-transport';
import type { Uninstall } from './uninstall';

export type NativeSetupRuntime = ManagedRuntime.ManagedRuntime<
	AgentIntegration | ShellLink | Uninstall,
	FlectUnavailableError
>;

const NativeSetupDependenciesLive = isTauri()
	? Layer.merge(
			makeTauriAgentIntegrationLayer().pipe(Layer.provide(TauriBridgeLive)),
			makeTauriShellLinkLayer().pipe(Layer.provide(TauriNativeHostLive))
		)
	: undefined;

const NativeSetupLive =
	NativeSetupDependenciesLive === undefined
		? undefined
		: Layer.merge(
				NativeSetupDependenciesLive,
				makeTauriUninstallLayer().pipe(
					Layer.provideMerge(NativeSetupDependenciesLive),
					Layer.provide(TauriNativeHostLive)
				)
			);

export const nativeSetupRuntime: NativeSetupRuntime | undefined =
	NativeSetupLive === undefined ? undefined : ManagedRuntime.make(NativeSetupLive);

export type NativeUpdateRuntime = ManagedRuntime.ManagedRuntime<NativeUpdate, NativeUpdateError>;

const NativeUpdateLive = isTauri()
	? makeTauriNativeUpdateLayer().pipe(Layer.provide(TauriNativeHostLive))
	: NativeUpdateUnavailableLive;

export const nativeUpdateRuntime: NativeUpdateRuntime = ManagedRuntime.make(NativeUpdateLive);
