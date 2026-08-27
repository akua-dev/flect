import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';
import { capsuleHostFixture } from '../../shared/capsule-fixture';
import { loadBrowserCapsule, loadBrowserCapsuleArchiveFromUrl } from './browser-capsule-loader';

afterEach(() => vi.unstubAllGlobals());

describe('browser capsule loader', () => {
	it('opens the canonical cross-host fixture', async () => {
		const archive = await Effect.runPromise(capsuleHostFixture);
		const capsule = await Effect.runPromise(
			loadBrowserCapsule(new Blob([Uint8Array.from(archive)]))
		);
		expect(capsule.manifest.id).toBe('dev.akua.host-contract');
	});

	it('downloads and verifies a bounded HTTPS capsule before returning bytes', async () => {
		const archive = await Effect.runPromise(capsuleHostFixture);
		const fetch = vi.fn(() =>
			Promise.resolve(
				new Response(Uint8Array.from(archive), {
					headers: { 'content-length': String(archive.byteLength) }
				})
			)
		);
		vi.stubGlobal('fetch', fetch);

		const loaded = await Effect.runPromise(
			loadBrowserCapsuleArchiveFromUrl('https://example.test/app.flect')
		);
		expect(loaded).toEqual(archive);
		expect(fetch).toHaveBeenCalledWith(
			'https://example.test/app.flect',
			expect.objectContaining({ credentials: 'omit' })
		);
	});

	it('rejects unsafe schemes and oversized responses before decoding', async () => {
		const fetch = vi.fn(() =>
			Promise.resolve(
				new Response(new Uint8Array(), {
					headers: { 'content-length': String(33 * 1024 * 1024) }
				})
			)
		);
		vi.stubGlobal('fetch', fetch);

		await expect(
			Effect.runPromise(loadBrowserCapsuleArchiveFromUrl('file:///tmp/app.flect'))
		).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();

		await expect(
			Effect.runPromise(loadBrowserCapsuleArchiveFromUrl('https://example.test/large.flect'))
		).rejects.toThrow();
	});
});
