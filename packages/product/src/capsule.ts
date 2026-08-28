import { Effect, Schema, type SchemaAST } from 'effect';
import {
	MAX_PORTABLE_EXTENSION_SOURCE_BYTES,
	PortableExtensionPackage,
	validatePortableExtensionPackage
} from './extensions.js';
import { decodePortableTar, encodePortableTar, PORTABLE_TAR_BLOCK_BYTES } from './portable-tar.js';

const MAX_FILES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CAPSULE_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const Path = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(100),
	Schema.isPattern(
		/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
	)
);
const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const SourceRevision = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(128),
	Schema.isPattern(/^[a-zA-Z0-9._:/-]+$/)
);

export class CapsuleFileManifest extends Schema.Class<CapsuleFileManifest>('CapsuleFileManifest')({
	path: Path,
	sha256: Hash,
	bytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_FILE_BYTES }))
}) {}

export class CapsuleManifest extends Schema.Class<CapsuleManifest>('CapsuleManifest')({
	formatVersion: Schema.Literal(1),
	id: Schema.String.check(
		Schema.isMinLength(3),
		Schema.isMaxLength(120),
		Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
	),
	name: Text(80),
	version: Schema.String.check(
		Schema.isMaxLength(40),
		Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
	),
	entrypoints: Schema.Array(Schema.Struct({ id: Text(40), path: Path })).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(16)
	),
	files: Schema.Array(CapsuleFileManifest).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(MAX_FILES)
	),
	capabilities: Schema.Array(Schema.Struct({ id: Text(120), required: Schema.Boolean })).check(
		Schema.isMaxLength(128)
	),
	extensions: Schema.optionalKey(
		Schema.Array(PortableExtensionPackage).check(Schema.isMaxLength(32))
	),
	compatibility: Schema.Struct({
		flect: Text(80),
		schemaVersion: Schema.Literal(1),
		platforms: Schema.Array(Schema.Literals(['browser', 'macos', 'windows', 'linux'])).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(4)
		)
	}),
	provenance: Schema.Struct({
		publisher: Text(120),
		source: Text(500),
		revision: Text(120),
		builder: Text(120)
	}),
	build: Schema.optionalKey(
		Schema.Struct({
			sourceRevision: SourceRevision,
			inputDigest: Hash,
			artifactDigest: Hash,
			dependencyGraphDigest: Schema.optionalKey(Hash)
		})
	),
	lineage: Schema.optionalKey(
		Schema.Struct({
			kind: Schema.Literal('local-fork'),
			parentContentSha256: Hash,
			parentSource: Text(500),
			parentRevision: Text(120)
		})
	),
	signatures: Schema.Array(
		Schema.Struct({
			algorithm: Schema.Literals(['ed25519']),
			keyId: Text(200),
			contentSha256: Schema.optionalKey(Hash),
			signedAt: Schema.optionalKey(
				Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/))
			),
			signature: Text(512)
		})
	).check(Schema.isMaxLength(16))
}) {}

export interface CapsuleSource {
	readonly manifest: Omit<CapsuleManifest, 'files'>;
	readonly files: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>;
}

export interface DecodedCapsule {
	readonly manifest: CapsuleManifest;
	readonly files: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>;
}

export class InvalidCapsule extends Schema.TaggedErrorClass<InvalidCapsule>()('InvalidCapsule', {
	message: Schema.String
}) {}

const invalid = (message = 'The .flect capsule is invalid.') => InvalidCapsule.make({ message });

const sha256 = (contents: Uint8Array) =>
	Effect.tryPromise({
		try: async () => {
			const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(contents).buffer);
			return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
		},
		catch: () => invalid('SHA-256 is unavailable.')
	});

export const hashCapsuleArchive = Effect.fn('Capsule.hashArchive')(
	(archive: Uint8Array): Effect.Effect<string, InvalidCapsule> => sha256(archive)
);

const decodeManifestSchema = Schema.decodeUnknownEffect(CapsuleManifest, strict);

const decodeManifest = Effect.fn('Capsule.decodeManifest')(function* (
	input: unknown
): Effect.fn.Return<CapsuleManifest, Schema.SchemaError | InvalidCapsule> {
	const manifest = yield* decodeManifestSchema(input);
	const extensions = manifest.extensions ?? [];
	if (new Set(extensions.map((extension) => extension.id)).size !== extensions.length)
		return yield* Effect.fail(invalid());
	yield* Effect.forEach(extensions, validatePortableExtensionPackage, {
		discard: true
	}).pipe(Effect.mapError(() => invalid()));
	return manifest;
});

