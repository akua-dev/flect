import type { Fetcher } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { Effect, Layer, Option, Schema, type SchemaAST, Semaphore } from 'effect';
import {
	Bash,
	type CommandName,
	defineCommand,
	getCommandNames,
	type IFileSystem,
	InMemoryFs
} from 'just-bash/browser';
import { BunCommandFailed, BunCommandRequest, BunCommandResult } from '../../shared/bun-command';
import { AgentCommandBus } from '../axi/agent-command-bus';
import type { BunModuleExecution } from '../execution/bun-module-execution';
import { GitWorkspace } from '../git/git-workspace';
import { BunCommand } from './bun-command';
import { makeShellBunCommandLiveLayer } from './bun-command-live';
import { makeFlectCommand } from './flect-command';
import { makeGitCommand } from './git-command';
import { makePersistentWorkspaceFs, snapshotWorkspaceFiles } from './persistent-workspace-fs';
import {
	type FlectAgentRole,
	type SandboxedAgentContext,
	SandboxedShell,
	type SandboxedShellExecuteOptions,
	type SandboxedShellShape,
	type SandboxedShellWorkspace
} from './sandboxed-shell-service';

export {
	type FlectAgentRole,
	SandboxedShell,
	type SandboxedShellExecuteOptions,
	type SandboxedShellShape,
	type SandboxedShellWorkspace
} from './sandboxed-shell-service';

const WORKSPACE_ROOT = '/workspace';
const OUTPUT_LIMIT = 1_048_576;

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

interface AstRecord {
	type?: unknown;
	name?: unknown;
	parts?: unknown;
	value?: unknown;
	[key: string]: unknown;
}

const isRecord = (value: unknown): value is AstRecord =>
	typeof value === 'object' && value !== null;

const staticWord = (word: unknown): string | undefined => {
	if (!isRecord(word) || !Array.isArray(word.parts)) {
		return undefined;
	}
	const values: Array<string> = [];
	for (const part of word.parts) {
		if (
			!isRecord(part) ||
			(part.type !== 'Literal' && part.type !== 'SingleQuoted' && part.type !== 'Escaped') ||
			typeof part.value !== 'string'
		) {
			return undefined;
		}
		values.push(part.value);
	}
	return values.join('');
};

const replaceStaticWord = (word: AstRecord, value: string) => {
	word.parts = [{ type: 'Literal', value }];
};

const reserveCommands = (ast: unknown, replacements: Readonly<Record<string, string>>) => {
	const seen = new Set<object>();
	const visit = (value: unknown): void => {
		if (!isRecord(value) || seen.has(value)) {
			return;
		}
		seen.add(value);

		if (
			value.type === 'SimpleCommand' &&
			isRecord(value.name) &&
			staticWord(value.name) !== undefined
		) {
			const name = staticWord(value.name);
			const replacement = name === undefined ? undefined : replacements[name];
			if (replacement !== undefined) {
				replaceStaticWord(value.name, replacement);
			}
		} else if (
			value.type === 'FunctionDef' &&
			typeof value.name === 'string' &&
			replacements[value.name] !== undefined
		) {
			value.name = `__flect_guest_${value.name}`;
		}

		for (const child of Object.values(value)) {
			if (Array.isArray(child)) {
				for (const entry of child) {
					visit(entry);
				}
			} else {
				visit(child);
			}
		}
	};
	visit(ast);
};

const shellFailure = (reason: BunCommandFailed['reason'], message: string) =>
	BunCommandFailed.make({ reason, message });

const blockedCommands = new Set([
	'curl',
	'gunzip',
	'gzip',
	'html-to-markdown',
	'js-exec',
	'python',
	'python3',
	'sqlite3',
	'zcat'
]);

const isEnabledCommand = (name: string): name is CommandName => !blockedCommands.has(name);

interface SandboxedShellWorkspaceOptions {
	readonly role: FlectAgentRole;
	readonly workspace?: SandboxedShellWorkspace;
	readonly files: Readonly<Record<string, string | Uint8Array>>;
	readonly fs?: IFileSystem;
}

export interface SandboxedShellWorkspaceShape {
	readonly replaceTree: (
		root: string,
		files: ReadonlyArray<{
			readonly path: string;
			readonly contents: Uint8Array;
		}>
	) => Effect.Effect<void, BunCommandFailed>;
	readonly execute: (
		line: string,
		options?: SandboxedShellExecuteOptions
	) => Effect.Effect<BunCommandResult, BunCommandFailed>;
	readonly stop: Effect.Effect<void, BunCommandFailed>;
}

