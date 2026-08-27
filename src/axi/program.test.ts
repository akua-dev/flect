import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Stream } from 'effect';
import {
	AgentWorkspaceSnapshot,
	ControlStateSnapshot,
	FlectCommandReceipt,
	FlectWorkspaceSnapshot,
	RailStateSnapshot,
	WorkbenchSnapshot
} from '../../shared/control';
import { ControlBrokerStatus } from '../../shared/control-channel';
import {
	PortableExtensionCatalogSnapshot,
	PortableExtensionRoleState
} from '../../shared/extensions';
import { GitRepositoryStatus } from '../../shared/git-workspace';
import { defaultInterfaceDocument, InterfaceDocument } from '../../shared/interface-document';
import { ProductCapabilityProjection } from '../../shared/product-capability';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import {
	ShareInstallationRecord,
	ShareInstallationRefs,
	ShareInstallationSnapshot,
	ShareInstalledArtifact,
	ShareUrlInstallationSource
} from '../../shared/share-installation';
import {
	UninstallApplication,
	UninstallOwnedItem,
	UninstallPlan,
	UninstallRetainedItem
} from '../../shared/uninstall';
import {
	AgentIntegration,
	type AgentIntegrationShape,
	AgentIntegrationStatus
} from '../lib/agent-integration';
import { ShellLink, ShellLinkStatus } from '../lib/shell-link';
import { Uninstall } from '../lib/uninstall';
import { FlectCommandGateway, type FlectCommandGatewayShape, FlectGatewayError } from './gateway';
import { runFlect } from './program';

const actionSnapshot = (
	document = defaultInterfaceDocument,
	mode: 'edit' | 'run' = 'run',
	sequence = 4
) => {
	const revision = InterfaceRevision.make({
		version: 1,
		id: RevisionId.make('axi-action-active'),
		status: 'accepted',
		source: 'built-in',
		document,
		createdAt: 0
	});
	return FlectWorkspaceSnapshot.make({
		version: 1,
		workspaceId: 'workspace-axi-action',
		sequence,
		phase: 'ready',
		mode,
		document,
		shaping: ShapingSnapshot.make({
			version: 1,
			active: revision,
			lastKnownGood: revision,
			safeMode: false,
			disabledExtensions: [],
			lastEvent: ShapingEvent.make({
				version: 1,
				sequence: 0,
				type: 'initialized',
				revisionId: revision.id
			})
		}),
		agent: AgentWorkspaceSnapshot.make({
			models: [],
			favoriteModels: [],
			externalExtensions: { app: false, shaper: false },
			app: {
				role: 'app',
				status: 'ready',
				messages: [],
				activities: [],
				lastPrompt: ''
			},
			previewApp: {
				role: 'app',
				status: 'ready',
				messages: [],
				activities: [],
				lastPrompt: ''
			},
			shaper: {
				role: 'shaper',
				status: 'ready',
				messages: [],
				activities: [],
				lastPrompt: ''
			}
		}),
		rail: RailStateSnapshot.make({ collapsed: false, width: 400 }),
		control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
		operations: [],
		workbench: WorkbenchSnapshot.make({
			target: mode === 'edit' ? 'shape' : 'use',
			binding: 'accepted',
			transitionSequence: sequence
		})
	});
};

const makeGateway = (options: Partial<FlectCommandGatewayShape> = {}) => {
	const command = vi.fn<FlectCommandGatewayShape['command']>(() => Effect.die('unused'));
	const layer = Layer.succeed(FlectCommandGateway)({
		audience: 'native',
		bin: '/Applications/Flect.app/Contents/MacOS/flect',
		status: Effect.succeed(
			ControlBrokerStatus.make({
				version: 1,
				enabled: false,
				connected: false,
				port: 43128,
				url: 'http://127.0.0.1:43128'
			})
		),
		inspect: Effect.die('unused'),
		logs: Effect.die('unused'),
		events: () => Stream.empty,
		command,
		...options
	});
	return { command, layer };
};

