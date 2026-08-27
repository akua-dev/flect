import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Layer, Ref } from 'effect';
import { BunCommandResult } from '../../shared/bun-command';
import {
	CommandRejected,
	ControlStateSnapshot,
	FlectWorkspaceSnapshot,
	RailStateSnapshot
} from '../../shared/control';
import {
	GitCheckpointed,
	GitOpened,
	GitRefSnapshot,
	GitRepositoryStatus
} from '../../shared/git-workspace';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import { AgentCommandBus, AgentCommandBusLive, AgentGatewayResult } from '../axi/agent-command-bus';
import { GitWorkspace, type GitWorkspaceShape } from '../git/git-workspace';
import { makeBunCommandTestLayer } from './bun-command';
import { makeSandboxedShellLayer, SandboxedShell } from './sandboxed-shell';

const builtIn = InterfaceRevision.make({
	version: 1,
	id: RevisionId.make('built-in'),
	status: 'accepted',
	source: 'built-in',
	document: defaultInterfaceDocument,
	createdAt: 0
});

const snapshot = FlectWorkspaceSnapshot.make({
	version: 1,
	workspaceId: 'workspace-flect-command',
	sequence: 8,
	phase: 'ready',
	mode: 'run',
	document: defaultInterfaceDocument,
	shaping: ShapingSnapshot.make({
		version: 1,
		active: builtIn,
		lastKnownGood: builtIn,
		safeMode: false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 0,
			type: 'initialized',
			revisionId: builtIn.id
		})
	}),
	agent: {
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
	},
	rail: RailStateSnapshot.make({ collapsed: false, width: 400 }),
	control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
	operations: [],
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

const context = {
	sessionId: 'session-shell-flect',
	parentOperationId: 'operation-shell-parent',
	requestId: 'tool-shell-flect'
};

const makeLayer = (
	role: 'app' | 'shaper' = 'app',
	files: Readonly<Record<string, string>> = {},
	git?: GitWorkspaceShape
) => {
	const bun = makeBunCommandTestLayer(() =>
		Effect.succeed(
			BunCommandResult.make({
				version: 1,
				exitCode: 0,
				stdout: '',
				stderr: ''
			})
		)
	);
	const shell = makeSandboxedShellLayer({ role, files }).pipe(
		Layer.provide(bun),
		Layer.provideMerge(AgentCommandBusLive)
	);
	return git === undefined
		? shell
		: shell.pipe(Layer.provideMerge(Layer.succeed(GitWorkspace)(git)));
};

const respondToReads = Effect.gen(function* () {
	const bus = yield* AgentCommandBus;
	const roles = yield* Ref.make<Array<string>>([]);
	yield* Effect.forever(
		Effect.gen(function* () {
			const request = yield* bus.take;
			yield* Ref.update(roles, (current) => [...current, request.source.role]);
			if (request.operation.type === 'propose-interface') {
				if (request.source.role !== 'shaper') {
					yield* Deferred.fail(
						request.response,
						CommandRejected.make({
							message: 'Only Shaper can propose an interface.'
						})
					);
					return;
				}
				yield* Deferred.succeed(
					request.response,
					AgentGatewayResult.make({
						type: 'propose-interface',
						value: {
							status: 'proposed',
							name: request.operation.document.name
						}
					})
				);
				return;
			}
			if (request.operation.type === 'propose-app') {
				if (request.source.role !== 'shaper') {
					yield* Deferred.fail(
						request.response,
						CommandRejected.make({
							message: 'Only Shaper can propose an authored app.'
						})
					);
					return;
				}
				yield* Deferred.succeed(
					request.response,
					AgentGatewayResult.make({
						type: 'propose-app',
						value: {
							status: 'proposed',
							name: request.operation.name
						}
					})
				);
				return;
			}
			if (request.operation.type === 'command') {
				yield* Deferred.succeed(
					request.response,
					AgentGatewayResult.make({
						type: 'command',
						value: { status: 'proposed' }
					})
				);
				return;
			}
			yield* Deferred.succeed(
				request.response,
				AgentGatewayResult.make({
					type: request.operation.type === 'logs' ? 'logs' : 'inspect',
					value: request.operation.type === 'logs' ? { version: 1, operations: [] } : snapshot
				})
			);
		})
	).pipe(Effect.forkScoped);
	return roles;
});

