import { assert, describe, it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import {
	type CapsuleSource,
	encodeCapsule,
	hashCapsuleArchive
} from '../../packages/product/src/capsule';
import {
	ShareArtifactDescriptor,
	ShareGitRepository,
	type ShareManifest
} from '../../packages/product/src/share';
import { decodeShareArchive, encodeShareArchive } from './share-archive';

const commit = 'b'.repeat(40);
const sourceDigest = 'c'.repeat(64);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const headerOffsets = (archive: Uint8Array) => {
	const offsets: Array<number> = [];
	for (let offset = 0; offset < archive.byteLength;) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		offsets.push(offset);
		const size = Number.parseInt(
			decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim(),
			8
		);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return offsets;
};

const mutateHeader = (
	archive: Uint8Array,
	offset: number,
	mutate: (header: Uint8Array) => void
) => {
	const changed = Uint8Array.from(archive);
	const header = Uint8Array.from(changed.subarray(offset, offset + 512));
	mutate(header);
	header.fill(0x20, 148, 156);
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	changed.set(header, offset);
	return changed;
};

const capsuleSource = (): CapsuleSource => ({
	manifest: {
		formatVersion: 1,
		id: 'dev.flect.shared-workbench',
		name: 'Shared workbench',
		version: '1.0.0',
		entrypoints: [{ id: 'main', path: 'ui/index.html' }],
		capabilities: [],
		extensions: [],
		compatibility: {
			flect: '>=0.2.0 <1.0.0',
			schemaVersion: 1,
			platforms: ['browser', 'macos']
		},
		provenance: {
			publisher: 'akua-dev',
			source: 'https://github.com/akua-dev/shared-workbench',
			revision: commit,
			builder: '@flect/product'
		},
		signatures: []
	},
	files: [
		{
			path: 'ui/index.html',
			contents: new TextEncoder().encode('<h1>Shared workbench</h1>')
		}
	]
});

const manifest = (
	capsuleSha256: string
): Omit<ShareManifest, 'repository'> & {
	readonly repository: ShareGitRepository;
} => ({
	formatVersion: 1,
	id: 'dev.flect.shared-workbench',
	name: 'Shared workbench',
	version: '1.0.0',
	repository: ShareGitRepository.make({ _tag: 'git', commit }),
	artifacts: [
		ShareArtifactDescriptor.make({
			id: 'dev.flect.shared-workbench.experience',
			kind: 'experience',
			version: '1.0.0',
			sourceRoot: 'experiences/workbench',
			contentSha256: sourceDigest,
			capsule: {
				path: 'artifacts/workbench.flect',
				sha256: capsuleSha256
			}
		})
	],
	compatibility: {
		flect: '>=0.2.0 <1.0.0',
		platforms: ['browser', 'macos']
	},
	provenance: {
		publisher: 'akua-dev',
		source: 'https://github.com/akua-dev/shared-workbench',
		revision: commit,
		builder: '@flect/product'
	},
	signatures: [],
	migrations: []
});

describe('share archive', () => {
	it.effect('encodes deterministically and verifies repository and capsule bytes', () =>
		Effect.gen(function* () {
			const capsule = yield* encodeCapsule(capsuleSource());
			const capsuleSha256 = yield* hashCapsuleArchive(capsule);
			const repository = new TextEncoder().encode('bounded-git-repository');
			const source = {
				manifest: manifest(capsuleSha256),
				repository,
				artifacts: [{ path: 'artifacts/workbench.flect', contents: capsule }]
			};

			const first = yield* encodeShareArchive(source);
			const second = yield* encodeShareArchive(source);
			const decoded = yield* decodeShareArchive(first);

			assert.deepStrictEqual(first, second);
			assert.strictEqual(decoded.manifest.repository._tag, 'embedded');
			assert.strictEqual(decoded.manifest.repository.commit, commit);
			assert.deepStrictEqual(decoded.repository, repository);
			assert.strictEqual(decoded.artifacts.length, 1);
			assert.deepStrictEqual(decoded.artifacts[0]?.contents, capsule);
		})
	);

	it.effect('fails closed on repository, capsule, and trailing-byte tampering', () =>
		Effect.gen(function* () {
			const capsule = yield* encodeCapsule(capsuleSource());
			const capsuleSha256 = yield* hashCapsuleArchive(capsule);
			const archive = yield* encodeShareArchive({
				manifest: manifest(capsuleSha256),
				repository: new TextEncoder().encode('bounded-git-repository'),
				artifacts: [{ path: 'artifacts/workbench.flect', contents: capsule }]
			});
			const cases = [
				archive.with(1_024, archive[1_024] === 0 ? 1 : 0),
				archive.with(2_048, archive[2_048] === 0 ? 1 : 0),
				Uint8Array.from([...archive, 1])
			];

			for (const candidate of cases) {
				const result = yield* decodeShareArchive(candidate).pipe(Effect.result);
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) {
					assert.strictEqual(result.failure._tag, 'ShareArchiveFailure');
					assert.strictEqual(result.failure.message, 'The .flect-share archive is invalid.');
				}
			}
		})
	);

	it.effect('rejects missing, duplicate, and undeclared artifact entries', () =>
		Effect.gen(function* () {
			const capsule = yield* encodeCapsule(capsuleSource());
			const capsuleSha256 = yield* hashCapsuleArchive(capsule);
			const base = manifest(capsuleSha256);
			const cases = [
				{ manifest: base, repository: new Uint8Array([1]), artifacts: [] },
				{
					manifest: base,
					repository: new Uint8Array([1]),
					artifacts: [
						{ path: 'artifacts/workbench.flect', contents: capsule },
						{ path: 'artifacts/workbench.flect', contents: capsule }
					]
				},
				{
					manifest: base,
					repository: new Uint8Array([1]),
					artifacts: [
						{ path: 'artifacts/workbench.flect', contents: capsule },
						{ path: 'artifacts/undeclared.flect', contents: capsule }
					]
				}
			];

			for (const candidate of cases) {
				const result = yield* encodeShareArchive(candidate).pipe(Effect.result);
				assert.isTrue(Result.isFailure(result));
			}
		})
	);

	it.effect('rejects traversal, duplicate, link, device, and malformed ustar entries', () =>
		Effect.gen(function* () {
			const capsule = yield* encodeCapsule(capsuleSource());
			const capsuleSha256 = yield* hashCapsuleArchive(capsule);
			const archive = yield* encodeShareArchive({
				manifest: manifest(capsuleSha256),
				repository: new Uint8Array([1, 2, 3]),
				artifacts: [{ path: 'artifacts/workbench.flect', contents: capsule }]
			});
			const artifactHeader = headerOffsets(archive)[2];
			assert.isDefined(artifactHeader);
			if (artifactHeader === undefined) return;
			const rewritePath = (path: string) => (header: Uint8Array) => {
				header.fill(0, 0, 100);
				header.set(encoder.encode(path), 0);
			};
			const cases = [
				mutateHeader(archive, artifactHeader, rewritePath('../private')),
				mutateHeader(archive, artifactHeader, rewritePath('repository.tar')),
				mutateHeader(archive, artifactHeader, (header) => {
					header[156] = '2'.charCodeAt(0);
				}),
				mutateHeader(archive, artifactHeader, (header) => {
					header[156] = '3'.charCodeAt(0);
				}),
				mutateHeader(archive, artifactHeader, (header) => {
					header.fill(0, 257, 263);
					header.set(encoder.encode('broken'), 257);
				})
			];
			for (const candidate of cases) {
				assert.strictEqual(
					(yield* decodeShareArchive(candidate).pipe(Effect.result))._tag,
					'Failure'
				);
			}
		})
	);
});
