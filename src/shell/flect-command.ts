import { Effect, Layer, Schema } from 'effect';
import { defineCommand } from 'just-bash/browser';
import {
	AgentCommandSource,
	CheckpointShareFork,
	ImportCapsule,
	ResolveShareConflict
} from '../../shared/control';
import { AgentCommandBus, type AgentCommandBusShape } from '../axi/agent-command-bus';
import { makeAgentFlectCommandGatewayLayer } from '../axi/agent-gateway';
import { FlectGatewayError } from '../axi/gateway';
import { runFlect } from '../axi/program';
import type { FlectAgentRole, SandboxedAgentContext } from './sandboxed-shell-service';

export interface FlectCommandOptions {
	readonly role: FlectAgentRole;
	readonly hiddenName: string;
	readonly bus: AgentCommandBusShape | undefined;
	readonly context: () => SandboxedAgentContext | undefined;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly readTree?: (
		directory: string
	) => Promise<ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>>;
}

const workspacePath = (path: string) => {
	const relative = path.startsWith('/workspace/')
		? path.slice('/workspace/'.length)
		: path.startsWith('./')
			? path.slice(2)
			: path;
	const parts = relative.split('/');
	return (path.startsWith('/') && !path.startsWith('/workspace/')) ||
		parts.length === 0 ||
		parts.some((part) => part.length === 0 || part === '.' || part === '..')
		? undefined
		: `/workspace/${parts.join('/')}`;
};

interface ShareCheckpointArguments {
	readonly shareId: string;
	readonly expectedForkCommit: string;
	readonly writes: ReadonlyArray<{
		readonly sharePath: string;
		readonly workspacePath: string;
	}>;
	readonly removals: ReadonlyArray<string>;
	readonly message: string;
}

const parseShareCheckpoint = (
	args: ReadonlyArray<string>
): ShareCheckpointArguments | undefined => {
	const shareId = args[2];
	if (shareId === undefined) return undefined;
	let expectedForkCommit: string | undefined;
	let message: string | undefined;
	const writes: Array<ShareCheckpointArguments['writes'][number]> = [];
	const removals: Array<string> = [];
	for (let index = 3; index < args.length;) {
		const flag = args[index];
		if (flag === '--at' && expectedForkCommit === undefined) {
			expectedForkCommit = args[index + 1];
			if (expectedForkCommit === undefined) return undefined;
			index += 2;
			continue;
		}
		if (flag === '--write') {
			const sharePath = args[index + 1];
			const requestedWorkspacePath = args[index + 2];
			const resolvedWorkspacePath =
				requestedWorkspacePath === undefined ? undefined : workspacePath(requestedWorkspacePath);
			if (sharePath === undefined || resolvedWorkspacePath === undefined) {
				return undefined;
			}
			writes.push({ sharePath, workspacePath: resolvedWorkspacePath });
			index += 3;
			continue;
		}
		if (flag === '--remove') {
			const path = args[index + 1];
			if (path === undefined) return undefined;
			removals.push(path);
			index += 2;
			continue;
		}
		if (flag === '--message' && message === undefined) {
			message = args[index + 1];
			if (message === undefined) return undefined;
			index += 2;
			continue;
		}
		return undefined;
	}
	return expectedForkCommit === undefined ||
		message === undefined ||
		writes.length + removals.length === 0 ||
		writes.length + removals.length > 4_096
		? undefined
		: { shareId, expectedForkCommit, writes, removals, message };
};

const shareCheckpointUsage =
	'usage: flect share checkpoint <share-id> --at <fork-commit> [--write <share-path> <workspace-path>] [--remove <share-path>] --message <text>\n';

interface ShareResolutionArguments {
	readonly shareId: string;
	readonly expectedBaseCommit: string;
	readonly expectedUpstreamCommit: string;
	readonly expectedForkCommit: string;
	readonly writes: ShareCheckpointArguments['writes'];
	readonly removals: ReadonlyArray<string>;
	readonly message: string;
}

