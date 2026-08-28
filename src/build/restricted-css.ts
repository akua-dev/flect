import { Option } from 'effect';
import type { BuildEntry } from './browser-build-digest';

const normalizeAbsolutePath = (path: string): Option.Option<string> => {
	const parts: Array<string> = [];
	for (const part of path.split('/')) {
		if (part.length === 0 || part === '.') {
			continue;
		}
		if (part === '..') {
			if (parts.length === 0) {
				return Option.none();
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return Option.some(`/${parts.join('/')}`);
};

/**
 * Resolves a CSS import in the rolldown `resolveId` hook (see
 * `browser-build-worker.ts`) to its mirrored absolute path when the request
 * is a local, in-bundle stylesheet — `Option.none()` otherwise, so the
 * bundler falls through to its default resolution.
 */
export const resolveRestrictedCssImport = (
	source: string,
	importer: string | undefined,
	root: string,
	files: ReadonlySet<string>
): Option.Option<string> => {
	if (
		importer === undefined ||
		!source.endsWith('.css') ||
		(!source.startsWith('./') && !source.startsWith('../'))
	) {
		return Option.none();
	}
	const slash = importer.lastIndexOf('/');
	return normalizeAbsolutePath(`${importer.slice(0, Math.max(0, slash))}/${source}`).pipe(
		Option.filter((resolved) => resolved.startsWith(`${root}/`) && files.has(resolved))
	);
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
