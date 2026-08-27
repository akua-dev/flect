import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { compareUnsignedReleaseTrees } from './compare-release-builds';

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
	for (const path of temporaryDirectories.splice(0)) {
		await rm(path, { recursive: true, force: true });
	}
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'flect-build-compare-'));
	temporaryDirectories.push(root);
	const first = join(root, 'first', 'Flect.app');
	const second = join(root, 'second', 'Flect.app');
	for (const path of [first, second]) {
		await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true });
		await mkdir(join(path, 'Contents', '_CodeSignature'), { recursive: true });
		await writeFile(join(path, 'Contents', 'MacOS', 'flect'), 'same binary');
	}
	return { first, second };
};

describe('independent release comparison', () => {
	it('accepts identical unsigned content and ignores only signature envelopes', async () => {
		const { first, second } = await fixture();
		await writeFile(join(first, 'Contents', '_CodeSignature', 'CodeResources'), 'first signature');
		await writeFile(
			join(second, 'Contents', '_CodeSignature', 'CodeResources'),
			'second signature'
		);

		await expect(
			Effect.runPromise(compareUnsignedReleaseTrees(first, second))
		).resolves.toMatchObject({ verified: true, changedPaths: [] });
	});

	it('fails exact executable changes with bounded byte offsets', async () => {
		const { first, second } = await fixture();
		await writeFile(join(second, 'Contents', 'MacOS', 'flect'), 'same bXnary');

		const comparison = await Effect.runPromise(compareUnsignedReleaseTrees(first, second));
		expect(comparison.verified).toBe(false);
		expect(comparison.changedPaths).toEqual(['Contents/MacOS/flect']);
		expect(comparison.binaryOffsets['Contents/MacOS/flect']).toEqual([6]);
	});

	it('does not normalize a Tauri Isolation UUID variance', async () => {
		const { first, second } = await fixture();
		await writeFile(
			join(first, 'Contents', 'MacOS', 'flect'),
			'isolation-schema-id=11111111-1111-4111-8111-111111111111'
		);
		await writeFile(
			join(second, 'Contents', 'MacOS', 'flect'),
			'isolation-schema-id=22222222-2222-4222-8222-222222222222'
		);

		const comparison = await Effect.runPromise(compareUnsignedReleaseTrees(first, second));
		expect(comparison.verified).toBe(false);
		expect(comparison.changedPaths).toContain('Contents/MacOS/flect');
		expect(comparison.binaryOffsets['Contents/MacOS/flect']?.length).toBeGreaterThan(0);
	});
});