const parseShareResolution = (
	args: ReadonlyArray<string>
): ShareResolutionArguments | undefined => {
	const shareId = args[2];
	if (shareId === undefined) return undefined;
	let expectedBaseCommit: string | undefined;
	let expectedUpstreamCommit: string | undefined;
	let expectedForkCommit: string | undefined;
	let message: string | undefined;
	const writes: Array<ShareCheckpointArguments['writes'][number]> = [];
	const removals: Array<string> = [];
	for (let index = 3; index < args.length;) {
		const flag = args[index];
		const value = args[index + 1];
		if (flag === '--base' && expectedBaseCommit === undefined) {
			if (value === undefined) return undefined;
			expectedBaseCommit = value;
			index += 2;
			continue;
		}
		if (flag === '--upstream' && expectedUpstreamCommit === undefined) {
			if (value === undefined) return undefined;
			expectedUpstreamCommit = value;
			index += 2;
			continue;
		}
		if (flag === '--fork' && expectedForkCommit === undefined) {
			if (value === undefined) return undefined;
			expectedForkCommit = value;
			index += 2;
			continue;
		}
		if (flag === '--write') {
			const requestedWorkspacePath = args[index + 2];
			const resolvedWorkspacePath =
				requestedWorkspacePath === undefined ? undefined : workspacePath(requestedWorkspacePath);
			if (value === undefined || resolvedWorkspacePath === undefined) return undefined;
			writes.push({ sharePath: value, workspacePath: resolvedWorkspacePath });
			index += 3;
			continue;
		}
		if (flag === '--remove') {
			if (value === undefined) return undefined;
			removals.push(value);
			index += 2;
			continue;
		}
		if (flag === '--message' && message === undefined) {
			if (value === undefined) return undefined;
			message = value;
			index += 2;
			continue;
		}
		return undefined;
	}
	return expectedBaseCommit === undefined ||
		expectedUpstreamCommit === undefined ||
		expectedForkCommit === undefined ||
		message === undefined ||
		writes.length + removals.length === 0 ||
		writes.length + removals.length > 100
		? undefined
		: {
				shareId,
				expectedBaseCommit,
				expectedUpstreamCommit,
				expectedForkCommit,
				writes,
				removals,
				message
			};
};

const shareResolutionUsage =
	'usage: flect share resolve <share-id> --base <commit> --upstream <commit> --fork <commit> [--write <share-path> <workspace-path>] [--remove <share-path>] --message <text>\n';

