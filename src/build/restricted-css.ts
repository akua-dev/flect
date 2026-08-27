import type { BuildEntry } from './browser-build-digest';

const normalizeAbsolutePath = (path: string) => {
	const parts: Array<string> = [];
	for (const part of path.split('/')) {
		if (part.length === 0 || part === '.') {
			continue;
		}
		if (part === '..') {
			if (parts.length === 0) {
				return undefined;
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join('/')}`;
};

export const resolveRestrictedCssImport = (
	source: string,
	importer: string | undefined,
	root: string,
	files: ReadonlySet<string>
) => {
	if (
		importer === undefined ||
		!source.endsWith('.css') ||
		(!source.startsWith('./') && !source.startsWith('../'))
	) {
		return undefined;
	}
	const slash = importer.lastIndexOf('/');
	const resolved = normalizeAbsolutePath(`${importer.slice(0, Math.max(0, slash))}/${source}`);
	return resolved?.startsWith(`${root}/`) && files.has(resolved) ? resolved : undefined;
};

export const collectRestrictedCss = (files: ReadonlyArray<BuildEntry>) => {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const encoder = new TextEncoder();
	const css = files
		.filter((file) => file.path.endsWith('.css'))
		.toSorted((left, right) => left.path.localeCompare(right.path))
		.map((file) => `/* ${file.path} */\n${decoder.decode(file.contents)}\n`)
		.join('');
	return encoder.encode(css);
};
