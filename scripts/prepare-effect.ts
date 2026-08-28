import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, FileSystem, Layer, Path } from 'effect';

const repoDir = '.repos/effect';
const repoUrl = 'https://github.com/Effect-TS/effect';
const effectCommit = 'cccd029ae0124a33254b4094f1bc9c06cd43324e';

interface CommandResult {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
}

const repository = Effect.fn('Flect.PrepareEffect.repository')(function* () {
	const path = yield* Path.Path;
	return path.join(import.meta.dirname, '..');
});

const runGit = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const cwd = yield* repository();
		const fail = (cause: unknown) => new Error(`git ${args.join(' ')} could not run`, { cause });
		const child = yield* Effect.sync(() =>
			Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
		);
		const [exitCode, stdout, stderr] = yield* Effect.all(
			[
				Effect.tryPromise({ try: () => child.exited, catch: fail }),
				Effect.tryPromise({ try: () => new Response(child.stdout).text(), catch: fail }),
				Effect.tryPromise({ try: () => new Response(child.stderr).text(), catch: fail })
			],
			{ concurrency: 'unbounded' }
		);
		return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() } satisfies CommandResult;
	});

const isGitCheckout = Effect.fn('Flect.PrepareEffect.isGitCheckout')(function* () {
	const result = yield* runGit(['-C', repoDir, 'rev-parse', '--git-dir']);
	return result.exitCode === 0;
});

const currentEffectCommit = Effect.fn('Flect.PrepareEffect.currentCommit')(function* () {
	const result = yield* runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
	return result.exitCode === 0 ? result.stdout : undefined;
});

const verifyCheckout = Effect.fn('Flect.PrepareEffect.verifyCheckout')(function* () {
	const actual = yield* currentEffectCommit();
	if (actual !== effectCommit) {
		return yield* Effect.fail(
			new Error(`Effect checkout is ${actual ?? '(missing)'}, expected ${effectCommit}`)
		);
	}
	console.log(`Effect checkout verified at ${effectCommit}`);
});

const checkoutDirectoryExists = Effect.fn('Flect.PrepareEffect.checkoutDirectoryExists')(
	function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		return yield* fs.exists(path.join(yield* repository(), repoDir));
	}
);

const ensureCheckout = Effect.fn('Flect.PrepareEffect.ensureCheckout')(function* () {
	const exists = yield* checkoutDirectoryExists();
	if (exists) {
		if (!(yield* isGitCheckout())) {
			return yield* Effect.fail(new Error(`${repoDir} exists but is not a Git checkout`));
		}
		return;
	}
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* fs
		.makeDirectory(path.join(yield* repository(), '.repos'), { recursive: true })
		.pipe(Effect.mapError((cause) => new Error('Could not create .repos', { cause })));
	const cloned = yield* runGit(['clone', repoUrl, repoDir]);
	if (cloned.exitCode !== 0) {
		return yield* Effect.fail(new Error(`git clone failed: ${cloned.stderr}`));
	}
});

const updateToPinnedCommit = Effect.fn('Flect.PrepareEffect.updateToPinnedCommit')(function* () {
	const actual = yield* currentEffectCommit();
	if (actual === effectCommit) return;
	const fetched = yield* runGit(['-C', repoDir, 'fetch', '--depth=1', 'origin', effectCommit]);
	if (fetched.exitCode !== 0) {
		return yield* Effect.fail(new Error(`git fetch failed: ${fetched.stderr}`));
	}
	const checkedOut = yield* runGit(['-C', repoDir, 'checkout', '--detach', effectCommit]);
	if (checkedOut.exitCode !== 0) {
		return yield* Effect.fail(new Error(`git checkout failed: ${checkedOut.stderr}`));
	}
});

const prepareEffect = Effect.gen(function* () {
	yield* ensureCheckout();
	yield* updateToPinnedCommit();
	yield* verifyCheckout();
});

const checkEffect = Effect.gen(function* () {
	const exists = yield* checkoutDirectoryExists();
	if (!exists) {
		return yield* Effect.fail(
			new Error(`Effect checkout is missing at ${repoDir}; run bun run prepare`)
		);
	}
	yield* verifyCheckout();
});

if (import.meta.main) {
	BunRuntime.runMain(
		(process.argv[2] === '--check' ? checkEffect : prepareEffect).pipe(
			Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer))
		)
	);
}
