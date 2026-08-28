import { Effect, Schema } from 'effect';

export interface RepositoryArchiveEntry {
	readonly path: string;
	readonly kind: 'directory' | 'file' | 'symlink';
	readonly contents?: Uint8Array;
	readonly target?: string;
}

export interface DecodedRepositoryArchiveEntry {
	readonly path: string;
	readonly kind: 'directory' | 'file';
	readonly contents?: Uint8Array;
}

export class RepositoryArchiveError extends Schema.TaggedErrorClass<RepositoryArchiveError>()(
	'RepositoryArchiveError',
	{
		reason: Schema.Literals(['malformed', 'oversized', 'prohibited', 'unsupported']),
		message: Schema.String
	}
) {}

const BLOCK_BYTES = 512;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const repositoryArchiveError = (reason: RepositoryArchiveError['reason']) =>
	RepositoryArchiveError.make({
		reason,
		message: 'The Git repository archive could not be imported safely.'
	});

const decodeText = (bytes: Uint8Array) =>
	Effect.try({
		try: () => decoder.decode(bytes).replace(/\0.*$/, ''),
		catch: () => repositoryArchiveError('malformed')
	});

const isSafePath = (path: string) => {
	const parts = path.split('/');
	return (
		!path.startsWith('/') &&
		!path.includes('\\') &&
		!path.includes('\0') &&
		parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
	);
};

const isProtectedRef = (ref: string) =>
	ref === 'refs/heads/flect' || ref.startsWith('refs/heads/flect/');

const isValidRef = (ref: string) =>
	/^(?:refs\/(?:heads|tags)\/)\S+$/.test(ref) &&
	!ref.includes('..') &&
	!ref.includes('@{') &&
	!ref.endsWith('.') &&
	!ref.endsWith('/') &&
	!ref.includes('//') &&
	!['~', '^', ':', '?', '*', '[', '\\'].some((character) => ref.includes(character));

const prohibitedPath = (path: string) =>
	path === '.gitmodules' ||
	path === '.git/shallow' ||
	path === '.git/objects/info/alternates' ||
	path.startsWith('.git/hooks/') ||
	path.startsWith('.git/worktrees/') ||
	path.startsWith('.git/refs/replace/') ||
	path.startsWith('.git/modules/');

const sanitizedPath = (path: string) =>
	path === '.git/config' ||
	path === '.git/index' ||
	path === '.git/HEAD' ||
	path === '.git/ORIG_HEAD' ||
	path === '.git/FETCH_HEAD' ||
	path === '.git/COMMIT_EDITMSG' ||
	path === '.git/description' ||
	path === '.git/logs' ||
	path.startsWith('.git/logs/');

const isLooseObjectPath = (path: string) =>
	/^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(path);

const isPackedObjectPath = (path: string) =>
	/^\.git\/objects\/pack\/pack-[0-9a-f]{40}\.(?:pack|idx)$/.test(path);

const isGitObjectDirectory = (path: string) =>
	path === '.git/objects' ||
	path === '.git/objects/info' ||
	path === '.git/objects/pack' ||
	/^\.git\/objects\/[0-9a-f]{2}$/.test(path);

const isLfsPointer = (contents: Uint8Array) => {
	const prefix = encoder.encode('version https://git-lfs.github.com/spec/v1\n');
	return (
		contents.byteLength >= prefix.byteLength &&
		prefix.every((byte, index) => contents[index] === byte)
	);
};

const validatePackedRefs = Effect.fn('RepositoryTar.validatePackedRefs')(function* (
	contents: Uint8Array
) {
	const value = yield* Effect.try({
		try: () => decoder.decode(contents),
		catch: () => repositoryArchiveError('malformed')
	});
	for (const line of value.split('\n')) {
		if (line.length === 0 || line.startsWith('#') || line.startsWith('^')) {
			continue;
		}
		const match = /^([0-9a-f]{40}) (\S+)$/.exec(line);
		if (match === null || !isValidRef(match[2] ?? '')) {
			return yield* Effect.fail(repositoryArchiveError('malformed'));
		}
		if (isProtectedRef(match[2] ?? '')) {
			return yield* Effect.fail(repositoryArchiveError('prohibited'));
		}
	}
});

