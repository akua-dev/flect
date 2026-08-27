import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Result } from 'effect';
import {
	ShareArtifactDescriptor,
	ShareGitRepository,
	type ShareManifest
} from '../../packages/product/src/share';
import {
	GitOpened,
	GitRemoved,
	GitRepositoryImported,
	GitShareInspected
} from '../../shared/git-workspace';
import type { GitWorkspaceShape } from '../git/git-workspace';
import { makeRepositoryTar } from '../git/repository-tar';
import { encodeShareArchive } from './share-archive';
import { makeShareQuarantineLayer, ShareQuarantine } from './share-quarantine';

const encoder = new TextEncoder();
const commit = 'a'.repeat(40);
const sourceDigest = 'd32d6b221997ecdf338aaf42ef0e0d2af95c71ac0db0b9bb6d92470a94fcd20c';
const objectPath = `.git/objects/aa/${'c'.repeat(38)}`;

const gitManifest = (): ShareManifest => ({
	formatVersion: 1,
	id: 'dev.flect.shared-card',
	name: 'Shared card',
	version: '1.0.0',
	repository: ShareGitRepository.make({ _tag: 'git', commit }),
	artifacts: [
		ShareArtifactDescriptor.make({
			id: 'dev.flect.shared-card.component',
			kind: 'component',
			version: '1.0.0',
			sourceRoot: 'components/shared-card',
			contentSha256: sourceDigest
		})
	],
	compatibility: { flect: '>=0.2.0 <1.0.0', platforms: ['browser', 'macos'] },
	provenance: {
		publisher: 'akua-dev',
		source: 'https://github.com/akua-dev/shared-card',
		revision: commit,
		builder: '@flect/product'
	},
	signatures: [],
	migrations: []
});

const repository = () =>
	makeRepositoryTar([
		{ path: '.git/', kind: 'directory' },
		{ path: '.git/objects/', kind: 'directory' },
		{ path: '.git/objects/aa/', kind: 'directory' },
		{ path: objectPath, kind: 'file', contents: new Uint8Array([1, 2, 3]) },
		{
			path: '.flect/share.json',
			kind: 'file',
			contents: encoder.encode(JSON.stringify(gitManifest()))
		},
		{
			path: 'components/shared-card/index.ts',
			kind: 'file',
			contents: encoder.encode('export const card = true;\n')
		}
	]);

const makeWorkspace = (options: {
	readonly removals: Ref.Ref<number>;
	readonly inspectedManifest?: ShareManifest;
	readonly inspectedRepository?: Uint8Array;
	readonly opened?: Ref.Ref<ReadonlyArray<{ readonly url?: string }>>;
	readonly importRepository?: GitWorkspaceShape['importRepository'];
}): GitWorkspaceShape => {
	const unsupported = Effect.die('unused');
	const manifest = options.inspectedManifest ?? gitManifest();
	const inspectedRepository = options.inspectedRepository ?? repository();
	const files = [
		{
			path: '.flect/share.json',
			contents: encoder.encode(JSON.stringify(manifest))
		},
		{
			path: 'components/shared-card/index.ts',
			contents: encoder.encode('export const card = true;\n')
		}
	];
	return {
		open: () =>
			Effect.succeed(GitOpened.make({ type: 'opened', variant: 'asyncify', existed: false })),
		write: () => unsupported,
		read: () => unsupported,
		run: () => unsupported,
		exportRepository: unsupported,
		remove: Ref.update(options.removals, (count) => count + 1).pipe(
			Effect.as(GitRemoved.make({ type: 'removed' }))
		),
		checkpoint: () => unsupported,
		readAtRef: () => unsupported,
		moveRef: () => unsupported,
		snapshotRef: () => unsupported,
		status: () => unsupported,
		importRepository:
			options.importRepository ??
			(() =>
				Effect.succeed(
					GitRepositoryImported.make({
						type: 'repository-imported',
						commit,
						fileCount: files.length
					})
				)),
		importObjects: () => Effect.die('unused'),
		deleteRef: () => Effect.die('unused'),
		inspectCommit: () => Effect.die('unused'),
		mergeRef: () => Effect.die('unused'),
		inspectShare: (request) =>
			(options.opened === undefined
				? Effect.void
				: Ref.update(options.opened, (items) => [
						...items,
						...(request.url === undefined ? [{}] : [{ url: request.url }])
					])
			).pipe(
				Effect.as(
					GitShareInspected.make({
						type: 'share-inspected',
						commit,
						manifest: encoder.encode(JSON.stringify(manifest)),
						repository: inspectedRepository,
						files
					})
				)
			)
	};
};

