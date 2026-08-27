import { assert, it } from '@effect/vitest';
import { Effect } from 'effect';
import { runTrustedExtensionFailureProbe } from './pi-extension-isolation';

it.effect('observes a genuine Pi extension failure through a bounded event', () =>
	Effect.gen(function* () {
		const fixturePath = new URL(
			'../tests/fixtures/pi-extensions/fail-on-agent-start.ts',
			import.meta.url
		).pathname;
		const event = yield* runTrustedExtensionFailureProbe(fixturePath, 'app');
		const publicEvidence = JSON.stringify(event);

		assert.strictEqual(event.type, 'external_extension_failed');
		assert.strictEqual(event.role, 'app');
		assert.strictEqual(event.stage, 'turn');
		assert.strictEqual(event.message, 'A trusted Pi extension failed.');
		assert.strictEqual(event.recovery, 'Disable trusted Pi extensions for this agent and retry.');
		assert.notInclude(publicEvidence, fixturePath);
		assert.notInclude(publicEvidence, 'FLECT_PRIVATE_EXTENSION_FIXTURE_FAILURE');
		assert.notInclude(publicEvidence, 'stack');
	})
);
