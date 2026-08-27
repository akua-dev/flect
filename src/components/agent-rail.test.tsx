// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
	PortableExtensionCatalogSnapshot,
	PortableExtensionPackage,
	PortableExtensionRoleState
} from '../../shared/extensions';
import { InterfaceDocument } from '../../shared/interface-document';
import {
	ProductCapabilityAllowChoice,
	ProductCapabilityProjection,
	ProductCapabilityRequestContext
} from '../../shared/product-capability';
import { ShellPreferencesValue } from '../../shared/shell-preferences';
import type { AgentWorkspaceController } from '../hooks/use-agent-session';
import type { CapsuleReview } from '../lib/workspace-controller';
import { AgentRail, type ShapingController } from './agent-rail';

afterEach(cleanup);

const document = InterfaceDocument.make({
	version: 2,
	name: 'Focused project overview',
	root: { id: 'root', type: 'text', text: 'Projects', style: 'headline' }
});

const permissionContext = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.akua.review',
	workspaceId: 'workspace-local-default',
	requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	revision: 'abc123',
	capabilities: [
		{ capabilityId: 'product:projects:read', required: true },
		{ capabilityId: 'product:projects:write', required: false }
	]
});

const unsignedTrust = {
	signature: {
		status: 'unsigned' as const,
		keyIds: [],
		contentSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
		authoritative: false as const
	},
	trustDecision: {
		allowed: true,
		reason: 'accepted' as const,
		permissionAuthorityChanged: false as const
	}
};

const capability = (options: {
	readonly id: string;
	readonly required: boolean;
	readonly available: boolean;
}) =>
	ProductCapabilityProjection.make({
		version: 1,
		scopeId: permissionContext.scopeId,
		workspaceId: permissionContext.workspaceId,
		requestDigest: permissionContext.requestDigest,
		revision: permissionContext.revision,
		capabilityId: options.id,
		state: 'requested',
		availability: options.available ? 'available' : 'unavailable',
		requested: true,
		required: options.required,
		confirmationPolicies: options.available ? ['once', 'session'] : [],
		operationIds: options.available ? ['projects.list'] : [],
		resourceIds: [],
		dataClassIds: []
	});

const workspace: AgentWorkspaceController = {
	models: [],
	selectedModel: undefined,
	reasoningLevel: undefined,
	providers: [],
	authEvent: undefined,
	selectModel: vi.fn(),
	selectReasoning: vi.fn(),
	loginProvider: vi.fn(),
	replyProviderAuth: vi.fn(() => Promise.resolve()),
	cancelProviderAuth: vi.fn(() => Promise.resolve()),
	refreshProviderAuth: vi.fn(() => Promise.resolve()),
	logoutProvider: vi.fn(() => Promise.resolve()),
	refresh: vi.fn(() => Promise.resolve()),
	externalExtensions: { app: false, shaper: false },
	toggleExternalExtensions: vi.fn(() => Promise.resolve()),
	app: {
		role: 'app',
		status: 'ready',
		messages: [{ id: 'a', role: 'assistant', content: 'App only' }],
		lastPrompt: '',
		error: undefined,
		submit: vi.fn(() => Promise.resolve()),
		cancel: vi.fn(() => Promise.resolve())
	},
	previewApp: {
		role: 'app',
		status: 'ready',
		messages: [],
		lastPrompt: '',
		error: undefined,
		submit: vi.fn(() => Promise.resolve()),
		cancel: vi.fn(() => Promise.resolve())
	},
	shaper: {
		role: 'shaper',
		status: 'ready',
		messages: [{ id: 's', role: 'assistant', content: 'Shaper only' }],
		lastPrompt: '',
		error: undefined,
		shape: vi.fn(() => Promise.resolve({ kind: 'document' as const, document })),
		cancel: vi.fn(() => Promise.resolve())
	},
	diagnoseRecovery: vi.fn(() =>
		Promise.resolve({ version: 1 as const, message: 'Recovery ready.' })
	)
};

const shaping: ShapingController = {
	status: 'idle',
	rollbackAvailable: false,
	isolation: 'ready',
	verifyIsolation: vi.fn(() => Promise.resolve()),
	request: vi.fn(() => Promise.resolve()),
	fixFailure: vi.fn(() => Promise.resolve()),
	accept: vi.fn(() => Promise.resolve()),
	reject: vi.fn(() => Promise.resolve()),
	rollback: vi.fn(() => Promise.resolve())
};