describe('share quarantine', () => {
	it.effect('inspects an embedded archive in a disposable workspace', () => {
		const removals = Ref.makeUnsafe(0);
		return Effect.gen(function* () {
			const archive = yield* encodeShareArchive({
				manifest: gitManifest(),
				repository: repository(),
				artifacts: []
			});
			const quarantine = yield* ShareQuarantine;
			const candidate = yield* quarantine.inspect(archive);

			assert.strictEqual(candidate.manifest.id, 'dev.flect.shared-card');
			assert.strictEqual(candidate.manifest.repository._tag, 'embedded');
			assert.strictEqual(candidate.files.length, 2);
			assert.strictEqual(candidate.artifacts.length, 0);
			assert.strictEqual(candidate.archiveSha256.length, 64);
			assert.strictEqual(yield* Ref.get(removals), 1);
		}).pipe(
			Effect.provide(
				makeShareQuarantineLayer({
					createWorkspace: Effect.succeed(makeWorkspace({ removals })),
					workspaceId: () => 'share-test'
				})
			)
		);
	});

	it.effect('normalizes public Git in the same disposable boundary', () => {
		const removals = Ref.makeUnsafe(0);
		const opened = Ref.makeUnsafe<ReadonlyArray<{ readonly url?: string }>>([]);
		return Effect.gen(function* () {
			const quarantine = yield* ShareQuarantine;
			const candidate = yield* quarantine.inspectGit(
				'https://example.test/shared-card.git',
				commit
			);
			assert.strictEqual(candidate.manifest.repository._tag, 'embedded');
			assert.strictEqual((yield* Ref.get(opened))[0]?.url, 'https://example.test/shared-card.git');
			assert.strictEqual(yield* Ref.get(removals), 1);
		}).pipe(
			Effect.provide(
				makeShareQuarantineLayer({
					createWorkspace: Effect.succeed(makeWorkspace({ removals, opened })),
					workspaceId: () => 'share-test'
				})
			)
		);
	});

	it.effect('rejects manifest drift without leaking private input', () => {
		const removals = Ref.makeUnsafe(0);
		return Effect.gen(function* () {
			const quarantine = yield* ShareQuarantine;
			const drift = yield* quarantine
				.inspectGit('https://example.test/shared-card.git', commit)
				.pipe(Effect.result);
			assert.isTrue(Result.isFailure(drift));
			if (Result.isFailure(drift)) {
				assert.strictEqual(drift.failure.reason, 'integrity');
				assert.notInclude(JSON.stringify(drift.failure), 'private-manifest-value');
			}
		}).pipe(
			Effect.provide(
				makeShareQuarantineLayer({
					createWorkspace: Effect.succeed(
						makeWorkspace({
							removals,
							inspectedManifest: {
								...gitManifest(),
								name: 'private-manifest-value',
								repository: ShareGitRepository.make({
									_tag: 'git',
									commit: 'd'.repeat(40)
								})
							}
						})
					),
					workspaceId: () => 'share-test'
				})
			)
		);
	});

	it.effect('removes quarantine storage and terminates work on interruption', () => {
		const removals = Ref.makeUnsafe(0);
		return Effect.gen(function* () {
			const started = yield* Deferred.make<undefined>();
			yield* Effect.gen(function* () {
				const archive = yield* encodeShareArchive({
					manifest: gitManifest(),
					repository: repository(),
					artifacts: []
				});
				const quarantine = yield* ShareQuarantine;
				const fiber = yield* quarantine
					.inspect(archive)
					.pipe(Effect.forkChild({ startImmediately: true }));
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
				assert.strictEqual(yield* Ref.get(removals), 1);
			}).pipe(
				Effect.provide(
					makeShareQuarantineLayer({
						createWorkspace: Effect.succeed(
							makeWorkspace({
								removals,
								importRepository: () =>
									Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
							})
						),
						workspaceId: () => 'share-interrupt-test'
					})
				)
			);
		});
	});
});
