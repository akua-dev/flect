import { glob as globFiles, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect } from 'effect';

const repository = fileURLToPath(new URL('..', import.meta.url));
// Portable node:fs glob rather than Bun.Glob (was Bun.Glob(...).scan(...) --
// same pattern, same matched files, verified identical on this repo: 428
// paths either way) -- see the WORKAROUND comment on //:check_effect_concurrency
// in BUILD.bazel for why: this module needs to load correctly under both
// bun's native `bun run *.ts` execution AND Vitest's Node worker pool, and
// `Bun.*` globals are undefined in the latter.
const SOURCE_GLOB = '{cli,packages,scripts,server,src,tests}/**/*.{ts,tsx}';
const forbiddenCall = ['Promise', 'all'].join('.');
const forbiddenPromiseWrapper = /new\s+Promise\s*(?:<|\()/u;
const forbiddenPromiseTail =
	/\b(?:let|var)\s+[A-Za-z0-9_]*(?:pending|tail)[A-Za-z0-9_]*\s*(?::\s*Promise\b|=\s*Promise\.(?:resolve|reject)\b)/iu;
const isTestOnlySource = (path: string) =>
	path.startsWith('tests/') ||
	path.includes('.test.') ||
	path.includes('.spec.') ||
	path.includes('/__tests__/');

const listSourceFiles = Effect.tryPromise({
	try: async () => {
		const paths: Array<string> = [];
		// node:fs's glob follows symlinks into workspace-linked node_modules
		// (e.g. packages/product/node_modules/effect -> the real hoisted
		// store) where Bun.Glob's scan did not; exclude explicitly so this
		// keeps checking only flect's own source, matching the prior
		// Bun.Glob-based behavior (verified identical file count -- 428 --
		// on this repo with node_modules excluded either way).
		for await (const path of globFiles(SOURCE_GLOB, {
			cwd: repository,
			exclude: (candidate: string) => candidate.includes('node_modules')
		})) {
			paths.push(path);
		}
		return paths.sort();
	},
	catch: () => new Error('Flect source files could not be enumerated.')
});

export const verifyEffectConcurrency = Effect.gen(function* () {
	const paths = yield* listSourceFiles;
	const inspections = yield* Effect.forEach(
		paths,
		(path) =>
			Effect.tryPromise({
				try: async () => {
					const source = await readFile(`${repository}/${path}`, 'utf8');
					return {
						path,
						nativeFanOut: source.includes(forbiddenCall),
						adHocPromiseWrapper: !isTestOnlySource(path) && forbiddenPromiseWrapper.test(source),
						nativePromiseTail: !isTestOnlySource(path) && forbiddenPromiseTail.test(source)
					};
				},
				catch: () => new Error(`Flect source could not be read: ${path}`)
			}),
		{ concurrency: 16 }
	);
	const pathsWithNativeFanOut = inspections
		.filter((inspection) => inspection.nativeFanOut)
		.map((inspection) => inspection.path);
	const pathsWithAdHocPromiseWrappers = inspections
		.filter((inspection) => inspection.adHocPromiseWrapper)
		.map((inspection) => inspection.path);
	const pathsWithNativePromiseTails = inspections
		.filter((inspection) => inspection.nativePromiseTail)
		.map((inspection) => inspection.path);
	const violations = [
		...(pathsWithNativeFanOut.length === 0
			? []
			: [`native promise fan-out: ${pathsWithNativeFanOut.join(', ')}`]),
		...(pathsWithAdHocPromiseWrappers.length === 0
			? []
			: [`ad hoc promise wrappers outside tests: ${pathsWithAdHocPromiseWrappers.join(', ')}`]),
		...(pathsWithNativePromiseTails.length === 0
			? []
			: [
					`native promise serialization tails outside tests: ${pathsWithNativePromiseTails.join(', ')}`
				])
	];
	if (violations.length > 0) {
		return yield* Effect.fail(
			new Error(
				`Use Effect concurrency and callback combinators instead of ${violations.join('; ')}`
			)
		);
	}
});

if (import.meta.main) {
	BunRuntime.runMain(verifyEffectConcurrency);
}
