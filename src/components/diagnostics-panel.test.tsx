// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ControlStateSnapshot, OperationRecord, UserCommandSource } from '../../shared/control';
import {
	NativeUpdateCandidate,
	NativeUpdateProgress,
	NativeUpdateSnapshot
} from '../../shared/native-update';
import { AgentIntegrationStatus, ShellLinkStatus } from '../../shared/setup';
import {
	UninstallApplication,
	UninstallOwnedItem,
	UninstallPlan,
	UninstallRetainedItem
} from '../../shared/uninstall';
import { DiagnosticsPanel } from './diagnostics-panel';

afterEach(cleanup);

describe('DiagnosticsPanel', () => {
	it('keeps session-only storage visible while Diagnostics is collapsed', async () => {
		const user = userEvent.setup();
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: false, clients: [] })}
				onToggleControl={() => Promise.resolve()}
				operations={[]}
				persistence={{ capsule: 'session', source: 'durable' }}
			/>
		);

		expect(screen.getByText('Session-only storage')).toBeVisible();
		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Compiled interfaces will be lost when this Flect session closes'
		);
	});

	it('shows local control state and safe operation evidence', async () => {
		const user = userEvent.setup();
		const onToggleControl = vi.fn(() => Promise.resolve());
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({
					enabled: false,
					clients: []
				})}
				onToggleControl={onToggleControl}
				operations={[
					OperationRecord.make({
						version: 1,
						sequence: 1,
						operationId: 'operation-diagnostics-1',
						commandId: 'cmd-diagnostics-1',
						workspaceId: 'workspace-diagnostics',
						source: UserCommandSource.make({ kind: 'user' }),
						category: 'validation',
						phase: 'failed',
						summary: 'Proposal validation failed',
						timestamp: 10,
						role: 'shaper'
					})
				]}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByText('Proposal validation failed')).toBeVisible();
		await user.click(screen.getByRole('button', { name: 'Enable local control' }));
		expect(onToggleControl).toHaveBeenCalledOnce();
		expect(screen.getByText('Desktop app required')).toBeVisible();
	});

	it('confirms exact native setup mutations and exposes definitive states', async () => {
		const user = userEvent.setup();
		const installShell = vi.fn(() => Promise.resolve());
		const removeAgent = vi.fn(() => Promise.resolve());
		const confirmation = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: false, clients: [] })}
				onToggleControl={() => Promise.resolve()}
				operations={[]}
				setup={{
					available: true,
					loading: false,
					shell: ShellLinkStatus.make({
						state: 'absent',
						path: '/Users/test/.local/bin/flect',
						changed: false
					}),
					agents: [
						AgentIntegrationStatus.make({
							host: 'codex',
							state: 'installed',
							path: '/Users/test/.codex/hooks.json',
							changed: false
						})
					],
					refresh: () => Promise.resolve(),
					installShell,
					removeShell: () => Promise.resolve(),
					installAgent: () => Promise.resolve(),
					removeAgent,
					prepareUninstall: () => Promise.resolve()
				}}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByText('Not installed')).toBeVisible();
		expect(screen.getByText('Installed', { selector: 'span' })).toBeVisible();
		await user.click(screen.getByRole('button', { name: 'Install command-line link' }));
		await user.click(screen.getByRole('button', { name: 'Remove Codex context' }));

		expect(confirmation).toHaveBeenNthCalledWith(
			1,
			'Install Flect at ~/.local/bin/flect? Only an existing stale Flect-owned link can be replaced.'
		);
		expect(confirmation).toHaveBeenNthCalledWith(
			2,
			'Remove Flect context from Codex? Unrelated hooks and settings will be preserved.'
		);
		expect(installShell).toHaveBeenCalledOnce();
		expect(removeAgent).toHaveBeenCalledWith('codex');
		confirmation.mockRestore();
	});

	it('confirms ownership-safe uninstall preparation and names retained data', async () => {
		const user = userEvent.setup();
		const prepareUninstall = vi.fn(() => Promise.resolve());
		const disableControl = vi.fn(() => Promise.resolve());
		const confirmation = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: true, clients: [] })}
				onToggleControl={disableControl}
				operations={[]}
				setup={{
					available: true,
					loading: false,
					agents: [],
					uninstall: UninstallPlan.make({
						version: 1,
						application: UninstallApplication.make({
							path: '/Applications/Flect.app',
							action: 'move-to-trash'
						}),
						ownedIntegrations: [
							UninstallOwnedItem.make({
								kind: 'shell-link',
								path: '/Users/test/.local/bin/flect',
								result: 'pending'
							})
						],
						retained: [
							UninstallRetainedItem.make({
								kind: 'workspace-data',
								reason: 'Projects and interface history remain available.'
							}),
							UninstallRetainedItem.make({
								kind: 'provider-authentication',
								reason: 'Provider sessions remain until the user removes them.'
							}),
							UninstallRetainedItem.make({
								kind: 'exports',
								reason: 'Exported files remain in place.'
							})
						]
					}),
					refresh: () => Promise.resolve(),
					installShell: () => Promise.resolve(),
					removeShell: () => Promise.resolve(),
					installAgent: () => Promise.resolve(),
					removeAgent: () => Promise.resolve(),
					prepareUninstall
				}}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByText('Workspace data')).toBeVisible();
		expect(screen.getByText('Provider authentication')).toBeVisible();
		expect(screen.getByText('Exports')).toBeVisible();
		await user.click(screen.getByRole('button', { name: 'Prepare to uninstall' }));

		expect(confirmation).toHaveBeenCalledWith(
			'Prepare Flect for removal? This disables Local control and removes only Flect-owned command and agent integrations. Your work and settings stay in place.'
		);
		await waitFor(() => expect(prepareUninstall).toHaveBeenCalledOnce());
		expect(disableControl).toHaveBeenCalledOnce();
		expect(disableControl.mock.invocationCallOrder[0]).toBeLessThan(
			prepareUninstall.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
		);
		confirmation.mockRestore();
	});

	it('shows a reviewed native update and confirms installation', async () => {
		const user = userEvent.setup();
		const install = vi.fn(() => Promise.resolve());
		const confirmation = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: false, clients: [] })}
				onToggleControl={() => Promise.resolve()}
				operations={[]}
				update={{
					snapshot: NativeUpdateSnapshot.make({
						version: 1,
						state: 'available',
						installedVersion: '0.2.0',
						candidate: NativeUpdateCandidate.make({
							version: '0.2.1',
							token: 'candidate-token-0001',
							notes: 'Security and reliability improvements.',
							target: 'darwin-aarch64',
							contentLength: 2048
						})
					}),
					loading: false,
					check: () => Promise.resolve(),
					install,
					relaunch: () => Promise.resolve()
				}}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByText('Flect 0.2.1 is available')).toBeVisible();
		expect(screen.getByText('Security and reliability improvements.')).toBeVisible();
		await user.click(screen.getByRole('button', { name: 'Install update' }));

		expect(confirmation).toHaveBeenCalledWith(
			'Install Flect 0.2.1 and restart when it is ready? Your work and settings stay in place.'
		);
		expect(install).toHaveBeenCalledWith('candidate-token-0001');
		confirmation.mockRestore();
	});

	it('reports the browser update boundary without an install action', async () => {
		const user = userEvent.setup();
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: false, clients: [] })}
				onToggleControl={() => Promise.resolve()}
				operations={[]}
				update={{
					snapshot: NativeUpdateSnapshot.make({
						version: 1,
						state: 'unavailable',
						installedVersion: '0.2.0',
						reason: 'browser'
					}),
					loading: false,
					check: () => Promise.resolve(),
					install: () => Promise.resolve(),
					relaunch: () => Promise.resolve()
				}}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByText('Updates are available in a signed desktop release.')).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
	});

	it('exposes bounded update progress accessibly', async () => {
		const user = userEvent.setup();
		render(
			<DiagnosticsPanel
				control={ControlStateSnapshot.make({ enabled: false, clients: [] })}
				onToggleControl={() => Promise.resolve()}
				operations={[]}
				update={{
					snapshot: NativeUpdateSnapshot.make({
						version: 1,
						state: 'downloading',
						installedVersion: '0.2.0',
						candidate: NativeUpdateCandidate.make({
							version: '0.2.1',
							token: 'candidate-token-0001',
							notes: 'A focused update.',
							target: 'darwin-aarch64',
							contentLength: 2048
						}),
						progress: NativeUpdateProgress.make({
							downloadedBytes: 512,
							totalBytes: 2048
						})
					}),
					loading: true,
					check: () => Promise.resolve(),
					install: () => Promise.resolve(),
					relaunch: () => Promise.resolve()
				}}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Diagnostics/i }));
		expect(screen.getByRole('progressbar', { name: 'Update progress' })).toHaveAttribute(
			'value',
			'512'
		);
		expect(screen.getByRole('progressbar', { name: 'Update progress' })).toHaveAttribute(
			'max',
			'2048'
		);
	});
});
