import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import {
	GitCheckpointed,
	GitCommandResult,
	GitCommitInspected,
	GitExported,
	GitObjectsImported,
	GitOpened,
	GitRefDeleted,
	GitRefMergeConflict,
	GitRefMerged,
	GitRefMoved,
	GitRefSnapshot,
	GitWorkspaceFailure
} from '../../shared/git-workspace';
import { GitWorkspace, type GitWorkspaceShape } from '../git/git-workspace';
import { deriveShareRefs, makeShareRepositoryLayer, ShareRepository } from './share-repository';

const objectA = 'a'.repeat(40);
const objectB = 'b'.repeat(40);
const objectF = 'f'.repeat(40);
const objectM = 'c'.repeat(40);

const makeGit = Effect.fn('ShareRepositoryTest.makeShareGit')(function* () {
	const refs = yield* Ref.make(new Map<string, string>());
	const commands = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
	const importGuards = yield* Ref.make<
		| ReadonlyArray<{
				readonly branch: string;
				readonly commit: string;
		  }>
		| undefined
	>(undefined);
	const mergeConflict = yield* Ref.make(false);
	const ancestry = yield* Ref.make<'ancestor' | 'replacement'>('ancestor');
	const staleMove = yield* Ref.make(false);
	const mergeFiles = yield* Ref.make<
		ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>
	>([]);
	const checkpoints = yield* Ref.make<
		ReadonlyArray<Parameters<GitWorkspaceShape['checkpoint']>[0]>
	>([]);

	const command = (exitCode = 0, stdout = '') =>
		GitCommandResult.make({ type: 'command', exitCode, stdout, stderr: '' });
	const service: GitWorkspaceShape = {
		open: () =>
			Effect.succeed(GitOpened.make({ type: 'opened', variant: 'asyncify', existed: true })),
		write: () => Effect.die('unused'),
		read: () => Effect.die('unused'),
		exportRepository: Effect.die('unused'),
		exportRef: ({ branch, expectedCommit }) =>
			Effect.succeed(
				GitExported.make({
					type: 'exported',
					archive: new Uint8Array([7, 8, 9]),
					fileCount: branch.endsWith('/fork') && expectedCommit === objectF ? 3 : 1
				})
			),
		remove: Effect.die('unused'),
		checkpoint: (options) =>
			Ref.update(checkpoints, (current) => [...current, options]).pipe(
				Effect.tap(() =>
					Ref.update(refs, (current) => new Map(current).set(options.branch, objectF))
				),
				Effect.as(
					GitCheckpointed.make({
						type: 'checkpointed',
						branch: options.branch,
						commit: objectF
					})
				)
			),
		readAtRef: () => Effect.die('unused'),
		snapshotRef: ({ branch, expectedCommit }) =>
			Ref.get(mergeConflict).pipe(
				Effect.map((conflicting) =>
					GitRefSnapshot.make({
						type: 'ref-snapshot',
						branch,
						commit: expectedCommit,
						files: conflicting
							? [
									{
										path: 'src/shared.ts',
										contents: new TextEncoder().encode(
											branch.endsWith('/base')
												? 'base'
												: branch.endsWith('/fork')
													? 'personal'
													: 'upstream'
										)
									}
								]
							: branch.endsWith('/base')
								? [
										{
											path: 'components/weather.ts',
											contents: new TextEncoder().encode('base')
										}
									]
								: branch.endsWith('/fork')
									? [
											{
												path: 'components/weather.ts',
												contents: new TextEncoder().encode('base')
											},
											{
												path: 'components/personal.md',
												contents: new TextEncoder().encode('personal')
											}
										]
									: [
											{
												path: 'components/weather.ts',
												contents: new TextEncoder().encode('updated')
											}
										]
					})
				)
			),
		status: () => Effect.die('unused'),
		importRepository: () => Effect.die('unused'),
		inspectShare: () => Effect.die('unused'),
		inspectCommit: (commit) =>
			Effect.succeed(
				GitCommitInspected.make({
					type: 'commit-inspected',
					commit,
					parents: [objectF, objectB]
				})
			),
		mergeRef: ({ branch, expectedCommit, expectedUpstreamCommit, files, conflictPaths }) =>
			Effect.gen(function* () {
				yield* Ref.set(mergeFiles, files);
				if ((yield* Ref.get(mergeConflict)) && conflictPaths === undefined)
					return GitRefMergeConflict.make({
						type: 'ref-merge-conflict',
						branch,
						commit: expectedCommit,
						conflictPaths: ['src/shared.ts']
					});
				yield* Ref.update(refs, (current) => new Map(current).set(branch, objectM));
				return GitRefMerged.make({
					type: 'ref-merged',
					branch,
					commit: objectM,
					parents: [expectedCommit, expectedUpstreamCommit]
				});
			}),
		importObjects: ({ commit, guards }) =>
			Ref.set(importGuards, guards ?? []).pipe(
				Effect.as(
					GitObjectsImported.make({
						type: 'objects-imported',
						commit,
						objectCount: 3
					})
				)
			),
		moveRef: ({ branch, expectedCommit, targetCommit }) =>
			Effect.gen(function* () {
				if (yield* Ref.get(staleMove)) {
					return yield* Effect.fail(
						GitWorkspaceFailure.make({
							operation: 'move-ref',
							reason: 'stale-ref',
							message: 'The Git ref changed before the operation completed.'
						})
					);
				}
				const current = yield* Ref.get(refs);
				const actual = current.get(branch);
				if (actual !== expectedCommit) return yield* Effect.die('stale test ref');
				const next = new Map(current).set(branch, targetCommit);
				yield* Ref.set(refs, next);
				return GitRefMoved.make({
					type: 'ref-moved',
					branch,
					commit: targetCommit
				});
			}),
		deleteRef: ({ branch, expectedCommit }) =>
			Effect.gen(function* () {
				const current = yield* Ref.get(refs);
				if (current.get(branch) !== expectedCommit) return yield* Effect.die('stale test ref');
				const next = new Map(current);
				next.delete(branch);
				yield* Ref.set(refs, next);
				return GitRefDeleted.make({ type: 'ref-deleted', branch });
			}),
		run: (args) =>
			Ref.update(commands, (current) => [...current, args]).pipe(
				Effect.andThen(
					Effect.gen(function* () {
						if (args[0] === 'log' && args[1] === '--format=%H')
							return command(0, (yield* Ref.get(ancestry)) === 'ancestor' ? '' : `${objectA}\n`);
						if (args[0] === 'merge') return command((yield* Ref.get(mergeConflict)) ? 1 : 0);
						if (args[0] === 'status') return command(0, 'UU src/shared.ts\n');
						if (args[0] === 'commit') {
							const candidate = [...(yield* Ref.get(refs)).keys()].find((ref) =>
								ref.endsWith('/candidate')
							);
							if (candidate !== undefined)
								yield* Ref.update(refs, (current) => new Map(current).set(candidate, objectM));
							return command();
						}
						if (args[0] === 'rev-parse') {
							const resolved = (yield* Ref.get(refs)).get(args[1] ?? '');
							return resolved === undefined ? command(1) : command(0, `${resolved}\n`);
						}
						return command();
					})
				)
			)
	};
	return {
		refs,
		commands,
		importGuards,
		mergeConflict,
		ancestry,
		staleMove,
		mergeFiles,
		checkpoints,
		service
	};
});