const permission = (state: 'granted' | 'revoked') =>
	ProductCapabilityProjection.make({
		version: 1,
		scopeId: 'dev.akua.projects',
		workspaceId: 'workspace-axi-action',
		requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		revision: 'revision-projects-1',
		capabilityId: 'product.projects.read',
		state,
		availability: 'available',
		requested: true,
		required: true,
		confirmationPolicies: ['session'],
		operationIds: ['projects.list'],
		resourceIds: ['projects.workspace'],
		dataClassIds: ['projects.summary'],
		decisionId: 'decision-capability-0001',
		confirmationPolicy: 'session'
	});

describe('Flect AXI program', () => {
	it.effect('returns a complete bounded interface authoring contract', () => {
		const { layer } = makeGateway();
		return Effect.gen(function* () {
			const result = yield* runFlect(['--json', 'interface', 'schema']);

			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, '"required":["version","name","root"]');
			assert.include(result.stdout, '"required":["id","type","text","style"]');
			assert.include(result.stdout, '"required":["id","type","direction","gap","children"]');
			assert.include(result.stdout, '"name":"Example"');
			assert.include(result.stdout, '"text":"Example"');
		}).pipe(Effect.provide(layer));
	});

	it.effect('lists and inspects only bounded protected share projections', () => {
		const hash = 'a'.repeat(64);
		const commit = 'b'.repeat(40);
		const shares = ShareInstallationSnapshot.make({
			formatVersion: 1,
			entries: [
				ShareInstallationRecord.make({
					formatVersion: 1,
					shareId: 'dev.flect.weather',
					version: '1.0.0',
					source: ShareUrlInstallationSource.make({
						_tag: 'url',
						url: 'https://example.test/weather.flect-share',
						archiveSha256: hash
					}),
					manifestSha256: hash,
					repositorySha256: hash,
					artifacts: [
						ShareInstalledArtifact.make({
							id: 'dev.flect.weather.component',
							kind: 'component',
							version: '1.0.0',
							contentSha256: hash
						})
					],
					installedArtifactIds: ['dev.flect.weather.component'],
					refs: ShareInstallationRefs.make({
						base: commit,
						upstream: commit,
						fork: commit
					}),
					createdAt: 1,
					updatedAt: 1
				})
			]
		});
		const snapshot = FlectWorkspaceSnapshot.make({
			...actionSnapshot(),
			shares
		});
		const { layer } = makeGateway({ inspect: Effect.succeed(snapshot) });
		return Effect.gen(function* () {
			const list = yield* runFlect(['--json', 'share', 'list']);
			const inspect = yield* runFlect(['--json', 'share', 'inspect', 'dev.flect.weather']);
			const missing = yield* runFlect(['--json', 'share', 'inspect', 'dev.flect.missing']);

			assert.strictEqual(list.exitCode, 0);
			assert.include(list.stdout, '"shareId":"dev.flect.weather"');
			assert.notInclude(list.stdout, 'private-token');
			assert.strictEqual(inspect.exitCode, 0);
			assert.include(inspect.stdout, '"installedArtifactIds"');
			assert.notInclude(inspect.stdout, 'credentials');
			assert.strictEqual(missing.exitCode, 1);
			assert.include(missing.stdout, '"code":"not-found"');
		}).pipe(Effect.provide(layer));
	});

	it.effect('dispatches share source and export actions through the command gateway', () => {
		const snapshot = actionSnapshot(defaultInterfaceDocument, 'run', 8);
		const command = vi.fn<FlectCommandGatewayShape['command']>((value) =>
			Effect.succeed(
				FlectCommandReceipt.make({
					version: 1,
					commandId: `cmd-${value.type}`,
					workspaceId: snapshot.workspaceId,
					operationId: `operation-${value.type}`,
					sequence: 8,
					status: 'completed',
					result: { status: 'ok' }
				})
			)
		);
		const { layer } = makeGateway({
			inspect: Effect.succeed(snapshot),
			command
		});
		return Effect.gen(function* () {
			const opened = yield* runFlect([
				'--json',
				'share',
				'open-url',
				'https://example.test/weather.flect-share'
			]);
			const exported = yield* runFlect(['--json', 'share', 'export', 'dev.flect.weather']);

			assert.strictEqual(opened.exitCode, 0);
			assert.strictEqual(exported.exitCode, 0);
			assert.deepStrictEqual(
				command.mock.calls.map(([value]) => value.type),
				['open-share-source', 'export-share']
			);
		}).pipe(Effect.provide(layer));
	});

	it.effect(
		'discovers and calls only the authenticated portable extension role and binding',
		() => {
			const roleState = (extensionId: string, role: 'app' | 'shaper') =>
				PortableExtensionRoleState.make({
					version: 1,
					capsuleId: 'dev.akua.weather',
					extensionId,
					packageVersion: '1.0.0',
					bundleSha256: 'a'.repeat(64),
					provenanceRevision: 'v1.0.0',
					role,
					binding: 'candidate',
					state: 'enabled',
					requestedCapabilities: ['interface:read'],
					requiredCapabilities: ['interface:read'],
					grantedCapabilities: ['interface:read'],
					pinned: false,
					tested: false,
					failureCount: 0
				});
			const snapshot = FlectWorkspaceSnapshot.make({
				...actionSnapshot(defaultInterfaceDocument, 'run', 9),
				workbench: WorkbenchSnapshot.make({
					target: 'use',
					binding: 'candidate',
					transitionSequence: 9,
					candidateRevisionId: RevisionId.make('revision-candidate')
				}),
				extensions: PortableExtensionCatalogSnapshot.make({
					version: 1,
					entries: [roleState('app-weather', 'app'), roleState('shape-weather', 'shaper')]
				})
			});
			const invoke = vi.fn<FlectCommandGatewayShape['command']>((_command) =>
				Effect.succeed(
					FlectCommandReceipt.make({
						version: 1,
						commandId: 'cmd-extension-call',
						workspaceId: snapshot.workspaceId,
						operationId: 'operation-extension-call',
						sequence: 10,
						status: 'completed',
						result: { extensionId: 'app-weather', intents: [] }
					})
				)
			);
			const { layer } = makeGateway({
				audience: 'app',
				binding: 'candidate',
				inspect: Effect.succeed(snapshot),
				command: invoke
			});
			return Effect.gen(function* () {
				const list = yield* runFlect(['--json', 'extensions', 'list']);
				const describe = yield* runFlect(['--json', 'extensions', 'describe', 'app-weather']);
				const call = yield* runFlect([
					'--json',
					'extensions',
					'call',
					'app-weather',
					'--input',
					'{"city":"Berlin"}'
				]);

				assert.strictEqual(list.exitCode, 0);
				assert.include(list.stdout, 'app-weather');
				assert.notInclude(list.stdout, 'shape-weather');
				assert.strictEqual(describe.exitCode, 0);
				assert.include(describe.stdout, '"binding":"candidate"');
				assert.strictEqual(call.exitCode, 0);
				assert.lengthOf(invoke.mock.calls, 1);
				const command = invoke.mock.calls[0]?.[0];
				assert.strictEqual(command?.type, 'invoke-portable-extension');
				if (command?.type === 'invoke-portable-extension') {
					assert.strictEqual(command.role, 'app');
					assert.strictEqual(command.binding, 'candidate');
					assert.deepStrictEqual(command.input, { city: 'Berlin' });
				}
			}).pipe(Effect.provide(layer));
		}
	);

	it.effect('reports canonical repository refs from reactive workspace state', () => {
		const inspect = FlectWorkspaceSnapshot.make({
			...actionSnapshot(),
			repository: GitRepositoryStatus.make({
				type: 'status',
				acceptedCommit: 'a'.repeat(40),
				lastKnownGoodCommit: 'b'.repeat(40),
				proposalBranch: 'flect/proposal/revision-1',
				proposalCommit: 'c'.repeat(40),
				dirty: false,
				conflictPaths: []
			})
		});
		const { layer } = makeGateway({ inspect: Effect.succeed(inspect) });
		return Effect.gen(function* () {
			const result = yield* runFlect(['--json', 'repository', 'status']);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, '"acceptedCommit"');
			assert.include(result.stdout, 'flect/proposal/revision-1');
		}).pipe(Effect.provide(layer));
	});

	it.effect('returns a definitive content-first home view when control is disabled', () => {
		const { layer } = makeGateway();
		return Effect.gen(function* () {
			const result = yield* runFlect([]);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, '');
			assert.include(result.stdout, 'bin: /Applications/Flect.app/Contents/MacOS/flect');
			assert.include(result.stdout, 'control: disabled');
			assert.include(result.stdout, 'workspace: unavailable');
		}).pipe(Effect.provide(layer));
	});

	it.effect('keeps no-argument discovery useful before a descriptor exists', () => {
		const { layer } = makeGateway({
			status: Effect.fail(
				FlectGatewayError.make({
					reason: 'unavailable',
					message: 'Flect local control is unavailable.'
				})
			)
		});
		return Effect.gen(function* () {
			const result = yield* runFlect([]);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'control: unavailable');
			assert.include(result.stdout, 'workspace: unavailable');
			assert.include(result.stdout, 'flect app');
			assert.strictEqual(result.stderr, '');
		}).pipe(Effect.provide(layer));
	});

	it.effect('emits bounded host context without control credentials', () => {
		const { layer } = makeGateway({
			status: Effect.succeed(
				ControlBrokerStatus.make({
					version: 1,
					enabled: true,
					connected: true,
					port: 43128,
					url: 'http://127.0.0.1:43128'
				})
			),
			inspect: Effect.succeed(actionSnapshot())
		});
		return Effect.gen(function* () {
			const result = yield* runFlect(['context', '--host', 'codex']);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'host: codex');
			assert.include(result.stdout, 'Flect is an adaptive interface shell');
			assert.include(result.stdout, 'workspace-axi-action');
			assert.include(result.stdout, 'flect action list');
			assert.notInclude(result.stdout.toLowerCase(), 'bearer');
			assert.isBelow(new TextEncoder().encode(result.stdout).byteLength, 1_200);
		}).pipe(Effect.provide(layer));
	});

	it.effect('routes native setup through typed Effect capabilities', () => {
		const { layer: gateway } = makeGateway();
		const installAgent = vi.fn<AgentIntegrationShape['install']>((host) =>
			Effect.succeed(
				AgentIntegrationStatus.make({
					host,
					state: 'installed',
					path: `/fixture/${host}`,
					changed: true
				})
			)
		);
		const agents = Layer.succeed(AgentIntegration)({
			status: (host) =>
				Effect.succeed(
					AgentIntegrationStatus.make({
						host,
						state: 'absent',
						path: `/fixture/${host}`,
						changed: false
					})
				),
			statusAll: Effect.succeed([
				AgentIntegrationStatus.make({
					host: 'codex',
					state: 'absent',
					path: '/fixture/codex',
					changed: false
				})
			]),
			install: installAgent,
			remove: (host) =>
				Effect.succeed(
					AgentIntegrationStatus.make({
						host,
						state: 'absent',
						path: `/fixture/${host}`,
						changed: true
					})
				)
		});
		const shellInstall = vi.fn(() =>
			Effect.succeed(
				ShellLinkStatus.make({
					state: 'installed',
					path: '/fixture/.local/bin/flect',
					changed: true
				})
			)
		);
		const shell = Layer.succeed(ShellLink)({
			status: Effect.succeed(
				ShellLinkStatus.make({
					state: 'absent',
					path: '/fixture/.local/bin/flect',
					changed: false
				})
			),
			install: shellInstall(),
			remove: Effect.succeed(
				ShellLinkStatus.make({
					state: 'absent',
					path: '/fixture/.local/bin/flect',
					changed: false
				})
			)
		});
		const inspectedUninstall = UninstallPlan.make({
			version: 1,
			application: UninstallApplication.make({
				path: '/Applications/Flect.app',
				action: 'move-to-trash'
			}),
			ownedIntegrations: [
				UninstallOwnedItem.make({
					kind: 'shell-link',
					path: '/fixture/.local/bin/flect',
					result: 'pending'
				})
			],
			retained: [
				UninstallRetainedItem.make({
					kind: 'workspace-data',
					reason: 'Projects and interface history remain available.'
				})
			]
		});
		const preparedUninstall = UninstallPlan.make({
			...inspectedUninstall,
			ownedIntegrations: [
				UninstallOwnedItem.make({
					kind: 'shell-link',
					path: '/fixture/.local/bin/flect',
					result: 'removed'
				})
			]
		});
		const prepareUninstall = vi.fn(() => Effect.succeed(preparedUninstall));
		const uninstall = Layer.succeed(Uninstall)({
			inspect: Effect.succeed(inspectedUninstall),
			prepare: prepareUninstall()
		});
		const live = Layer.mergeAll(gateway, agents, shell, uninstall);

		return Effect.gen(function* () {
			const status = yield* runFlect(['setup', 'status']);
			const agent = yield* runFlect(['setup', 'agent', 'install', 'codex']);
			const command = yield* runFlect(['setup', 'shell', 'install']);
			const uninstallStatus = yield* runFlect(['--json', 'setup', 'uninstall', 'inspect']);
			const uninstallPrepared = yield* runFlect(['--json', 'setup', 'uninstall', 'prepare']);

			assert.include(status.stdout, 'shell:');
			assert.include(status.stdout, 'agents[1]');
			assert.include(agent.stdout, 'host: codex');
			assert.include(command.stdout, 'state: installed');
			assert.strictEqual(installAgent.mock.calls.length, 1);
			assert.strictEqual(shellInstall.mock.calls.length, 1);
			assert.include(uninstallStatus.stdout, '"action":"move-to-trash"');
			assert.include(uninstallPrepared.stdout, '"result":"removed"');
			assert.notInclude(uninstallPrepared.stdout, 'rm -rf');
			assert.strictEqual(prepareUninstall.mock.calls.length, 1);
		}).pipe(Effect.provide(live));
	});

	it.effect('renders usage failures on stdout without touching the gateway', () => {
		const { command, layer } = makeGateway();
		return Effect.gen(function* () {
			const result = yield* runFlect(['action', 'list', '--stat']);
			assert.strictEqual(result.exitCode, 2);
			assert.strictEqual(result.stderr, '');
			assert.include(result.stdout, 'code: unknown-flag');
			assert.strictEqual(command.mock.calls.length, 0);
		}).pipe(Effect.provide(layer));
	});

	it.effect('supports JSON help without requiring a live workspace', () => {
		const { layer } = makeGateway();
		return Effect.gen(function* () {
			const result = yield* runFlect(['--json', 'model', '--help']);
			assert.strictEqual(result.exitCode, 0);
			const decoded: unknown = JSON.parse(result.stdout);
			assert.deepInclude(decoded, {
				bin: '/Applications/Flect.app/Contents/MacOS/flect'
			});
			assert.include(result.stdout, 'model select');
		}).pipe(Effect.provide(layer));
	});

	it.effect('discovers protected Shaper share editing commands in local help', () => {
		const { layer } = makeGateway();
		return Effect.gen(function* () {
			const result = yield* runFlect(['share', '--help']);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'flect share checkpoint');
			assert.include(result.stdout, 'flect share resolve');
			assert.include(result.stdout, '--base <commit>');
			assert.include(result.stdout, '--upstream <commit>');
			assert.include(result.stdout, '--fork <commit>');
		}).pipe(Effect.provide(layer));
	});

	it.effect('maps gateway failures to stable operational errors', () => {
		const { layer } = makeGateway({
			status: Effect.fail(
				FlectGatewayError.make({
					reason: 'unavailable',
					message: 'Flect local control is unavailable.'
				})
			)
		});
		return Effect.gen(function* () {
			const result = yield* runFlect(['status']);
			assert.strictEqual(result.exitCode, 1);
			assert.include(result.stdout, 'code: unavailable');
			assert.strictEqual(result.stderr, '');
		}).pipe(Effect.provide(layer));
	});

	it.effect('projects actions with availability and a definitive zero state', () => {
		const empty = InterfaceDocument.make({
			...defaultInterfaceDocument,
			root: {
				id: 'empty-root',
				type: 'stack',
				direction: 'column',
				gap: 'sm',
				children: []
			}
		});
		const { layer: emptyLayer } = makeGateway({
			inspect: Effect.succeed(actionSnapshot(empty))
		});
		const { layer: actionLayer } = makeGateway({
			inspect: Effect.succeed(actionSnapshot())
		});
		return Effect.gen(function* () {
			const zero = yield* runFlect(['action', 'list']).pipe(Effect.provide(emptyLayer));
			const actions = yield* runFlect(['action', 'list']).pipe(Effect.provide(actionLayer));

			assert.include(zero.stdout, 'count: 0');
			assert.include(actions.stdout, 'actions[1]{nodeId,label,action,available}');
			assert.include(actions.stdout, 'shape-interface,Start building,shape,true');
		});
	});

	it.effect('returns the invoked action and post-command workspace state', () => {
		let inspections = 0;
		const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
			Effect.succeed(
				FlectCommandReceipt.make({
					version: 1,
					commandId: 'cmd-axi-action',
					workspaceId: 'workspace-axi-action',
					operationId: 'operation-axi-action',
					sequence: 5,
					status: 'completed'
				})
			)
		);
		const { layer } = makeGateway({
			audience: 'app',
			inspect: Effect.sync(() => {
				inspections += 1;
				return actionSnapshot(
					defaultInterfaceDocument,
					inspections === 1 ? 'run' : 'edit',
					inspections === 1 ? 4 : 6
				);
			}),
			command
		});
		return Effect.gen(function* () {
			const result = yield* runFlect(['action', 'invoke', 'shape-interface']);

			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'nodeId: shape-interface');
			assert.include(result.stdout, 'mode: edit');
			assert.strictEqual(command.mock.calls.length, 1);
			assert.strictEqual(command.mock.calls[0]?.[0].type, 'invoke-interface-action');
		}).pipe(Effect.provide(layer));
	});

	it.effect('returns a product operation result without exposing an HTTP primitive', () => {
		const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
			Effect.succeed(
				FlectCommandReceipt.make({
					version: 1,
					commandId: 'cmd-axi-product',
					workspaceId: 'workspace-axi-action',
					operationId: 'operation-axi-product',
					sequence: 5,
					status: 'completed',
					result: { projects: ['one'] }
				})
			)
		);
		const { layer } = makeGateway({ audience: 'app', command });
		return Effect.gen(function* () {
			const result = yield* runFlect([
				'product',
				'invoke',
				'projects.list',
				'--input',
				'{"limit":2}'
			]);

			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'projects.list');
			assert.include(result.stdout, 'one');
			assert.deepInclude(command.mock.calls[0]?.[0], {
				type: 'invoke-product-operation',
				operationId: 'projects.list',
				input: { limit: 2 }
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect(
		'lists reactive permission lifecycle and exposes revocation without a grant command',
		() => {
			let inspections = 0;
			const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
				Effect.succeed(
					FlectCommandReceipt.make({
						version: 1,
						commandId: 'cmd-axi-permission',
						workspaceId: 'workspace-axi-action',
						operationId: 'operation-axi-permission',
						sequence: 5,
						status: 'completed'
					})
				)
			);
			const { layer } = makeGateway({
				command,
				inspect: Effect.sync(() => {
					inspections += 1;
					return FlectWorkspaceSnapshot.make({
						...actionSnapshot(undefined, 'run', inspections < 3 ? 4 : 5),
						permissions: [permission(inspections < 3 ? 'granted' : 'revoked')]
					});
				})
			});
			return Effect.gen(function* () {
				const listed = yield* runFlect(['permissions', 'list']);
				const revoked = yield* runFlect(['permissions', 'revoke', 'decision-capability-0001']);

				assert.strictEqual(listed.exitCode, 0);
				assert.include(listed.stdout, 'product.projects.read');
				assert.include(listed.stdout, 'state: granted');
				assert.strictEqual(revoked.exitCode, 0);
				assert.include(revoked.stdout, 'state: revoked');
				assert.deepInclude(command.mock.calls[0]?.[0], {
					type: 'revoke-product-capability',
					decisionId: 'decision-capability-0001'
				});
			}).pipe(Effect.provide(layer));
		}
	);

	it.effect('dispatches semantic workbench target selection and reports the result', () => {
		const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
			Effect.succeed(
				FlectCommandReceipt.make({
					version: 1,
					commandId: 'cmd-axi-target',
					workspaceId: 'workspace-axi-action',
					operationId: 'operation-axi-target',
					sequence: 5,
					status: 'completed'
				})
			)
		);
		let inspections = 0;
		const { layer } = makeGateway({
			command,
			inspect: Effect.sync(() =>
				actionSnapshot(
					defaultInterfaceDocument,
					++inspections === 1 ? 'run' : 'edit',
					inspections === 1 ? 4 : 5
				)
			)
		});
		return Effect.gen(function* () {
			const result = yield* runFlect(['target', 'shape']);

			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'target: shape');
			assert.deepInclude(command.mock.calls[0]?.[0], {
				type: 'select-workbench-target',
				target: 'shape'
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect('dispatches cancellation through the shared command gateway', () => {
		const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
			Effect.succeed(
				FlectCommandReceipt.make({
					version: 1,
					commandId: 'cmd-axi-cancel',
					workspaceId: 'workspace-axi-action',
					operationId: 'operation-axi-cancel',
					sequence: 5,
					status: 'completed'
				})
			)
		);
		let inspections = 0;
		const { layer } = makeGateway({
			command,
			inspect: Effect.sync(() =>
				actionSnapshot(defaultInterfaceDocument, 'run', ++inspections === 1 ? 4 : 5)
			)
		});
		return Effect.gen(function* () {
			const result = yield* runFlect(['cancel', 'shaper']);

			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'sequence: 5');
			assert.strictEqual(inspections, 2);
			assert.strictEqual(command.mock.calls.length, 1);
			assert.deepInclude(command.mock.calls[0]?.[0], {
				type: 'cancel-role',
				role: 'shaper'
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect('rejects missing actions and Shaper invocation before dispatch', () => {
		const app = makeGateway({
			audience: 'app',
			inspect: Effect.succeed(actionSnapshot())
		});
		const shaper = makeGateway({
			audience: 'shaper',
			inspect: Effect.succeed(actionSnapshot())
		});
		return Effect.gen(function* () {
			const missing = yield* runFlect(['action', 'invoke', 'missing-action']).pipe(
				Effect.provide(app.layer)
			);
			const denied = yield* runFlect(['action', 'invoke', 'shape-interface']).pipe(
				Effect.provide(shaper.layer)
			);

			assert.strictEqual(missing.exitCode, 1);
			assert.include(missing.stdout, 'code: not-found');
			assert.strictEqual(app.command.mock.calls.length, 0);
			assert.strictEqual(denied.exitCode, 1);
			assert.include(denied.stdout, 'code: unauthorized');
			assert.strictEqual(shaper.command.mock.calls.length, 0);
		});
	});
});
