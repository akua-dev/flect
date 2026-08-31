import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { assert, describe, it } from '@effect/vitest';
import { Effect, FileSystem, Layer, Path } from 'effect';

const PlatformLive = Layer.merge(BunFileSystem.layer, BunPath.layer);

// `tauri dev` waits for `devUrl` before opening the window, and the Astro dev
// server's port is pinned in astro.config.ts. Those two numbers live in
// different files with no compiler relationship, so when the Astro port was
// pinned to 5173 the Tauri config kept pointing at Astro's old default (4321)
// and `bun run dev:desktop` hung silently, waiting on a URL nothing served.
// These assertions tie them together so the next port change cannot drift.
const readRepoFile = Effect.fn('TauriDevUrl.readRepoFile')(function* (relative: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const resolved = yield* path.fromFileUrl(new URL(`../${relative}`, import.meta.url));
	return yield* fs.readFileString(resolved);
});

const pinnedAstroPort = Effect.fn('TauriDevUrl.pinnedAstroPort')(function* () {
	const source = yield* readRepoFile('astro.config.ts');
	const match = /server:\s*\{[^}]*?port:\s*(\d+)/su.exec(source);
	assert.isNotNull(match, 'astro.config.ts must pin an explicit server.port');
	return Number(match?.[1]);
});

const tauriDevUrl = Effect.fn('TauriDevUrl.configured')(function* () {
	const source = yield* readRepoFile('src-tauri/tauri.conf.json');
	const config: unknown = JSON.parse(source);
	const devUrl = (config as { build?: { devUrl?: unknown } }).build?.devUrl;
	assert.isString(devUrl, 'tauri.conf.json must declare build.devUrl');
	return new URL(devUrl as string);
});

describe('desktop dev server wiring', () => {
	it.effect('points tauri devUrl at the pinned Astro dev port', () =>
		Effect.gen(function* () {
			const port = yield* pinnedAstroPort();
			const devUrl = yield* tauriDevUrl();
			assert.strictEqual(
				Number(devUrl.port),
				port,
				`tauri.conf.json build.devUrl (${devUrl.href}) must use the Astro dev port ${port}`
			);
		}).pipe(Effect.provide(PlatformLive))
	);

	it.effect('keeps the desktop dev URL on loopback', () =>
		Effect.gen(function* () {
			const devUrl = yield* tauriDevUrl();
			assert.strictEqual(devUrl.hostname, '127.0.0.1');
			assert.strictEqual(devUrl.protocol, 'http:');
		}).pipe(Effect.provide(PlatformLive))
	);
});
