import type { Vfs } from '@riftydev/vfs';
import { Context, Effect, Layer, Schema } from 'effect';
import { MAX_SHARE_ARCHIVE_BYTES } from '../../packages/product/src/share';
import { browserPersistentStorage } from '../lib/browser-persistent-vfs';

const OBJECTS = '/flect-shares/default/objects';
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export class ShareCandidateStoreFailure extends Schema.TaggedErrorClass<ShareCandidateStoreFailure>()(
	'ShareCandidateStoreFailure',
	{
		reason: Schema.Literals(['invalid-key', 'integrity', 'quota', 'unavailable']),
		message: Schema.String
	}
) {}

const failure = (reason: ShareCandidateStoreFailure['reason']) =>
	ShareCandidateStoreFailure.make({
		reason,
		message:
			reason === 'quota'
				? 'The shared candidate exceeds the local storage limit.'
				: reason === 'invalid-key' || reason === 'integrity'
					? 'The stored shared candidate is invalid.'
					: 'Shared candidate storage is unavailable.'
	});

const hash = (archive: Uint8Array) =>
	Effect.tryPromise({
		try: async () => {
			const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(archive));
			return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
				''
			);
		},
		catch: () => failure('unavailable')
	});

export interface ShareCandidateStoreShape {
	readonly persistence: 'durable' | 'session';
	readonly save: (archive: Uint8Array) => Effect.Effect<string, ShareCandidateStoreFailure>;
	readonly load: (
		digest: string
	) => Effect.Effect<Uint8Array | undefined, ShareCandidateStoreFailure>;
	readonly remove: (digest: string) => Effect.Effect<void, ShareCandidateStoreFailure>;
}

export class ShareCandidateStore extends Context.Service<
	ShareCandidateStore,
	ShareCandidateStoreShape
>()('flect/ShareCandidateStore') {}

const decodeDigest = (digest: string) =>
	Schema.decodeUnknownEffect(Digest)(digest).pipe(Effect.mapError(() => failure('invalid-key')));

export const makeShareCandidateStore = (
	vfs: Vfs,
	persistence: ShareCandidateStoreShape['persistence']
): ShareCandidateStoreShape => ({
	persistence,
	save: (archive) =>
		Effect.gen(function* () {
			if (archive.byteLength === 0 || archive.byteLength > MAX_SHARE_ARCHIVE_BYTES) {
				return yield* Effect.fail(failure('quota'));
			}
			const contents = archive.slice();
			const digest = yield* hash(contents);
			yield* Effect.tryPromise({
				try: async () => {
					await vfs.mkdir(OBJECTS, { recursive: true });
					const path = `${OBJECTS}/${digest}.flect-share`;
					if (!(await vfs.exists(path))) await vfs.writeFile(path, contents);
				},
				catch: () => failure('unavailable')
			});
			return digest;
		}),
	load: (input) =>
		Effect.gen(function* () {
			const digest = yield* decodeDigest(input);
			const contents = yield* Effect.tryPromise({
				try: async () => {
					const path = `${OBJECTS}/${digest}.flect-share`;
					return (await vfs.exists(path)) ? await vfs.readFile(path) : undefined;
				},
				catch: () => failure('unavailable')
			});
			if (contents === undefined) return undefined;
			if (
				contents.byteLength === 0 ||
				contents.byteLength > MAX_SHARE_ARCHIVE_BYTES ||
				(yield* hash(contents)) !== digest
			) {
				return yield* Effect.fail(failure('integrity'));
			}
			return contents.slice();
		}),
	remove: (input) =>
		Effect.gen(function* () {
			const digest = yield* decodeDigest(input);
			yield* Effect.tryPromise({
				try: () =>
					vfs.rm(`${OBJECTS}/${digest}.flect-share`, {
						force: true
					}),
				catch: () => failure('unavailable')
			});
		})
});

export const makeShareCandidateStoreLayer = (
	vfs: Vfs,
	persistence: ShareCandidateStoreShape['persistence'] = 'session'
) => Layer.succeed(ShareCandidateStore)(makeShareCandidateStore(vfs, persistence));

export const ShareCandidateStoreLive = Layer.effect(
	ShareCandidateStore,
	Effect.promise(() =>
		browserPersistentStorage().then(({ vfs, persistence }) =>
			makeShareCandidateStore(vfs, persistence)
		)
	)
);
