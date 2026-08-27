import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema, type SchemaAST } from 'effect';
import {
	BrowserExecutionCapabilities,
	JavaScriptExecutionRequest,
	WasiWorkerResponse
} from './browser-execution';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

describe('browser execution contracts', () => {
	it.effect('rejects an excess JavaScript request property', () =>
		Schema.decodeUnknownEffect(
			JavaScriptExecutionRequest,
			strict
		)({
			version: 1,
			source: '40 + 2',
			unexpected: true
		}).pipe(
			Effect.match({
				onFailure: () => Effect.void,
				onSuccess: () => Effect.die('excess property was accepted')
			})
		)
	);

	it.effect('round-trips the capability report', () =>
		Effect.gen(function* () {
			const report = BrowserExecutionCapabilities.make({
				version: 1,
				worker: true,
				webAssembly: true,
				crossOriginIsolated: false,
				opfs: false
			});
			const encoded = yield* Schema.encodeUnknownEffect(BrowserExecutionCapabilities)(report);
			const decoded = yield* Schema.decodeUnknownEffect(
				BrowserExecutionCapabilities,
				strict
			)(encoded);
			assert.deepStrictEqual(decoded, report);
		})
	);

	it.effect('rejects an unknown WASI worker frame', () =>
		Schema.decodeUnknownEffect(
			WasiWorkerResponse,
			strict
		)({
			type: 'other',
			id: 'request-a'
		}).pipe(
			Effect.match({
				onFailure: () => Effect.void,
				onSuccess: () => Effect.die('unknown frame was accepted')
			})
		)
	);
});
