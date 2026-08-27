// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { vi } from 'vitest';
import type { Clipboard } from '../lib/clipboard';
import { MarkdownCodeBlock } from './markdown-code-block';

const highlightMarkdownCode = vi.hoisted(() =>
	vi.fn((code: string, language: string) =>
		Effect.succeed(
			`<pre class="shiki" data-highlight-language="${language}"><code>${code}</code></pre>`
		)
	)
);

vi.mock('./markdown-highlighter', () => ({ highlightMarkdownCode }));
const clipboardHarness = vi.hoisted(() => ({
	fail: false,
	writes: [] as Array<string>
}));
vi.mock('../lib/runtime', async () => {
	const { Effect } = await import('effect');
	const { Clipboard, ClipboardWriteError } = await import('../lib/clipboard');
	const { Layer } = await import('effect');
	const ClipboardTest = Layer.succeed(Clipboard)({
		writeText: (value: string) =>
			Effect.try({
				try: () => {
					if (clipboardHarness.fail) {
						throw new Error('permission denied');
					}
					clipboardHarness.writes.push(value);
				},
				catch: () =>
					ClipboardWriteError.make({
						message: 'Flect could not copy this content.'
					})
			})
	});
	return {
		browserRuntime: {
			runPromiseExit: <A, E>(effect: Effect.Effect<A, E, Clipboard>) =>
				Effect.runPromiseExit(effect.pipe(Effect.provide(ClipboardTest)))
		}
	};
});

beforeEach(() => {
	highlightMarkdownCode.mockClear();
	clipboardHarness.writes = [];
	clipboardHarness.fail = false;
});

afterEach(cleanup);

describe('MarkdownCodeBlock', () => {
	it('renders title, lazy highlighting, wrap, and exact copy', async () => {
		const user = userEvent.setup();
		const { container } = render(
			<MarkdownCodeBlock
				code={'const answer: number = 42'}
				language='typescript'
				streaming={false}
				title='src/app.ts'
			/>
		);

		expect(screen.getByText('src/app.ts')).toBeVisible();
		expect(container.querySelector('[data-language="typescript"]')).toBeInTheDocument();
		expect(screen.getByText('const answer: number = 42')).toBeVisible();

		await waitFor(() => expect(container.querySelector('.shiki')).toBeInTheDocument());

		const wrap = screen.getByRole('button', { name: 'Wrap lines' });
		await user.click(wrap);
		expect(screen.getByRole('button', { name: 'Disable line wrap' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await user.click(screen.getByRole('button', { name: 'Copy code' }));
		await waitFor(() => expect(clipboardHarness.writes).toEqual(['const answer: number = 42']));
		expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent('Copied');
	});

	it('announces a typed clipboard failure', async () => {
		clipboardHarness.fail = true;
		const user = userEvent.setup();
		render(<MarkdownCodeBlock code='denied' language='text' streaming={false} />);

		await user.click(screen.getByRole('button', { name: 'Copy code' }));

		expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent('Copy failed');
	});

	it('keeps streaming source plain and skips highlighting', async () => {
		const { container } = render(
			<MarkdownCodeBlock code='incomplete source' language='typescript' streaming />
		);

		expect(screen.getByText('incomplete source')).toBeVisible();
		expect(container.querySelector('.shiki')).not.toBeInTheDocument();
		await Promise.resolve();
		expect(highlightMarkdownCode).not.toHaveBeenCalled();
	});
});
