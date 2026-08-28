import { type Fetcher, install, RegistryClient } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { Context, Effect, Layer, Schema } from 'effect';
import {
	BrowserExecutionFailed,
	type PackageMirrorRequest,
	PackageMirrorResult
} from '../../shared/browser-execution';

const PACKAGE_DEADLINE = '10 seconds';
const REGISTRY_BASE_URL = 'https://registry.flect.invalid';

export interface RiftyPackageMirrorShape {
	readonly install: (
		request: PackageMirrorRequest
	) => Effect.Effect<PackageMirrorResult, BrowserExecutionFailed>;
}

export class RiftyPackageMirror extends Context.Service<
	RiftyPackageMirror,
	RiftyPackageMirrorShape
>()('flect/RiftyPackageMirror') {}

const packageFailure = () =>
	BrowserExecutionFailed.make({
		reason: 'package',
		operation: 'package-mirror',
		message: 'Browser package installation failed safely.'
	});

const LockfileDocument = Schema.Struct({
	lockfileVersion: Schema.Literal(3)
});

const installIntoDisposableVfs = (request: PackageMirrorRequest, fetch: Fetcher) =>
	Effect.scoped(
		Effect.acquireRelease(
			Effect.sync(() => new AbortController()),
			(controller) => Effect.sync(() => controller.abort())
		).pipe(
			Effect.flatMap((controller) =>
				Effect.tryPromise({
					try: async () => {
						const vfs = new MemoryVfs();
						await vfs.mkdir('/workspace', { recursive: true });
						await vfs.writeFile(
							'/workspace/package.json',
							`${JSON.stringify(
								{
									name: request.name,
									version: request.packageVersion,
									private: true,
									dependencies: { ...request.dependencies }
								},
								null,
								2
							)}\n`
						);

						const registry = new RegistryClient({
							baseUrl: REGISTRY_BASE_URL,
							fetch: (url, init) => fetch(url, { ...init, signal: controller.signal }),
							maxRetries: 0
						});
						const installed = await install({
							vfs,
							cwd: '/workspace',
							registry
						});

						const dependencyManifests = await Effect.runPromise(
							Effect.forEach(
								Object.keys(request.dependencies),
								(name) =>
									Effect.promise(() => vfs.exists(`/workspace/node_modules/${name}/package.json`)),
								{ concurrency: 'unbounded' }
							)
						);
						if (
							dependencyManifests.some((exists) => !exists) ||
							(await vfs.exists('/workspace/bun.lock'))
						) {
							throw new Error('The disposable package layout is invalid.');
						}

						const lockfileDocument: unknown = JSON.parse(
							await vfs.readFileText('/workspace/package-lock.json')
						);
						const lockfile = await Schema.decodeUnknownPromise(LockfileDocument)(lockfileDocument);

						return Schema.decodeUnknownPromise(PackageMirrorResult)({
							version: 1,
							packageCount: installed.packages.length,
							lockfileWritten: lockfile.lockfileVersion === 3
						});
					},
					catch: packageFailure
				})
			),
			Effect.timeoutOrElse({
				duration: PACKAGE_DEADLINE,
				orElse: () => Effect.fail(packageFailure())
			})
		)
	);

export const makeRiftyPackageMirrorLayer = (options: { readonly fetch: Fetcher }) =>
	Layer.succeed(RiftyPackageMirror)({
		install: Effect.fn('RiftyPackageMirror.install')((request) =>
			installIntoDisposableVfs(request, options.fetch)
		)
	});
