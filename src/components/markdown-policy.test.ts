import { describe, expect, it } from '@effect/vitest';
import {
	extractFenceLanguage,
	extractFenceTitle,
	isExternalMarkdownHref,
	markdownUrlTransform,
	normalizeSanitizedFragmentId
} from './markdown-policy';

describe('Markdown policy', () => {
	it.each([
		['https://example.com', 'https://example.com'],
		['http://example.com', 'http://example.com'],
		['mailto:team@example.com', 'mailto:team@example.com'],
		['#summary', '#summary'],
		['javascript:alert(1)', ''],
		['data:text/html,boom', ''],
		['file:///tmp/private', ''],
		['//example.com/path', ''],
		['/relative/path', ''],
		['relative/path', ''],
		['tel:+15555550123', '']
	])('transforms %s to the closed-policy result', (value, expected) => {
		expect(markdownUrlTransform(value)).toBe(expected);
	});

	it('classifies only HTTP links as external browsing targets', () => {
		expect(isExternalMarkdownHref('https://example.com')).toBe(true);
		expect(isExternalMarkdownHref('http://example.com')).toBe(true);
		expect(isExternalMarkdownHref('mailto:team@example.com')).toBe(false);
		expect(isExternalMarkdownHref('#summary')).toBe(false);
	});

	it('normalizes sanitizer-prefixed fragment identifiers', () => {
		expect(normalizeSanitizedFragmentId('user-content-summary')).toBe('summary');
		expect(normalizeSanitizedFragmentId('summary')).toBe('summary');
	});

	it.each([
		['language-ts', 'typescript'],
		['token language-js highlighted', 'javascript'],
		['language-sh', 'shell'],
		['language-bash', 'shell'],
		['language-yml', 'yaml'],
		['language-md', 'markdown'],
		['language-plaintext', 'text'],
		['language-gitignore', 'ini'],
		[undefined, 'text']
	])('extracts language from %s', (className, expected) => {
		expect(extractFenceLanguage(className)).toBe(expected);
	});

	it.each([
		['title="src/app.ts"', 'src/app.ts'],
		['filename=server.ts', 'server.ts'],
		["file='docs/with spaces.md'", 'docs/with spaces.md'],
		['ts title=src/plain.ts', 'src/plain.ts'],
		['title=', undefined],
		[undefined, undefined]
	])('extracts a safe fence title from %s', (meta, expected) => {
		expect(extractFenceTitle(meta)).toBe(expected);
	});
});
