// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentIntegrationStatus, ShellLinkStatus } from '../../shared/setup';
import {
	UninstallApplication,
	UninstallOwnedItem,
	UninstallPlan,
	UninstallRetainedItem
} from '../../shared/uninstall';
import { type NativeSetupClient, useNativeSetup } from './use-native-setup';

afterEach(cleanup);

describe('useNativeSetup', () => {
	const uninstall = (result: 'pending' | 'removed') =>
		UninstallPlan.make({
			version: 1,
			application: UninstallApplication.make({
				path: '/Applications/Flect.app',
				action: 'move-to-trash'
			}),
			ownedIntegrations: [
				UninstallOwnedItem.make({
					kind: 'shell-link',
					path: '/fixture/.local/bin/flect',
					result
				})
			],
			retained: [
				UninstallRetainedItem.make({
					kind: 'workspace-data',
					reason: 'Workspace data remains available.'
				})
			]
		});

	it('reports the browser boundary definitively', () => {
		const { result } = renderHook(() => useNativeSetup(undefined));

		expect(result.current.available).toBe(false);
		expect(result.current.loading).toBe(false);
		expect(result.current.agents).toEqual([]);
	});

	it('refreshes reactive status after a typed mutation', async () => {
		let installed = false;
		const status = vi.fn(async () => ({
			shell: ShellLinkStatus.make({
				state: installed ? 'installed' : 'absent',
				path: '/fixture/.local/bin/flect',
				changed: false
			}),
			agents: [
				AgentIntegrationStatus.make({
					host: 'codex',
					state: 'absent',
					path: '/fixture/.codex/hooks.json',
					changed: false
				})
			],
			uninstall: uninstall('pending')
		}));
		const installShell = vi.fn(async () => {
			installed = true;
		});
		const client: NativeSetupClient = {
			status,
			installShell,
			removeShell: async () => undefined,
			installAgent: async () => undefined,
			removeAgent: async () => undefined,
			prepareUninstall: async () => uninstall('removed')
		};

		const { result } = renderHook(() => useNativeSetup(client));
		await waitFor(() => expect(result.current.shell?.state).toBe('absent'));
		await act(() => result.current.installShell());

		expect(installShell).toHaveBeenCalledOnce();
		expect(status).toHaveBeenCalledTimes(2);
		expect(result.current.shell?.state).toBe('installed');
	});

	it('projects the ownership-safe uninstall result reactively', async () => {
		const prepareUninstall = vi.fn(async () => uninstall('removed'));
		const client: NativeSetupClient = {
			status: async () => ({
				shell: ShellLinkStatus.make({
					state: 'installed',
					path: '/fixture/.local/bin/flect',
					changed: false
				}),
				agents: [],
				uninstall: uninstall('pending')
			}),
			installShell: async () => undefined,
			removeShell: async () => undefined,
			installAgent: async () => undefined,
			removeAgent: async () => undefined,
			prepareUninstall
		};

		const { result } = renderHook(() => useNativeSetup(client));
		await waitFor(() =>
			expect(result.current.uninstall?.ownedIntegrations[0]?.result).toBe('pending')
		);
		await act(() => result.current.prepareUninstall());

		expect(prepareUninstall).toHaveBeenCalledOnce();
		expect(result.current.uninstall?.ownedIntegrations[0]?.result).toBe('removed');
	});
});
