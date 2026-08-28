import { Effect, Layer, ManagedRuntime } from 'effect';
import { useEffect, useMemo, useState } from 'react';
import {
	GitShareLifecycleDiagnosticResult,
	type GitWorkspaceFailure
} from '../../shared/git-workspace';
import {
	deriveShareRefs,
	makeShareRepositoryLayer,
	ShareRepository,
	type ShareRepositoryFailure
} from '../sharing/share-repository';
import { GitWorkspace, GitWorkspaceLive } from './git-workspace';

interface DiagnosticState {
	readonly state: 'running' | 'complete' | 'failed';
	readonly result?: GitShareLifecycleDiagnosticResult;
	readonly archive?: Uint8Array;
	readonly message?: string;
}

const encoder = new TextEncoder();
const errorMessage = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	'message' in error &&
	typeof error.message === 'string'
		? error.message
		: 'The Git share lifecycle diagnostic failed safely.';

const runDiagnostic = (workspaceId: string) => {
	const sourceWorkspace = `${workspaceId}-source`;
	const targetWorkspace = `${workspaceId}-target`;
	const runtime = ManagedRuntime.make(
		makeShareRepositoryLayer({ workspaceId: targetWorkspace }).pipe(
			Layer.provideMerge(GitWorkspaceLive)
		)
	);
	return runtime
		.runPromise(
			Effect.gen(function* () {
				const git = yield* GitWorkspace;
				const repository = yield* ShareRepository;
				yield* git.open({ workspaceId: sourceWorkspace, reset: true });
				const base = yield* git.checkpoint({
					branch: 'flect/share-source',
					files: [
						{
							path: 'components/card/shared.ts',
							contents: encoder.encode("export const label = 'base';\n")
						}
					],
					message: 'Create shared base'
				});
				const baseArchive = (yield* git.inspectShare({
					commit: base.commit,
					manifestRequired: false
				})).repository;
				const upstream = yield* git.checkpoint({
					branch: 'flect/share-source',
					expectedCommit: base.commit,
					files: [
						{
							path: 'components/card/upstream.ts',
							contents: encoder.encode('export const upstream = true;\n')
						}
					],
					message: 'Add disjoint upstream work'
				});
				const upstreamArchive = (yield* git.inspectShare({
					commit: upstream.commit,
					manifestRequired: false
				})).repository;
				const conflictUpstream = yield* git.checkpoint({
					branch: 'flect/share-source',
					expectedCommit: upstream.commit,
					files: [
						{
							path: 'components/card/shared.ts',
							contents: encoder.encode("export const label = 'upstream';\n")
						}
					],
					message: 'Change shared upstream source'
				});
				const conflictArchive = (yield* git.inspectShare({
					commit: conflictUpstream.commit,
					manifestRequired: false
				})).repository;

				yield* git.open({ workspaceId: targetWorkspace, reset: true });
				const local = yield* git.checkpoint({
					branch: 'flect/accepted',
					files: [
						{
							path: 'flect.json',
							contents: encoder.encode('{"version":1}\n')
						}
					],
					message: 'Initialize canonical workspace'
				});
				const verifyAccepted = Effect.fn('GitShareLifecycleDiagnostic.verifyAccepted')(function* (
					stage: string
				) {
					const result = yield* git.run(['rev-parse', 'flect/accepted']);
					if (result.stdout.trim() !== local.commit)
						return yield* Effect.fail(new Error(`Accepted ref changed ${stage}.`));
				});
				yield* verifyAccepted('after initialization');
				const retained = yield* repository.retain({
					shareId: 'dev.flect.lifecycle',
					archive: baseArchive,
					commit: base.commit
				});
				yield* verifyAccepted('after retain');
				const names = yield* deriveShareRefs('dev.flect.lifecycle');
				const fork = yield* git.checkpoint({
					branch: names.fork,
					expectedCommit: retained.refs.fork,
					guards: [
						{ branch: names.base, commit: retained.refs.base },
						{ branch: names.upstream, commit: retained.refs.upstream }
					],
					files: [
						{
							path: 'components/card/shared.ts',
							contents: encoder.encode("export const label = 'personal';\n")
						}
					],
					message: 'Personalize shared source'
				});
				yield* verifyAccepted('after fork checkpoint');
				const prepared = yield* repository
					.prepareUpdate({
						shareId: 'dev.flect.lifecycle',
						archive: upstreamArchive,
						commit: upstream.commit,
						refs: {
							base: retained.refs.base,
							upstream: retained.refs.upstream,
							fork: fork.commit
						}
					})
					.pipe(Effect.result);
				if (prepared._tag === 'Failure') {
					return yield* Effect.fail(new Error(prepared.failure.message));
				}
				const merged = prepared.success;
				yield* verifyAccepted('after clean merge');
				if (merged._tag !== 'merged') {
					return yield* Effect.fail(new Error(`Expected a clean merge, received ${merged._tag}.`));
				}
				const representativeArchive = (yield* git.inspectShare({
					commit: merged.candidate,
					manifestRequired: false
				})).repository;
				yield* repository.rejectCandidate({
					shareId: 'dev.flect.lifecycle',
					candidate: merged.candidate,
					refs: {
						base: retained.refs.base,
						upstream: upstream.commit,
						fork: fork.commit
					}
				});
				yield* verifyAccepted('after candidate rejection');
				const conflictAttempt = yield* repository
					.prepareUpdate({
						shareId: 'dev.flect.lifecycle',
						archive: conflictArchive,
						commit: conflictUpstream.commit,
						refs: {
							base: retained.refs.base,
							upstream: upstream.commit,
							fork: fork.commit
						}
					})
					.pipe(Effect.result);
				if (conflictAttempt._tag === 'Failure') {
					const currentUpstream = yield* git.run(['rev-parse', names.upstream]);
					const currentCandidate = yield* git.run(['rev-parse', names.candidate]);
					return yield* Effect.fail(
						new Error(
							`${conflictAttempt.failure.message} Upstream advanced: ${currentUpstream.stdout.trim() === conflictUpstream.commit}. Candidate exists: ${/^[0-9a-f]{40}$/.test(currentCandidate.stdout.trim())}.`
						)
					);
				}
				const conflict = conflictAttempt.success;
				yield* verifyAccepted('after conflict preparation');
				if (conflict._tag !== 'conflict') {
					return yield* Effect.fail(
						new Error(`Expected a merge conflict, received ${conflict._tag}.`)
					);
				}
				const candidateSnapshot = yield* git
					.snapshotRef({
						branch: names.candidate,
						expectedCommit: merged.candidate,
						guards: []
					})
					.pipe(Effect.result);
				const candidateRemoved = candidateSnapshot._tag === 'Failure';
				yield* git
					.snapshotRef({
						branch: 'flect/accepted',
						expectedCommit: local.commit,
						guards: []
					})
					.pipe(Effect.mapError((error) => new Error(`Before removal: ${error.message}`)));
				yield* repository.removeInstallation({
					shareId: 'dev.flect.lifecycle',
					refs: {
						base: retained.refs.base,
						upstream: conflictUpstream.commit,
						fork: fork.commit
					}
				});
				yield* git
					.snapshotRef({
						branch: 'flect/accepted',
						expectedCommit: local.commit,
						guards: []
					})
					.pipe(Effect.mapError((error) => new Error(`After removal: ${error.message}`)));
				yield* repository.deleteLocalData({
					shareId: 'dev.flect.lifecycle',
					forkCommit: fork.commit,
					installed: false
				});
				const forkSnapshot = yield* git
					.snapshotRef({
						branch: names.fork,
						expectedCommit: fork.commit,
						guards: []
					})
					.pipe(Effect.result);
				const forkRemoved = forkSnapshot._tag === 'Failure';
				const unrelatedSnapshot = yield* git
					.snapshotRef({
						branch: 'flect/accepted',
						expectedCommit: local.commit,
						guards: []
					})
					.pipe(Effect.result);
				if (unrelatedSnapshot._tag === 'Failure')
					return yield* Effect.fail(
						new Error(`Unrelated ref preservation failed: ${unrelatedSnapshot.failure.message}`)
					);
				const unrelatedPreserved = unrelatedSnapshot._tag === 'Success';
				const result = GitShareLifecycleDiagnosticResult.make({
					baseCommit: base.commit,
					forkCommit: fork.commit,
					upstreamCommit: upstream.commit,
					mergedCommit: merged.candidate,
					mergeParents: merged.parents,
					conflictPaths: conflict.conflictPaths,
					candidateRemoved,
					forkRemoved,
					unrelatedPreserved
				});
				yield* git.remove;
				yield* git.open({ workspaceId: sourceWorkspace });
				yield* git.remove;
				return { result, archive: representativeArchive };
			}).pipe(
				Effect.catch((error: GitWorkspaceFailure | ShareRepositoryFailure | Error) =>
					Effect.fail(new Error(error.message))
				)
			)
		)
		.finally(() => void runtime.dispose());
};

