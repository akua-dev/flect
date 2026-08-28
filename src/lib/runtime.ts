import { BrowserHttpClient } from '@effect/platform-browser';
import { isTauri } from '@tauri-apps/api/core';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import {
	type PrivateShareSourceDefinition,
	ShareSourceFailure
} from '../../packages/product/src/host/share-source';
import {
	AuthorizedProductOperation,
	ProductCapabilityManifest,
	type ProductJson,
	ProductOperationFailure
} from '../../packages/product/src/product-capability';
import type { CapabilityIntent, ExtensionIntentContext } from '../../shared/sandbox';
import { type AgentCommandBridge, AgentCommandBridgeLive } from '../axi/agent-command-bridge';
import { type AgentCommandBus, AgentCommandBusLive } from '../axi/agent-command-bus';
import { LazyProposalBuildLive } from '../build/lazy-proposal-build';
import {
	makeNativeAppearanceOperation,
	NativeAppearanceCapabilityManifest
} from '../capabilities/native-appearance-capability';
import { makeProductCapabilityBrokerLayer } from '../capabilities/product-capability-broker';
import { makeProductCapabilityDecisionStoreLayer } from '../capabilities/product-capability-decision-store';
import {
	makeProductCapabilityRegistryLayer,
	type ProductCapabilityRegistry
} from '../capabilities/product-capability-registry';
import {
	type CapsuleStore,
	type CapsuleStoreError,
	CapsuleStoreLive
} from '../capsule/capsule-store';
import {
	type CapsuleTrustVerifier,
	CapsuleTrustVerifierLive
} from '../capsule/capsule-trust-verifier';
import { type ExtensionCatalog, makeExtensionCatalogLayer } from '../extensions/extension-catalog';
import {
	type PortableExtensionHost,
	PortableExtensionHostLive,
	PortableExtensionSourceLive
} from '../extensions/portable-extension-host';
import { type GitWorkspace, makeGitWorkspaceLayer } from '../git/git-workspace';
import { CapabilityAdapter, SandboxCapabilityBrokerLive } from '../sandbox/capability-broker';
import { ExtensionExecutionLive } from '../sandbox/extension-execution';
import { ExtensionSandboxLive } from '../sandbox/extension-sandbox';
import {
	makePrivateShareSourceRegistryLayer,
	type PrivateShareSourceRegistry
} from '../sharing/private-share-source-registry';
import {
	type ShareCandidateStore,
	ShareCandidateStoreLive
} from '../sharing/share-candidate-store';
import {
	makeShareInstallationStoreLayer,
	type ShareInstallationStore
} from '../sharing/share-installation-store';
import { type ShareQuarantine, ShareQuarantineLive } from '../sharing/share-quarantine';
import { makeShareRepositoryLayer, type ShareRepository } from '../sharing/share-repository';
import {
	type ShareSignatureVerifier,
	ShareSignatureVerifierLive
} from '../sharing/share-signature-verifier';
import {
	makeShareSourceResolverLayer,
	ShareHttpClientLive,
	type ShareSourceResolver
} from '../sharing/share-source-resolver';
import { LazyRoleSandboxedShellLive } from '../shell/lazy-sandboxed-shell';
import type { SandboxedShell } from '../shell/sandboxed-shell-service';
import { type AgentWorkspace, AgentWorkspaceLive } from './agent-workspace';
import { type FlectClient, type FlectUnavailableError, makeFlectClientLayer } from './api';
import { type Clipboard, ClipboardLive } from './clipboard';
import { makeGitInterfaceRepositoryLayer } from './git-interface-repository';
import { type InterfaceStorage, InterfaceStorageLive } from './interface-store';
import { NativePlatform, NativePlatformUnavailableLive } from './native-platform';
import { type OperationJournal, OperationJournalLive } from './operation-journal';
import {
	ContinuityLockLive,
	makeRoleContinuityRepositoryLayer,
	type RoleContinuityRepository
} from './role-continuity-repository';
import { makePersistentShapingKernelLayer, ShapingKernel } from './shaping-kernel';
import { makeShellPreferencesLayer, type ShellPreferences } from './shell-preferences';
import {
	type WorkspaceControlBridge,
	WorkspaceControlBridgeLive
} from './workspace-control-bridge';
import {
	makeBrowserWorkspaceControlTransportLayer,
	type WorkspaceControlTransport
} from './workspace-control-transport';
import {
	type FlectWorkspaceController,
	FlectWorkspaceControllerLive
} from './workspace-controller';

