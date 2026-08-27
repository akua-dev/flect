import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Effect, Schema, type SchemaAST, type Scope } from 'effect';

const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(root, 'packages/product');
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const ProductPackageManifest = Schema.Struct({
	name: Schema.Literal('@flect/product'),
	version: Schema.Literal('0.1.0'),
	description: Schema.String,
	type: Schema.Literal('module'),
	sideEffects: Schema.Literal(false),
	license: Schema.Literal('Apache-2.0'),
	repository: Schema.Struct({
		type: Schema.Literal('git'),
		url: Schema.String,
		directory: Schema.Literal('packages/product')
	}),
	homepage: Schema.String,
	bugs: Schema.String,
	files: Schema.Array(Schema.String),
	main: Schema.Literal('./dist/index.js'),
	types: Schema.Literal('./dist/index.d.ts'),
	exports: Schema.Struct({
		'.': Schema.Unknown,
		'./contracts': Schema.Unknown,
		'./host': Schema.Unknown,
		'./capsule': Schema.Unknown,
		'./capsule-trust': Schema.Unknown
	}),
	scripts: Schema.Struct({ build: Schema.String }),
	peerDependencies: Schema.Struct({
		effect: Schema.Literal('4.0.0-beta.102')
	}),
	devDependencies: Schema.Struct({
		effect: Schema.Literal('4.0.0-beta.102'),
		typescript: Schema.Literal('7.0.2')
	}),
	engines: Schema.Struct({ node: Schema.String })
});

export class ProductSdkPackagingError extends Schema.TaggedErrorClass<ProductSdkPackagingError>()(
	'ProductSdkPackagingError',
	{
		reason: Schema.Literals([
			'build',
			'manifest',
			'pack',
			'archive',
			'consumer-install',
			'consumer-typecheck',
			'consumer-run'
		]),
		message: Schema.Literal('The product SDK could not be packaged safely.')
	}
) {}

const packagingError = (reason: ProductSdkPackagingError['reason']): ProductSdkPackagingError =>
	ProductSdkPackagingError.make({
		reason,
		message: 'The product SDK could not be packaged safely.'
	});

interface CommandResult {
	readonly stdout: string;
	readonly stderr: string;
}

const runCommand = Effect.fn('Flect.ProductSdk.runCommand')(function* (
	command: ReadonlyArray<string>,
	cwd: string,
	reason: ProductSdkPackagingError['reason']
) {
	const executable = command[0];
	if (executable === undefined) {
		return yield* Effect.fail(packagingError(reason));
	}
	const child = yield* Effect.try({
		try: () =>
			spawn(executable, command.slice(1), {
				cwd,
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe']
			}),
		catch: () => packagingError(reason)
	});
	return yield* Effect.callback<CommandResult, ProductSdkPackagingError>((resume) => {
		let stdout = '';
		let stderr = '';
		let completed = false;
		const cleanup = () => {
			child.stdout.off('data', onStdout);
			child.stderr.off('data', onStderr);
			child.off('error', onError);
			child.off('close', onClose);
		};
		const complete = (result: Effect.Effect<CommandResult, ProductSdkPackagingError>) => {
			if (completed) {
				return;
			}
			completed = true;
			cleanup();
			resume(result);
		};
		const onStdout = (chunk: string) => {
			stdout += chunk;
		};
		const onStderr = (chunk: string) => {
			stderr += chunk;
		};
		const onError = () => complete(Effect.fail(packagingError(reason)));
		const onClose = (exitCode: number | null) => {
			complete(
				exitCode === 0 ? Effect.succeed({ stdout, stderr }) : Effect.fail(packagingError(reason))
			);
		};
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', onStdout);
		child.stderr.on('data', onStderr);
		child.once('error', onError);
		child.once('close', onClose);
		return Effect.sync(() => {
			cleanup();
			if (!completed) {
				completed = true;
				try {
					child.kill();
				} catch {
					// The child already exited; interruption still owns cleanup.
				}
			}
		});
	});
});

const makeTempDirectory = (
	prefix: string
): Effect.Effect<string, ProductSdkPackagingError, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.tryPromise({
			try: () => mkdtemp(join(tmpdir(), prefix)),
			catch: () => packagingError('archive')
		}),
		(path) => Effect.promise(() => rm(path, { force: true, recursive: true })).pipe(Effect.orDie)
	);