const validateGitEntry = Effect.fn('RepositoryTar.validateGitEntry')(function* (
	entry: DecodedRepositoryArchiveEntry
): Effect.fn.Return<boolean, RepositoryArchiveError> {
	const { path } = entry;
	if (prohibitedPath(path)) {
		return yield* Effect.fail(repositoryArchiveError('prohibited'));
	}
	if (sanitizedPath(path)) {
		return false;
	}
	if (entry.kind === 'directory') {
		if (
			path === '.git' ||
			path === '.git/refs' ||
			path === '.git/refs/heads' ||
			path === '.git/refs/tags' ||
			path.startsWith('.git/refs/heads/') ||
			path.startsWith('.git/refs/tags/') ||
			isGitObjectDirectory(path)
		) {
			if (path.startsWith('.git/refs/heads/flect/') || path === '.git/refs/heads/flect') {
				return yield* Effect.fail(repositoryArchiveError('prohibited'));
			}
			return true;
		}
		return yield* Effect.fail(repositoryArchiveError('prohibited'));
	}
	const contents = entry.contents ?? new Uint8Array();
	if (isLooseObjectPath(path) || isPackedObjectPath(path)) {
		return true;
	}
	if (path === '.git/packed-refs') {
		yield* validatePackedRefs(contents);
		return false;
	}
	if (path.startsWith('.git/refs/')) {
		const ref = path.slice('.git/'.length);
		const value = yield* Effect.try({
			try: () => decoder.decode(contents),
			catch: () => repositoryArchiveError('malformed')
		});
		if (!isValidRef(ref) || !/^[0-9a-f]{40}\n?$/.test(value)) {
			return yield* Effect.fail(repositoryArchiveError('malformed'));
		}
		if (isProtectedRef(ref)) {
			return yield* Effect.fail(repositoryArchiveError('prohibited'));
		}
		return false;
	}
	return yield* Effect.fail(repositoryArchiveError('prohibited'));
});

export const decodeRepositoryTar = Effect.fn('RepositoryTar.decode')(function* (
	archive: Uint8Array
): Effect.fn.Return<ReadonlyArray<DecodedRepositoryArchiveEntry>, RepositoryArchiveError> {
	if (archive.byteLength > MAX_ARCHIVE_BYTES || archive.byteLength < BLOCK_BYTES * 3) {
		return yield* Effect.fail(
			repositoryArchiveError(archive.byteLength > MAX_ARCHIVE_BYTES ? 'oversized' : 'malformed')
		);
	}
	if (archive.byteLength % BLOCK_BYTES !== 0) {
		return yield* Effect.fail(repositoryArchiveError('malformed'));
	}
	const entries: Array<DecodedRepositoryArchiveEntry> = [];
	const paths = new Set<string>();
	let ended = false;
	for (let offset = 0; offset < archive.byteLength;) {
		const header = archive.subarray(offset, offset + BLOCK_BYTES);
		if (header.byteLength !== BLOCK_BYTES) {
			return yield* Effect.fail(repositoryArchiveError('malformed'));
		}
		if (header.every((byte) => byte === 0)) {
			if (
				offset + BLOCK_BYTES * 2 > archive.byteLength ||
				!archive.subarray(offset, offset + BLOCK_BYTES * 2).every((byte) => byte === 0) ||
				!archive.subarray(offset + BLOCK_BYTES * 2).every((byte) => byte === 0)
			) {
				return yield* Effect.fail(repositoryArchiveError('malformed'));
			}
			ended = true;
			break;
		}
		const [rawPath, sizeText, checksumText, magic, version, prefix] = yield* Effect.all([
			decodeText(header.subarray(0, 100)),
			decodeText(header.subarray(124, 136)),
			decodeText(header.subarray(148, 156)),
			decodeText(header.subarray(257, 263)),
			decodeText(header.subarray(263, 265)),
			decodeText(header.subarray(345, 500))
		]);
		const size = Number.parseInt(sizeText.trim(), 8);
		const storedChecksum = Number.parseInt(checksumText.trim(), 8);
		const actualChecksum = header.reduce(
			(sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte),
			0
		);
		const type = String.fromCharCode(header[156] ?? 0);
		const kind = type === '5' ? 'directory' : type === '0' ? 'file' : undefined;
		const path = kind === 'directory' && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
		if (
			kind === undefined ||
			path.length === 0 ||
			prefix.length > 0 ||
			magic !== 'ustar' ||
			version !== '00' ||
			!isSafePath(path) ||
			paths.has(path) ||
			!Number.isSafeInteger(size) ||
			size < 0 ||
			(kind === 'directory' && size !== 0) ||
			storedChecksum !== actualChecksum
		) {
			const reason =
				type !== '0' && type !== '5'
					? 'unsupported'
					: !isSafePath(path)
						? 'prohibited'
						: 'malformed';
			return yield* Effect.fail(repositoryArchiveError(reason));
		}
		paths.add(path);
		offset += BLOCK_BYTES;
		if (offset + size > archive.byteLength) {
			return yield* Effect.fail(repositoryArchiveError('malformed'));
		}
		const contents = archive.slice(offset, offset + size);
		const paddedSize = Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
		if (
			offset + paddedSize > archive.byteLength ||
			!archive.subarray(offset + size, offset + paddedSize).every((byte) => byte === 0)
		) {
			return yield* Effect.fail(repositoryArchiveError('malformed'));
		}
		offset += paddedSize;
		if (paths.size > MAX_ARCHIVE_ENTRIES) {
			return yield* Effect.fail(repositoryArchiveError('oversized'));
		}
		const entry: DecodedRepositoryArchiveEntry =
			kind === 'directory' ? { path, kind } : { path, kind, contents };
		if (prohibitedPath(path)) {
			return yield* Effect.fail(repositoryArchiveError('prohibited'));
		}
		const retain =
			path.startsWith('.git/') || path === '.git' ? yield* validateGitEntry(entry) : true;
		if (entry.kind === 'file' && isLfsPointer(contents)) {
			return yield* Effect.fail(repositoryArchiveError('prohibited'));
		}
		if (retain) {
			entries.push(entry);
		}
	}
	if (!ended || entries.length === 0) {
		return yield* Effect.fail(repositoryArchiveError('malformed'));
	}
	return entries;
});