const preferences = {
	value: ShellPreferencesValue.make({
		version: 1,
		railWidth: 400,
		railCollapsed: false,
		modelFavorites: []
	}),
	setRailWidth: vi.fn(() => Promise.resolve()),
	setRailCollapsed: vi.fn(() => Promise.resolve()),
	toggleModelFavorite: vi.fn(() => Promise.resolve())
};

const portableExtension = PortableExtensionPackage.make({
	formatVersion: 1,
	id: 'project-guide',
	name: 'Project guide',
	description: 'Adds a bounded project summary command.',
	version: '1.0.0',
	bundle: 'extensions/project-guide.mjs',
	roles: ['app'],
	compatibility: {
		flect: '>=0.2.0 <1.0.0',
		extensionApi: 1,
		platforms: ['browser', 'macos']
	},
	capabilities: [{ id: 'interface:read', required: true }],
	publicInstructions: 'Use only when asked for a project summary.',
	commands: [],
	tools: [],
	resources: {
		deadlineMs: 80,
		memoryBytes: 4 * 1024 * 1024,
		inputBytes: 8 * 1024,
		outputBytes: 16 * 1024,
		maxIntents: 3
	},
	provenance: {
		publisher: 'Akua',
		source: 'https://github.com/akua-dev/project-guide',
		revision: 'abc123',
		bundleSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	}
});

const portableReview: CapsuleReview = {
	id: 'dev.akua.review',
	name: 'Reviewed app',
	version: '1.2.3',
	publisher: 'akua-dev',
	source: 'https://github.com/akua-dev/reviewed-app',
	revision: 'abc123',
	builder: 'flect@0.2.0',
	platforms: ['browser', 'macos'],
	currentPlatform: 'browser',
	flectRange: '>=0.2.0 <1.0.0',
	flectCompatible: true,
	platformCompatible: true,
	capabilities: [],
	extensions: [portableExtension],
	permissionContext: ProductCapabilityRequestContext.make({
		version: 1,
		scopeId: 'dev.akua.review',
		workspaceId: 'workspace-local-default',
		requestDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		revision: 'abc123',
		capabilities: []
	}),
	signatureCount: 0,
	...unsignedTrust,
	fileCount: 2,
	totalBytes: 512,
	activationBlocked: false,
	archive: new Uint8Array()
};

const untestedPortableExtensions = PortableExtensionCatalogSnapshot.make({
	version: 1,
	entries: [
		PortableExtensionRoleState.make({
			version: 1,
			capsuleId: portableReview.id,
			extensionId: portableExtension.id,
			packageVersion: portableExtension.version,
			bundleSha256: portableExtension.provenance.bundleSha256,
			provenanceRevision: portableExtension.provenance.revision,
			role: 'app',
			binding: 'candidate',
			state: 'enabled',
			requestedCapabilities: ['interface:read'],
			requiredCapabilities: ['interface:read'],
			grantedCapabilities: ['interface:read'],
			pinned: false,
			tested: false,
			failureCount: 0
		})
	]
});