describe('reserved browser flect command', () => {
	it.effect('fails safely without authenticated call context', () =>
		Effect.gen(function* () {
			const shell = yield* SandboxedShell;
			const result = yield* shell.execute('app', 'flect');
			assert.strictEqual(result.exitCode, 1);
			assert.include(result.stderr, 'authenticated agent context unavailable');
		}).pipe(Effect.provide(makeLayer()))
	);

	it.effect('is browser-embedded, role-bound, pipeable, and unshadowable', () =>
		Effect.gen(function* () {
			const roles = yield* respondToReads;
			const shell = yield* SandboxedShell;
			const lines = [
				'FLECT_ROLE=shaper flect | tee home.toon; grep browser-embedded home.toon',
				'flect repository status | grep acceptedCommit; echo browser-embedded',
				'alias flect=false; flect',
				'flect() { false; }; flect',
				'echo false > /workspace/flect; chmod +x /workspace/flect; PATH=/workspace:$PATH flect'
			];
			const results = yield* Effect.forEach(lines, (line, index) =>
				shell.execute('app', line, {
					agentContext: { ...context, requestId: `tool-shell-${index}` }
				})
			);
			results.forEach((result) => {
				assert.strictEqual(result.exitCode, 0);
				assert.include(result.stdout, 'browser-embedded');
			});
			assert.isTrue((yield* Ref.get(roles)).every((role) => role === 'app'));
		}).pipe(Effect.provide(makeLayer()))
	);

	it.effect('cancels one embedded command without stopping the workspace', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const shell = yield* SandboxedShell;
			const controller = new AbortController();
			const running = yield* shell
				.execute('app', 'flect', {
					signal: controller.signal,
					agentContext: context
				})
				.pipe(Effect.forkChild);
			yield* bus.take;
			controller.abort();
			const cancelled = yield* Fiber.join(running);
			assert.strictEqual(cancelled.exitCode, 1);
			const after = yield* shell.execute('app', 'echo still-running');
			assert.strictEqual(after.stdout, 'still-running\n');
		}).pipe(Effect.provide(makeLayer()))
	);

	it.effect('lets only Shaper import a capsule from its sandbox', () =>
		Effect.gen(function* () {
			yield* respondToReads;
			const shell = yield* SandboxedShell;
			const result = yield* shell.execute('shaper', 'flect capsule import app.flect', {
				agentContext: context
			});
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'status: proposed');
		}).pipe(Effect.provide(makeLayer('shaper', { '/workspace/app.flect': 'fixture' })))
	);

	it.effect('packages and proposes authored app source from the sandbox', () =>
		Effect.gen(function* () {
			yield* respondToReads;
			const shell = yield* SandboxedShell;
			const validated = yield* shell.execute(
				'shaper',
				"flect app validate /workspace/project --name 'Driftwood Coffee'",
				{ agentContext: context }
			);
			assert.strictEqual(validated.exitCode, 0);
			assert.include(validated.stdout, 'valid');
			assert.include(validated.stdout, 'static-html');
			const proposed = yield* shell.execute(
				'shaper',
				"flect app propose /workspace/project --name 'Driftwood Coffee'",
				{ agentContext: { ...context, requestId: 'tool-shell-flect-2' } }
			);
			assert.strictEqual(proposed.exitCode, 0);
			assert.include(proposed.stdout, 'proposed');
			assert.include(proposed.stdout, 'Driftwood Coffee');
		}).pipe(
			Effect.provide(
				makeLayer('shaper', {
					'/workspace/project/index.html':
						'<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Driftwood</h1></body></html>',
					'/workspace/project/styles.css': 'body{background:#faf6f0}'
				})
			)
		)
	);

	it.effect('refuses authored app proposals outside the Shaper role', () =>
		Effect.gen(function* () {
			yield* respondToReads;
			const shell = yield* SandboxedShell;
			const result = yield* shell.execute('app', 'flect app propose /workspace/project', {
				agentContext: context
			});
			assert.notStrictEqual(result.exitCode, 0);
			assert.include(result.stderr + result.stdout, 'Shaper');
		}).pipe(
			Effect.provide(
				makeLayer('app', {
					'/workspace/project/index.html': '<!doctype html><h1>App</h1>'
				})
			)
		)
	);

	it.effect('lets Shaper checkpoint bounded sandbox files onto an inspected shared fork', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const captured = yield* Ref.make<
				ReadonlyArray<{
					readonly type: string;
					readonly path?: string;
					readonly text?: string;
				}>
			>([]);
			yield* Effect.gen(function* () {
				const request = yield* bus.take;
				if (
					request.operation.type !== 'command' ||
					request.operation.command.type !== 'checkpoint-share-fork'
				) {
					return yield* Effect.die('Expected a shared fork checkpoint');
				}
				const command = request.operation.command;
				yield* Ref.set(captured, [
					{
						type: command.type,
						path: command.files[0]?.path,
						text:
							command.files[0] === undefined
								? undefined
								: new TextDecoder().decode(command.files[0].contents)
					}
				]);
				yield* Deferred.succeed(
					request.response,
					AgentGatewayResult.make({
						type: 'command',
						value: { status: 'checkpointed' }
					})
				);
			}).pipe(Effect.forkScoped);

			const shell = yield* SandboxedShell;
			const result = yield* shell.execute(
				'shaper',
				`flect share checkpoint dev.flect.shared-card --at ${'a'.repeat(40)} --write components/card/index.tsx ./card.tsx --remove components/card/old.tsx --message 'Personalize shared card'`,
				{ agentContext: context }
			);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'checkpoint submitted');
			assert.deepStrictEqual(yield* Ref.get(captured), [
				{
					type: 'checkpoint-share-fork',
					path: 'components/card/index.tsx',
					text: 'export const Card = 2\n'
				}
			]);
		}).pipe(
			Effect.provide(
				makeLayer('shaper', {
					'/workspace/card.tsx': 'export const Card = 2\n'
				})
			)
		)
	);

	it.effect('denies shared fork checkpointing to App Agent', () =>
		Effect.gen(function* () {
			const shell = yield* SandboxedShell;
			const result = yield* shell.execute(
				'app',
				`flect share checkpoint dev.flect.shared-card --at ${'a'.repeat(40)} --write components/card/index.tsx ./card.tsx --message 'Unauthorized edit'`,
				{ agentContext: context }
			);
			assert.strictEqual(result.exitCode, 126);
			assert.include(result.stderr, 'Only Shaper can edit a retained fork');
		}).pipe(
			Effect.provide(
				makeLayer('app', {
					'/workspace/card.tsx': 'export const Card = 2\n'
				})
			)
		)
	);

	it.effect('lets only Shaper submit an exact shared conflict resolution', () =>
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const captured = yield* Ref.make<
				| {
						readonly type: string;
						readonly path?: string;
						readonly text?: string;
				  }
				| undefined
			>(undefined);
			yield* Effect.gen(function* () {
				const request = yield* bus.take;
				if (
					request.operation.type !== 'command' ||
					request.operation.command.type !== 'resolve-share-conflict'
				) {
					return yield* Effect.die('Expected a shared conflict resolution');
				}
				const command = request.operation.command;
				yield* Ref.set(captured, {
					type: command.type,
					path: command.files[0]?.path,
					text:
						command.files[0] === undefined
							? undefined
							: new TextDecoder().decode(command.files[0].contents)
				});
				yield* Deferred.succeed(
					request.response,
					AgentGatewayResult.make({
						type: 'command',
						value: { status: 'resolved' }
					})
				);
			}).pipe(Effect.forkScoped);

			const shell = yield* SandboxedShell;
			const result = yield* shell.execute(
				'shaper',
				`flect share resolve dev.flect.shared-card --base ${'a'.repeat(40)} --upstream ${'b'.repeat(40)} --fork ${'f'.repeat(40)} --write components/card/index.tsx ./resolved.tsx --message 'Resolve shared card'`,
				{ agentContext: context }
			);
			assert.strictEqual(result.exitCode, 0);
			assert.include(result.stdout, 'resolution submitted');
			assert.deepStrictEqual(yield* Ref.get(captured), {
				type: 'resolve-share-conflict',
				path: 'components/card/index.tsx',
				text: "export const Card = 'resolved'\n"
			});
		}).pipe(
			Effect.provide(
				makeLayer('shaper', {
					'/workspace/resolved.tsx': "export const Card = 'resolved'\n"
				})
			)
		)
	);

	it.effect('binds reserved Git inspection to the authenticated role', () =>
		Effect.gen(function* () {
			const app = yield* Effect.gen(function* () {
				yield* respondToReads;
				const shell = yield* SandboxedShell;
				return yield* shell.execute(
					'app',
					'git branch --show-current; git rev-parse HEAD; git status',
					{ agentContext: context }
				);
			}).pipe(Effect.provide(makeLayer('app')));
			const [shaper, denied] = yield* Effect.gen(function* () {
				yield* respondToReads;
				const shell = yield* SandboxedShell;
				return yield* Effect.all([
					shell.execute(
						'shaper',
						'alias git=false; git branch --show-current; git rev-parse HEAD',
						{ agentContext: { ...context, requestId: 'tool-git-shaper' } }
					),
					shell.execute('shaper', 'git checkout main', {
						agentContext: { ...context, requestId: 'tool-git-denied' }
					})
				]);
			}).pipe(Effect.provide(makeLayer('shaper')));

			assert.strictEqual(app.exitCode, 0);
			assert.include(app.stdout, 'flect/accepted');
			assert.include(app.stdout, 'a'.repeat(40));
			assert.strictEqual(shaper.exitCode, 0);
			assert.include(shaper.stdout, 'flect/proposal/revision-1');
			assert.include(shaper.stdout, 'c'.repeat(40));
			assert.strictEqual(denied.exitCode, 126);
			assert.include(denied.stderr, 'checkpoint-bound');
		})
	);

	it.effect('checkpoints staged Shaper source onto a guarded authoring ref', () =>
		Effect.gen(function* () {
			const checkpoints: Array<Parameters<GitWorkspaceShape['checkpoint']>[0]> = [];
			const git: GitWorkspaceShape = {
				open: () =>
					Effect.succeed(
						GitOpened.make({
							type: 'opened',
							variant: 'asyncify',
							existed: true
						})
					),
				checkpoint: (options) =>
					Effect.sync(() => {
						checkpoints.push(options);
						return GitCheckpointed.make({
							type: 'checkpointed',
							branch: options.branch,
							commit: 'd'.repeat(40)
						});
					}),
				snapshotRef: (options) =>
					Effect.succeed(
						GitRefSnapshot.make({
							type: 'ref-snapshot',
							branch: options.branch,
							commit: options.expectedCommit,
							files: [
								{
									path: 'flect.json',
									contents: new TextEncoder().encode('protected\n')
								},
								{
									path: 'old.txt',
									contents: new TextEncoder().encode('old\n')
								}
							]
						})
					),
				write: () => Effect.die('unused'),
				read: () => Effect.die('unused'),
				run: () => Effect.die('unused'),
				exportRepository: Effect.die('unused'),
				remove: Effect.die('unused'),
				readAtRef: () => Effect.die('unused'),
				moveRef: () => Effect.die('unused'),
				status: () => Effect.die('unused'),
				importRepository: () => Effect.die('unused'),
				importObjects: () => Effect.die('unused'),
				deleteRef: () => Effect.die('unused'),
				inspectCommit: () => Effect.die('unused'),
				mergeRef: () => Effect.die('unused'),
				inspectShare: () => Effect.die('unused')
			};
			const output = yield* Effect.gen(function* () {
				yield* respondToReads;
				const shell = yield* SandboxedShell;
				return yield* shell.execute(
					'shaper',
					'git add -A && git commit -m \'Shape source\' && printf transient > /workspace/transient.txt && git status --short | grep transient.txt && git restore . && test -f /workspace/old.txt && test ! -e /workspace/transient.txt && test -z "$(git status --short)"',
					{ agentContext: context }
				);
			}).pipe(Effect.provide(makeLayer('shaper', { '/workspace/new.txt': 'new\n' }, git)));

			assert.strictEqual(output.exitCode, 0);
			assert.include(output.stdout, 'flect/authoring');
			assert.lengthOf(checkpoints, 1);
			assert.strictEqual(checkpoints[0]?.branch, 'flect/authoring');
			assert.strictEqual(checkpoints[0]?.baseCommit, 'a'.repeat(40));
			assert.deepStrictEqual(checkpoints[0]?.removals, ['old.txt']);
			assert.deepStrictEqual(
				checkpoints[0]?.files.map((file) => file.path),
				['new.txt']
			);
			assert.isTrue(
				checkpoints[0]?.guards?.some(
					(guard) => guard.branch === 'flect/proposal/revision-1' && guard.commit === 'c'.repeat(40)
				)
			);
		})
	);

	it.effect('describes, validates, and proposes an interface only as Shaper', () =>
		Effect.gen(function* () {
			yield* respondToReads;
			const shell = yield* SandboxedShell;
			const schema = yield* shell.execute('shaper', 'flect interface schema', {
				agentContext: { ...context, requestId: 'tool-schema' }
			});
			const candidate = JSON.stringify({
				version: 2,
				name: 'Visible canvas',
				root: {
					id: 'root',
					type: 'stack',
					direction: 'column',
					gap: 'md',
					children: [
						{
							id: 'headline',
							type: 'text',
							text: 'Visible canvas',
							style: 'headline'
						}
					]
				}
			});
			const written = yield* shell.execute(
				'shaper',
				`printf '%s' '${candidate}' > /workspace/interface.json`,
				{ agentContext: { ...context, requestId: 'tool-write' } }
			);
			const validated = yield* shell.execute(
				'shaper',
				'flect interface validate ./interface.json',
				{ agentContext: context }
			);
			const proposed = yield* shell.execute(
				'shaper',
				'flect interface propose /workspace/interface.json',
				{ agentContext: { ...context, requestId: 'tool-propose' } }
			);
			const escaped = yield* shell.execute('shaper', 'flect interface validate ../outside.json', {
				agentContext: { ...context, requestId: 'tool-escape' }
			});
			assert.strictEqual(schema.exitCode, 0);
			assert.include(schema.stdout, 'direction');
			assert.include(schema.stdout, 'children');
			assert.include(schema.stdout, 'headline');
			assert.strictEqual(written.exitCode, 0);
			assert.strictEqual(validated.exitCode, 0);
			assert.include(validated.stdout, 'status: valid');
			assert.strictEqual(proposed.exitCode, 0);
			assert.include(proposed.stdout, 'status: proposed');
			assert.strictEqual(escaped.exitCode, 1);
			assert.include(escaped.stdout, 'code: unauthorized');
		}).pipe(
			Effect.provide(
				makeLayer('shaper', {
					'/workspace/interface.json': JSON.stringify(defaultInterfaceDocument)
				})
			)
		)
	);
});