const writeText = (target: Uint8Array, offset: number, length: number, value: string) => {
	const bytes = encoder.encode(value);
	target.set(bytes.subarray(0, length), offset);
};

const octal = (value: number, length: number) =>
	`${Math.max(0, value)
		.toString(8)
		.padStart(length - 1, '0')}\0`;

const makeHeader = (entry: RepositoryArchiveEntry) => {
	if (encoder.encode(entry.path).byteLength > 100) {
		throw new Error('The repository contains a path too long for portable tar export.');
	}
	const header = new Uint8Array(BLOCK_BYTES);
	const contents = entry.contents ?? new Uint8Array();
	writeText(header, 0, 100, entry.path);
	writeText(header, 100, 8, octal(entry.kind === 'directory' ? 0o755 : 0o644, 8));
	writeText(header, 108, 8, octal(0, 8));
	writeText(header, 116, 8, octal(0, 8));
	writeText(header, 124, 12, octal(entry.kind === 'file' ? contents.byteLength : 0, 12));
	writeText(header, 136, 12, octal(0, 12));
	header.fill(0x20, 148, 156);
	writeText(
		header,
		156,
		1,
		entry.kind === 'directory' ? '5' : entry.kind === 'symlink' ? '2' : '0'
	);
	if (entry.kind === 'symlink') {
		writeText(header, 157, 100, entry.target ?? '');
	}
	writeText(header, 257, 6, 'ustar\0');
	writeText(header, 263, 2, '00');
	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
	return header;
};

export const makeRepositoryTar = (entries: ReadonlyArray<RepositoryArchiveEntry>) => {
	const chunks: Array<Uint8Array> = [];
	let byteLength = BLOCK_BYTES * 2;
	for (const entry of entries) {
		const contents = entry.contents ?? new Uint8Array();
		const paddedLength =
			entry.kind === 'file' ? Math.ceil(contents.byteLength / BLOCK_BYTES) * BLOCK_BYTES : 0;
		const payload = new Uint8Array(paddedLength);
		payload.set(contents);
		chunks.push(makeHeader(entry), payload);
		byteLength += BLOCK_BYTES + paddedLength;
	}
	const archive = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return archive;
};
