import { Effect, Schema } from 'effect';
import { defineCommand, type IFileSystem } from 'just-bash/browser';
import { AgentCommandSource, FlectWorkspaceSnapshot } from '../../shared/control';
import { GitRepositoryStatus } from '../../shared/git-workspace';
import type { AgentCommandBusShape } from '../axi/agent-command-bus';
import type { GitWorkspaceShape } from '../git/git-workspace';
import { snapshotWorkspaceFiles, type WorkspaceSourceFile } from './persistent-workspace-fs';
import type { FlectAgentRole, SandboxedAgentContext } from './sandboxed-shell-service';

export interface GitCommandOptions {
	readonly role: FlectAgentRole;
	readonly hiddenName: string;
	readonly bus: AgentCommandBusShape | undefined;
	readonly git: GitWorkspaceShape | undefined;
	readonly fileSystem: IFileSystem;
	readonly context: () => SandboxedAgentContext | undefined;
}

interface GitCommandState {
	staged?: ReadonlyArray<WorkspaceSourceFile>;
	authoringCommit?: string;
}

const usage = [
	'usage: git status [--short]',
	'       git branch [--show-current]',
	'       git rev-parse <HEAD|flect/ref>',
	'       git log',
	'       git add <-A|--all|.>',
	'       git commit -m <message>',
	'       git restore .'
].join('\n');

const currentRef = (role: FlectAgentRole, repository: GitRepositoryStatus) =>
	role === 'shaper' && repository.authoringCommit !== undefined
		? 'flect/authoring'
		: role === 'shaper' && repository.proposalBranch !== undefined
			? repository.proposalBranch
			: 'flect/accepted';

const currentCommit = (role: FlectAgentRole, repository: GitRepositoryStatus) =>
	role === 'shaper' && repository.authoringCommit !== undefined
		? repository.authoringCommit
		: role === 'shaper' && repository.proposalCommit !== undefined
			? repository.proposalCommit
			: repository.acceptedCommit;

const inspect = (options: GitCommandOptions, context: SandboxedAgentContext) => {
	if (options.bus === undefined) {
		return Effect.fail('authenticated agent context unavailable');
	}
	return options.bus
		.submit(
			AgentCommandSource.make({
				kind: 'agent',
				role: options.role,
				sessionId: context.sessionId,
				parentOperationId: context.parentOperationId,
				requestId: context.requestId
			}),
			{ type: 'inspect' }
		)
		.pipe(
			Effect.mapError(() => 'workspace unavailable'),
			Effect.flatMap((result) =>
				Schema.decodeUnknownEffect(FlectWorkspaceSnapshot)(result.value).pipe(
					Effect.mapError(() => 'workspace returned invalid state')
				)
			),
			Effect.flatMap((snapshot) =>
				snapshot.repository === undefined
					? Effect.fail('canonical repository is still opening')
					: Effect.succeed(snapshot.repository)
			)
		);
};

const branchLines = (role: FlectAgentRole, repository: GitRepositoryStatus) => {
	const selected = currentRef(role, repository);
	const branches = [
		repository.acceptedCommit === undefined ? undefined : 'flect/accepted',
		repository.lastKnownGoodCommit === undefined ? undefined : 'flect/last-known-good',
		repository.proposalCommit === undefined ? undefined : repository.proposalBranch,
		repository.authoringCommit === undefined ? undefined : 'flect/authoring'
	].filter((branch): branch is string => branch !== undefined);
	return branches.map((branch) => `${branch === selected ? '*' : ' '} ${branch}`).join('\n');
};

const sourceFile = (path: string) =>
	path !== 'flect.json' &&
	path !== 'flect-state.json' &&
	path !== '.flect-root' &&
	!path.startsWith('node_modules/') &&
	!path.startsWith('.flect-build/');

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const readWorkspaceSource = (fileSystem: IFileSystem) =>
	Effect.tryPromise({
		try: async () =>
			(await snapshotWorkspaceFiles(fileSystem)).filter((file) => sourceFile(file.path)),
		catch: () => 'the role workspace could not be staged'
	});

