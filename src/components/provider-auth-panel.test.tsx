// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
	AuthDeviceCode,
	AuthFailed,
	AuthProtectedEntry,
	AuthSelectionRequired,
	ProviderAuthSummary
} from '../../shared/contracts';
import { ProviderAuthPanel } from './provider-auth-panel';

afterEach(cleanup);

const disconnected = ProviderAuthSummary.make({
	version: 1,
	id: 'openai-codex',
	name: 'OpenAI Codex',
	status: 'disconnected',
	methods: [{ type: 'oauth', label: 'ChatGPT subscription' }]
});

const connected = ProviderAuthSummary.make({
	...disconnected,
	status: 'connected',
	sourceLabel: 'Pi credential store',
	credentialType: 'oauth'
});

const callbacks = () => ({
	onLogin: vi.fn(),
	onReply: vi.fn(() => Promise.resolve()),
	onCancel: vi.fn(() => Promise.resolve()),
	onRefresh: vi.fn(() => Promise.resolve()),
	onLogout: vi.fn(() => Promise.resolve())
});

describe('ProviderAuthPanel', () => {
	it('keeps one recommended browser login primary until more providers are requested', async () => {
		const actions = callbacks();
		const apiKeyProvider = ProviderAuthSummary.make({
			version: 1,
			id: 'anthropic',
			name: 'Anthropic',
			status: 'disconnected',
			methods: [{ type: 'api_key', label: 'Anthropic API key' }]
		});
		render(
			<ProviderAuthPanel
				authEvent={undefined}
				compact
				disabled={false}
				providers={[apiKeyProvider, disconnected]}
				{...actions}
			/>
		);

		expect(screen.getByRole('button', { name: 'ChatGPT subscription' })).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Anthropic API key' })).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Other providers (1)' }));
		expect(screen.getByRole('button', { name: 'Anthropic API key' })).toBeVisible();
	});

	it('starts a Pi-owned provider login without rendering credential inputs', async () => {
		const actions = callbacks();
		render(
			<ProviderAuthPanel
				authEvent={undefined}
				disabled={false}
				providers={[disconnected]}
				{...actions}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }));
		expect(actions.onLogin).toHaveBeenCalledWith({
			providerId: 'openai-codex',
			method: 'oauth'
		});
		expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
	});

	it('opens protected entry in a one-use page and exposes cancellation', async () => {
		const actions = callbacks();
		const loginId = 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		render(
			<ProviderAuthPanel
				authEvent={AuthProtectedEntry.make({
					type: 'auth_protected_entry',
					loginId,
					promptId: 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
					label: 'Enter provider information securely',
					url: 'http://127.0.0.1:43123/entry/one-use-path'
				})}
				disabled={false}
				providers={[disconnected]}
				{...actions}
			/>
		);

		const link = screen.getByRole('link', { name: 'Continue securely' });
		expect(link).toHaveAttribute('href', 'http://127.0.0.1:43123/entry/one-use-path');
		expect(link).toHaveAttribute('rel', 'noreferrer noopener');
		expect(screen.queryByLabelText(/api key|credential/i)).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Cancel login' }));
		expect(actions.onCancel).toHaveBeenCalledWith({ loginId });
	});

	it('returns only a bounded selection reply to Pi', async () => {
		const actions = callbacks();
		const loginId = 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		const promptId = 'prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2';
		render(
			<ProviderAuthPanel
				authEvent={AuthSelectionRequired.make({
					type: 'auth_selection_required',
					loginId,
					promptId,
					message: 'Choose how to continue with this provider.',
					options: [{ id: 'browser', label: 'Browser login' }]
				})}
				disabled={false}
				providers={[disconnected]}
				{...actions}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Browser login' }));
		expect(actions.onReply).toHaveBeenCalledWith({
			loginId,
			promptId,
			optionId: 'browser'
		});
	});

	it('copies a public device code without rendering a sensitive input', async () => {
		const actions = callbacks();
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		render(
			<ProviderAuthPanel
				authEvent={AuthDeviceCode.make({
					type: 'auth_device_code',
					loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
					userCode: 'ABCD-EFGH',
					verificationUrl: 'https://provider.example.test/device'
				})}
				disabled={false}
				providers={[disconnected]}
				{...actions}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
		expect(writeText).toHaveBeenCalledWith('ABCD-EFGH');
		expect(await screen.findByText('Device code copied.')).toBeVisible();
		expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
	});

	it('confirms that disconnect restarts private sessions', async () => {
		const actions = callbacks();
		render(
			<ProviderAuthPanel
				authEvent={AuthFailed.make({
					type: 'auth_failed',
					loginId: 'login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
					code: 'expired',
					message: 'Provider authentication could not be completed.'
				})}
				disabled={false}
				providers={[connected]}
				{...actions}
			/>
		);

		expect(screen.getByText(/login expired/i)).toBeVisible();
		await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
		expect(screen.getByText(/private sessions will restart/i)).toBeVisible();
		expect(actions.onLogout).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
		expect(actions.onLogout).toHaveBeenCalledWith('openai-codex');
	});
});