describe('ShareRepository', () => {
	it.effect('derives stable opaque refs and retains an initial fork', () =>
		Effect.gen(function* () {
			const first = yield* deriveShareRefs('community.weather');
			const repeated = yield* deriveShareRefs('community.weather');
			const other = yield* deriveShareRefs('community.calendar');
			assert.deepStrictEqual(first, repeated);
			assert.notStrictEqual(first.base, other.base);
			assert.match(first.base, /^flect\/shared\/[0-9a-f]{64}\/base$/);

			const fake = yield* makeGit();
			const result = yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				return yield* repository.retain({
					shareId: 'community.weather',
					archive: new Uint8Array([1]),
					commit: objectA
				});
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);

			assert.deepStrictEqual(result.refs, {
				base: objectA,
				upstream: objectA,
				fork: objectA
			});
			assert.deepStrictEqual(yield* Ref.get(fake.importGuards), []);
			assert.strictEqual((yield* Ref.get(fake.refs)).size, 3);
		})
	);

	it.effect('advances only the guarded user fork through an optimistic checkpoint', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectB],
					[names.fork, objectA]
				])
			);
			const result = yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				return yield* repository.checkpointFork({
					shareId: 'community.weather',
					expectedForkCommit: objectA,
					refs: {
						base: objectA,
						upstream: objectB,
						fork: objectA
					},
					files: [
						{
							path: 'components/weather.tsx',
							contents: new TextEncoder().encode('export const Weather = 2')
						}
					],
					removals: ['components/old-weather.tsx'],
					message: 'Personalize weather card'
				});
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);

			assert.strictEqual(result.fork, objectF);
			const checkpoints = yield* Ref.get(fake.checkpoints);
			assert.lengthOf(checkpoints, 1);
			assert.strictEqual(checkpoints[0]?.branch, names.fork);
			assert.strictEqual(checkpoints[0]?.expectedCommit, objectA);
			assert.deepStrictEqual(checkpoints[0]?.guards, [
				{ branch: names.base, commit: objectA },
				{ branch: names.upstream, commit: objectB }
			]);
			assert.deepStrictEqual(checkpoints[0]?.removals, ['components/old-weather.tsx']);
			yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				yield* repository.restoreFork({
					shareId: 'community.weather',
					expectedForkCommit: objectF,
					targetForkCommit: objectA,
					refs: { base: objectA, upstream: objectB }
				});
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);
			assert.strictEqual((yield* Ref.get(fake.refs)).get(names.fork), objectA);
		})
	);

	it.effect('prepares fast-forward, replacement, clean merge, and conflict outcomes', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectA],
					[names.fork, objectA]
				])
			);
			const layer = makeShareRepositoryLayer().pipe(
				Layer.provide(Layer.succeed(GitWorkspace)(fake.service))
			);
			const prepare = (fork: string) =>
				Effect.gen(function* () {
					const repository = yield* ShareRepository;
					return yield* repository.prepareUpdate({
						shareId: 'community.weather',
						archive: new Uint8Array([2]),
						commit: objectB,
						refs: { base: objectA, upstream: objectA, fork }
					});
				}).pipe(Effect.provide(layer));

			const fastForward = yield* prepare(objectA);
			assert.strictEqual(fastForward._tag, 'fast-forward');
			if (fastForward._tag !== 'fast-forward') return yield* Effect.die('wrong result');
			assert.strictEqual(fastForward.candidate, objectB);

			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectA],
					[names.fork, objectF]
				])
			);
			yield* Ref.set(fake.ancestry, 'replacement');
			const replacement = yield* prepare(objectF);
			assert.strictEqual(replacement._tag, 'replacement');
			if (replacement._tag !== 'replacement') return yield* Effect.die('wrong result');
			assert.strictEqual(replacement.candidate, objectB);

			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectA],
					[names.fork, objectF]
				])
			);
			yield* Ref.set(fake.ancestry, 'ancestor');
			const merged = yield* prepare(objectF);
			assert.strictEqual(merged._tag, 'merged');
			if (merged._tag !== 'merged') return yield* Effect.die('wrong result');
			assert.strictEqual(merged.candidate, objectM);
			assert.deepStrictEqual(merged.parents, [objectF, objectB]);
			assert.deepStrictEqual(
				(yield* Ref.get(fake.mergeFiles)).map((file) => [
					file.path,
					new TextDecoder().decode(file.contents)
				]),
				[
					['components/personal.md', 'personal'],
					['components/weather.ts', 'updated']
				]
			);

			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectA],
					[names.fork, objectF]
				])
			);
			yield* Ref.set(fake.mergeConflict, true);
			const conflict = yield* prepare(objectF);
			assert.strictEqual(conflict._tag, 'conflict');
			if (conflict._tag !== 'conflict') return yield* Effect.die('wrong result');
			assert.deepStrictEqual(conflict.conflictPaths, ['src/shared.ts']);
			assert.strictEqual((yield* Ref.get(fake.refs)).has(names.candidate), false);
		})
	);

	it.effect('resolves only the recorded conflict paths into a guarded two-parent candidate', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectB],
					[names.fork, objectF]
				])
			);
			yield* Ref.set(fake.mergeConflict, true);
			const resolved = yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				return yield* repository.resolveConflict({
					shareId: 'community.weather',
					refs: { base: objectA, upstream: objectB, fork: objectF },
					conflictPaths: ['src/shared.ts'],
					files: [
						{
							path: 'src/shared.ts',
							contents: new TextEncoder().encode('personal + upstream')
						}
					],
					removals: [],
					message: 'Resolve shared source'
				});
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);
			assert.strictEqual(resolved.candidate, objectM);
			assert.deepStrictEqual(resolved.parents, [objectF, objectB]);
			assert.deepStrictEqual(
				(yield* Ref.get(fake.mergeFiles)).map((file) => [
					file.path,
					new TextDecoder().decode(file.contents)
				]),
				[['src/shared.ts', 'personal + upstream']]
			);
		})
	);

	it.effect('accepts a guarded candidate into upstream base and the user fork', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectB],
					[names.fork, objectF],
					[names.candidate, objectM]
				])
			);
			const accepted = yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				return yield* repository.acceptCandidate({
					shareId: 'community.weather',
					refs: {
						base: objectA,
						upstream: objectB,
						fork: objectF,
						candidate: objectM
					}
				});
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);

			assert.deepStrictEqual(accepted.refs, {
				base: objectB,
				upstream: objectB,
				fork: objectM
			});
			assert.strictEqual((yield* Ref.get(fake.refs)).get(names.base), objectB);
			assert.strictEqual((yield* Ref.get(fake.refs)).get(names.fork), objectM);
			assert.isFalse((yield* Ref.get(fake.refs)).has(names.candidate));
		})
	);

	it.effect('fails a stale candidate Keep without moving any guarded ref', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			const before = new Map([
				[names.base, objectA],
				[names.upstream, objectB],
				[names.fork, objectF],
				[names.candidate, objectM]
			]);
			yield* Ref.set(fake.refs, before);
			yield* Ref.set(fake.staleMove, true);
			const failure = yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				return yield* repository
					.acceptCandidate({
						shareId: 'community.weather',
						refs: {
							base: objectA,
							upstream: objectB,
							fork: objectF,
							candidate: objectM
						}
					})
					.pipe(Effect.flip);
			}).pipe(
				Effect.provide(
					makeShareRepositoryLayer().pipe(Layer.provide(Layer.succeed(GitWorkspace)(fake.service)))
				)
			);

			assert.strictEqual(failure.reason, 'stale-ref');
			assert.deepStrictEqual(yield* Ref.get(fake.refs), before);
		})
	);

	it.effect('removes installation refs before deleting only uninstalled fork data', () =>
		Effect.gen(function* () {
			const fake = yield* makeGit();
			const names = yield* deriveShareRefs('community.weather');
			yield* Ref.set(
				fake.refs,
				new Map([
					[names.base, objectA],
					[names.upstream, objectB],
					[names.fork, objectF],
					[names.candidate, objectM],
					['flect/unrelated', objectA]
				])
			);
			const layer = makeShareRepositoryLayer().pipe(
				Layer.provide(Layer.succeed(GitWorkspace)(fake.service))
			);
			yield* Effect.gen(function* () {
				const repository = yield* ShareRepository;
				yield* repository.removeInstallation({
					shareId: 'community.weather',
					refs: {
						base: objectA,
						upstream: objectB,
						fork: objectF,
						candidate: objectM
					}
				});
				assert.deepStrictEqual(
					yield* repository.exportFork({
						shareId: 'community.weather',
						forkCommit: objectF
					}),
					new Uint8Array([7, 8, 9])
				);
				assert.deepStrictEqual(
					yield* repository.exportCandidate({
						shareId: 'community.weather',
						candidateCommit: objectM,
						refs: { base: objectA, upstream: objectB, fork: objectF }
					}),
					new Uint8Array([7, 8, 9])
				);
				yield* repository.deleteLocalData({
					shareId: 'community.weather',
					forkCommit: objectF,
					installed: false
				});
			}).pipe(Effect.provide(layer));
			const remaining = yield* Ref.get(fake.refs);
			assert.deepStrictEqual([...remaining], [['flect/unrelated', objectA]]);
		})
	);
});
