import type { Vfs } from '@riftydev/vfs';
import { Context, Effect, Layer, Schema, type SchemaAST } from 'effect';
import { BrowserBuildArtifact, BrowserBuildOutput } from '../../shared/browser-build';
import { browserPersistentStorage } from '../lib/browser-persistent-vfs';
import { digestBuildBytes, digestBuildEntries } from './browser-build-digest';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_FILES = 256;
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const BuildPath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

class StoredBuildOutput extends Schema.Class<StoredBuildOutput>('StoredBuildOutput')({
	path: BuildPath,
	kind: Schema.Literals(['chunk', 'asset']),
	bytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_FILE_BYTES })),
	digest: Digest
}) {}

class StoredBuildArtifact extends Schema.Class<StoredBuildArtifact>('StoredBuildArtifact')({
	version: Schema.Literal(1),
	buildId: Schema.String,
	sourceRevision: Schema.String,
	dependencyGraphDigest: Schema.optionalKey(Digest),
	inputDigest: Digest,
	artifactDigest: Digest,
	outputs: Schema.Array(StoredBuildOutput).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(MAX_OUTPUT_FILES)
	)
}) {}

class StoredBuildBindings extends Schema.Class<StoredBuildBindings>('StoredBuildBindings')({
	version: Schema.Literal(1),
	lastSuccessful: Digest
}) {}

export class BrowserBuildStoreError extends Schema.TaggedErrorClass<BrowserBuildStoreError>()(
	'BrowserBuildStoreError',
	{ message: Schema.Literal('Browser build storage is unavailable.') }
) {}

export interface BrowserBuildStoreShape {
	readonly load: Effect.Effect<BrowserBuildArtifact | undefined, BrowserBuildStoreError>;
	readonly save: (artifact: BrowserBuildArtifact) => Effect.Effect<void, BrowserBuildStoreError>;
}

export class BrowserBuildStore extends Context.Service<BrowserBuildStore, BrowserBuildStoreShape>()(
	'flect/BrowserBuildStore'
) {}

const failure = () =>
	BrowserBuildStoreError.make({
		message: 'Browser build storage is unavailable.'
	});

const canonicalPath = (path: string) => {
	const parts = path.split('/');
	return (
		path.length > 0 &&
		!path.startsWith('/') &&
		!path.includes('\\') &&
		!path.includes('\0') &&
		parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
	);
};

const validateRoot = (root: string) => {
	if (!/^\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(root)) {
		throw failure();
	}
	return root;
};

const decodeBindings = Schema.decodeUnknownPromise(StoredBuildBindings, strictOptions);
const decodeArtifact = Schema.decodeUnknownPromise(StoredBuildArtifact, strictOptions);

const makeStore = (vfs: Vfs, requestedRoot: string): BrowserBuildStoreShape => {
	const root = validateRoot(requestedRoot);
	const objects = `${root}/objects`;
	const bindings = `${root}/bindings.json`;

	const load = Effect.tryPromise({
		try: async () => {
			if (!(await vfs.exists(bindings))) {
				return undefined;
			}
			const binding = await decodeBindings(JSON.parse(await vfs.readFileText(bindings)));
			const objectRoot = `${objects}/${binding.lastSuccessful}`;
			const manifest = await decodeArtifact(
				JSON.parse(await vfs.readFileText(`${objectRoot}/manifest.json`))
			);
			if (manifest.artifactDigest !== binding.lastSuccessful) {
				throw failure();
			}
			const paths = new Set<string>();
			let totalBytes = 0;
			const outputs: Array<BrowserBuildOutput> = [];
			for (const [index, output] of manifest.outputs.entries()) {
				if (!canonicalPath(output.path) || paths.has(output.path)) {
					throw failure();
				}
				paths.add(output.path);
				const contents = await vfs.readFile(`${objectRoot}/files/${index}.bin`);
				totalBytes += contents.byteLength;
				if (
					contents.byteLength !== output.bytes ||
					totalBytes > MAX_BUILD_BYTES ||
					(await digestBuildBytes(contents)) !== output.digest
				) {
					throw failure();
				}
				outputs.push(
					BrowserBuildOutput.make({
						path: output.path,
						kind: output.kind,
						contents
					})
				);
			}
			if ((await digestBuildEntries(outputs)) !== manifest.artifactDigest) {
				throw failure();
			}
			return BrowserBuildArtifact.make({
				version: 1,
				buildId: manifest.buildId,
				sourceRevision: manifest.sourceRevision,
				...(manifest.dependencyGraphDigest === undefined
					? {}
					: { dependencyGraphDigest: manifest.dependencyGraphDigest }),
				inputDigest: manifest.inputDigest,
				artifactDigest: manifest.artifactDigest,
				outputs
			});
		},
		catch: failure
	});

	const save = (artifact: BrowserBuildArtifact) =>
		Effect.tryPromise({
			try: async () => {
				if (
					artifact.outputs.length === 0 ||
					artifact.outputs.length > MAX_OUTPUT_FILES ||
					(await digestBuildEntries(artifact.outputs)) !== artifact.artifactDigest
				) {
					throw failure();
				}
				const paths = new Set<string>();
				let totalBytes = 0;
				const storedOutputs: Array<StoredBuildOutput> = [];
				for (const output of artifact.outputs) {
					totalBytes += output.contents.byteLength;
					if (
						!canonicalPath(output.path) ||
						paths.has(output.path) ||
						output.contents.byteLength > MAX_FILE_BYTES ||
						totalBytes > MAX_BUILD_BYTES
					) {
						throw failure();
					}
					paths.add(output.path);
					storedOutputs.push(
						StoredBuildOutput.make({
							path: output.path,
							kind: output.kind,
							bytes: output.contents.byteLength,
							digest: await digestBuildBytes(output.contents)
						})
					);
				}
				const objectRoot = `${objects}/${artifact.artifactDigest}`;
				await vfs.mkdir(`${objectRoot}/files`, { recursive: true });
				for (const [index, output] of artifact.outputs.entries()) {
					await vfs.writeFile(`${objectRoot}/files/${index}.bin`, output.contents);
				}
				await vfs.writeFile(
					`${objectRoot}/manifest.json`,
					JSON.stringify(
						StoredBuildArtifact.make({
							version: 1,
							buildId: artifact.buildId,
							sourceRevision: artifact.sourceRevision,
							...(artifact.dependencyGraphDigest === undefined
								? {}
								: { dependencyGraphDigest: artifact.dependencyGraphDigest }),
							inputDigest: artifact.inputDigest,
							artifactDigest: artifact.artifactDigest,
							outputs: storedOutputs
						})
					)
				);
				await vfs.mkdir(root, { recursive: true });
				await vfs.writeFile(
					bindings,
					JSON.stringify(
						StoredBuildBindings.make({
							version: 1,
							lastSuccessful: artifact.artifactDigest
						})
					)
				);
			},
			catch: failure
		});

	return { load, save };
};

export const makeBrowserBuildStoreLayer = (vfs: Vfs, root = '/flect-builds/default') =>
	Layer.succeed(BrowserBuildStore)(makeStore(vfs, root));

export const BrowserBuildStoreLive = Layer.effect(
	BrowserBuildStore,
	Effect.promise(() =>
		browserPersistentStorage().then(({ vfs }) => makeStore(vfs, '/flect-builds/default'))
	)
);
