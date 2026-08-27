import { Effect, Schema } from 'effect';
import { unzipSync } from 'fflate';
import { decodeRepositoryTar } from '../git/repository-tar';
import {
	importWebProject,
	type WebProjectFile,
	WebProjectImportFailure,
	type WebProjectImportResult
} from './web-project-import';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4_096;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_ENTRY = 0x02014b50;

const failure = (message: string) => WebProjectImportFailure.make({ message });

const digest = async (contents: Uint8Array) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(contents))),
		(byte) => byte.toString(16).padStart(2, '0')
	).join('');

const preflightZip = (archive: Uint8Array) => {
	if (archive.byteLength > MAX_ARCHIVE_BYTES || archive.byteLength < 22) {
		throw new Error('archive size');
	}
	const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
	let end = -1;
	const earliest = Math.max(0, archive.byteLength - 65_557);
	for (let offset = archive.byteLength - 22; offset >= earliest; offset -= 1) {
		if (view.getUint32(offset, true) === ZIP_EOCD) {
			end = offset;
			break;
		}
	}
	if (end < 0) throw new Error('missing directory');
	const disk = view.getUint16(end + 4, true);
	const directoryDisk = view.getUint16(end + 6, true);
	const entriesOnDisk = view.getUint16(end + 8, true);
	const entries = view.getUint16(end + 10, true);
	const directoryBytes = view.getUint32(end + 12, true);
	const directoryOffset = view.getUint32(end + 16, true);
	const commentBytes = view.getUint16(end + 20, true);
	if (
		disk !== 0 ||
		directoryDisk !== 0 ||
		entriesOnDisk !== entries ||
		entries === 0 ||
		entries > MAX_ARCHIVE_ENTRIES ||
		entries === 0xffff ||
		directoryBytes === 0xffffffff ||
		directoryOffset === 0xffffffff ||
		end + 22 + commentBytes !== archive.byteLength ||
		directoryOffset + directoryBytes !== end
	) {
		throw new Error('unsupported directory');
	}
	let offset = directoryOffset;
	let expandedBytes = 0;
	for (let index = 0; index < entries; index += 1) {
		if (offset + 46 > end || view.getUint32(offset, true) !== ZIP_CENTRAL_ENTRY) {
			throw new Error('invalid entry');
		}
		const flags = view.getUint16(offset + 8, true);
		const compression = view.getUint16(offset + 10, true);
		const compressedBytes = view.getUint32(offset + 20, true);
		const uncompressedBytes = view.getUint32(offset + 24, true);
		const nameBytes = view.getUint16(offset + 28, true);
		const extraBytes = view.getUint16(offset + 30, true);
		const entryCommentBytes = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		expandedBytes += uncompressedBytes;
		if (
			(flags & 1) !== 0 ||
			![0, 8].includes(compression) ||
			compressedBytes === 0xffffffff ||
			uncompressedBytes === 0xffffffff ||
			localOffset === 0xffffffff ||
			localOffset >= directoryOffset ||
			expandedBytes > MAX_ARCHIVE_BYTES
		) {
			throw new Error('unsupported entry');
		}
		offset += 46 + nameBytes + extraBytes + entryCommentBytes;
	}
	if (offset !== end) throw new Error('invalid directory size');
};

const zipFiles = (archive: Uint8Array): ReadonlyArray<WebProjectFile> => {
	preflightZip(archive);
	const decoded = unzipSync(archive);
	return Object.entries(decoded)
		.filter(([path]) => !path.endsWith('/'))
		.map(([path, contents]) => ({ path, contents }));
};

export const importWebProjectArchive = Effect.fn('Flect.WebProject.importArchive')(function* (
	fileName: string,
	archive: Uint8Array
): Effect.fn.Return<WebProjectImportResult, WebProjectImportFailure> {
	const normalized = fileName.toLowerCase();
	const files = yield* Effect.tryPromise({
		try: async () =>
			normalized.endsWith('.zip')
				? zipFiles(archive)
				: normalized.endsWith('.tar')
					? (await Effect.runPromise(decodeRepositoryTar(archive)))
							.filter(
								(entry): entry is typeof entry & { readonly contents: Uint8Array } =>
									entry.kind === 'file' && entry.contents !== undefined
							)
							.map(({ path, contents }) => ({ path, contents }))
					: Promise.reject(new Error('unsupported archive')),
		catch: () =>
			failure(
				'Choose a bounded .zip or POSIX .tar source archive. Links, encryption, ZIP64, and archives over 32 MiB are rejected.'
			)
	});
	const revision = yield* Effect.tryPromise({
		try: () => digest(archive),
		catch: () => failure('The archive could not be fingerprinted safely.')
	});
	return yield* importWebProject(files, {
		source: 'archive',
		revision,
		sourceLabel: fileName.slice(0, 200)
	});
});

export const isWebProjectImportFailure = Schema.is(WebProjectImportFailure);
