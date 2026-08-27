import { assert, describe, it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import {
	decodeRepositoryTar,
	makeRepositoryTar,
	type RepositoryArchiveEntry
} from './repository-tar';

const encoder = new TextEncoder();
const objectPath = `.git/objects/aa/${'b'.repeat(38)}`;

const archive = (entries: ReadonlyArray<RepositoryArchiveEntry>) => makeRepositoryTar(entries);

const checksum = (bytes: Uint8Array) => {
	const next = Uint8Array.from(bytes);
	next.fill(0x20, 148, 156);
	const value = next.reduce((sum, byte) => sum + byte, 0);
	next.set(encoder.encode(`${value.toString(8).padStart(6, '0')}\0 `), 148);
	return next;
};

const expectFailure = (bytes: Uint8Array, reason: string, label = reason) =>
	Effect.gen(function* () {
		const result = yield* decodeRepositoryTar(bytes).pipe(Effect.result);
		assert.isTrue(Result.isFailure(result), label);
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure._tag, 'RepositoryArchiveError');
			assert.strictEqual(result.failure.reason, reason);
			assert.strictEqual(
				result.failure.message,
				'The Git repository archive could not be imported safely.'
			);
		}
	});

describe('repository tar import', () => {
	it.effect('returns only validated files and directories and sanitizes mutable Git state', () =>
		Effect.gen(function* () {
			const decoded = yield* decodeRepositoryTar(
				archive([
					{ path: '.git/', kind: 'directory' },
					{ path: '.git/objects/', kind: 'directory' },
					{ path: '.git/objects/aa/', kind: 'directory' },
					{
						path: objectPath,
						kind: 'file',
						contents: new Uint8Array([1, 2, 3])
					},
					{
						path: '.git/config',
						kind: 'file',
						contents: encoder.encode('private-token')
					},
					{
						path: '.git/index',
						kind: 'file',
						contents: new Uint8Array([4, 5])
					},
					{
						path: '.git/logs/HEAD',
						kind: 'file',
						contents: encoder.encode('private-local-path')
					},
					{
						path: '.git/HEAD',
						kind: 'file',
						contents: encoder.encode('ref: refs/heads/main\n')
					},
					{
						path: 'src/index.ts',
						kind: 'file',
						contents: encoder.encode('export const value = 1;\n')
					}
				])
			);

			assert.deepStrictEqual(
				decoded.map((entry) => entry.path),
				['.git', '.git/objects', '.git/objects/aa', objectPath, 'src/index.ts']
			);
			assert.isFalse(
				decoded.some((entry) =>
					['.git/config', '.git/index', '.git/logs/HEAD', '.git/HEAD'].includes(entry.path)
				)
			);
		})
	);

	it.effect('rejects corrupt structure, duplicates, traversal, links, and devices', () =>
		Effect.gen(function* () {
			const valid = archive([
				{
					path: 'src/index.ts',
					kind: 'file',
					contents: encoder.encode('ok')
				}
			]);
			const badChecksum = valid.with(0, valid[0] === 0x78 ? 0x79 : 0x78);
			const duplicate = archive([
				{ path: 'src/index.ts', kind: 'file', contents: new Uint8Array() },
				{ path: 'src/index.ts', kind: 'file', contents: new Uint8Array() }
			]);
			const traversal = archive([{ path: '../private', kind: 'file', contents: new Uint8Array() }]);
			const link = archive([{ path: 'src/link', kind: 'symlink', target: '../private' }]);
			const deviceHeader = Uint8Array.from(valid.subarray(0, 512));
			deviceHeader[156] = '3'.charCodeAt(0);
			const device = Uint8Array.from(valid);
			device.set(checksum(deviceHeader), 0);

			yield* expectFailure(badChecksum, 'malformed');
			yield* expectFailure(valid.slice(0, -1), 'malformed');
			yield* expectFailure(Uint8Array.from([...valid, 1]), 'malformed');
			yield* expectFailure(duplicate, 'malformed');
			yield* expectFailure(traversal, 'prohibited');
			yield* expectFailure(link, 'unsupported');
			yield* expectFailure(device, 'unsupported');
		})
	);

	it.effect('rejects executable Git machinery and repository indirection', () =>
		Effect.gen(function* () {
			const paths = [
				'.git/hooks/pre-commit',
				'.git/objects/info/alternates',
				'.git/worktrees/other/HEAD',
				'.git/refs/replace/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				'.git/shallow',
				'.git/modules/vendor/config',
				'.gitmodules'
			];
			for (const path of paths) {
				yield* expectFailure(
					archive([{ path, kind: 'file', contents: encoder.encode('secret') }]),
					'prohibited',
					path
				);
			}
		})
	);

	it.effect('rejects protected refs, invalid object paths, and Git LFS pointers', () =>
		Effect.gen(function* () {
			const cases = [
				archive([
					{
						path: '.git/refs/heads/flect/accepted',
						kind: 'file',
						contents: encoder.encode(`${'a'.repeat(40)}\n`)
					}
				]),
				archive([
					{
						path: '.git/objects/not-an-object',
						kind: 'file',
						contents: new Uint8Array([1])
					}
				]),
				archive([
					{
						path: 'assets/model.bin',
						kind: 'file',
						contents: encoder.encode(
							'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n'
						)
					}
				])
			];
			for (const candidate of cases) {
				yield* expectFailure(candidate, 'prohibited');
			}
		})
	);

	it.effect('enforces the repository byte and entry bounds before import', () =>
		Effect.gen(function* () {
			const oversized = archive([
				{
					path: 'payload.bin',
					kind: 'file',
					contents: new Uint8Array(32 * 1024 * 1024)
				}
			]);
			const excessiveEntries = archive(
				Array.from({ length: 20_001 }, (_, index) => ({
					path: `d${index}/`,
					kind: 'directory' as const
				}))
			);

			yield* expectFailure(oversized, 'oversized');
			yield* expectFailure(excessiveEntries, 'oversized');
		})
	);
});