const verifyExtensionPayloads = (
	manifest: CapsuleManifest
): Effect.Effect<void, InvalidCapsule> => {
	const byPath = new Map(manifest.files.map((file) => [file.path, file]));
	const valid = (manifest.extensions ?? []).every((extension) => {
		const bundle = byPath.get(extension.bundle);
		if (
			bundle === undefined ||
			bundle.bytes > MAX_PORTABLE_EXTENSION_SOURCE_BYTES ||
			bundle.sha256 !== extension.provenance.bundleSha256
		)
			return false;
		if (extension.sourceMap === undefined || extension.provenance.sourceMapSha256 === undefined)
			return (
				extension.sourceMap === undefined && extension.provenance.sourceMapSha256 === undefined
			);
		return byPath.get(extension.sourceMap)?.sha256 === extension.provenance.sourceMapSha256;
	});
	return valid
		? Effect.void
		: Effect.fail(invalid('A portable extension payload is missing or invalid.'));
};

export const encodeCapsule = Effect.fn('Capsule.encode')(function* (
	source: CapsuleSource
): Effect.fn.Return<Uint8Array, InvalidCapsule> {
	const paths = new Set<string>();
	let total = 0;
	const sorted = [...source.files].toSorted((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0
	);
	const files = [];
	for (const file of sorted) {
		if (paths.has(file.path) || file.path === 'flect.json') return yield* Effect.fail(invalid());
		paths.add(file.path);
		total += file.contents.byteLength;
		files.push({
			path: file.path,
			sha256: yield* sha256(file.contents),
			bytes: file.contents.byteLength
		});
	}
	if (sorted.length === 0 || sorted.length > MAX_FILES || total > MAX_CAPSULE_BYTES)
		return yield* Effect.fail(invalid());
	const manifest = yield* decodeManifest({ ...source.manifest, files }).pipe(
		Effect.mapError(() => invalid())
	);
	if (manifest.entrypoints.some((entry) => !paths.has(entry.path)))
		return yield* Effect.fail(invalid('A capsule entrypoint is missing.'));
	yield* verifyExtensionPayloads(manifest);
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	return yield* encodePortableTar(
		[
			{ path: 'flect.json', contents: manifestBytes },
			...sorted.map((file) => ({ path: file.path, contents: file.contents }))
		],
		{
			maxArchiveBytes: MAX_CAPSULE_BYTES,
			maxEntries: MAX_FILES + 1,
			maxEntryBytes: MAX_FILE_BYTES,
			minimumArchiveBytes: PORTABLE_TAR_BLOCK_BYTES * 3
		}
	).pipe(Effect.mapError(() => invalid('The .flect capsule is too large.')));
});

export const decodeCapsule = Effect.fn('Capsule.decode')(function* (
	archive: Uint8Array
): Effect.fn.Return<DecodedCapsule, InvalidCapsule> {
	const entries = yield* decodePortableTar(archive, {
		maxArchiveBytes: MAX_CAPSULE_BYTES,
		maxEntries: MAX_FILES + 1,
		maxEntryBytes: MAX_FILE_BYTES,
		minimumArchiveBytes: PORTABLE_TAR_BLOCK_BYTES * 3
	}).pipe(Effect.mapError(() => invalid()));
	if (entries[0]?.path !== 'flect.json') return yield* Effect.fail(invalid());
	const manifestEntry = entries[0];
	if (manifestEntry === undefined) return yield* Effect.fail(invalid());
	const manifest = yield* Effect.try({
		try: () => JSON.parse(decoder.decode(manifestEntry.contents)),
		catch: () => invalid()
	}).pipe(
		Effect.flatMap(decodeManifest),
		Effect.mapError(() => invalid())
	);
	const files = entries.slice(1);
	if (files.length !== manifest.files.length) return yield* Effect.fail(invalid());
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		const expected = manifest.files[index];
		if (file === undefined || expected === undefined) return yield* Effect.fail(invalid());
		if (file.path !== expected.path || file.contents.byteLength !== expected.bytes)
			return yield* Effect.fail(invalid());
		if ((yield* sha256(file.contents)) !== expected.sha256)
			return yield* Effect.fail(invalid('A capsule payload failed integrity verification.'));
	}
	yield* verifyExtensionPayloads(manifest);
	return { manifest, files } satisfies DecodedCapsule;
});