export function GitShareLifecycleDiagnostic() {
	const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
		state: 'running'
	});
	const downloadUrl = useMemo(
		() =>
			diagnostic.archive === undefined
				? undefined
				: URL.createObjectURL(
						new Blob([Uint8Array.from(diagnostic.archive)], {
							type: 'application/x-tar'
						})
					),
		[diagnostic.archive]
	);
	useEffect(() => {
		const workspaceId =
			new URLSearchParams(globalThis.location.search).get('workspace') ?? 'share-lifecycle';
		let active = true;
		void runDiagnostic(workspaceId)
			.then(({ result, archive }) => {
				if (active) setDiagnostic({ state: 'complete', result, archive });
			})
			.catch((error: unknown) => {
				if (active)
					setDiagnostic({
						state: 'failed',
						message: errorMessage(error)
					});
			});
		return () => {
			active = false;
		};
	}, []);
	useEffect(
		() => () => {
			if (downloadUrl !== undefined) URL.revokeObjectURL(downloadUrl);
		},
		[downloadUrl]
	);
	return (
		<main>
			<pre data-testid='git-share-lifecycle-result' data-state={diagnostic.state}>
				{diagnostic.result === undefined
					? (diagnostic.message ?? 'Running Git share lifecycle proof…')
					: JSON.stringify(diagnostic.result)}
			</pre>
			{downloadUrl === undefined ? null : (
				<a href={downloadUrl} download='flect-share-lifecycle.tar'>
					Download shared history
				</a>
			)}
		</main>
	);
}