const readManifest = Effect.fn('Flect.ProductSdk.readManifest')(function* () {
	const source = yield* Effect.tryPromise({
		try: () => readFile(resolve(packageRoot, 'package.json'), 'utf8'),
		catch: () => packagingError('manifest')
	});
	const input = yield* Effect.try({
		try: (): unknown => JSON.parse(source),
		catch: () => packagingError('manifest')
	});
	return yield* Schema.decodeUnknownEffect(
		ProductPackageManifest,
		strict
	)(input).pipe(Effect.mapError(() => packagingError('manifest')));
});

const sha256 = (contents: Uint8Array): string =>
	createHash('sha256').update(contents).digest('hex');

export interface ProductSdkPackageEvidence {
	readonly name: '@flect/product';
	readonly version: '0.1.0';
	readonly tarball: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly files: ReadonlyArray<string>;
	readonly exports: ReadonlyArray<'.' | './contracts' | './host' | './capsule' | './capsule-trust'>;
}

export interface ProductSdkConsumerEvidence {
	readonly typecheck: 'passed';
	readonly output: 'offline-ready';
}

export const packageProductSdk = Effect.fn('Flect.ProductSdk.package')(function* (options?: {
	readonly outputDirectory?: string;
}) {
	const manifest = yield* readManifest();
	yield* Effect.tryPromise({
		try: () => rm(resolve(packageRoot, 'dist'), { force: true, recursive: true }),
		catch: () => packagingError('build')
	});
	yield* runCommand(['bun', 'run', 'build'], packageRoot, 'build');

	const temporaryRoot = yield* makeTempDirectory('flect-product-pack-');
	const staging = resolve(temporaryRoot, 'package');
	const output = options?.outputDirectory ?? resolve(temporaryRoot, 'output');
	yield* Effect.tryPromise({
		try: async () => {
			await mkdir(staging, { recursive: true });
			await mkdir(output, { recursive: true });
			await cp(resolve(packageRoot, 'dist'), resolve(staging, 'dist'), {
				recursive: true
			});
			await cp(resolve(packageRoot, 'README.md'), resolve(staging, 'README.md'));
			await cp(resolve(root, 'LICENSE'), resolve(staging, 'LICENSE'));
			await cp(resolve(packageRoot, 'package.json'), resolve(staging, 'package.json'));
		},
		catch: () => packagingError('archive')
	});

	yield* runCommand(
		['bun', 'pm', 'pack', '--destination', output, '--ignore-scripts'],
		staging,
		'pack'
	);
	const tarballs = (yield* Effect.tryPromise({
		try: () => readdir(output),
		catch: () => packagingError('archive')
	})).filter((entry) => entry.endsWith('.tgz'));
	if (tarballs.length !== 1 || tarballs[0] === undefined) {
		return yield* Effect.fail(packagingError('archive'));
	}
	const tarball = resolve(output, tarballs[0]);
	const archive = yield* Effect.tryPromise({
		try: () => readFile(tarball),
		catch: () => packagingError('archive')
	});
	const metadata = yield* Effect.tryPromise({
		try: () => stat(tarball),
		catch: () => packagingError('archive')
	});
	const listing = yield* runCommand(['tar', '-tzf', tarball], root, 'archive');
	const files = listing.stdout
		.split('\n')
		.map((entry) => entry.replace(/\/$/, ''))
		.filter((entry) => entry.length > 0);

	return {
		name: manifest.name,
		version: manifest.version,
		tarball,
		sha256: sha256(archive),
		bytes: metadata.size,
		files,
		exports: ['.', './contracts', './host', './capsule', './capsule-trust']
	};
});

