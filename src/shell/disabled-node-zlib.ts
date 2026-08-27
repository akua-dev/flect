const unavailable = (): never => {
	throw new Error('Compression commands are unavailable in the browser shell.');
};

export const constants = Object.freeze({
	Z_BEST_COMPRESSION: 9,
	Z_BEST_SPEED: 1,
	Z_DEFAULT_COMPRESSION: -1
});

export const gunzipSync = (_input: Uint8Array, _options?: unknown): Uint8Array => unavailable();

export const gzipSync = (_input: Uint8Array, _options?: unknown): Uint8Array => unavailable();
