import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { PackageMirrorRequest } from '../../shared/browser-execution';
import { badIntegrityRegistryFetch, fixtureRegistryFetch } from './fixtures/package-registry';
import { makeRiftyPackageMirrorLayer, RiftyPackageMirror } from './rifty-package-mirror';

const request = PackageMirrorRequest.make({
	version: 1,
	name: 'flect-test',
	packageVersion: '1.0.0',
	dependencies: {
		'flect-fixture': '1.0.0'
	}
});

describe('RiftyPackageMirror', () => {
	it.layer(makeRiftyPackageMirrorLayer({ fetch: fixtureRegistryFetch }))((it) => {
		it.effect('installs one verified package and writes a v3 lockfile', () =>
			Effect.gen(function* () {
				const mirror = yield* RiftyPackageMirror;
				const result = yield* mirror.install(request);

				assert.strictEqual(result.packageCount, 1);
				assert.isTrue(result.lockfileWritten);
			})
		);
	});

	it.layer(makeRiftyPackageMirrorLayer({ fetch: badIntegrityRegistryFetch }))((it) => {
		it.effect('fails closed on a tarball integrity mismatch', () =>
			Effect.gen(function* () {
				const mirror = yield* RiftyPackageMirror;
				const error = yield* mirror.install(request).pipe(Effect.flip);

				assert.strictEqual(error.reason, 'package');
				assert.strictEqual(error.operation, 'package-mirror');
			})
		);
	});
});
