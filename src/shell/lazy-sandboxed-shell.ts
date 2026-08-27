import { Effect, Layer } from 'effect';
import { BunCommandFailed } from '../../shared/bun-command';
import { AgentCommandBus } from '../axi/agent-command-bus';
import { GitWorkspace } from '../git/git-workspace';
import { SandboxedShell, type SandboxedShellShape } from './sandboxed-shell-service';

type LiveSandboxedShellHandle = {
	readonly service: SandboxedShellShape;
	readonly dispose: () => Promise<void>;
};

type LiveSandboxedShellLoader = (input: {
	readonly bus: typeof AgentCommandBus.Service;
	readonly git: typeof GitWorkspace.Service;
}) => Promise<LiveSandboxedShellHandle>;

const unavailable = () =>
	BunCommandFailed.make({
		reason: 'execution',
		message: 'The on-demand sandboxed shell could not start safely.'
	});

export const makeLazyRoleSandboxedShellLayer = (options?: {
	readonly load?: LiveSandboxedShellLoader;
}) =>
	Layer.effect(
		SandboxedShell,
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const git = yield* GitWorkspace;
			let handle: Promise<LiveSandboxedShellHandle> | undefined;
			const load = () => {
				handle ??=
					options?.load?.({ bus, git }) ??
					import('./live-sandboxed-shell-runtime').then((module) =>
						module.makeLiveSandboxedShell({ bus, git })
					);
				return handle;
			};
			const service = Effect.tryPromise({ try: load, catch: unavailable }).pipe(
				Effect.map((loaded) => loaded.service)
			);
			yield* Effect.addFinalizer(() => {
				const current = handle;
				return current === undefined
					? Effect.void
					: Effect.promise(() => current.then((loaded) => loaded.dispose()).catch(() => undefined));
			});
			return {
				replaceTree: (workspace, root, files) =>
					service.pipe(Effect.flatMap((shell) => shell.replaceTree(workspace, root, files))),
				execute: (workspace, line, options) =>
					service.pipe(Effect.flatMap((shell) => shell.execute(workspace, line, options))),
				stop: (workspace) => service.pipe(Effect.flatMap((shell) => shell.stop(workspace)))
			} satisfies SandboxedShellShape;
		})
	);

export const LazyRoleSandboxedShellLive = makeLazyRoleSandboxedShellLayer();