const runtimeQuery = new URLSearchParams(
	typeof globalThis.location === 'undefined' ? '' : globalThis.location.search
);
const PrivateShareDiagnosticBootstrap = Schema.Struct({
	adapterId: Schema.String.check(
		Schema.isMinLength(1),
		Schema.isMaxLength(80),
		Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)
	),
	archive: Schema.Uint8Array,
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	reference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
	secretSentinel: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
});
const privateShareDiagnosticSources = (): ReadonlyArray<PrivateShareSourceDefinition> => {
	if (import.meta.env.VITE_FLECT_PRIVATE_SHARE_DIAGNOSTIC !== '1') return [];
	const input = Reflect.get(globalThis, '__flectPrivateShareDiagnostic');
	Reflect.deleteProperty(globalThis, '__flectPrivateShareDiagnostic');
	const decoded = Effect.runSync(
		Schema.decodeUnknownEffect(PrivateShareDiagnosticBootstrap, {
			errors: 'all',
			onExcessProperty: 'error'
		})(input).pipe(Effect.option)
	);
	if (decoded._tag === 'None') return [];
	const fixture = decoded.value;
	return [
		{
			id: fixture.adapterId,
			name: fixture.name,
			open: (reference) =>
				reference === fixture.reference && fixture.secretSentinel.length > 0
					? Effect.succeed(fixture.archive.slice())
					: Effect.fail(
							ShareSourceFailure.make({
								reason: 'adapter',
								message: 'The private share source could not be opened.'
							})
						)
		}
	];
};
const requestedTestWorkspace = runtimeQuery.get('workspace');
const runtimeWorkspaceId =
	import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === '1' &&
	requestedTestWorkspace !== null &&
	/^[a-z0-9][a-z0-9-]{0,79}$/.test(requestedTestWorkspace)
		? requestedTestWorkspace
		: 'default';
const productCapabilityWorkflowEnabled =
	import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC === '1' &&
	runtimeQuery.get('product-capability-workflow') === '1';
const nativePlatformAvailable = isTauri();
const SharedGitWorkspaceLive = makeGitWorkspaceLayer({
	defaultWorkspaceId: runtimeWorkspaceId
});

const ClientLive = nativePlatformAvailable
	? Layer.unwrap(
			Effect.promise(() => import('./tauri-runtime-layers')).pipe(
				Effect.map((module) => module.TauriClientLive)
			)
		)
	: makeFlectClientLayer().pipe(Layer.provide(BrowserHttpClient.layerFetch));

const AgentShellLive = LazyRoleSandboxedShellLive.pipe(
	Layer.provideMerge(AgentCommandBusLive),
	Layer.provideMerge(SharedGitWorkspaceLive)
);

const ShellPreferencesLive = makeShellPreferencesLayer.pipe(Layer.provide(InterfaceStorageLive));

const RoleContinuityRepositoryLive = makeRoleContinuityRepositoryLayer.pipe(
	Layer.provide(Layer.merge(InterfaceStorageLive, ContinuityLockLive))
);

const ShareInstallationStoreLive = makeShareInstallationStoreLayer().pipe(
	Layer.provide(InterfaceStorageLive)
);

const PrivateShareSourceRegistryForApplication = makePrivateShareSourceRegistryLayer({
	sources: privateShareDiagnosticSources()
});

const ShareRepositoryLive = makeShareRepositoryLayer({
	workspaceId: runtimeWorkspaceId
}).pipe(Layer.provide(SharedGitWorkspaceLive));

