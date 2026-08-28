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

const repository = Effect.fn('PrepareEffect.repository')(function* () {
	const path = yield* Path.Path;
	return path.join(import.meta.dirname, '..');
});

// Detects whether the flect package root sits inside a Bazel monorepo (for
// example, grafted as apps/flect inside cnap) by walking ancestor directories
// above it for a REPO.bazel or MODULE.bazel marker. A standalone flect
// checkout has no such ancestor, so this stays false there.
const findsBazelMonorepoAbove = Effect.fn('PrepareEffect.findsBazelMonorepoAbove')(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	let dir = path.dirname(yield* repository());
	while (true) {
		const hasRepoBazel = yield* fs.exists(path.join(dir, 'REPO.bazel'));
		const hasModuleBazel = yield* fs.exists(path.join(dir, 'MODULE.bazel'));
		if (hasRepoBazel || hasModuleBazel) return true;
		const parent = path.dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
});

// The pinned Effect checkout is a local API reference for standalone flect
// development only. Skip cloning it when either:
//   - flect is nested inside a Bazel monorepo (its `bun install` would
//     materialize the checkout as CI workspace bloat unrelated to this repo), or
//   - CI is truthy (any CI runner, monorepo or standalone).
// Returns the human-readable reason to print, or undefined when the clone
// should proceed as usual.
const skipCloneReason = Effect.fn('PrepareEffect.skipCloneReason')(function* () {
	if (process.env.CI) {
		return 'CI is set';
	}
	if (yield* findsBazelMonorepoAbove()) {
		return 'running inside a Bazel monorepo (found REPO.bazel/MODULE.bazel above the flect package root)';
	}
	return undefined;
});

const runGit = Effect.fn('PrepareEffect.runGit')(function* (args: ReadonlyArray<string>) {
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

const isGitCheckout = Effect.fn('PrepareEffect.isGitCheckout')(function* () {
	const result = yield* runGit(['-C', repoDir, 'rev-parse', '--git-dir']);
	return result.exitCode === 0;
});

const currentEffectCommit = Effect.fn('PrepareEffect.currentCommit')(function* () {
	const result = yield* runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
	return result.exitCode === 0 ? result.stdout : undefined;
});

const verifyCheckout = Effect.fn('PrepareEffect.verifyCheckout')(function* () {
	const actual = yield* currentEffectCommit();
	if (actual !== effectCommit) {
		return yield* Effect.fail(
			new Error(`Effect checkout is ${actual ?? '(missing)'}, expected ${effectCommit}`)
		);
	}
	console.log(`Effect checkout verified at ${effectCommit}`);
});

const checkoutDirectoryExists = Effect.fn('PrepareEffect.checkoutDirectoryExists')(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	return yield* fs.exists(path.join(yield* repository(), repoDir));
});

const ensureCheckout = Effect.fn('PrepareEffect.ensureCheckout')(function* () {
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

const updateToPinnedCommit = Effect.fn('PrepareEffect.updateToPinnedCommit')(function* () {
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
	const skipReason = yield* skipCloneReason();
	if (skipReason !== undefined) {
		console.log(
			`Skipping local Effect checkout at ${repoDir}: ${skipReason}. It is only a local API reference for standalone flect development.`
		);
		return;
	}
	yield* ensureCheckout();
	yield* updateToPinnedCommit();
	yield* verifyCheckout();
});

const checkEffect = Effect.gen(function* () {
	const exists = yield* checkoutDirectoryExists();
	if (exists) {
		yield* verifyCheckout();
		return;
	}
	const skipReason = yield* skipCloneReason();
	if (skipReason !== undefined) {
		console.log(
			`Effect checkout absent at ${repoDir}; skipping verification: ${skipReason}. It is only a local API reference for standalone flect development.`
		);
		return;
	}
	return yield* Effect.fail(
		new Error(`Effect checkout is missing at ${repoDir}; run bun run prepare`)
	);
});

if (import.meta.main) {
	BunRuntime.runMain(
		(process.argv[2] === '--check' ? checkEffect : prepareEffect).pipe(
			Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer))
		)
	);
}
