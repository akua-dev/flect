import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import {
	ProductCapabilityAllowChoice,
	ProductCapabilityDenyChoice
} from '../packages/product/src/product-capability';
import { ExternalPiExtensionSelection } from './contracts';
import {
	AgentCommandSource,
	AgentWorkspaceSnapshot,
	DecideProductCapability,
	decodeFlectCommandEnvelope,
	EnableControl,
	FlectCommandEnvelope,
	Inspect,
	RequestShapeHandoff,
	ResolvePortableExtensionUpdate,
	RevokeProductCapability,
	SelectWorkbenchTarget,
	SetExternalExtensions,
	SetModelFavorite,
	SetPortableExtensionEnabled,
	SetPortableExtensionPin,
	SubmitShaperInstruction,
	TestPortableExtension,
	UserCommandSource
} from './control';
import { RevisionId } from './revisions';

describe('Flect control contracts', () => {
	it.effect('decodes the complete protected sharing lifecycle as strict commands', () =>
		Effect.gen(function* () {
			const commands = [
				{
					type: 'open-share-source',
					source: {
						_tag: 'url',
						url: 'https://example.test/weather.flect-share'
					}
				},
				{ type: 'reject-share-candidate' },
				{
					type: 'retain-share-candidate',
					artifactIds: ['dev.akua.weather']
				},
				{ type: 'fork-share', shareId: 'dev.akua.weather' },
				{
					type: 'checkpoint-share-fork',
					shareId: 'dev.akua.weather',
					expectedForkCommit: '1111111111111111111111111111111111111111',
					files: [
						{
							path: 'components/weather.tsx',
							contents: new TextEncoder().encode('export const Weather = 2')
						}
					],
					removals: [],
					message: 'Personalize weather card'
				},
				{ type: 'prepare-share-update', shareId: 'dev.akua.weather' },
				{ type: 'continue-share-fork', shareId: 'dev.akua.weather' },
				{
					type: 'open-share-conflict-in-shape',
					shareId: 'dev.akua.weather'
				},
				{
					type: 'resolve-share-conflict',
					shareId: 'dev.akua.weather',
					expectedBaseCommit: '1111111111111111111111111111111111111111',
					expectedUpstreamCommit: '2222222222222222222222222222222222222222',
					expectedForkCommit: '3333333333333333333333333333333333333333',
					files: [
						{
							path: 'components/weather.tsx',
							contents: new TextEncoder().encode("export const Weather = 'resolved'")
						}
					],
					removals: [],
					message: 'Resolve weather update'
				},
				{
					type: 'activate-share-candidate',
					shareId: 'dev.akua.weather',
					artifactIds: ['dev.akua.weather']
				},
				{ type: 'remove-share', shareId: 'dev.akua.weather' },
				{
					type: 'delete-share-local-data',
					shareId: 'dev.akua.weather',
					expectedForkCommit: '1111111111111111111111111111111111111111'
				},
				{ type: 'export-share', shareId: 'dev.akua.weather' }
			] as const;

			for (const [index, command] of commands.entries()) {
				const decoded = yield* decodeFlectCommandEnvelope({
					version: 1,
					commandId: `cmd-share-${index}-test`,
					workspaceId: 'workspace-00000001',
					source: { kind: 'user' },
					command
				});
				expect(decoded.command.type).toBe(command.type);
			}

			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-share-excess',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: {
					type: 'reject-share-candidate',
					credential: 'must-not-cross-the-boundary'
				}
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-share-unsafe-path',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: {
					type: 'checkpoint-share-fork',
					shareId: 'dev.akua.weather',
					expectedForkCommit: '1111111111111111111111111111111111111111',
					files: [
						{
							path: '.git/config',
							contents: new Uint8Array([1])
						}
					],
					removals: [],
					message: 'Unsafe'
				}
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-share-incomplete-resolution',
				workspaceId: 'workspace-00000001',
				source: {
					kind: 'agent',
					role: 'shaper',
					sessionId: 'session-0001',
					parentOperationId: 'operation-0001',
					requestId: 'request-0001'
				},
				command: {
					type: 'resolve-share-conflict',
					shareId: 'dev.akua.weather',
					expectedBaseCommit: '1'.repeat(40),
					expectedUpstreamCommit: '2'.repeat(40),
					expectedForkCommit: '3'.repeat(40),
					files: [{ path: '.git/config', contents: new Uint8Array([1]) }],
					removals: [],
					message: 'Unsafe resolution'
				}
			}).pipe(Effect.flip);
		})
	);

	it.effect('decodes strict protected capability decisions and revocation', () =>
		Effect.gen(function* () {
			const allow = yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-capability-allow',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: DecideProductCapability.make({
					type: 'decide-product-capability',
					capsuleId: 'dev.akua.projects',
					capabilityId: 'product.projects.read',
					choice: ProductCapabilityAllowChoice.make({
						type: 'allow',
						confirmationPolicy: 'session'
					})
				})
			});
			expect(allow.command.type).toBe('decide-product-capability');

			const deny = DecideProductCapability.make({
				type: 'decide-product-capability',
				capsuleId: 'dev.akua.projects',
				capabilityId: 'product.projects.read',
				choice: ProductCapabilityDenyChoice.make({ type: 'deny' })
			});
			expect(deny.choice.type).toBe('deny');

			const revoke = RevokeProductCapability.make({
				type: 'revoke-product-capability',
				decisionId: 'decision-capability-0001'
			});
			expect(revoke.decisionId).toBe('decision-capability-0001');

			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-capability-excess',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: { ...deny, ambientAuthority: true }
			}).pipe(Effect.flip);
		})
	);

	it.effect('keeps provider authentication state outside inspectable workspace snapshots', () =>
		Effect.gen(function* () {
			const role = (role: 'app' | 'shaper') => ({
				role,
				status: 'ready' as const,
				messages: [],
				activities: [],
				lastPrompt: ''
			});
			const snapshot = AgentWorkspaceSnapshot.make({
				models: [],
				favoriteModels: [],
				externalExtensions: ExternalPiExtensionSelection.make({
					app: false,
					shaper: false
				}),
				app: role('app'),
				previewApp: role('app'),
				shaper: role('shaper')
			});
			const encoded = yield* Schema.encodeEffect(AgentWorkspaceSnapshot)(snapshot);
			const serialized = JSON.stringify(encoded);

			expect(serialized).not.toContain('providers');
			expect(serialized).not.toContain('authEvent');
			expect(serialized).not.toContain('login-private-1');
			expect(serialized).not.toContain('https://auth.example.test/');

			yield* Schema.decodeUnknownEffect(AgentWorkspaceSnapshot, {
				onExcessProperty: 'error'
			})({
				...encoded,
				providers: [],
				authEvent: {
					type: 'auth_url',
					providerId: 'openai-codex',
					loginId: 'login-private-1',
					url: 'https://auth.example.test/'
				}
			}).pipe(Effect.flip);
		})
	);

	it.effect('round-trips a strict versioned command envelope', () =>
		Effect.gen(function* () {
			const envelope = FlectCommandEnvelope.make({
				version: 1,
				commandId: 'cmd-00000001',
				workspaceId: 'workspace-00000001',
				source: UserCommandSource.make({ kind: 'user' }),
				command: SubmitShaperInstruction.make({
					type: 'submit-shaper-instruction',
					instruction: 'Make the headline quieter'
				})
			});

			const encoded = yield* Schema.encodeEffect(FlectCommandEnvelope)(envelope);
			expect(yield* decodeFlectCommandEnvelope(encoded)).toEqual(envelope);
			yield* decodeFlectCommandEnvelope({ ...encoded, invented: true }).pipe(Effect.flip);
		})
	);

	it.effect('requires identity for control sources', () =>
		Effect.gen(function* () {
			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-00000002',
				workspaceId: 'workspace-00000001',
				source: { kind: 'control' },
				command: Inspect.make({ type: 'inspect' })
			}).pipe(Effect.flip);

			const decoded = yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-00000003',
				workspaceId: 'workspace-00000001',
				source: {
					kind: 'control',
					clientId: 'client-00000001',
					clientName: 'Outside coding agent'
				},
				command: Inspect.make({ type: 'inspect' })
			});

			expect(decoded.source.kind).toBe('control');
		})
	);

	it.effect('strictly attributes commands created by an interactive agent', () =>
		Effect.gen(function* () {
			const source = AgentCommandSource.make({
				kind: 'agent',
				role: 'shaper',
				sessionId: 'session-00000001',
				parentOperationId: 'operation-00000001',
				requestId: 'tool-call-1'
			});
			const envelope = FlectCommandEnvelope.make({
				version: 1,
				commandId: 'cmd-agent-source',
				workspaceId: 'workspace-00000001',
				source,
				command: Inspect.make({ type: 'inspect' })
			});

			const encoded = yield* Schema.encodeEffect(FlectCommandEnvelope)(envelope);
			expect(yield* decodeFlectCommandEnvelope(encoded)).toEqual(envelope);
			yield* decodeFlectCommandEnvelope({
				...encoded,
				source: { ...encoded.source, impersonate: 'app' }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				...encoded,
				source: { ...encoded.source, role: 'guardian' }
			}).pipe(Effect.flip);
		})
	);

	it.effect('keeps enable-control in the closed union for UI authorization', () =>
		Effect.gen(function* () {
			const decoded = yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-00000004',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: { type: 'enable-control' }
			});

			expect(decoded.command).toEqual(EnableControl.make({ type: 'enable-control' }));
		})
	);

	it.effect('decodes the complete closed command surface', () =>
		Effect.gen(function* () {
			const commands: ReadonlyArray<unknown> = [
				{ type: 'inspect' },
				{ type: 'set-mode', mode: 'edit' },
				{ type: 'select-workbench-target', target: 'shape' },
				{ type: 'set-rail-collapsed', collapsed: true },
				{ type: 'set-rail-width', width: 420 },
				{ type: 'refresh-runtime' },
				{ type: 'select-model' },
				{
					type: 'select-model',
					model: { provider: 'openai-codex', id: 'gpt-5.6' }
				},
				{
					type: 'set-model-favorite',
					model: { provider: 'openai-codex', id: 'gpt-5.6' },
					favorite: true
				},
				{
					type: 'set-external-extensions',
					role: 'shaper',
					enabled: true
				},
				{
					type: 'set-portable-extension-enabled',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					enabled: true,
					grants: ['interface:read']
				},
				{
					type: 'test-portable-extension',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					input: { city: 'Berlin' }
				},
				{
					type: 'set-portable-extension-pin',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'accepted',
					pinned: true
				},
				{
					type: 'fork-portable-extension',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'shaper',
					binding: 'accepted',
					revision: 'local-weather-layout'
				},
				{
					type: 'resolve-portable-extension-update',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					choice: 'upstream'
				},
				{
					type: 'remove-portable-extension',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'accepted'
				},
				{
					type: 'invoke-portable-extension',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'accepted',
					input: { city: 'Berlin' }
				},
				{ type: 'submit-app-prompt', text: 'Summarize this app' },
				{
					type: 'submit-shaper-instruction',
					instruction: 'Use a compact layout'
				},
				{
					type: 'request-shape-handoff',
					handoff: {
						version: 1,
						instruction: 'Make the failed action clearer',
						revisionId: RevisionId.make('revision-candidate'),
						selectedNodeId: 'primary-action',
						failureOperationId: 'operation-failed-1',
						failureSummary: 'The action returned a safe validation error.'
					}
				},
				{ type: 'cancel-role', role: 'app' },
				{ type: 'invoke-interface-action', nodeId: 'primary-action' },
				{ type: 'accept-proposal' },
				{ type: 'reject-proposal' },
				{ type: 'rollback-revision' },
				{ type: 'enter-safe-mode' },
				{ type: 'restore-safe-mode' },
				{ type: 'enable-control' },
				{ type: 'disable-control' }
			];

			yield* Effect.forEach(
				commands,
				(command, index) =>
					decodeFlectCommandEnvelope({
						version: 1,
						commandId: `cmd-command-${index}`,
						workspaceId: 'workspace-00000001',
						source: { kind: 'user' },
						command
					}),
				{ discard: true }
			);

			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-unknown-command',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: { type: 'delete-everything' }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-old-model-toggle',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: {
					type: 'toggle-model-favorite',
					model: { provider: 'openai-codex', id: 'gpt-5.6' }
				}
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				version: 1,
				commandId: 'cmd-old-extension-toggle',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' },
				command: { type: 'toggle-external-extensions', role: 'shaper' }
			}).pipe(Effect.flip);
		})
	);

	it.effect('bounds widths, identifiers, prompts, and command fields', () =>
		Effect.gen(function* () {
			const base = {
				version: 1,
				commandId: 'cmd-bounds-check',
				workspaceId: 'workspace-00000001',
				source: { kind: 'user' }
			};

			yield* decodeFlectCommandEnvelope({
				...base,
				command: { type: 'set-rail-width', width: 10_000 }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				...base,
				command: { type: 'invoke-interface-action', nodeId: '../unsafe' }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				...base,
				command: { type: 'submit-shaper-instruction', instruction: ' ' }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				...base,
				command: { type: 'inspect', extra: true }
			}).pipe(Effect.flip);
			yield* decodeFlectCommandEnvelope({
				...base,
				command: {
					type: 'request-shape-handoff',
					handoff: {
						version: 1,
						instruction: 'Fix it',
						revisionId: 'revision-candidate',
						failureSummary: 'x'.repeat(1_001)
					}
				}
			}).pipe(Effect.flip);

			expect(
				SelectWorkbenchTarget.make({
					type: 'select-workbench-target',
					target: 'use'
				}).target
			).toBe('use');
			expect(
				RequestShapeHandoff.make({
					type: 'request-shape-handoff',
					handoff: {
						version: 1,
						instruction: 'Change the selected control',
						revisionId: RevisionId.make('revision-candidate')
					}
				}).handoff.instruction
			).toBe('Change the selected control');
			expect(
				SetModelFavorite.make({
					type: 'set-model-favorite',
					model: { provider: 'openai-codex', id: 'gpt-5.6' },
					favorite: false
				}).favorite
			).toBe(false);
			expect(
				SetExternalExtensions.make({
					type: 'set-external-extensions',
					role: 'app',
					enabled: false
				}).enabled
			).toBe(false);
			expect(
				SetPortableExtensionEnabled.make({
					type: 'set-portable-extension-enabled',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					enabled: true,
					grants: ['interface:read']
				}).enabled
			).toBe(true);
			expect(
				TestPortableExtension.make({
					type: 'test-portable-extension',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					input: {}
				}).binding
			).toBe('candidate');
			expect(
				SetPortableExtensionPin.make({
					type: 'set-portable-extension-pin',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'accepted',
					pinned: true
				}).pinned
			).toBe(true);
			expect(
				ResolvePortableExtensionUpdate.make({
					type: 'resolve-portable-extension-update',
					capsuleId: 'dev.akua.weather',
					extensionId: 'weather-card',
					role: 'app',
					binding: 'candidate',
					choice: 'fork'
				}).choice
			).toBe('fork');
		})
	);
});