const AgentWorkspaceDependencies = Layer.mergeAll(ClientLive, AgentShellLive, OperationJournalLive);

const AgentWorkspaceWithDependencies = AgentWorkspaceLive.pipe(
	Layer.provideMerge(AgentWorkspaceDependencies)
);

export type FlectBrowserServices =
	| FlectClient
	| AgentCommandBridge
	| AgentCommandBus
	| AgentWorkspace
	| Clipboard
	| ExtensionCatalog
	| PortableExtensionHost
	| ProductCapabilityRegistry
	| NativePlatform
	| CapsuleStore
	| CapsuleTrustVerifier
	| InterfaceStorage
	| OperationJournal
	| RoleContinuityRepository
	| SandboxedShell
	| ShellPreferences
	| FlectWorkspaceController
	| GitWorkspace
	| PrivateShareSourceRegistry
	| ShareInstallationStore
	| ShareCandidateStore
	| ShareQuarantine
	| ShareRepository
	| ShareSignatureVerifier
	| ShareSourceResolver
	| WorkspaceControlBridge
	| WorkspaceControlTransport;
export type FlectBrowserRuntime = ManagedRuntime.ManagedRuntime<
	FlectBrowserServices,
	CapsuleStoreError | FlectUnavailableError | ShareSourceFailure
>;

const ProductCapabilityDecisionStoreLive = makeProductCapabilityDecisionStoreLayer.pipe(
	Layer.provide(InterfaceStorageLive)
);

const PortableExtensionCatalogLive = makeExtensionCatalogLayer().pipe(
	Layer.provide(InterfaceStorageLive)
);

const ProductWorkflowManifest = ProductCapabilityManifest.make({
	version: 1,
	id: 'product:projects:read',
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent'],
	maxGrantDurationMs: 86_400_000,
	maxRate: { maxInvocations: 20, intervalMs: 60_000 }
});

const NativePlatformForApplication = nativePlatformAvailable
	? Layer.unwrap(
			Effect.promise(() => import('./tauri-runtime-layers')).pipe(
				Effect.map((module) => module.TauriNativePlatformLive)
			)
		)
	: NativePlatformUnavailableLive;
const NativeSystemAccentColor = Effect.flatMap(
	NativePlatform,
	(platform) => platform.systemAccentColor
).pipe(Effect.provide(NativePlatformForApplication));

const ProductCapabilityManifests = [
	...(productCapabilityWorkflowEnabled ? [ProductWorkflowManifest] : []),
	...(nativePlatformAvailable ? [NativeAppearanceCapabilityManifest] : [])
];

const ProductCapabilityBrokerLive = makeProductCapabilityBrokerLayer({
	manifests: ProductCapabilityManifests
}).pipe(Layer.provide(ProductCapabilityDecisionStoreLive));

const ProductCapabilityRegistryLive = makeProductCapabilityRegistryLayer({
	operations: [
		...(productCapabilityWorkflowEnabled
			? [
					{
						id: 'projects.list',
						capabilityId: ProductWorkflowManifest.id,
						authorize: (input: ProductJson) =>
							typeof input === 'object' &&
							input !== null &&
							Reflect.get(input, 'productDenied') === true
								? Effect.fail(
										ProductOperationFailure.make({
											operationId: 'projects.list',
											reason: 'product-denied',
											message: 'The product denied this operation.'
										})
									)
								: Effect.succeed(
										AuthorizedProductOperation.make({
											version: 1,
											capabilityId: ProductWorkflowManifest.id,
											operationId: 'projects.list',
											resourceIds: ['projects.workspace'],
											dataClassIds: ['projects.summary']
										})
									),
						execute: () => Effect.succeed({ projects: ['one'] })
					}
				]
			: []),
		...(nativePlatformAvailable ? [makeNativeAppearanceOperation(NativeSystemAccentColor)] : [])
	]
}).pipe(Layer.provide(ProductCapabilityBrokerLive));

