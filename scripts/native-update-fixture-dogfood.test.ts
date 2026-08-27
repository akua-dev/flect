import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { runNativeUpdateFixtureDogfood } from './native-update-fixture-dogfood';

describe('native update fixture dogfood', () => {
	it.live('preserves durable state across a signed update and corrupt-signature rejection', () =>
		Effect.gen(function* () {
			const report = yield* runNativeUpdateFixtureDogfood();

			assert.strictEqual(report.transport, 'loopback');
			assert.strictEqual(report.installedVersion, '0.2.0');
			assert.strictEqual(report.relaunchedVersion, '0.2.0');
			assert.deepStrictEqual(report.preserved, ['workspace', 'settings', 'grants', 'extensions']);
			assert.strictEqual(report.corruptSignature, 'rejected');
			assert.strictEqual(report.bundleAfterRejection, 'unchanged');
			assert.strictEqual(report.stateAfterRejection, 'unchanged');
		})
	);
});
