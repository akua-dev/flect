import { beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { vi } from 'vitest';
import { __markdownHighlightTest, highlightMarkdownCode } from './markdown-highlighter';

const codeToHtml = vi.hoisted(() =>
	vi.fn(
		async (
			code: string,
			options: {
				readonly defaultColor: false;
				readonly lang: string;
				readonly themes: {
					readonly dark: string;
					readonly light: string;
				};
			}
		) => {
			if (options.lang === 'unsupported') {
				throw new Error('Unknown language');
			}
			return `<pre class="shiki" data-lang="${options.lang}" data-themes="${options.themes.light},${options.themes.dark}"><code>${code.replaceAll('<', '&lt;')}</code></pre>`;
		}
	)
);

vi.mock('shiki/bundle/web', () => ({ codeToHtml }));

describe('highlightMarkdownCode', () => {
	beforeEach(() => {
		codeToHtml.mockClear();
		__markdownHighlightTest.reset();
	});

	it.effect('returns escaped Shiki output with pinned adaptive themes', () =>
		Effect.gen(function* () {
			const html = yield* highlightMarkdownCode('const value = <Widget />', 'typescript');

			expect(html).toContain('<pre class="shiki"');
			expect(html).toContain('const value = &lt;Widget />');
			expect(codeToHtml).toHaveBeenCalledExactlyOnceWith('const value = <Widget />', {
				defaultColor: false,
				lang: 'typescript',
				themes: {
					dark: 'github-dark-default',
					light: 'github-light-default'
				}
			});
		})
	);

	it.effect('falls back to text for unsupported languages', () =>
		Effect.gen(function* () {
			const html = yield* highlightMarkdownCode('plain source', 'unsupported');

			expect(html).toContain('data-lang="text"');
			expect(codeToHtml).toHaveBeenNthCalledWith(1, 'plain source', {
				defaultColor: false,
				lang: 'unsupported',
				themes: {
					dark: 'github-dark-default',
					light: 'github-light-default'
				}
			});
			expect(codeToHtml).toHaveBeenNthCalledWith(2, 'plain source', {
				defaultColor: false,
				lang: 'text',
				themes: {
					dark: 'github-dark-default',
					light: 'github-light-default'
				}
			});
		})
	);

	it.effect('reuses a cached result', () =>
		Effect.gen(function* () {
			const first = yield* highlightMarkdownCode('const answer = 42', 'ts');
			const second = yield* highlightMarkdownCode('const answer = 42', 'ts');

			expect(second).toBe(first);
			expect(codeToHtml).toHaveBeenCalledTimes(1);
			expect(__markdownHighlightTest.size()).toBe(1);
		})
	);

	it.effect('evicts the oldest result after the entry limit', () =>
		Effect.gen(function* () {
			for (let index = 0; index <= 100; index += 1) {
				yield* highlightMarkdownCode(`value-${index}`, 'text');
			}

			expect(__markdownHighlightTest.size()).toBe(100);
			expect(__markdownHighlightTest.has('value-0', 'text')).toBe(false);
			expect(__markdownHighlightTest.has('value-100', 'text')).toBe(true);
		})
	);
});
