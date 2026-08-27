import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { makePiWorkbenchBridge } from './pi-workbench-bridge';

describe('Pi workbench bridge', () => {
	it.effect('emits one bounded typed interface-edit request', () =>
		Effect.gen(function* () {
			const events: Array<{
				readonly type: string;
				readonly requestId: string;
				readonly instruction: string;
			}> = [];
			const bridge = makePiWorkbenchBridge((event) => events.push(event));
			const result = yield* Effect.promise(() =>
				bridge.tool.execute(
					'tool-transition-1',
					{ instruction: 'Make the failed action clearer' },
					undefined,
					undefined,
					// makePiWorkbenchBridge's execute() never reads its ExtensionContext
					// argument (see pi-workbench-bridge.ts). That third-party type has ~16
					// required members, including a class field gated by a private
					// property, so no object literal can satisfy it structurally without
					// constructing a real ModelRuntime this test doesn't need. Object.create
					// returns `any`, so this assigns without an `as` type assertion.
					Object.create(null)
				)
			);

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0]?.type, 'interface_edit_requested');
			assert.strictEqual(events[0]?.requestId, 'tool-transition-1');
			assert.strictEqual(events[0]?.instruction, 'Make the failed action clearer');
			const content = result.content[0];
			assert.strictEqual(content?.type, 'text');
			if (content?.type === 'text') {
				assert.include(content.text, 'Flect will switch');
			}
		})
	);
});