describe('AgentRail', () => {
	it('serializes the two role resets behind the single trusted-extension switch', async () => {
		let finishApp: (() => void) | undefined;
		const appReset = new Promise<void>((resolve) => {
			finishApp = resolve;
		});
		const toggleExternalExtensions = vi.fn((role: 'app' | 'shaper') =>
			role === 'app' ? appReset : Promise.resolve()
		);
		render(
			<AgentRail
				document={document}
				mode='edit'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={{ ...workspace, toggleExternalExtensions }}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
		await userEvent.click(
			screen.getByRole('menuitem', {
				name: 'Enable trusted Pi extensions'
			})
		);
		await waitFor(() => expect(toggleExternalExtensions).toHaveBeenCalledWith('app'));
		expect(toggleExternalExtensions).not.toHaveBeenCalledWith('shaper');

		finishApp?.();
		await waitFor(() => expect(toggleExternalExtensions).toHaveBeenCalledWith('shaper'));
	});

	it('keeps typed browser-build progress visible in the protected rail', () => {
		render(
			<AgentRail
				build={{
					version: 1,
					phase: 'compiling',
					message: 'Compiling exact proposal'
				}}
				document={document}
				mode='edit'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={workspace}
			/>
		);

		expect(screen.getByText('Compiling exact proposal').closest('[role=status]')).toHaveTextContent(
			'Browser build: Compiling exact proposal'
		);
	});

	it('routes provider setup from the model popover to the workspace', async () => {
		const loginProvider = vi.fn();
		const providerWorkspace: AgentWorkspaceController = {
			...workspace,
			providers: [
				{
					version: 1,
					id: 'openai-codex',
					name: 'OpenAI Codex',
					status: 'disconnected',
					methods: [{ type: 'oauth', label: 'Connect' }]
				}
			],
			loginProvider
		};
		render(
			<AgentRail
				document={document}
				mode='edit'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={providerWorkspace}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
		expect(loginProvider).toHaveBeenCalledWith({
			providerId: 'openai-codex',
			method: 'oauth'
		});
	});

	it('turns clean-profile setup into a direct provider action beside the editable draft', async () => {
		const loginProvider = vi.fn();
		const setupWorkspace: AgentWorkspaceController = {
			...workspace,
			providers: [
				{
					version: 1,
					id: 'anthropic',
					name: 'Anthropic',
					status: 'disconnected',
					methods: [{ type: 'api_key', label: 'Anthropic API key' }]
				},
				{
					version: 1,
					id: 'openai-codex',
					name: 'OpenAI Codex',
					status: 'disconnected',
					methods: [{ type: 'oauth', label: 'OpenAI (ChatGPT Plus/Pro)' }]
				}
			],
			loginProvider,
			app: { ...workspace.app, status: 'setup-required' }
		};
		render(
			<AgentRail
				document={document}
				mode='edit'
				onCollapse={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={setupWorkspace}
			/>
		);

		expect(screen.getByRole('region', { name: 'Connect an agent' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Message Flect' })).toBeEnabled();
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'OpenAI (ChatGPT Plus/Pro)'
			})
		);
		expect(loginProvider).toHaveBeenCalledWith({
			providerId: 'openai-codex',
			method: 'oauth'
		});
	});

	it('passes each message role into semantic Markdown rendering', async () => {
		const roleWorkspace: AgentWorkspaceController = {
			...workspace,
			app: {
				...workspace.app,
				messages: [
					{
						id: 'assistant-markdown',
						role: 'assistant',
						content: '# Release notes\n\nline one\nline two'
					},
					{
						id: 'user-markdown',
						role: 'user',
						content: 'keep this\non two lines'
					}
				]
			}
		};

		const { container } = render(
			<AgentRail
				document={document}
				mode='run'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={roleWorkspace}
			/>
		);

		const assistant = (
			await screen.findByRole('heading', {
				level: 1,
				name: 'Release notes'
			})
		).closest('.message-content');
		expect(assistant).toHaveAttribute('data-message-role', 'assistant');
		expect(assistant?.querySelectorAll('br')).toHaveLength(0);

		const user = container.querySelector('.message--user .message-content');
		expect(user).toHaveAttribute('data-message-role', 'user');
		expect(user).toHaveTextContent('keep this on two lines');
		expect(user?.querySelectorAll('br')).toHaveLength(1);
	});

	it('renders one Flect conversation across internal agent roles', () => {
		render(
			<AgentRail
				document={document}
				mode='run'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={workspace}
			/>
		);
		expect(screen.getByText('App only')).toBeVisible();
		expect(screen.getByText('Shaper only')).toBeVisible();
		expect(screen.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();
		expect(screen.queryByRole('button', { name: /App Agent|Shaper/ })).not.toBeInTheDocument();
	});

	it('bypasses ordinary sending in safe mode', () => {
		render(
			<AgentRail
				document={document}
				mode='safe'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={shaping}
				workspace={workspace}
			/>
		);

		expect(screen.getByText('Your interface is protected.')).toBeVisible();
		expect(screen.getByRole('textbox', { name: 'Message Flect' })).toBeDisabled();
	});

	it('focuses an explicit import decision while keeping Flect reachable', async () => {
		render(
			<AgentRail
				document={document}
				mode='edit'
				preview
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={{ ...shaping, status: 'preview' }}
				workspace={workspace}
			/>
		);

		await waitFor(() => expect(screen.getByRole('button', { name: 'Activate app' })).toHaveFocus());
		expect(screen.getByRole('textbox', { name: 'Message Flect' })).toBeEnabled();
		expect(screen.queryByRole('button', { name: /App Agent|Shaper/ })).not.toBeInTheDocument();
	});

	it('blocks activation until an enabled candidate extension passes its protected test', async () => {
		const testExtension = vi.fn(() => Promise.resolve());
		const noChange = vi.fn(() => Promise.resolve());
		render(
			<AgentRail
				capsuleReview={portableReview}
				document={document}
				extensions={untestedPortableExtensions}
				mode='edit'
				preview
				onCollapse={vi.fn()}
				onForkPortableExtension={noChange}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRemovePortableExtension={noChange}
				onResolvePortableExtensionUpdate={noChange}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				onSetPortableExtensionEnabled={noChange}
				onSetPortableExtensionPinned={noChange}
				onTargetChange={vi.fn()}
				onTestPortableExtension={testExtension}
				preferences={preferences}
				shaping={{ ...shaping, status: 'preview' }}
				workspace={workspace}
			/>
		);

		expect(screen.getByRole('button', { name: 'Activate app' })).toBeDisabled();
		expect(
			screen.getByText(/must pass its bounded test before this app can be activated/i)
		).toBeVisible();
		await userEvent.click(await screen.findByRole('button', { name: 'Test for App Agent' }));
		expect(testExtension).toHaveBeenCalledWith(
			expect.objectContaining({
				capsuleId: portableReview.id,
				extensionId: portableExtension.id,
				role: 'app',
				binding: 'candidate'
			})
		);
	});

	it('shows capsule provenance and lets the protected user grant a registered capability', async () => {
		const decide = vi.fn(() => Promise.resolve());
		render(
			<AgentRail
				capsuleReview={{
					id: 'dev.akua.review',
					name: 'Reviewed app',
					version: '1.2.3',
					publisher: 'akua-dev',
					source: 'https://github.com/akua-dev/reviewed-app',
					revision: 'abc123',
					builder: 'flect@0.2.0',
					platforms: ['browser', 'macos'],
					currentPlatform: 'browser',
					flectRange: '>=0.2.0 <1.0.0',
					flectCompatible: true,
					platformCompatible: true,
					capabilities: [
						capability({
							id: 'product:projects:read',
							required: true,
							available: true
						}),
						capability({
							id: 'product:projects:write',
							required: false,
							available: false
						})
					],
					extensions: [],
					permissionContext,
					signatureCount: 0,
					...unsignedTrust,
					fileCount: 2,
					totalBytes: 512,
					build: {
						sourceRevision: 'c'.repeat(40),
						inputDigest: 'd'.repeat(64),
						artifactDigest: 'e'.repeat(64),
						dependencyGraphDigest: 'f'.repeat(64)
					},
					importReport: {
						version: 1,
						kind: 'vite-react',
						name: 'reviewed-app',
						entrypoint: 'src/main.tsx',
						includedFiles: 4,
						ignoredFiles: ['.env.local'],
						adaptations: ['Flect used its restricted compiler instead of Vite.'],
						warnings: ['BrowserRouter needs a memory-router adaptation.']
					},
					activationBlocked: true,
					archive: new Uint8Array()
				}}
				document={document}
				mode='edit'
				preview
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				onDecideProductCapability={decide}
				preferences={preferences}
				shaping={{ ...shaping, status: 'preview' }}
				workspace={workspace}
			/>
		);

		expect(screen.getByText('akua-dev · 1.2.3')).toBeVisible();
		expect(screen.getByText('product:projects:read')).toBeVisible();
		expect(screen.getByText('Required · Awaiting decision')).toBeVisible();
		await userEvent.click(
			screen.getByRole('button', {
				name: 'This session product:projects:read'
			})
		);
		expect(decide).toHaveBeenCalledWith(
			'dev.akua.review',
			'product:projects:read',
			ProductCapabilityAllowChoice.make({
				type: 'allow',
				confirmationPolicy: 'session'
			})
		);
		expect(screen.getByText('Vite React · src/main.tsx')).toBeVisible();
		expect(screen.getByText('Flect used its restricted compiler instead of Vite.')).toBeVisible();
		expect(screen.getByText(/artifact eeeeeee/)).toBeVisible();
		expect(screen.getByText('Locked in source Git · graph fffffff')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Activate app' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
	});

	it('presents changed signature bytes as trust failure without granting authority', () => {
		render(
			<AgentRail
				capsuleReview={{
					...portableReview,
					extensions: [],
					signatureCount: 1,
					signature: {
						status: 'changed-after-signing',
						keyIds: ['akua:release'],
						contentSha256: 'd'.repeat(64),
						authoritative: false
					},
					trustDecision: {
						allowed: false,
						reason: 'invalid-signature',
						permissionAuthorityChanged: false
					},
					activationBlocked: true
				}}
				document={document}
				mode='run'
				onCollapse={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				preferences={preferences}
				shaping={{ ...shaping, status: 'preview' }}
				workspace={workspace}
			/>
		);

		expect(screen.getByText('Changed after signing')).toBeVisible();
		expect(screen.getByText(/signatures never grant product capabilities/i)).toBeVisible();
		expect(screen.getByRole('button', { name: 'Activate app' })).toBeDisabled();
	});

	it('reports a capability grant that could not be saved', async () => {
		const decide = vi.fn(() => Promise.reject(new Error('storage failed')));
		render(
			<AgentRail
				acceptedCapsuleReview={{
					id: 'dev.akua.review',
					name: 'Reviewed app',
					version: '1.2.3',
					publisher: 'akua-dev',
					source: 'fixture',
					revision: 'abc123',
					builder: 'flect@0.2.0',
					platforms: ['browser'],
					currentPlatform: 'browser',
					flectRange: '>=0.2.0 <1.0.0',
					flectCompatible: true,
					platformCompatible: true,
					capabilities: [
						capability({
							id: 'product:projects:read',
							required: true,
							available: true
						})
					],
					extensions: [],
					permissionContext,
					signatureCount: 0,
					...unsignedTrust,
					fileCount: 1,
					totalBytes: 128,
					activationBlocked: false,
					archive: new Uint8Array()
				}}
				document={document}
				mode='run'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				onDecideProductCapability={decide}
				preferences={preferences}
				shaping={shaping}
				workspace={workspace}
			/>
		);

		await userEvent.click(
			screen.getByRole('button', {
				name: 'Allow once product:projects:read'
			})
		);
		expect(
			await screen.findByRole('alert', {
				name: 'Product capability change failed'
			})
		).toHaveTextContent('The capability change could not be saved.');
	});

	it('keeps granted permission inspection and revocation available in safe mode without Pi', async () => {
		const revoke = vi.fn(() => Promise.resolve());
		const granted = ProductCapabilityProjection.make({
			...capability({
				id: 'product:projects:read',
				required: true,
				available: true
			}),
			state: 'granted',
			decisionId: 'decision-capability-0001',
			confirmationPolicy: 'session',
			expiresAtMillis: 4_102_444_800_000,
			rateLimit: { maxInvocations: 5, intervalMs: 1_000 }
		});
		render(
			<AgentRail
				acceptedCapsuleReview={{
					id: 'dev.akua.review',
					name: 'Reviewed app',
					version: '1.2.3',
					publisher: 'akua-dev',
					source: 'fixture',
					revision: 'abc123',
					builder: 'flect@0.2.0',
					platforms: ['browser'],
					currentPlatform: 'browser',
					flectRange: '>=0.2.0 <1.0.0',
					flectCompatible: true,
					platformCompatible: true,
					capabilities: [granted],
					extensions: [],
					permissionContext,
					signatureCount: 0,
					...unsignedTrust,
					fileCount: 1,
					totalBytes: 128,
					activationBlocked: false,
					archive: new Uint8Array()
				}}
				document={document}
				mode='safe'
				onCollapse={vi.fn()}
				onModeChange={vi.fn()}
				onOpenSafeMode={vi.fn()}
				onRestoreSafeMode={vi.fn(() => Promise.resolve())}
				onRevokeProductCapability={revoke}
				preferences={preferences}
				shaping={shaping}
				workspace={{
					...workspace,
					app: { ...workspace.app, status: 'unavailable' },
					previewApp: { ...workspace.previewApp, status: 'unavailable' },
					shaper: { ...workspace.shaper, status: 'unavailable' }
				}}
			/>
		);

		await userEvent.click(screen.getByText('Product capabilities'));
		expect(screen.getByText('Required · Granted · This session')).toBeVisible();
		await userEvent.click(screen.getByText('Scope details'));
		expect(screen.getByText('Decision decision-capability-0001')).toBeVisible();
		await userEvent.click(
			screen.getByRole('button', {
				name: 'Revoke product:projects:read'
			})
		);
		expect(revoke).toHaveBeenCalledWith('decision-capability-0001');
	});
});