const changed = (left: Uint8Array | undefined, right: Uint8Array | undefined) =>
	left === undefined ? right !== undefined : right === undefined || !bytesEqual(left, right);

const workspaceStatus = Effect.fn('Flect.Shell.gitStatus')(function* (
	options: GitCommandOptions,
	repository: GitRepositoryStatus,
	state: GitCommandState
) {
	if (options.role !== 'shaper' || options.git === undefined) {
		return repository.conflictPaths.map((path) => `UU ${path}`);
	}
	const branch = currentRef(options.role, repository);
	const commit = currentCommit(options.role, repository);
	if (commit === undefined) {
		return repository.conflictPaths.map((path) => `UU ${path}`);
	}
	yield* options.git.open({ workspaceId: 'default' });
	const snapshot = yield* options.git.snapshotRef({
		branch,
		expectedCommit: commit,
		guards: [
			...(repository.acceptedCommit === undefined || branch === 'flect/accepted'
				? []
				: [
						{
							branch: 'flect/accepted',
							commit: repository.acceptedCommit
						}
					])
		]
	});
	const base = new Map(
		snapshot.files
			.filter((file) => sourceFile(file.path))
			.map((file) => [file.path, file.contents] as const)
	);
	const work = new Map(
		(yield* readWorkspaceSource(options.fileSystem)).map(
			(file) => [file.path, file.contents] as const
		)
	);
	const index =
		state.staged === undefined
			? base
			: new Map(state.staged.map((file) => [file.path, file.contents] as const));
	const paths = new Set([...base.keys(), ...index.keys(), ...work.keys()]);
	return [...paths].toSorted().flatMap((path) => {
		const before = base.get(path);
		const staged = index.get(path);
		const working = work.get(path);
		if (before === undefined && staged === undefined && working !== undefined) {
			return [`?? ${path}`];
		}
		const indexCode = changed(before, staged)
			? before === undefined
				? 'A'
				: staged === undefined
					? 'D'
					: 'M'
			: ' ';
		const workCode = changed(staged, working) ? (working === undefined ? 'D' : 'M') : ' ';
		return indexCode === ' ' && workCode === ' ' ? [] : [`${indexCode}${workCode} ${path}`];
	});
});