export const verifyProductSdkConsumer = Effect.fn('Flect.ProductSdk.verifyConsumer')(function* (
	tarball: string
) {
	const consumer = yield* makeTempDirectory('flect-product-consumer-');
	yield* Effect.tryPromise({
		try: async () => {
			await writeFile(
				resolve(consumer, 'package.json'),
				JSON.stringify({
					name: 'flect-product-clean-consumer',
					private: true,
					type: 'module'
				})
			);
			await writeFile(
				resolve(consumer, 'tsconfig.json'),
				JSON.stringify({
					compilerOptions: {
						target: 'ES2023',
						lib: ['ES2023', 'DOM'],
						module: 'NodeNext',
						moduleResolution: 'NodeNext',
						strict: true,
						skipLibCheck: true,
						noEmit: true
					},
					include: ['index.ts']
				})
			);
			await writeFile(
				resolve(consumer, 'index.ts'),
				[
					'import { Effect } from "effect";',
					'import { AuthorizedProductOperation, defineProductIntegration, encodeCapsule, hashCapsuleArchive, ProductCapabilityManifest } from "@flect/product";',
					'import { verifyCapsuleSignatures } from "@flect/product/capsule-trust";',
					'const program = Effect.gen(function* () {',
					'  const archive = yield* encodeCapsule({ manifest: { formatVersion: 1, id: "dev.example.offline", name: "Offline example", version: "1.0.0", entrypoints: [{ id: "main", path: "ui/index.html" }], capabilities: [{ id: "product.example.status", required: true }], compatibility: { flect: ">=0.2.0 <1.0.0", schemaVersion: 1, platforms: ["browser"] }, provenance: { publisher: "example", source: "https://example.test/flect", revision: "v1", builder: "example" }, signatures: [] }, files: [{ path: "ui/index.html", contents: new TextEncoder().encode("<!doctype html><title>Offline</title>") }] });',
					'  const capability = ProductCapabilityManifest.make({ version: 1, id: "product.example.status", name: "Read status", description: "Read one offline status.", operationIds: ["example.status"], resourceIds: ["example.workspace"], dataClassIds: ["example.status"], confirmationPolicies: ["session"] });',
					'  const operation = { id: "example.status", capabilityId: capability.id, authorize: () => Effect.succeed(AuthorizedProductOperation.make({ version: 1, capabilityId: capability.id, operationId: "example.status", resourceIds: ["example.workspace"], dataClassIds: ["example.status"] })), execute: () => Effect.succeed({ status: "offline-ready" }) };',
					'  const integration = yield* defineProductIntegration({ metadata: { version: 1, descriptor: { version: 1, id: "dev.example.offline", name: "Offline example", description: "Smallest Flect product.", integrationVersion: "1.0.0", revision: "v1", productApiVersion: 1, connection: "offline", authenticationOwner: "none", compatibility: { flect: ">=0.2.0 <1.0.0", platforms: ["browser"] }, inference: { allowedOwners: ["user"], defaultOwner: "user" } }, experience: { version: 1, capsuleId: "dev.example.offline", capsuleVersion: "1.0.0", archiveSha256: yield* hashCapsuleArchive(archive), provenanceRevision: "v1", appExtensionIds: [], shaperExtensionIds: [] }, capabilities: [capability], migrations: [] }, operations: [operation], events: [], selectedInferenceOwner: "user", loadRecommendedExperience: Effect.succeed(archive) });',
					'  yield* verifyCapsuleSignatures(archive, []);',
					'  return yield* integration.operations[0]?.execute({});',
					'});',
					'const output = await Effect.runPromise(program);',
					'console.log(JSON.stringify(output) === \'{"status":"offline-ready"}\' ? "offline-ready" : "invalid");',
					''
				].join('\n')
			);
		},
		catch: () => packagingError('consumer-install')
	});
	yield* runCommand(
		[
			'bun',
			'add',
			'--ignore-scripts',
			'--no-save',
			tarball,
			`file:${resolve(root, 'node_modules/effect')}`
		],
		consumer,
		'consumer-install'
	);
	yield* runCommand(
		[resolve(root, 'node_modules/.bin/tsc'), '-p', 'tsconfig.json'],
		consumer,
		'consumer-typecheck'
	);
	const executed = yield* runCommand(['bun', 'run', 'index.ts'], consumer, 'consumer-run');
	if (executed.stdout.trim() !== 'offline-ready') {
		return yield* Effect.fail(packagingError('consumer-run'));
	}
	return { typecheck: 'passed', output: 'offline-ready' };
});

if (import.meta.main) {
	const outputDirectory = resolve(root, 'dist-product-sdk');
	const result = await Effect.runPromise(
		Effect.scoped(
			packageProductSdk({ outputDirectory }).pipe(
				Effect.tap((evidence) => verifyProductSdkConsumer(evidence.tarball))
			)
		)
	);
	console.log(
		JSON.stringify({
			...result,
			tarball: basename(result.tarball)
		})
	);
}
