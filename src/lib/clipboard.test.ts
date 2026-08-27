import { beforeEach, describe, expect, layer, vi } from '@effect/vitest';
import { Effect } from 'effect';
import { Clipboard, ClipboardLive, ClipboardWriteError } from './clipboard';

const writeText = vi.fn<(value: string) => Promise<void>>();

describe('Clipboard', () => {
	beforeEach(() => {
		writeText.mockReset();
		writeText.mockResolvedValue(undefined);
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
	});

	layer(ClipboardLive)((it) => {
		it.effect('writes text through the browser clipboard', () =>
			Effect.gen(function* () {
				const clipboard = yield* Clipboard;
				yield* clipboard.writeText('exact Markdown');

				expect(writeText).toHaveBeenCalledExactlyOnceWith('exact Markdown');
			})
		);

		it.effect('keeps clipboard rejection typed', () =>
			Effect.gen(function* () {
				writeText.mockRejectedValueOnce(new Error('permission denied'));
				const clipboard = yield* Clipboard;
				const error = yield* clipboard.writeText('blocked').pipe(Effect.flip);

				expect(error).toEqual(
					ClipboardWriteError.make({
						message: 'Flect could not copy this content.'
					})
				);
			})
		);
	});
});
