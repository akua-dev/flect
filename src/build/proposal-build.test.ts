import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { BrowserBuildArtifact, type BrowserBuildRequest } from '../../shared/browser-build';
import { BrowserPackageResolution } from '../../shared/browser-package';
import { GitRefSnapshot } from '../../shared/git-workspace';
import { GitWorkspace, type GitWorkspaceShape } from '../git/git-workspace';
import { BrowserBuild } from './browser-build';
import { digestBuildEntries } from './browser-build-digest';
import {
	BrowserPackageResolver,
	type BrowserPackageResolverShape
} from './browser-package-resolver';
import { ProposalBuild, ProposalBuildLive } from './proposal-build';

const encoder = new TextEncoder();
const objectId = (character: string) => character.repeat(40);
const acceptedCommit = objectId('a');
const lastKnownGoodCommit = objectId('b');
const proposalCommit = objectId('c');

describe('ProposalBuild', () => {
	it.effect('builds only the exact guarded proposal project snapshot', () =>
		Effect.gen(function* () {
			const lockfile = encoder.encode('{"lockfileVersion":3}');
			let snapshotCalls = 0;
			const snapshotRef = vi.fn<GitWorkspaceShape['snapshotRef']>(() => {
				snapshotCalls += 1;
				return Effect.succeed(
					GitRefSnapshot.make({
						type: 'ref-snapshot',
						branch: 'flect/proposal/revision-test',
						commit: proposalCommit,
						files: [
							{
								path: '.flect/snapshot.json',
								contents: encoder.encode('{}')
							},
							{
								path: 'project/package.json',
								contents: encoder.encode('{"dependencies":{"fixture":"1.0.0"}}')
							},
							{
								path: 'project/src/main.tsx',
								contents: encoder.encode('export const ready = true')
							},
							{
								path: 'project/src/styles.css',
								contents: encoder.encode('body {}')
							},
							...(snapshotCalls > 1
								? [{ path: 'project/package-lock.json', contents: lockfile }]
								: [])
						]
					})
				);
			});
			const compile = vi.fn((request: BrowserBuildRequest) =>
				Effect.promise(async () => {
					const outputs = [
						{
							path: 'app.js',
							kind: 'chunk' as const,
							contents: encoder.encode('var ready=true')
						}
					];
					return BrowserBuildArtifact.make({
						version: 1,
						buildId: request.buildId,
						sourceRevision: request.sourceRevision,
						...(request.dependencyGraphDigest === undefined
							? {}
							: { dependencyGraphDigest: request.dependencyGraphDigest }),
						inputDigest: await digestBuildEntries(request.files),
						artifactDigest: await digestBuildEntries(outputs),
						outputs
					});
				})
			);
			const unsupported = Effect.die(new Error('Unexpected Git call'));
			const git = Layer.succeed(GitWorkspace)({
				open: () => unsupported,
				write: () => unsupported,
				read: () => unsupported,
				run: () => unsupported,
				exportRepository: unsupported,
				remove: unsupported,
				checkpoint: () => unsupported,
				readAtRef: () => unsupported,
				moveRef: () => unsupported,
				snapshotRef,
				status: () => unsupported,
				importRepository: () => unsupported,
				importObjects: () => unsupported,
				deleteRef: () => unsupported,
				inspectCommit: () => unsupported,
				mergeRef: () => unsupported,
				inspectShare: () => unsupported
			} satisfies GitWorkspaceShape);
			const browserBuild = Layer.succeed(BrowserBuild)({
				compile,
				lastSuccessful: Effect.succeed(undefined)
			});
			const dependencyGraphDigest = 'd'.repeat(64);
			const resolvePackages = vi.fn<BrowserPackageResolverShape['resolve']>(() =>
				Effect.succeed(
					BrowserPackageResolution.make({
						version: 1,
						inputDigest: 'e'.repeat(64),
						lockDigest: 'f'.repeat(64),
						graphDigest: dependencyGraphDigest,
						packageCount: 1,
						lockfile,
						files: [
							{
								path: 'node_modules/fixture/index.js',
								contents: encoder.encode('export const fixture = true')
							}
						],
						cacheHit: true
					})
				)
			);
			const packages = Layer.succeed(BrowserPackageResolver)({
				resolve: resolvePackages
			});
			const layer = ProposalBuildLive.pipe(
				Layer.provideMerge(Layer.mergeAll(git, browserBuild, packages))
			);

			const { artifact, resolvedLock } = yield* Effect.gen(function* () {
				const build = yield* ProposalBuild;
				const request = {
					proposalBranch: 'flect/proposal/revision-test',
					proposalCommit,
					acceptedCommit,
					lastKnownGoodCommit,
					entrypoint: 'src/main.tsx'
				};
				const resolvedLock = yield* build.resolvePackageLock(request);
				const artifact = yield* build.compile(request);
				return { artifact, resolvedLock };
			}).pipe(Effect.provide(layer));

			assert.strictEqual(resolvedLock?.needsCheckpoint, true);
			assert.deepStrictEqual(resolvedLock?.contents, lockfile);
			assert.strictEqual(artifact.sourceRevision, proposalCommit);
			assert.strictEqual(artifact.dependencyGraphDigest, dependencyGraphDigest);
			assert.deepStrictEqual(snapshotRef.mock.calls[0]?.[0], {
				branch: 'flect/proposal/revision-test',
				expectedCommit: proposalCommit,
				guards: [
					{ branch: 'flect/accepted', commit: acceptedCommit },
					{ branch: 'flect/last-known-good', commit: lastKnownGoodCommit }
				]
			});
			assert.deepStrictEqual(
				compile.mock.calls[0]?.[0].files.map((file) => file.path),
				[
					'node_modules/fixture/index.js',
					'package-lock.json',
					'package.json',
					'src/main.tsx',
					'src/styles.css'
				]
			);
			assert.strictEqual(compile.mock.calls[0]?.[0].dependencyGraphDigest, dependencyGraphDigest);
			assert.strictEqual(resolvePackages.mock.calls.length, 2);
			assert.strictEqual(resolvePackages.mock.calls[0]?.[0].packageLock, undefined);
			assert.deepStrictEqual(resolvePackages.mock.calls[1]?.[0].packageLock, lockfile);
		})
	);
});
