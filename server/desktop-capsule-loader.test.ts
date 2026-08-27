import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { capsuleHostFixture } from '../shared/capsule-fixture';
import { loadDesktopCapsule } from './desktop-capsule-loader';

describe('desktop capsule loader', () => {
	it('opens the canonical cross-host fixture', async () => {
		const archive = await Effect.runPromise(capsuleHostFixture);
		const capsule = await Effect.runPromise(loadDesktopCapsule(archive));
		expect(capsule.manifest.id).toBe('dev.akua.host-contract');
	});
});
