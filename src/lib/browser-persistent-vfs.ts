import { MemoryVfs, OpfsVfs, type Vfs } from '@riftydev/vfs';
import { Effect } from 'effect';

export interface BrowserPersistentStorage {
	readonly vfs: Vfs;
	readonly persistence: 'durable' | 'session';
}

let persistentStorage: Promise<BrowserPersistentStorage> | undefined;

const openDurableVfs = Effect.fn('Flect.BrowserPersistentVfs.openDurable')(function* () {
	const vfs = new OpfsVfs();
	yield* Effect.tryPromise(() => vfs.init());
	return { vfs, persistence: 'durable' as const };
});

const openPersistentStorage = openDurableVfs().pipe(
	Effect.catch(() =>
		// OPFS is unavailable, blocked, or its init failed; fall back to the
		// session VFS.
		Effect.succeed({ vfs: new MemoryVfs(), persistence: 'session' as const })
	)
);

/**
 * One asynchronous storage surface per browser realm keeps lazy services from
 * reopening OPFS while the Git worker is active. Namespaced consumers still
 * own disjoint roots, but share the already initialized directory handle.
 */
export const browserPersistentStorage = (): Promise<BrowserPersistentStorage> => {
	persistentStorage ??= OpfsVfs.isSupported()
		? Effect.runPromise(openPersistentStorage)
		: Promise.resolve({ vfs: new MemoryVfs(), persistence: 'session' as const });
	return persistentStorage;
};