export const makeFlectCommand = (options: FlectCommandOptions) =>
	defineCommand(options.hiddenName, async (args, commandContext) => {
		const context = options.context();
		if (context === undefined || options.bus === undefined) {
			return {
				stdout: '',
				stderr: 'flect: authenticated agent context unavailable\n',
				exitCode: 1
			};
		}
		const source = AgentCommandSource.make({
			kind: 'agent',
			role: options.role,
			sessionId: context.sessionId,
			parentOperationId: context.parentOperationId,
			requestId: context.requestId,
			...(context.binding === undefined ? {} : { binding: context.binding })
		});
		if (args[0] === 'share' && args[1] === 'resolve') {
			if (options.role !== 'shaper') {
				return {
					stdout: '',
					stderr: 'flect: Only Shaper can resolve a shared conflict\n',
					exitCode: 126
				};
			}
			const parsed = parseShareResolution(args);
			if (parsed === undefined) {
				return { stdout: '', stderr: shareResolutionUsage, exitCode: 2 };
			}
			try {
				const files = await Effect.runPromise(
					Effect.forEach(
						parsed.writes,
						(write) =>
							Effect.tryPromise({
								try: async () => ({
									path: write.sharePath,
									contents: await options.readFile(write.workspacePath)
								}),
								catch: () => new Error('Shared file could not be read.')
							}),
						{ concurrency: 'unbounded' }
					),
					{ signal: commandContext.signal }
				);
				const command = await Effect.runPromise(
					Schema.decodeUnknownEffect(ResolveShareConflict)({
						type: 'resolve-share-conflict',
						shareId: parsed.shareId,
						expectedBaseCommit: parsed.expectedBaseCommit,
						expectedUpstreamCommit: parsed.expectedUpstreamCommit,
						expectedForkCommit: parsed.expectedForkCommit,
						files,
						removals: parsed.removals,
						message: parsed.message
					}),
					{ signal: commandContext.signal }
				);
				await Effect.runPromise(options.bus.submit(source, { type: 'command', command }), {
					signal: commandContext.signal
				});
				return {
					stdout: 'status: resolution submitted\n',
					stderr: '',
					exitCode: 0
				};
			} catch {
				return {
					stdout: '',
					stderr: commandContext.signal?.aborted
						? 'flect: command cancelled\n'
						: 'flect: shared conflict resolution failed safely\n',
					exitCode: 1
				};
			}
		}
		if (args[0] === 'share' && args[1] === 'checkpoint') {
			if (options.role !== 'shaper') {
				return {
					stdout: '',
					stderr: 'flect: Only Shaper can edit a retained fork\n',
					exitCode: 126
				};
			}
			const parsed = parseShareCheckpoint(args);
			if (parsed === undefined) {
				return { stdout: '', stderr: shareCheckpointUsage, exitCode: 2 };
			}
			try {
				const files = await Effect.runPromise(
					Effect.forEach(
						parsed.writes,
						(write) =>
							Effect.tryPromise({
								try: async () => ({
									path: write.sharePath,
									contents: await options.readFile(write.workspacePath)
								}),
								catch: () => new Error('Shared file could not be read.')
							}),
						{ concurrency: 'unbounded' }
					),
					{ signal: commandContext.signal }
				);
				const command = await Effect.runPromise(
					Schema.decodeUnknownEffect(CheckpointShareFork)({
						type: 'checkpoint-share-fork',
						shareId: parsed.shareId,
						expectedForkCommit: parsed.expectedForkCommit,
						files,
						removals: parsed.removals,
						message: parsed.message
					}),
					{ signal: commandContext.signal }
				);
				await Effect.runPromise(options.bus.submit(source, { type: 'command', command }), {
					signal: commandContext.signal
				});
				return {
					stdout: 'status: checkpoint submitted\n',
					stderr: '',
					exitCode: 0
				};
			} catch {
				return {
					stdout: '',
					stderr: commandContext.signal?.aborted
						? 'flect: command cancelled\n'
						: 'flect: shared fork checkpoint failed safely\n',
					exitCode: 1
				};
			}
		}
		if (args[0] === 'capsule') {
			if (options.role !== 'shaper') {
				return {
					stdout: '',
					stderr: 'flect: App Agent cannot import capsules\n',
					exitCode: 126
				};
			}
			const resolved =
				args.length === 3 && args[1] === 'import' ? workspacePath(args[2] ?? '') : undefined;
			if (resolved === undefined) {
				return {
					stdout: '',
					stderr: 'usage: flect capsule import <workspace-path>\n',
					exitCode: 2
				};
			}
			try {
				const archive = await options.readFile(resolved);
				await Effect.runPromise(
					options.bus.submit(source, {
						type: 'command',
						command: ImportCapsule.make({ type: 'import-capsule', archive })
					}),
					{ signal: commandContext.signal }
				);
				return { stdout: 'status: proposed\n', stderr: '', exitCode: 0 };
			} catch {
				return {
					stdout: '',
					stderr: commandContext.signal?.aborted
						? 'flect: command cancelled\n'
						: 'flect: capsule import failed safely\n',
					exitCode: 1
				};
			}
		}
		const bus = Layer.succeed(AgentCommandBus)(options.bus);
		const readInterface = (path: string) => {
			const resolved = workspacePath(path);
			if (resolved === undefined) {
				return Effect.fail(
					FlectGatewayError.make({
						reason: 'unauthorized',
						message: 'The interface path must stay inside /workspace.'
					})
				);
			}
			return Effect.tryPromise({
				try: async () => {
					const bytes = await options.readFile(resolved);
					const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
					return parsed;
				},
				catch: () =>
					FlectGatewayError.make({
						reason: 'invalid-response',
						message: 'The interface file is not valid JSON.'
					})
			});
		};
		const readAppSource = (directory: string) => {
			const resolved = workspacePath(directory);
			if (resolved === undefined || options.readTree === undefined) {
				return Effect.fail(
					FlectGatewayError.make({
						reason: 'unauthorized',
						message: 'The app source directory must stay inside /workspace.'
					})
				);
			}
			return Effect.tryPromise({
				try: async () => {
					const files = await options.readTree?.(resolved);
					return files ?? [];
				},
				catch: () =>
					FlectGatewayError.make({
						reason: 'invalid-response',
						message: 'The app source directory could not be read.'
					})
			});
		};
		const gateway = makeAgentFlectCommandGatewayLayer(source, readInterface, readAppSource).pipe(
			Layer.provide(bus)
		);
		try {
			const result = await Effect.runPromise(runFlect(args).pipe(Effect.provide(gateway)), {
				signal: commandContext.signal
			});
			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode
			};
		} catch {
			return {
				stdout: '',
				stderr: commandContext.signal?.aborted
					? 'flect: command cancelled\n'
					: 'flect: embedded command failed safely\n',
				exitCode: 1
			};
		}
	});