const makeSandboxedShellWorkspace = Effect.fn('SandboxedShell.makeWorkspace')(function* (
	options: SandboxedShellWorkspaceOptions
) {
	const command = yield* BunCommand;
	const maybeBus = yield* Effect.serviceOption(AgentCommandBus);
	const bus = Option.getOrUndefined(maybeBus);
	const git = Option.getOrUndefined(yield* Effect.serviceOption(GitWorkspace));
	const executionPermit = yield* Semaphore.make(1);
	let previewUrl: string | undefined;
	let agentContext: SandboxedAgentContext | undefined;
	const initialFiles = {
		'/workspace/.flect-root': '',
		...options.files
	};
	const fileSystem = options.fs ?? new InMemoryFs(initialFiles);
	const hiddenCommand = `__flect_reserved_bun_${crypto.randomUUID().replaceAll('-', '')}`;
	const hiddenFlectCommand = `__flect_reserved_flect_${crypto.randomUUID().replaceAll('-', '')}`;
	const hiddenGitCommand = `__flect_reserved_git_${crypto.randomUUID().replaceAll('-', '')}`;
	const bun = defineCommand(hiddenCommand, async (args, context) => {
		try {
			const request = await Schema.decodeUnknownPromise(
				BunCommandRequest,
				strict
			)({
				version: 1,
				argv: args.length === 0 ? ['--help'] : args,
				cwd: context.cwd
			});
			const output = await Effect.runPromise(command.execute(request), {
				signal: context.signal
			});
			previewUrl = output.previewUrl;
			return {
				stdout: output.stdout,
				stderr: output.stderr,
				exitCode: output.exitCode
			};
		} catch {
			return {
				stdout: '',
				stderr: context.signal?.aborted
					? 'bun: command cancelled\n'
					: 'bun: command failed safely\n',
				exitCode: context.signal?.aborted ? 130 : 1
			};
		}
	});
	const flect = makeFlectCommand({
		role: options.role,
		hiddenName: hiddenFlectCommand,
		bus,
		context: () => agentContext,
		readFile: (path) => fileSystem.readFileBuffer(path),
		readTree: async (directory) => {
			const prefix = `${directory.replace(/\/$/, '').slice(`${WORKSPACE_ROOT}/`.length)}/`;
			return (await snapshotWorkspaceFiles(fileSystem)).flatMap((file) =>
				file.path.startsWith(prefix)
					? [{ path: file.path.slice(prefix.length), contents: file.contents }]
					: []
			);
		}
	});
	const gitCommand = makeGitCommand({
		role: options.role,
		hiddenName: hiddenGitCommand,
		bus,
		git,
		fileSystem,
		context: () => agentContext
	});
	const bash = new Bash({
		cwd: WORKSPACE_ROOT,
		fs: fileSystem,
		env: {
			FLECT_ROLE: options.role,
			HOME: WORKSPACE_ROOT,
			PATH: '/usr/bin:/bin'
		},
		commands: getCommandNames().filter(isEnabledCommand),
		customCommands: [bun, flect, gitCommand],
		executionLimitProfile: 'hardened',
		executionLimits: {
			maxSourceBytes: 262_144,
			maxExecutionTimeMs: 30_000,
			maxExtensionCleanupTimeMs: 1_000,
			maxFileSystemBytes: 67_108_864,
			maxOutputSize: OUTPUT_LIMIT,
			maxCommandCount: 10_000,
			maxLoopIterations: 10_000
		}
	});
	const reservedPlugin: Parameters<Bash['registerTransformPlugin']>[0] = {
		name: 'flect-reserved-commands',
		transform: ({
			ast,
			metadata
		}: {
			readonly ast: unknown;
			readonly metadata: Record<string, unknown>;
		}) => {
			reserveCommands(ast, {
				bun: hiddenCommand,
				flect: hiddenFlectCommand,
				git: hiddenGitCommand
			});
			return { ast, metadata };
		}
	};
	bash.registerTransformPlugin(reservedPlugin);

	return {
		replaceTree: Effect.fn('SandboxedShell.replaceTree')((root, files) =>
			executionPermit.withPermit(
				Effect.tryPromise({
					try: async () => {
						if (
							!/^\/workspace\/\.flect\/share-conflicts\/[a-z0-9][a-z0-9.-]{2,119}$/.test(root) ||
							files.length > 300
						) {
							throw new Error('invalid conflict tree');
						}
						const paths = new Set<string>();
						let bytes = 0;
						for (const file of files) {
							bytes += file.contents.byteLength;
							if (
								!/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(
									file.path
								) ||
								paths.has(file.path) ||
								file.contents.byteLength > 8 * 1024 * 1024 ||
								bytes > 32 * 1024 * 1024
							) {
								throw new Error('invalid conflict file');
							}
							paths.add(file.path);
						}
						await fileSystem.rm(root, { recursive: true, force: true });
						await fileSystem.mkdir(root, { recursive: true });
						for (const file of files) {
							const target = `${root}/${file.path}`;
							const parent = target.slice(0, target.lastIndexOf('/'));
							await fileSystem.mkdir(parent, { recursive: true });
							await fileSystem.writeFile(target, file.contents);
						}
					},
					catch: () =>
						shellFailure('execution', 'The selected agent workspace could not be prepared safely.')
				})
			)
		),
		execute: Effect.fn('SandboxedShell.execute')((line, executeOptions) =>
			executionPermit.withPermit(
				Effect.sync(() => {
					previewUrl = undefined;
					agentContext = executeOptions?.agentContext;
				}).pipe(
					Effect.andThen(
						Effect.tryPromise({
							try: (effectSignal) => {
								const signal =
									executeOptions?.signal === undefined
										? effectSignal
										: AbortSignal.any([effectSignal, executeOptions.signal]);
								return bash.exec(line, {
									cwd: WORKSPACE_ROOT,
									signal
								});
							},
							catch: () => shellFailure('execution', 'The sandboxed shell failed safely.')
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							agentContext = undefined;
						})
					),
					Effect.flatMap((output) =>
						output.stdout.length > OUTPUT_LIMIT || output.stderr.length > OUTPUT_LIMIT
							? Effect.fail(
									shellFailure('execution', 'The sandboxed shell output exceeded its limit.')
								)
							: Effect.succeed(
									BunCommandResult.make({
										version: 1,
										exitCode:
											executeOptions?.agentContext !== undefined &&
											executeOptions.signal?.aborted === true
												? 1
												: Math.min(255, Math.max(0, output.exitCode)),
										stdout: output.stdout,
										stderr: output.stderr,
										...(previewUrl === undefined ? {} : { previewUrl })
									})
								)
					)
				)
			)
		),
		stop: command
			.execute(
				BunCommandRequest.make({
					version: 1,
					argv: ['stop'],
					cwd: WORKSPACE_ROOT
				})
			)
			.pipe(Effect.asVoid)
	} satisfies SandboxedShellWorkspaceShape;
});

