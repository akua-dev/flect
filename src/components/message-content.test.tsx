// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { vi } from 'vitest';
import { MessageContent } from './message-content';

const highlightMarkdownCode = vi.hoisted(() =>
	vi.fn((code: string, language: string) =>
		Effect.succeed(
			`<pre class="shiki" data-highlight-language="${language}"><code>${code}</code></pre>`
		)
	)
);

vi.mock('./markdown-highlighter', () => ({ highlightMarkdownCode }));

afterEach(cleanup);

describe('MessageContent', () => {
	it('renders complete semantic GFM and footnotes', () => {
		const { container } = render(
			<MessageContent
				content={`# Release notes

**Strong**, *emphasis*, ~~removed~~, and \`inline()\`.

> A quoted decision.

1. First
2. Second

- [x] Complete
- [ ] Remaining

A footnote.[^1]

[^1]: Supporting detail.`}
				messageRole='assistant'
			/>
		);

		expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeVisible();
		expect(container.querySelector('strong')).toHaveTextContent('Strong');
		expect(container.querySelector('em')).toHaveTextContent('emphasis');
		expect(container.querySelector('del')).toHaveTextContent('removed');
		expect(container.querySelector('blockquote')).toHaveTextContent('A quoted decision.');
		expect(container.querySelector('ol')).toBeInTheDocument();
		expect(container.querySelector('code:not(pre code)')).toHaveTextContent('inline()');

		const tasks = screen.getAllByRole('checkbox');
		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toBeChecked();
		expect(tasks[1]).not.toBeChecked();
		expect(tasks[0]).toBeDisabled();
		expect(tasks[1]).toBeDisabled();
		expect(screen.getByRole('doc-noteref')).toHaveAttribute('href', '#user-content-fn-1');
		expect(screen.getByRole('doc-endnotes')).toHaveTextContent('Supporting detail.');
		expect(container).not.toHaveTextContent('**Strong**');
	});

	it('uses chat hard breaks only for user and activity messages', () => {
		const user = render(<MessageContent content={'line one\nline two'} messageRole='user' />);
		expect(user.container.querySelectorAll('br')).toHaveLength(1);
		user.unmount();

		const assistant = render(
			<MessageContent content={'line one\nline two'} messageRole='assistant' />
		);
		expect(assistant.container.querySelectorAll('br')).toHaveLength(0);
		expect(assistant.container.querySelector('p')).toHaveTextContent('line one line two');
	});

	it('sanitizes active content while preserving safe details and text', () => {
		const { container } = render(
			<MessageContent
				content={`<script>window.__unsafe = true</script>
<span onclick="window.__unsafe = true" style="color:red">Safe text</span>

[unsafe](javascript:alert(1))
[safe](https://example.com/docs)

<details open><summary>More</summary>Safe detail</details>

<img src="https://example.com/tracker.png" alt="tracker" />
<iframe src="https://example.com"></iframe>
<form><input value="secret" /></form>`}
				messageRole='assistant'
			/>
		);

		expect(
			container.querySelector('script, style, iframe, object, form, img, audio, video')
		).not.toBeInTheDocument();
		expect(container.querySelector('[onclick], [style]')).not.toBeInTheDocument();
		expect(screen.getByText('Safe text')).toBeVisible();

		const unsafe = screen.getByText('unsafe');
		expect(unsafe.closest('a')).not.toBeInTheDocument();

		const safe = screen.getByRole('link', { name: 'safe' });
		expect(safe).toHaveAttribute('href', 'https://example.com/docs');
		expect(safe).toHaveAttribute('target', '_blank');
		expect(safe).toHaveAttribute('rel', 'noopener noreferrer');

		const details = screen.getByText('More').closest('details');
		expect(details).toHaveAttribute('open');
		expect(details).toHaveTextContent('Safe detail');
	});

	it('keeps local fragments local and incomplete code visible', () => {
		const { container } = render(
			<MessageContent
				content={`## Summary

[Jump](#summary)

\`\`\`ts
const answer = 42`}
				messageRole='assistant'
				streaming
			/>
		);

		expect(screen.getByRole('link', { name: 'Jump' })).toHaveAttribute('href', '#summary');
		const code = container.querySelector('pre code');
		expect(code).toHaveTextContent('const answer = 42');
		if (!(code instanceof HTMLElement)) {
			throw new Error('Expected the highlighted code block to be an HTMLElement.');
		}
		expect(within(code).queryByRole('button')).toBeNull();
	});

	it('resolves repeated fragments inside their own message first', async () => {
		const user = userEvent.setup();
		const outside = document.createElement('div');
		outside.id = 'user-content-fn-1';
		document.body.append(outside);
		const outsideScroll = vi.fn();
		const localScroll = vi.fn();
		Object.defineProperty(outside, 'scrollIntoView', {
			configurable: true,
			value: outsideScroll
		});

		const { container } = render(
			<MessageContent
				content={`A local note.[^1]

[^1]: Inside this message.`}
				messageRole='assistant'
			/>
		);
		const local = container.querySelector('#user-content-fn-1');
		Object.defineProperty(local, 'scrollIntoView', {
			configurable: true,
			value: localScroll
		});

		await user.click(screen.getByRole('doc-noteref'));

		expect(localScroll).toHaveBeenCalledOnce();
		expect(outsideScroll).not.toHaveBeenCalled();
		outside.remove();
	});

	it('promotes complete titled fences into rich code instruments', async () => {
		const user = userEvent.setup();
		const fixture = () => (
			<MessageContent
				content={`\`\`\`ts title="src/app.ts"
const answer: number = 42
\`\`\``}
				messageRole='assistant'
			/>
		);
		const { container, rerender } = render(fixture());

		expect(screen.getByText('src/app.ts')).toBeVisible();
		expect(container.querySelector('[data-language="typescript"]')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Wrap lines' })).toBeVisible();
		await waitFor(() => expect(container.querySelector('.shiki')).toBeInTheDocument());
		expect(highlightMarkdownCode).toHaveBeenCalledWith('const answer: number = 42\n', 'typescript');

		await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
		rerender(fixture());
		expect(screen.getByRole('button', { name: 'Disable line wrap' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('promotes GFM tables into contained copyable instruments', () => {
		const { container } = render(
			<MessageContent
				content={`| Name | State |
| --- | --- |
| Flect | Ready |`}
				messageRole='assistant'
			/>
		);

		expect(screen.getByRole('table')).toBeVisible();
		expect(container.querySelector('.markdown-table')).toHaveAttribute('data-expanded', 'false');
		expect(screen.getByRole('button', { name: 'Expand table cells' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Copy table as Markdown' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Copy table as CSV' })).toBeVisible();
	});
});
