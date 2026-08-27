import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Data, Effect } from 'effect';

const binaries = [
	{
		name: 'private Flect runtime',
		entrypoint: resolve('server/sidecar.ts'),
		output: resolve('src-tauri/binaries/flect-runtime-aarch64-apple-darwin')
	}
] as const;

export class SidecarBuildError extends Data.TaggedError('SidecarBuildError')<{
	readonly binary: string;
	readonly logs: ReadonlyArray<unknown>;
}> {}

const buildSidecar = Effect.fn('Flect.BuildSidecar.build')(function* (
	binary: (typeof binaries)[number]
) {
	yield* Effect.promise(() => mkdir(dirname(binary.output), { recursive: true }));
	const result = yield* Effect.promise(() =>
		Bun.build({
			entrypoints: [binary.entrypoint],
			target: 'bun',
			minify: false,
			sourcemap: 'none',
			compile: {
				target: 'bun-darwin-arm64',
				outfile: binary.output,
				autoloadDotenv: false,
				autoloadBunfig: false,
				autoloadTsconfig: false,
				autoloadPackageJson: false
			}
		})
	);
	if (!result.success) {
		return yield* Effect.fail(new SidecarBuildError({ binary: binary.name, logs: result.logs }));
	}
	yield* Effect.log(`Built ${binary.name}: ${binary.output}`);
});

const buildSidecars = Effect.gen(function* () {
	for (const binary of binaries) {
		yield* buildSidecar(binary);
	}
}).pipe(
	Effect.tapError((error) =>
		Effect.sync(() => {
			for (const message of error.logs) console.error(message);
			process.exitCode = 1;
		})
	),
	Effect.catch(() => Effect.void)
);

await Effect.runPromise(buildSidecars);
