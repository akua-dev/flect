import { assert, describe, it } from '@effect/vitest';
import { MemoryVfs } from '@riftydev/vfs';
import { Effect } from 'effect';
import { MAX_SHARE_ARCHIVE_BYTES } from '../../packages/product/src/share';
import { makeShareCandidateStore } from './share-candidate-store';

describe('ShareCandidateStore', () => {
	it.effect('persists immutable candidate archives by verified digest', () =>
		Effect.gen(function* () {
			const store = makeShareCandidateStore(new MemoryVfs(), 'session');
			const archive = new Uint8Array([1, 2, 3, 4]);

			const first = yield* store.save(archive);
			const repeated = yield* store.save(archive);
			const restored = yield* store.load(first);

			assert.strictEqual(first, repeated);
			assert.deepStrictEqual(restored, archive);
			archive[0] = 9;
			assert.deepStrictEqual(yield* store.load(first), new Uint8Array([1, 2, 3, 4]));

			yield* store.remove(first);
			assert.isUndefined(yield* store.load(first));
		})
	);

	it.effect('rejects invalid keys and oversized archives with typed failures', () =>
		Effect.gen(function* () {
			const store = makeShareCandidateStore(new MemoryVfs(), 'session');
			const invalid = yield* store.load('../candidate').pipe(Effect.flip);
			assert.strictEqual(invalid.reason, 'invalid-key');

			const oversized = yield* store
				.save(new Uint8Array(MAX_SHARE_ARCHIVE_BYTES + 1))
				.pipe(Effect.flip);
			assert.strictEqual(oversized.reason, 'quota');
		})
	);
});
