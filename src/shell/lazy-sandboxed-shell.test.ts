import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { BunCommandResult } from '../../shared/bun-command';
import { AgentCommandBus, type AgentCommandBusShape } from '../axi/agent-command-bus';
import { GitWorkspace, type GitWorkspaceShape } from '../git/git-workspace';
import { makeLazyRoleSandboxedShellLayer } from './lazy-sandboxed-shell';
import { SandboxedShell, type SandboxedShellShape } from './sandboxed-shell-service';

describe('LazyRoleSandboxedShellLive', () => {
	it('loads one scoped shell only when an agent requests a command', async () => {
		const execute = vi.fn<SandboxedShellShape['execute']>(() =>
			Effect.succeed(
				BunCommandResult.make({
					version: 1,
					exitCode: 0,
					stdout: 'ready\n',
					stderr: ''
				})
			)
		);
		const dispose = vi.fn(() => Promise.resolve());
		const load = vi.fn(() =>
			Promise.resolve({
				service: {
					execute,
					replaceTree: () => Effect.void,
					stop: () => Effect.void
				} satisfies SandboxedShellShape,
				dispose
			})
		);
		const dependencies = Layer.merge(
			Layer.succeed(AgentCommandBus)({} as AgentCommandBusShape),
			Layer.succeed(GitWorkspace)({} as GitWorkspaceShape)
		);
		const layer = makeLazyRoleSandboxedShellLayer({ load }).pipe(Layer.provide(dependencies));

		await Effect.runPromise(
			Effect.gen(function* () {
				const shell = yield* SandboxedShell;
				expect(load).not.toHaveBeenCalled();
				yield* shell.execute('shaper', 'echo ready');
				yield* shell.execute('shaper', 'echo again');
				expect(load).toHaveBeenCalledOnce();
			}).pipe(Effect.provide(layer))
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(dispose).toHaveBeenCalledOnce();
	});
});
