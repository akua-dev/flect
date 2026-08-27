import { assert, describe, it } from '@effect/vitest';
import type { Fetcher } from '@riftydev/npm-client';
import { Effect, Ref } from 'effect';
import type { WorkspaceDelta } from '../../shared/bun-command';
import {
	BunPackageMutation,
	type BunPackageWorkspace,
	canonicalPackageVfsPath,
	makeBunPackageMutationLayer
} from './bun-package-mutation';
import {
	badIntegrityRegistryFetch,
	fixtureRegistryFetch,
	traversalRegistryFetch
} from './fixtures/package-registry';

const decoder = new TextDecoder();

const emptyWorkspace = (): BunPackageWorkspace => ({
	files: {
		'/workspace/package.json':
			'{\n  "name": "fixture-app",\n  "private": true,\n  "dependencies": {}\n}\n'
	}
});

const installWorkspace = (): BunPackageWorkspace => ({
	files: {
		'/workspace/package.json':
			'{\n  "name": "fixture-app",\n  "private": true,\n  "dependencies": {\n    "flect-fixture": "1.0.0"\n  }\n}\n'
	}
});

const textAt = (delta: WorkspaceDelta, path: string) => {
	const change = delta.files.find(
		(candidate) => candidate.operation === 'write' && candidate.path === path
	);
	return change?.operation === 'write' ? decoder.decode(change.content) : undefined;
};

const applyDelta = (workspace: BunPackageWorkspace, delta: WorkspaceDelta): BunPackageWorkspace => {
	const files = new Map(Object.entries(workspace.files));
	for (const change of delta.files) {
		if (change.operation === 'remove') {
			files.delete(change.path);
		} else {
			files.set(change.path, decoder.decode(change.content));
		}
	}
	return { files: Object.fromEntries(files) };
};

describe('BunPackageMutation', () => {
	it('normalizes only private cache separator artifacts', () => {
		assert.strictEqual(
			canonicalPackageVfsPath('/.rifty/tarball-cache//A/package.tgz'),
			'/.rifty/tarball-cache/A/package.tgz'
		);
		assert.throws(() => canonicalPackageVfsPath('/workspace/node_modules//outside/index.js'));
		assert.throws(() => canonicalPackageVfsPath('/outside/package.json'));
	});

	it.layer(makeBunPackageMutationLayer({ fetch: fixtureRegistryFetch }))((it) => {
		it.effect('installs verified packages and returns only a staged delta', () =>
			Effect.gen(function* () {
				const source = installWorkspace();
				const before = structuredClone(source);
				const packages = yield* BunPackageMutation;
				const output = yield* packages.install({
					cwd: '/workspace',
					workspace: source
				});

				assert.deepStrictEqual(source, before);
				assert.strictEqual(
					JSON.parse(
						textAt(output.delta, '/workspace/node_modules/flect-fixture/package.json') ?? '{}'
					).name,
					'flect-fixture'
				);
				assert.strictEqual(
					JSON.parse(textAt(output.delta, '/workspace/package-lock.json') ?? '{}').lockfileVersion,
					3
				);
				assert.isFalse(
					output.delta.files.some(({ path }) => path.includes('lifecycle-script-ran'))
				);
			})
		);

		it.effect('adds and removes a dependency through portable deltas', () =>
			Effect.gen(function* () {
				const packages = yield* BunPackageMutation;
				const initial = emptyWorkspace();
				const added = yield* packages.add({
					cwd: '/workspace',
					args: ['flect-fixture@1.0.0'],
					workspace: initial
				});
				const addedManifest = JSON.parse(textAt(added.delta, '/workspace/package.json') ?? '{}');
				assert.strictEqual(addedManifest.dependencies['flect-fixture'], '1.0.0');

				const withPackage = applyDelta(initial, added.delta);
				const removed = yield* packages.remove({
					cwd: '/workspace',
					args: ['flect-fixture'],
					workspace: withPackage
				});
				const removedManifest = JSON.parse(
					textAt(removed.delta, '/workspace/package.json') ?? '{}'
				);
				assert.isUndefined(removedManifest.dependencies['flect-fixture']);
				assert.isTrue(
					removed.delta.files.some(
						(change) =>
							change.operation === 'remove' &&
							change.path === '/workspace/node_modules/flect-fixture/package.json'
					)
				);
			})
		);
	});

	it.layer(makeBunPackageMutationLayer({ fetch: badIntegrityRegistryFetch }))((it) => {
		it.effect('fails closed when package integrity does not match', () =>
			Effect.gen(function* () {
				const packages = yield* BunPackageMutation;
				const error = yield* packages
					.install({
						cwd: '/workspace',
						workspace: installWorkspace()
					})
					.pipe(Effect.flip);

				assert.strictEqual(error.reason, 'package');
				assert.notInclude(error.message, 'sha512');
			})
		);
	});

	it.layer(makeBunPackageMutationLayer({ fetch: traversalRegistryFetch }))((it) => {
		it.effect('rejects archive paths outside the package subtree', () =>
			Effect.gen(function* () {
				const packages = yield* BunPackageMutation;
				const error = yield* packages
					.install({
						cwd: '/workspace',
						workspace: {
							files: {
								...installWorkspace().files,
								'/workspace/src/important.ts': 'export const safe = true;\n'
							}
						}
					})
					.pipe(Effect.flip);

				assert.strictEqual(error.reason, 'package');
			})
		);
	});

	it.effect('rejects traversal package names before registry access', () =>
		Effect.gen(function* () {
			const fetches = yield* Ref.make(0);
			const fetch: Fetcher = (url, init) =>
				Ref.update(fetches, (count) => count + 1).pipe(
					Effect.andThen(Effect.promise(() => fixtureRegistryFetch(url, init))),
					Effect.runPromise
				);
			const layer = makeBunPackageMutationLayer({ fetch });
			const error = yield* Effect.gen(function* () {
				const packages = yield* BunPackageMutation;
				return yield* packages.add({
					cwd: '/workspace',
					args: ['../outside@1.0.0'],
					workspace: emptyWorkspace()
				});
			}).pipe(Effect.provide(layer), Effect.flip);

			assert.strictEqual(error.reason, 'package');
			assert.strictEqual(yield* Ref.get(fetches), 0);
		})
	);
});
