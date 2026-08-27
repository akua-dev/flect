import { describe, expect, it } from '@effect/vitest';
import { MemoryVfs } from '@riftydev/vfs';
import { Effect } from 'effect';
import { CapsuleStore, makeCapsuleStoreLayer } from './capsule-store';

describe('CapsuleStore', () => {
	it('identifies explicitly injected memory storage as session-only', async () => {
		const persistence = await Effect.runPromise(
			Effect.gen(function* () {
				return (yield* CapsuleStore).persistence;
			}).pipe(Effect.provide(makeCapsuleStoreLayer(new MemoryVfs(), 'session')))
		);

		expect(persistence).toBe('session');
	});

	it('restores content-addressed bindings through a fresh service', async () => {
		const vfs = new MemoryVfs();
		const first = makeCapsuleStoreLayer(vfs);
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CapsuleStore;
				yield* store.save({ accepted: new Uint8Array([1, 2, 3]) });
			}).pipe(Effect.provide(first))
		);
		const restored = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* CapsuleStore).load;
			}).pipe(Effect.provide(makeCapsuleStoreLayer(vfs)))
		);
		expect(restored.accepted).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('uninstalls only currently bound capsule objects and preserves unrelated data', async () => {
		const vfs = new MemoryVfs();
		const accepted = new Uint8Array([1, 2, 3]);
		const candidate = new Uint8Array([4, 5, 6]);
		const digest = async (bytes: Uint8Array) =>
			[...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
		const acceptedDigest = await digest(accepted);
		const candidateDigest = await digest(candidate);
		const orphanDigest = 'f'.repeat(64);
		const layer = makeCapsuleStoreLayer(vfs);

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CapsuleStore;
				yield* store.save({
					accepted,
					candidate,
					lastKnownGood: accepted
				});
			}).pipe(Effect.provide(layer))
		);
		await vfs.writeFile(
			`/flect-capsules/default/objects/${orphanDigest}.flect`,
			new Uint8Array([9])
		);
		await vfs.writeFile('/flect-capsules/default/owner-note.txt', 'not owned by the binding file');
		await vfs.mkdir('/workspace', { recursive: true });
		await vfs.writeFile('/workspace/project.txt', 'keep me');

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* CapsuleStore).uninstall;
			}).pipe(Effect.provide(layer))
		);

		expect(result).toEqual({ removedBindings: 3, removedObjects: 2 });
		expect(await vfs.exists(`/flect-capsules/default/objects/${acceptedDigest}.flect`)).toBe(false);
		expect(await vfs.exists(`/flect-capsules/default/objects/${candidateDigest}.flect`)).toBe(
			false
		);
		expect(await vfs.exists(`/flect-capsules/default/objects/${orphanDigest}.flect`)).toBe(true);
		expect(await vfs.readFileText('/flect-capsules/default/owner-note.txt')).toBe(
			'not owned by the binding file'
		);
		expect(await vfs.readFileText('/workspace/project.txt')).toBe('keep me');
		expect(
			await Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* CapsuleStore).load;
				}).pipe(Effect.provide(makeCapsuleStoreLayer(vfs)))
			)
		).toEqual({});
	});

	it('fails closed on corrupt bindings instead of guessing what to delete', async () => {
		const vfs = new MemoryVfs();
		const object = `/flect-capsules/default/objects/${'a'.repeat(64)}.flect`;
		await vfs.mkdir('/flect-capsules/default/objects', { recursive: true });
		await vfs.writeFile(object, new Uint8Array([7]));
		await vfs.writeFile(
			'/flect-capsules/default/bindings.json',
			JSON.stringify({ version: 1, accepted: 'unsafe' })
		);

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* CapsuleStore).uninstall;
				}).pipe(Effect.provide(makeCapsuleStoreLayer(vfs)))
			)
		).rejects.toMatchObject({ _tag: 'CapsuleStoreError' });
		expect(await vfs.exists(object)).toBe(true);
		expect(await vfs.exists('/flect-capsules/default/bindings.json')).toBe(true);
	});
});
