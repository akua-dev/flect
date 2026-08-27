import { Effect, Schema } from 'effect';

const HIGHLIGHT_THEMES = {
	dark: 'github-dark-default',
	light: 'github-light-default'
} as const;
const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

interface CacheEntry {
	readonly html: string;
	readonly bytes: number;
}

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

const cacheKey = (code: string, language: string): string => `${language}\u0000${code}`;

const estimateBytes = (key: string, code: string, html: string): number =>
	(key.length + code.length + html.length) * 2;

const readCache = (key: string): string | undefined => {
	const entry = cache.get(key);
	if (entry === undefined) {
		return undefined;
	}
	cache.delete(key);
	cache.set(key, entry);
	return entry.html;
};

const writeCache = (key: string, code: string, html: string): void => {
	const bytes = estimateBytes(key, code, html);
	if (bytes > MAX_CACHE_BYTES) {
		return;
	}

	cache.set(key, { html, bytes });
	cacheBytes += bytes;
	while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
		const oldest = cache.entries().next().value;
		if (oldest === undefined) {
			break;
		}
		cache.delete(oldest[0]);
		cacheBytes -= oldest[1].bytes;
	}
};

export class MarkdownHighlightError extends Schema.TaggedErrorClass<MarkdownHighlightError>()(
	'MarkdownHighlightError',
	{
		language: Schema.String
	}
) {}

export const highlightMarkdownCode = Effect.fn('Flect.Markdown.highlightCode')(function* (
	code: string,
	language: string
) {
	const key = cacheKey(code, language);
	const cached = readCache(key);
	if (cached !== undefined) {
		return cached;
	}

	const html = yield* Effect.tryPromise({
		try: async () => {
			const { codeToHtml } = await import('shiki/bundle/web');
			try {
				return await codeToHtml(code, {
					defaultColor: false,
					lang: language,
					themes: HIGHLIGHT_THEMES
				});
			} catch (cause) {
				if (language === 'text') {
					throw cause;
				}
				return await codeToHtml(code, {
					defaultColor: false,
					lang: 'text',
					themes: HIGHLIGHT_THEMES
				});
			}
		},
		catch: () => MarkdownHighlightError.make({ language })
	});

	writeCache(key, code, html);
	return html;
});

export const __markdownHighlightTest = {
	has: (code: string, language: string): boolean => cache.has(cacheKey(code, language)),
	reset: (): void => {
		cache.clear();
		cacheBytes = 0;
	},
	size: (): number => cache.size
};
