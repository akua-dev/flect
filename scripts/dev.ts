import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';

/**
 * Local dev orchestrator.
 *
 * Astro v7's `astro dev` daemonizes itself whenever stdout is not an
 * interactive TTY (true for every non-interactive shell, CI runner, and
 * agent harness): it starts a detached background dev server, prints its
 * status, and the launching process exits 0 almost immediately. A naive
 * `concurrently --kill-others "bun run dev:server" "bun run dev:web"` reads
 * that immediate exit as a crash and kills the sibling Pi runtime with it,
 * so the whole `dev` script fails even though Astro started fine.
 *
 * This script embraces that behavior instead of fighting it: it always
 * starts Astro explicitly backgrounded (`astro dev --background`), then runs
 * the Pi runtime (`bun --watch server/index.ts`) in the foreground as the one
 * process the developer watches and Ctrl-C's. Astro's own startup output
 * (ready URL, or "already running" if a previous session left one up)
 * streams into this terminal; its ongoing dev-server logs live in Astro's
 * own log file, reachable with `astro dev logs --follow` while this script
 * is running. On exit - clean Ctrl-C, a runtime crash, or a failed Astro
 * start - it always calls `astro dev stop` so no background dev server is
 * left orphaned. `bun run dev:stop` runs the same stop step by hand if a
 * session ever ends uncleanly (e.g. `kill -9`).
 */

const astroEnv = { env: { ASTRO_TELEMETRY_DISABLED: '1' }, extendEnv: true } as const;

const streamPrefixed = (prefix: string, stream: Stream.Stream<Uint8Array, unknown>) =>
	stream.pipe(
		Stream.decodeText(),
		Stream.splitLines,
		Stream.runForEach((line) => Effect.sync(() => console.log(`[${prefix}] ${line}`)))
	);

const runToCompletion = Effect.fn('Dev.runToCompletion')(function* (
	label: string,
	command: ChildProcess.Command
) {
	const handle = yield* command;
	const [, , exitCode] = yield* Effect.all(
		[streamPrefixed(label, handle.stdout), streamPrefixed(label, handle.stderr), handle.exitCode],
		{ concurrency: 'unbounded' }
	);
	return exitCode;
});

const runToSuccess = Effect.fn('Dev.runToSuccess')(function* (
	label: string,
	command: ChildProcess.Command
) {
	const exitCode = yield* Effect.scoped(runToCompletion(label, command));
	if (exitCode !== 0) {
		return yield* Effect.fail(new Error(`${label} exited with code ${exitCode}`));
	}
});

const startAstroBackground = Effect.fn('Dev.startAstro')(function* () {
	yield* runToSuccess(
		'astro',
		ChildProcess.make('astro', ['dev', '--background', '--host', '127.0.0.1'], astroEnv)
	);
	console.log(
		'[astro] dev server started in the background - logs above, `astro dev stop` on exit'
	);
});

const stopAstroBackground = Effect.ignore(
	runToSuccess('astro', ChildProcess.make('astro', ['dev', 'stop']))
);

// A shutdown signal (Ctrl-C, or this script's own scope teardown) reaches the
// runtime child as SIGINT/SIGTERM, which Bun reports as exit code 130/143.
// That is a clean stop, not a crash - only other nonzero codes are failures.
const terminationSignalExitCodes: ReadonlySet<number> = new Set([130, 143]);

const runRuntimeForeground = Effect.fn('Dev.runRuntime')(function* () {
	const exitCode = yield* Effect.scoped(
		runToCompletion('runtime', ChildProcess.make('bun', ['--watch', 'server/index.ts']))
	);
	if (exitCode !== 0 && !terminationSignalExitCodes.has(exitCode)) {
		return yield* Effect.fail(new Error(`runtime exited with code ${exitCode}`));
	}
});

const dev = Effect.scoped(
	Effect.gen(function* () {
		yield* Effect.acquireRelease(startAstroBackground(), () => stopAstroBackground);
		yield* runRuntimeForeground();
	})
);

const childProcessLayer = BunChildProcessSpawner.layer.pipe(
	Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
);

if (import.meta.main) {
	BunRuntime.runMain(dev.pipe(Effect.provide(childProcessLayer)));
}
