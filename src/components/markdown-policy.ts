import { defaultUrlTransform, type UrlTransform } from 'react-markdown';

const SAFE_URL = /^(?:https?:|mailto:)/i;
const EXTERNAL_URL = /^https?:/i;
const FRAGMENT_URL = /^#[^\s]*$/;
const LANGUAGE_CLASS = /(?:^|\s)language-([^\s]+)/i;
const FENCE_TITLE = /(?:^|\s)(?:title|file|filename)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i;

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
	bash: 'shell',
	gitignore: 'ini',
	js: 'javascript',
	md: 'markdown',
	plaintext: 'text',
	sh: 'shell',
	ts: 'typescript',
	txt: 'text',
	yml: 'yaml'
};

export const markdownUrlTransform = ((url: string) => {
	const value = url.trim();
	if (FRAGMENT_URL.test(value)) {
		return value;
	}
	if (!SAFE_URL.test(value)) {
		return '';
	}
	return defaultUrlTransform(value);
}) satisfies UrlTransform;

export const isExternalMarkdownHref = (href: string): boolean => EXTERNAL_URL.test(href.trim());

export const normalizeSanitizedFragmentId = (id: string): string =>
	id.replace(/^user-content-/, '');

export const extractFenceLanguage = (className?: string): string => {
	const declared = LANGUAGE_CLASS.exec(className ?? '')?.[1]?.toLowerCase();
	if (declared === undefined || !/^[a-z0-9_+#.-]+$/.test(declared)) {
		return 'text';
	}
	return LANGUAGE_ALIASES[declared] ?? declared;
};

export const extractFenceTitle = (meta?: string): string | undefined => {
	const match = FENCE_TITLE.exec(meta ?? '');
	const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
	return value === undefined || value.length === 0 ? undefined : value;
};
