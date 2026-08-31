import { readFile } from 'node:fs/promises';
import { assert, describe, it } from '@effect/vitest';

// `tauri dev` waits for `devUrl` before opening the window, and the Astro dev
// server's port is pinned in astro.config.ts. Those two numbers are set in
// different files with no compiler relationship, so when the Astro port was
// pinned to 5173 the Tauri config kept pointing at Astro's old default (4321)
// and `bun run dev:desktop` hung silently, waiting on a URL nothing served.
// This test ties them together so the next port change cannot drift again.
const readPinnedAstroPort = async () => {
	const source = await readFile('astro.config.ts', 'utf8');
	const match = /server:\s*\{[^}]*?port:\s*(\d+)/su.exec(source);
	assert.isNotNull(match, 'astro.config.ts must pin an explicit server.port');
	return Number(match?.[1]);
};

const readTauriDevUrl = async () => {
	const config: unknown = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
	const build = (config as { build?: { devUrl?: unknown } }).build;
	const devUrl = build?.devUrl;
	assert.isString(devUrl, 'tauri.conf.json must declare build.devUrl');
	return new URL(devUrl as string);
};

describe('desktop dev server wiring', () => {
	it('points tauri devUrl at the pinned Astro dev port', async () => {
		const port = await readPinnedAstroPort();
		const devUrl = await readTauriDevUrl();
		assert.strictEqual(
			Number(devUrl.port),
			port,
			`tauri.conf.json build.devUrl (${devUrl.href}) must use the Astro dev port ${port}`
		);
	});

	it('keeps the desktop dev URL on loopback', async () => {
		const devUrl = await readTauriDevUrl();
		assert.strictEqual(devUrl.hostname, '127.0.0.1');
		assert.strictEqual(devUrl.protocol, 'http:');
	});
});