const missingRoleWorkspace = () =>
	Effect.fail(shellFailure('execution', 'The selected agent workspace is unavailable.'));

const makeSandboxedShellService = (
	workspaces: Partial<Readonly<Record<SandboxedShellWorkspace, SandboxedShellWorkspaceShape>>>
): SandboxedShellShape => ({
	replaceTree: Effect.fn('SandboxedShell.replaceTreeForRole')(
		(workspace, root, files) =>
			workspaces[workspace]?.replaceTree(root, files) ?? missingRoleWorkspace()
	),
	execute: Effect.fn('SandboxedShell.executeForRole')(
		(workspace: SandboxedShellWorkspace, line: string, options?: SandboxedShellExecuteOptions) =>
			workspaces[workspace]?.execute(line, options) ?? missingRoleWorkspace()
	),
	stop: Effect.fn('SandboxedShell.stopRole')(
		(workspace: SandboxedShellWorkspace) => workspaces[workspace]?.stop ?? missingRoleWorkspace()
	)
});

export const makeRoleSandboxedShellService = (
	workspaces: Readonly<Record<SandboxedShellWorkspace, SandboxedShellWorkspaceShape>>
) => makeSandboxedShellService(workspaces);

export const makeSandboxedShellLayer = (options: SandboxedShellWorkspaceOptions) =>
	Layer.effect(
		SandboxedShell,
		makeSandboxedShellWorkspace(options).pipe(
			Effect.map((workspace) =>
				makeSandboxedShellService({
					[options.workspace ?? options.role]: workspace
				})
			)
		)
	);

type RoleWorkspaceOptions = Omit<SandboxedShellWorkspaceOptions, 'role'>;

