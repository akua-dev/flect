import { Effect, Schema, type SchemaAST } from 'effect';

export const MAX_SHARE_ARCHIVE_BYTES = 64 * 1024 * 1024;
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const Text = (maximum: number) =>
	Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum));
const Identifier = Schema.String.check(
	Schema.isMinLength(3),
	Schema.isMaxLength(120),
	Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
);
const AdapterIdentifier = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)
);
const SemanticVersion = Schema.String.check(
	Schema.isMaxLength(40),
	Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
);
const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const PortablePath = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(100),
	Schema.isPattern(
		/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
	)
);
const HttpsUrl = Schema.String.check(
	Schema.isMaxLength(2_048),
	Schema.isPattern(/^https:\/\/(?![^/]*@)[^\s#]+$/)
);
const Platform = Schema.Literals(['browser', 'macos', 'windows', 'linux']);
const encoder = new TextEncoder();

export class ShareEmbeddedRepository extends Schema.TaggedClass<ShareEmbeddedRepository>()(
	'embedded',
	{
		archivePath: Schema.Literal('repository.tar'),
		sha256: Hash,
		commit: ObjectId
	}
) {}

export class ShareGitRepository extends Schema.TaggedClass<ShareGitRepository>()('git', {
	commit: ObjectId
}) {}

export const ShareRepositoryReceipt = Schema.Union([ShareEmbeddedRepository, ShareGitRepository]);
export type ShareRepositoryReceipt = typeof ShareRepositoryReceipt.Type;

export const ShareArtifactKind = Schema.Literals([
	'experience',
	'component',
	'theme',
	'workflow',
	'extension'
]);
export type ShareArtifactKind = typeof ShareArtifactKind.Type;

export class ShareArtifactDescriptor extends Schema.Class<ShareArtifactDescriptor>(
	'ShareArtifactDescriptor'
)({
	id: Identifier,
	kind: ShareArtifactKind,
	version: SemanticVersion,
	sourceRoot: PortablePath,
	contentSha256: Hash,
	capsule: Schema.optionalKey(
		Schema.Struct({
			path: PortablePath,
			sha256: Hash
		})
	)
}) {}

export class ShareMigration extends Schema.Class<ShareMigration>('ShareMigration')({
	fromVersion: SemanticVersion,
	toVersion: SemanticVersion,
	artifactIds: Schema.Array(Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
	instruction: Text(500)
}) {}

export class ShareManifest extends Schema.Class<ShareManifest>('ShareManifest')({
	formatVersion: Schema.Literal(1),
	id: Identifier,
	name: Text(80),
	version: SemanticVersion,
	repository: ShareRepositoryReceipt,
	artifacts: Schema.Array(ShareArtifactDescriptor).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(64)
	),
	compatibility: Schema.Struct({
		flect: Text(80),
		platforms: Schema.Array(Platform).check(Schema.isMinLength(1), Schema.isMaxLength(4))
	}),
	provenance: Schema.Struct({
		publisher: Text(120),
		source: Text(500),
		revision: Text(128),
		builder: Text(120)
	}),
	signatures: Schema.Array(
		Schema.Struct({
			algorithm: Schema.Literal('ed25519'),
			keyId: Text(200),
			signature: Text(512)
		})
	).check(Schema.isMaxLength(16)),
	migrations: Schema.Array(ShareMigration).check(Schema.isMaxLength(64))
}) {}

export class ShareContractFailure extends Schema.TaggedErrorClass<ShareContractFailure>()(
	'ShareContractFailure',
	{ message: Schema.String }
) {}

const contractFailure = () =>
	ShareContractFailure.make({
		message: 'The shared artifact contract is invalid.'
	});

const expectedRoot = (kind: ShareArtifactKind) =>
	kind === 'experience'
		? 'experiences/'
		: kind === 'component'
			? 'components/'
			: kind === 'theme'
				? 'themes/'
				: kind === 'workflow'
					? 'workflows/'
					: 'extensions/';

export const validateShareManifest = Effect.fn('Flect.Share.validateManifest')(function* (
	input: unknown
) {
	const manifest = yield* Schema.decodeUnknownEffect(
		ShareManifest,
		strict
	)(input).pipe(Effect.mapError(contractFailure));
	const artifactIds = new Set<string>();
	const sourceRoots = new Set<string>();
	const capsulePaths = new Set<string>();
	for (const artifact of manifest.artifacts) {
		const capsuleRequired = artifact.kind === 'experience' || artifact.kind === 'extension';
		const capsuleValid =
			artifact.capsule === undefined
				? !capsuleRequired
				: capsuleRequired &&
					artifact.capsule.path.startsWith('artifacts/') &&
					artifact.capsule.path.endsWith('.flect') &&
					!capsulePaths.has(artifact.capsule.path);
		if (
			artifactIds.has(artifact.id) ||
			sourceRoots.has(artifact.sourceRoot) ||
			!artifact.sourceRoot.startsWith(expectedRoot(artifact.kind)) ||
			!capsuleValid
		) {
			return yield* Effect.fail(contractFailure());
		}
		artifactIds.add(artifact.id);
		sourceRoots.add(artifact.sourceRoot);
		if (artifact.capsule !== undefined) {
			capsulePaths.add(artifact.capsule.path);
		}
	}
	const migrationEdges = new Set<string>();
	for (const migration of manifest.migrations) {
		const edge = `${migration.fromVersion}->${migration.toVersion}`;
		if (
			migration.fromVersion === migration.toVersion ||
			migrationEdges.has(edge) ||
			new Set(migration.artifactIds).size !== migration.artifactIds.length ||
			migration.artifactIds.some((artifactId) => !artifactIds.has(artifactId))
		) {
			return yield* Effect.fail(contractFailure());
		}
		migrationEdges.add(edge);
	}
	return manifest;
});

const digestBytes = (contents: Uint8Array) =>
	Effect.tryPromise({
		try: async () => {
			const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(contents));
			return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
				''
			);
		},
		catch: contractFailure
	});

