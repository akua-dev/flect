import { fileURLToPath } from 'node:url';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect } from 'effect';

const repository = fileURLToPath(new URL('..', import.meta.url));
const sourceFiles = new Bun.Glob('{cli,packages,scripts,server,src,tests}/**/*.{ts,tsx}');
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
		for await (const path of sourceFiles.scan({ cwd: repository })) {
			paths.push(path);
		}
		return paths.sort();
	},
	catch: () => new Error('Flect source files could not be enumerated.')
});

const verifyEffectConcurrency = Effect.gen(function* () {
	const paths = yield* listSourceFiles;
	const inspections = yield* Effect.forEach(
		paths,
		(path) =>
			Effect.tryPromise({
				try: async () => {
					const source = await Bun.file(`${repository}/${path}`).text();
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