const safeMode = runtimeQuery.get('safe') === '1';

const InterfaceRepositoryLive = makeGitInterfaceRepositoryLayer({
	safeMode,
	workspaceId: runtimeWorkspaceId
}).pipe(Layer.provide(Layer.merge(InterfaceStorageLive, SharedGitWorkspaceLive)));

const PersistentShapingKernelLive = makePersistentShapingKernelLayer().pipe(
	Layer.provide(InterfaceRepositoryLive)
);

const CapabilityAdapterLive = Layer.effect(
	CapabilityAdapter,
	Effect.gen(function* () {
		const kernel = yield* ShapingKernel;
		return {
			apply: Effect.fn('CapabilityAdapter.apply')(function* (
				context: ExtensionIntentContext,
				intents: ReadonlyArray<CapabilityIntent>
			) {
				yield* kernel.applyExtensionIntents(context, intents);
			})
		};
	})
).pipe(Layer.provide(PersistentShapingKernelLive));

const CapabilityBrokerLive = SandboxCapabilityBrokerLive.pipe(Layer.provide(CapabilityAdapterLive));

const ExtensionDependencies = Layer.mergeAll(
	PersistentShapingKernelLive,
	ExtensionSandboxLive,
	CapabilityBrokerLive
);

const ShapingAndExtensionLive = ExtensionExecutionLive.pipe(
	Layer.provideMerge(ExtensionDependencies)
);

const PortableExtensionSourceForApplication = PortableExtensionSourceLive.pipe(
	Layer.provide(CapsuleStoreLive)
);

const PortableExtensionHostForApplication = PortableExtensionHostLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			PortableExtensionCatalogLive,
			PortableExtensionSourceForApplication,
			ExtensionSandboxLive,
			CapabilityBrokerLive
		)
	)
);

const ProposalBuildWithDependencies = LazyProposalBuildLive.pipe(
	Layer.provideMerge(SharedGitWorkspaceLive)
);

const ApplicationDependencies = Layer.mergeAll(
	AgentWorkspaceWithDependencies,
	InterfaceStorageLive,
	ShellPreferencesLive,
	RoleContinuityRepositoryLive,
	ClipboardLive,
	SharedGitWorkspaceLive,
	CapsuleStoreLive,
	CapsuleTrustVerifierLive,
	NativePlatformForApplication,
	ProposalBuildWithDependencies,
	ProductCapabilityRegistryLive,
	PortableExtensionCatalogLive,
	PortableExtensionHostForApplication,
	ShapingAndExtensionLive,
	ShareInstallationStoreLive,
	ShareCandidateStoreLive,
	ShareRepositoryLive,
	ShareSignatureVerifierLive,
	makeShareSourceResolverLayer().pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				ShareQuarantineLive,
				PrivateShareSourceRegistryForApplication,
				ShareHttpClientLive
			)
		)
	)
);

const FlectApplicationLive = FlectWorkspaceControllerLive.pipe(
	Layer.provideMerge(ApplicationDependencies)
);

const FlectApplicationWithAgentBridgeLive = AgentCommandBridgeLive.pipe(
	Layer.provideMerge(FlectApplicationLive)
);

const ControlTransportLive = nativePlatformAvailable
	? Layer.unwrap(
			Effect.promise(() => import('./tauri-runtime-layers')).pipe(
				Effect.map((module) => module.TauriControlTransportLive)
			)
		)
	: makeBrowserWorkspaceControlTransportLayer().pipe(Layer.provide(BrowserHttpClient.layerFetch));

const FlectApplicationWithControlLive = WorkspaceControlBridgeLive.pipe(
	Layer.provideMerge(Layer.merge(FlectApplicationWithAgentBridgeLive, ControlTransportLive))
);

export const flectRuntime = ManagedRuntime.make(FlectApplicationWithControlLive);
export const browserRuntime: FlectBrowserRuntime = flectRuntime;
export const shapingRuntime = flectRuntime;
