import { assert, describe, it } from '@effect/vitest';
import { makeBoundedWasiOutput, WasiOutputLimitExceeded } from './rifty-wasi-output';

describe('bounded WASI output', () => {
	it('fails during stdout emission instead of retaining over-limit output', () => {
		const output = makeBoundedWasiOutput();

		output.stdout('x'.repeat(1_048_576));
		let failure: unknown;
		try {
			output.stdout('y');
		} catch (error) {
			failure = error;
		}

		assert.isTrue(failure instanceof WasiOutputLimitExceeded);
		assert.strictEqual(output.stdoutText(), 'x'.repeat(1_048_576));
	});

	it('enforces stderr independently at the callback boundary', () => {
		const output = makeBoundedWasiOutput();

		output.stderr('x'.repeat(1_048_576));
		let failure: unknown;
		try {
			output.stderr('y');
		} catch (error) {
			failure = error;
		}

		assert.isTrue(failure instanceof WasiOutputLimitExceeded);
		assert.strictEqual(output.stderrText(), 'x'.repeat(1_048_576));
	});
});
