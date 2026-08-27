export const installRiftyCapabilityBoundary = (): void => {
	const denied = (name: string) => {
		const capability = () => {
			throw new Error(`${name} is disabled in the Flect guest runtime.`);
		};
		return capability;
	};
	const deniedFetch = () =>
		Promise.reject(new Error('fetch is disabled in the Flect guest runtime.'));
	const deny = (name: string, value: unknown) => {
		Object.defineProperty(globalThis, name, {
			configurable: false,
			enumerable: false,
			value,
			writable: false
		});
	};

	deny('fetch', deniedFetch);
	for (const name of [
		'XMLHttpRequest',
		'WebSocket',
		'EventSource',
		'WebTransport',
		'RTCPeerConnection',
		'BroadcastChannel',
		'Worker',
		'SharedWorker',
		'ServiceWorker',
		'importScripts',
		'navigator',
		'location',
		'caches',
		'indexedDB',
		'localStorage',
		'sessionStorage',
		'cookieStore',
		'showOpenFilePicker',
		'showSaveFilePicker',
		'showDirectoryPicker',
		'FileSystemHandle',
		'FileSystemFileHandle',
		'FileSystemDirectoryHandle',
		'FileSystemWritableFileStream',
		'OriginPrivateFileSystem',
		'StorageManager',
		'Cache',
		'CacheStorage',
		'Storage',
		'IDBFactory',
		'IDBDatabase',
		'IDBObjectStore',
		'IDBTransaction',
		'IDBRequest',
		'IDBOpenDBRequest',
		'IDBKeyRange',
		'IDBCursor',
		'IDBCursorWithValue'
	]) {
		deny(name, name === 'navigator' ? undefined : denied(name));
	}
};

export const riftyCapabilityBoundarySource = `(${installRiftyCapabilityBoundary.toString()})();`;
