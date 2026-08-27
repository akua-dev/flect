import { MemoryVfs, OpfsVfs, type Vfs } from '@riftydev/vfs';

export interface BrowserPersistentStorage {
	readonly vfs: Vfs;
	readonly persistence: 'durable' | 'session';
}

let persistentStorage: Promise<BrowserPersistentStorage> | undefined;

/**
 * One asynchronous storage surface per browser realm keeps lazy services from
 * reopening OPFS while the Git worker is active. Namespaced consumers still
 * own disjoint roots, but share the already initialized directory handle.
 */
export const browserPersistentStorage = (): Promise<BrowserPersistentStorage> => {
	persistentStorage ??= (async () => {
		if (OpfsVfs.isSupported()) {
			try {
				const vfs = new OpfsVfs();
				await vfs.init();
				return { vfs, persistence: 'durable' as const };
			} catch {
				// OPFS is unavailable or blocked; fall back to the session VFS below.
			}
		}
		return { vfs: new MemoryVfs(), persistence: 'session' as const };
	})();
	return persistentStorage;
};