const execute = Effect.fn('Flect.Shell.git')(function* (
	options: GitCommandOptions,
	state: GitCommandState,
	context: SandboxedAgentContext,
	args: ReadonlyArray<string>
) {
	const inspected = yield* inspect(options, context);
	const repository =
		state.authoringCommit === undefined
			? inspected
			: GitRepositoryStatus.make({
					...inspected,
					authoringCommit: state.authoringCommit
				});
	const [command, ...rest] = args;
	switch (command) {
		case undefined:
		case '--help':
			return { stdout: `${usage}\n`, stderr: '', exitCode: 0 };
		case 'status': {
			if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== '--short')) {
				return { stdout: '', stderr: `${usage}\n`, exitCode: 2 };
			}
			const lines = yield* workspaceStatus(options, repository, state);
			if (rest[0] === '--short') {
				const status = lines.join('\n');
				return {
					stdout: status.length === 0 ? '' : `${status}\n`,
					stderr: '',
					exitCode: 0
				};
			}
			return {
				stdout: [
					`On branch ${currentRef(options.role, repository)}`,
					repository.conflictPaths.length > 0
						? `You have ${repository.conflictPaths.length} unresolved conflict${repository.conflictPaths.length === 1 ? '' : 's'}.`
						: lines.length > 0
							? `${lines.length} source change${lines.length === 1 ? '' : 's'} in the role workspace.`
							: 'nothing to commit, working tree clean',
					''
				].join('\n'),
				stderr: '',
				exitCode: 0
			};
		}
		case 'branch': {
			if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== '--show-current')) {
				return { stdout: '', stderr: `${usage}\n`, exitCode: 2 };
			}
			return {
				stdout:
					rest[0] === '--show-current'
						? `${currentRef(options.role, repository)}\n`
						: `${branchLines(options.role, repository)}\n`,
				stderr: '',
				exitCode: 0
			};
		}
		case 'rev-parse': {
			if (rest.length !== 1) {
				return { stdout: '', stderr: `${usage}\n`, exitCode: 2 };
			}
			const ref = rest[0];
			const commit =
				ref === 'HEAD' || ref === currentRef(options.role, repository)
					? currentCommit(options.role, repository)
					: ref === 'flect/accepted'
						? repository.acceptedCommit
						: ref === 'flect/last-known-good'
							? repository.lastKnownGoodCommit
							: ref === repository.proposalBranch
								? repository.proposalCommit
								: undefined;
			return commit === undefined
				? {
						stdout: '',
						stderr: `fatal: ambiguous argument '${ref ?? ''}'\n`,
						exitCode: 128
					}
				: { stdout: `${commit}\n`, stderr: '', exitCode: 0 };
		}
		case 'log': {
			if (rest.length > 0 || options.git === undefined) {
				return {
					stdout: '',
					stderr:
						options.git === undefined ? 'fatal: embedded Git engine unavailable\n' : `${usage}\n`,
					exitCode: 2
				};
			}
			yield* options.git.open({ workspaceId: 'default' });
			const result = yield* options.git.run(['log', currentRef(options.role, repository)]);
			return {
				stdout: result.stdout.length === 0 ? '' : `${result.stdout}\n`,
				stderr: result.stderr.length === 0 ? '' : `${result.stderr}\n`,
				exitCode: result.exitCode
			};
		}
		case 'add': {
			if (
				options.role !== 'shaper' ||
				rest.length !== 1 ||
				(rest[0] !== '-A' && rest[0] !== '--all' && rest[0] !== '.')
			) {
				return {
					stdout: '',
					stderr:
						options.role !== 'shaper'
							? 'git: App Agent has read-only repository authority\n'
							: `${usage}\n`,
					exitCode: options.role !== 'shaper' ? 126 : 2
				};
			}
			state.staged = yield* readWorkspaceSource(options.fileSystem);
			return { stdout: '', stderr: '', exitCode: 0 };
		}
		case 'commit': {
			if (options.role !== 'shaper') {
				return {
					stdout: '',
					stderr: 'git: App Agent has read-only repository authority\n',
					exitCode: 126
				};
			}
			if (
				rest.length !== 2 ||
				rest[0] !== '-m' ||
				rest[1] === undefined ||
				state.staged === undefined ||
				options.git === undefined
			) {
				return { stdout: '', stderr: `${usage}\n`, exitCode: 2 };
			}
			const baseBranch =
				repository.authoringCommit === undefined ? 'flect/accepted' : 'flect/authoring';
			const baseCommit = repository.authoringCommit ?? repository.acceptedCommit;
			if (baseCommit === undefined) {
				return {
					stdout: '',
					stderr: 'git: canonical repository is still opening\n',
					exitCode: 1
				};
			}
			yield* options.git.open({ workspaceId: 'default' });
			const base = yield* options.git.snapshotRef({
				branch: baseBranch,
				expectedCommit: baseCommit,
				guards: [
					...(repository.acceptedCommit === undefined
						? []
						: [
								{
									branch: 'flect/accepted',
									commit: repository.acceptedCommit
								}
							])
				]
			});
			const before = new Map(
				base.files
					.filter((file) => sourceFile(file.path))
					.map((file) => [file.path, file.contents] as const)
			);
			const after = new Map(state.staged.map((file) => [file.path, file.contents] as const));
			const files = state.staged.filter((file) => {
				const previous = before.get(file.path);
				return previous === undefined || !bytesEqual(previous, file.contents);
			});
			const removals = [...before.keys()].filter((path) => !after.has(path));
			if (files.length === 0 && removals.length === 0) {
				state.staged = undefined;
				return {
					stdout: 'On branch flect/authoring\nnothing to commit, working tree clean\n',
					stderr: '',
					exitCode: 1
				};
			}
			const checkpointed = yield* options.git.checkpoint({
				branch: 'flect/authoring',
				...(repository.authoringCommit === undefined
					? { baseCommit }
					: { expectedCommit: repository.authoringCommit }),
				files,
				removals,
				guards: [
					...(repository.acceptedCommit === undefined
						? []
						: [
								{
									branch: 'flect/accepted',
									commit: repository.acceptedCommit
								}
							]),
					...(repository.lastKnownGoodCommit === undefined
						? []
						: [
								{
									branch: 'flect/last-known-good',
									commit: repository.lastKnownGoodCommit
								}
							]),
					...(repository.proposalBranch === undefined || repository.proposalCommit === undefined
						? []
						: [
								{
									branch: repository.proposalBranch,
									commit: repository.proposalCommit
								}
							])
				],
				message: rest[1]
			});
			state.staged = undefined;
			state.authoringCommit = checkpointed.commit;
			return {
				stdout: `[flect/authoring ${checkpointed.commit.slice(0, 7)}] ${rest[1]}\n`,
				stderr: '',
				exitCode: 0
			};
		}
		case 'restore': {
			if (
				options.role !== 'shaper' ||
				rest.length !== 1 ||
				rest[0] !== '.' ||
				options.git === undefined
			) {
				return {
					stdout: '',
					stderr:
						options.role !== 'shaper'
							? 'git: App Agent has read-only repository authority\n'
							: `${usage}\n`,
					exitCode: options.role !== 'shaper' ? 126 : 2
				};
			}
			const branch = currentRef(options.role, repository);
			const commit = currentCommit(options.role, repository);
			if (commit === undefined) {
				return {
					stdout: '',
					stderr: 'git: canonical repository is still opening\n',
					exitCode: 1
				};
			}
			yield* options.git.open({ workspaceId: 'default' });
			const snapshot = yield* options.git.snapshotRef({
				branch,
				expectedCommit: commit,
				guards: [
					...(repository.acceptedCommit === undefined || branch === 'flect/accepted'
						? []
						: [
								{
									branch: 'flect/accepted',
									commit: repository.acceptedCommit
								}
							])
				]
			});
			const desired = snapshot.files.filter((file) => sourceFile(file.path));
			const desiredPaths = new Set(desired.map((file) => file.path));
			const current = yield* readWorkspaceSource(options.fileSystem);
			yield* Effect.tryPromise({
				try: async () => {
					for (const file of current) {
						if (!desiredPaths.has(file.path)) {
							await options.fileSystem.rm(`/workspace/${file.path}`, {
								force: true
							});
						}
					}
					for (const file of desired) {
						const slash = file.path.lastIndexOf('/');
						if (slash > 0) {
							await options.fileSystem.mkdir(`/workspace/${file.path.slice(0, slash)}`, {
								recursive: true
							});
						}
						await options.fileSystem.writeFile(`/workspace/${file.path}`, file.contents);
					}
				},
				catch: () => 'the role workspace could not be restored'
			});
			state.staged = undefined;
			return { stdout: '', stderr: '', exitCode: 0 };
		}
		default:
			return {
				stdout: '',
				stderr:
					'git: mutation and unsupported commands are denied until the role filesystem is checkpoint-bound\n',
				exitCode: 126
			};
	}
});

export const makeGitCommand = (options: GitCommandOptions) =>
	defineCommand(options.hiddenName, async (args, commandContext) => {
		const context = options.context();
		if (context === undefined) {
			return {
				stdout: '',
				stderr: 'git: authenticated agent context unavailable\n',
				exitCode: 1
			};
		}
		const state = gitCommandStates.get(options) ?? {};
		gitCommandStates.set(options, state);
		return Effect.runPromise(
			execute(options, state, context, args).pipe(
				Effect.catch((error) =>
					Effect.succeed({
						stdout: '',
						stderr: `git: ${typeof error === 'string' ? error : error.message}\n`,
						exitCode: 1
					})
				)
			),
			{ signal: commandContext.signal }
		);
	});

const gitCommandStates = new WeakMap<GitCommandOptions, GitCommandState>();
