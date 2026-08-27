import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { BunCommandResult } from '../../shared/bun-command';
import { AgentCommandBus } from '../axi/agent-command-bus';
import { GitWorkspace } from '../git/git-workspace';
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
		// Neither dependency's methods are exercised by this test (it only asserts
		// that `load` stays uncalled until a command runs, then runs against the
		// lazily-loaded shell above). AgentCommandBusShape/GitWorkspaceShape are
		// each 3-17 methods wide, so Object.create(null) stands in for an unused
		// service without an `as` assertion or a large, unmaintained mock.
		const dependencies = Layer.merge(
			Layer.succeed(AgentCommandBus)(Object.create(null)),
			Layer.succeed(GitWorkspace)(Object.create(null))
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
