import { Data, Effect } from 'effect';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';

export class BrowserEsbuildLoadError extends Data.TaggedError('BrowserEsbuildLoadError')<{
	readonly cause: unknown;
}> {}

let initialization: Promise<void> | undefined;
let moduleLoad: Promise<typeof import('esbuild-wasm')> | undefined;

const loadBrowserEsbuildEffect = Effect.fn('Flect.Execution.loadBrowserEsbuild')(function* () {
	moduleLoad ??= import('esbuild-wasm');
	const esbuild = yield* Effect.tryPromise({
		try: () => moduleLoad ?? import('esbuild-wasm'),
		catch: (cause) => new BrowserEsbuildLoadError({ cause })
	});
	if (typeof window !== 'undefined') {
		initialization ??= esbuild.initialize({
			wasmURL: new URL(esbuildWasmUrl, window.location.href).href,
			worker: true
		});
		yield* Effect.tryPromise({
			try: () => initialization ?? Promise.resolve(),
			catch: (cause) => new BrowserEsbuildLoadError({ cause })
		});
	}
	return esbuild;
});

export const loadBrowserEsbuild = () => Effect.runPromise(loadBrowserEsbuildEffect());