export const hashShareArtifactSource = Effect.fn('Flect.Share.hashArtifactSource')(function* (
	sourceRoot: string,
	files: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>
) {
	const root = yield* Schema.decodeUnknownEffect(
		PortablePath,
		strict
	)(sourceRoot).pipe(Effect.mapError(contractFailure));
	if (files.length === 0 || files.length > 4_096) {
		return yield* Effect.fail(contractFailure());
	}
	const paths = new Set<string>();
	let totalBytes = 0;
	const normalized = [];
	for (const file of files.toSorted((left, right) => left.path.localeCompare(right.path))) {
		const path = yield* Schema.decodeUnknownEffect(
			PortablePath,
			strict
		)(file.path).pipe(Effect.mapError(contractFailure));
		if (
			!path.startsWith(`${root}/`) ||
			paths.has(path) ||
			!Schema.is(Schema.Uint8Array)(file.contents) ||
			file.contents.byteLength > 8 * 1024 * 1024
		) {
			return yield* Effect.fail(contractFailure());
		}
		paths.add(path);
		totalBytes += file.contents.byteLength;
		if (totalBytes > 32 * 1024 * 1024) {
			return yield* Effect.fail(contractFailure());
		}
		normalized.push({
			path: path.slice(root.length + 1),
			bytes: file.contents.byteLength,
			sha256: yield* digestBytes(file.contents)
		});
	}
	return yield* digestBytes(
		encoder.encode(JSON.stringify({ formatVersion: 1, sourceRoot: root, files: normalized }))
	);
});

export class ShareLocalSource extends Schema.TaggedClass<ShareLocalSource>()('local', {
	name: Schema.String.check(
		Schema.isMinLength(1),
		Schema.isMaxLength(240),
		Schema.isPattern(/^[^/\\\0]+\.flect-share$/)
	),
	bytes: Schema.Uint8Array
}) {}

export class ShareUrlSource extends Schema.TaggedClass<ShareUrlSource>()('url', {
	url: HttpsUrl
}) {}

export class ShareGitSource extends Schema.TaggedClass<ShareGitSource>()('git', {
	url: HttpsUrl,
	commit: ObjectId
}) {}

export class SharePrivateSource extends Schema.TaggedClass<SharePrivateSource>()('private', {
	adapterId: AdapterIdentifier,
	reference: Text(500)
}) {}

export const ShareSource = Schema.Union([
	ShareLocalSource,
	ShareUrlSource,
	ShareGitSource,
	SharePrivateSource
]);
export type ShareSource = typeof ShareSource.Type;
