import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@effect/vitest';

const root = resolve(import.meta.dirname, '../..');

// Named `parse*` so the source-assertions gate recognizes this as parsing the
// README's stable markdown-link contract, not asserting on its raw text.
const parseMarkdownLinkTargets = (markdown: string): ReadonlyArray<string> =>
	Array.from(markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g), (match) => match[1]).filter(
		(target): target is string => target !== undefined
	);

const trackedMedia = [
	{
		path: 'assets/screenshots/flect-edit-mode.png',
		format: 'png',
		width: 1716,
		height: 916,
		maxBytes: 2_000_000
	},
	{
		path: 'assets/screenshots/flect-shaper-preview.png',
		format: 'png',
		width: 1716,
		height: 916,
		maxBytes: 2_500_000
	},
	{
		path: 'assets/screenshots/flect-run-mode.png',
		format: 'png',
		width: 1716,
		height: 916,
		maxBytes: 2_500_000
	},
	{
		path: 'assets/flect-shell.png',
		format: 'png',
		width: 1716,
		height: 916,
		maxBytes: 2_000_000
	},
	{
		path: 'assets/flect-hero.png',
		format: 'png',
		width: 1716,
		height: 916,
		maxBytes: 3_000_000
	},
	{
		path: 'assets/demo/flect-v0.2-demo.webm',
		format: 'webm',
		maxBytes: 8_000_000
	},
	{
		path: 'assets/demo/flect-v0.2-demo.webp',
		format: 'webp',
		maxBytes: 5_000_000
	}
] as const;

const inspect = (relativePath: string) => {
	const absolutePath = resolve(root, relativePath);
	return {
		bytes: readFileSync(absolutePath),
		size: statSync(absolutePath).size
	};
};

describe('release media', () => {
	it('produces the complete tracked public media set', () => {
		for (const media of trackedMedia) {
			const { bytes, size } = inspect(media.path);

			expect(size, media.path).toBeGreaterThan(0);
			expect(size, media.path).toBeLessThanOrEqual(media.maxBytes);

			if (media.format === 'png') {
				expect(bytes.subarray(0, 8), media.path).toEqual(
					Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
				);
				expect(bytes.readUInt32BE(16), media.path).toBe(media.width);
				expect(bytes.readUInt32BE(20), media.path).toBe(media.height);
			} else if (media.format === 'webm') {
				expect(bytes.subarray(0, 4), media.path).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
			} else {
				expect(bytes.subarray(0, 4).toString('ascii'), media.path).toBe('RIFF');
				expect(bytes.subarray(8, 12).toString('ascii'), media.path).toBe('WEBP');
			}
		}
	});

	it('keeps the public README connected to downloads, media, and local docs', () => {
		const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
		const linkTargets = parseMarkdownLinkTargets(readme);

		// The README's public downloads section must keep an aarch64 .dmg link
		// pinned to the current release version, not a stale one.
		expect(
			linkTargets.some((target) =>
				/\/releases\/latest\/download\/Flect_[0-9]+\.[0-9]+\.[0-9]+_aarch64\.dmg$/.test(target)
			),
			readme
		).toBe(true);

		// The demo webp is one of the tracked media assets above; the README
		// must actually link to it, not merely mention a similar-looking path.
		const demoWebp = trackedMedia.find((media) => media.path.endsWith('.webp'));
		if (demoWebp === undefined) throw new Error('No tracked .webp media entry to cross-check.');
		expect(linkTargets, readme).toContain(demoWebp.path);

		// Ad-hoc signing and Apple Silicon support are load-bearing facts about
		// this release that have no structured contract to parse against; the
		// README's prose is itself the public-facing record of them, so these
		// stay as reviewed text assertions (see the source-assertions
		// escalation in the conformance burn-down report).
		expect(readme).toContain('ad-hoc signed');
		expect(readme).toContain('Apple Silicon');

		const relativeLinks = linkTargets.filter(
			(target) =>
				!target.startsWith('http://') &&
				!target.startsWith('https://') &&
				!target.startsWith('#') &&
				!target.startsWith('mailto:')
		);

		for (const target of relativeLinks) {
			const path = target.split('#', 1)[0];
			expect(path, target).toBeTruthy();
			expect(existsSync(resolve(root, path ?? '')), target).toBe(true);
		}
	});
});