export const makeRoleSandboxedShellLayer = (options: {
	readonly app: RoleWorkspaceOptions;
	readonly previewApp: RoleWorkspaceOptions;
	readonly shaper: RoleWorkspaceOptions;
}) =>
	Layer.effect(
		SandboxedShell,
		Effect.gen(function* () {
			const app = yield* makeSandboxedShellWorkspace({
				role: 'app',
				workspace: 'app',
				...options.app
			});
			const previewApp = yield* makeSandboxedShellWorkspace({
				role: 'app',
				workspace: 'previewApp',
				...options.previewApp
			});
			const shaper = yield* makeSandboxedShellWorkspace({
				role: 'shaper',
				workspace: 'shaper',
				...options.shaper
			});
			return makeRoleSandboxedShellService({ app, previewApp, shaper });
		})
	);

export const makeLiveSandboxedShellLayer = (options: {
	readonly role: FlectAgentRole;
	readonly files: Readonly<Record<string, string | Uint8Array>>;
	readonly packageFetch?: Fetcher;
	readonly registryBaseUrl?: string;
	readonly moduleLayer?: Layer.Layer<BunModuleExecution>;
}) =>
	Layer.unwrap(
		Effect.sync(() => {
			const fs = new InMemoryFs({
				'/workspace/.flect-root': '',
				...options.files
			});
			const commandLayer = makeShellBunCommandLiveLayer({
				fs,
				...(options.packageFetch === undefined ? {} : { packageFetch: options.packageFetch }),
				...(options.registryBaseUrl === undefined
					? {}
					: { registryBaseUrl: options.registryBaseUrl }),
				...(options.moduleLayer === undefined ? {} : { moduleLayer: options.moduleLayer })
			});
			return makeSandboxedShellLayer({
				role: options.role,
				files: {},
				fs
			}).pipe(Layer.provide(commandLayer));
		})
	);

type LiveRoleWorkspaceOptions = Omit<Parameters<typeof makeLiveSandboxedShellLayer>[0], 'role'>;

const makeLiveWorkspace = Effect.fn('SandboxedShell.makeLiveWorkspace')(function* (
	role: FlectAgentRole,
	workspace: SandboxedShellWorkspace,
	options: LiveRoleWorkspaceOptions,
	fs: IFileSystem
) {
	const commandLayer = makeShellBunCommandLiveLayer({
		fs,
		...(options.packageFetch === undefined ? {} : { packageFetch: options.packageFetch }),
		...(options.registryBaseUrl === undefined ? {} : { registryBaseUrl: options.registryBaseUrl }),
		...(options.moduleLayer === undefined ? {} : { moduleLayer: options.moduleLayer })
	});
	return yield* makeSandboxedShellWorkspace({
		role,
		workspace,
		files: {},
		fs
	}).pipe(Effect.provide(commandLayer));
});

export const makeLiveRoleSandboxedShellLayer = (options: {
	readonly workspaceId?: string;
	readonly app: LiveRoleWorkspaceOptions;
	readonly previewApp: LiveRoleWorkspaceOptions;
	readonly shaper: LiveRoleWorkspaceOptions;
}) =>
	Layer.effect(
		SandboxedShell,
		Effect.gen(function* () {
			// Role workspaces are deliberately disposable. They must not share the
			// canonical browser persistence surface used by accepted interface and
			// repository state.
			const vfs = new MemoryVfs();
			const workspaceId = options.workspaceId ?? 'default';
			const makeFs = (
				workspace: SandboxedShellWorkspace,
				files: LiveRoleWorkspaceOptions['files']
			) =>
				Effect.promise(() =>
					makePersistentWorkspaceFs({
						vfs,
						namespace: `/flect-role-workspaces/${workspaceId}/${workspace === 'previewApp' ? 'preview-app' : workspace}`,
						files
					})
				);
			const appFs = yield* makeFs('app', options.app.files);
			const previewAppFs = yield* makeFs('previewApp', options.previewApp.files);
			const shaperFs = yield* makeFs('shaper', options.shaper.files);
			const app = yield* makeLiveWorkspace('app', 'app', options.app, appFs);
			const previewApp = yield* makeLiveWorkspace(
				'app',
				'previewApp',
				options.previewApp,
				previewAppFs
			);
			const shaper = yield* makeLiveWorkspace('shaper', 'shaper', options.shaper, shaperFs);
			return makeRoleSandboxedShellService({ app, previewApp, shaper });
		})
	);
