import { Effect, ManagedRuntime, Schema } from 'effect';
import { useEffect, useState } from 'react';
import { type GitCommandResult, GitWorkspaceDiagnosticResult } from '../../shared/git-workspace';
import { GitWorkspace, GitWorkspaceLive } from './git-workspace';

interface DiagnosticState {
	readonly state: 'running' | 'complete' | 'failed';
	readonly result?: GitWorkspaceDiagnosticResult;
	readonly message?: string;
	readonly archiveUrl?: string;
}

const encoder = new TextEncoder();

const requireSuccess = (result: GitCommandResult) => {
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || `Git exited with ${result.exitCode}.`);
	}
	return result;
};

const runDiagnostic = async (workspaceId: string) => {
	const cacheKey = `flect.git-diagnostic.${workspaceId}`;
	const cached = sessionStorage.getItem(cacheKey);
	const runtime = ManagedRuntime.make(GitWorkspaceLive);
	try {
		const opened = await runtime.runPromise(
			Effect.gen(function* () {
				const git = yield* GitWorkspace;
				return yield* git.open({ workspaceId, reset: cached === null });
			})
		);

		if (cached !== null) {
			const previous = await Schema.decodeUnknownPromise(GitWorkspaceDiagnosticResult)(
				JSON.parse(cached)
			);
			const reopenedCommit = await runtime.runPromise(
				Effect.gen(function* () {
					const git = yield* GitWorkspace;
					return requireSuccess(yield* git.run(['rev-parse', 'HEAD'])).stdout.trim();
				})
			);
			const exported = await runtime.runPromise(
				Effect.gen(function* () {
					const git = yield* GitWorkspace;
					return yield* git.exportRepository;
				})
			);
			return {
				result: GitWorkspaceDiagnosticResult.make({
					...previous,
					reopenedCommit
				}),
				archive: exported.archive
			};
		}

		const first = await runtime.runPromise(
			Effect.gen(function* () {
				const git = yield* GitWorkspace;
				yield* git.write('flect.json', encoder.encode('{"revision":"initial"}\n'));
				yield* git.run(['add', 'flect.json']).pipe(Effect.map(requireSuccess));
				yield* git.run(['commit', '-m', 'Initial interface']).pipe(Effect.map(requireSuccess));
				const initialCommit = requireSuccess(yield* git.run(['rev-parse', 'HEAD'])).stdout.trim();
				yield* git.run(['checkout', '-b', 'flect/accepted']).pipe(Effect.map(requireSuccess));
				yield* git.run(['checkout', '-b', 'flect/proposal/e2e']).pipe(Effect.map(requireSuccess));
				yield* git.write('flect.json', encoder.encode('{"revision":"candidate"}\n'));
				const diff = requireSuccess(yield* git.run(['diff'])).stdout;
				yield* git.run(['add', 'flect.json']).pipe(Effect.map(requireSuccess));
				yield* git.run(['commit', '-m', 'Candidate interface']).pipe(Effect.map(requireSuccess));
				const proposalCommit = requireSuccess(yield* git.run(['rev-parse', 'HEAD'])).stdout.trim();
				yield* git.run(['checkout', 'flect/accepted']).pipe(Effect.map(requireSuccess));
				yield* git.write('flect.json', encoder.encode('{"revision":"accepted"}\n'));
				yield* git.run(['add', 'flect.json']).pipe(Effect.map(requireSuccess));
				yield* git.run(['commit', '-m', 'Accepted interface']).pipe(Effect.map(requireSuccess));
				const acceptedCommit = requireSuccess(yield* git.run(['rev-parse', 'HEAD'])).stdout.trim();
				yield* git.run(['merge', 'flect/proposal/e2e']);
				const status = requireSuccess(yield* git.run(['status', '--short'])).stdout;
				if (!status.includes('flect.json')) {
					return yield* Effect.fail(
						new Error('The divergent interface edit did not produce a conflict.')
					);
				}
				yield* git.run(['reset', '--hard', acceptedCommit]).pipe(Effect.map(requireSuccess));
				return {
					variant: opened.variant,
					initialCommit,
					proposalCommit,
					acceptedCommit,
					conflictPaths: status.includes('flect.json') ? ['flect.json'] : [],
					diff,
					status
				};
			})
		);
		await runtime.dispose();

		const reopenedRuntime = ManagedRuntime.make(GitWorkspaceLive);
		try {
			const completed = await reopenedRuntime.runPromise(
				Effect.gen(function* () {
					const git = yield* GitWorkspace;
					yield* git.open({ workspaceId });
					const reopenedCommit = requireSuccess(
						yield* git.run(['rev-parse', 'HEAD'])
					).stdout.trim();
					yield* git.run(['reset', '--hard', first.initialCommit]).pipe(Effect.map(requireSuccess));
					const rollbackCommit = requireSuccess(
						yield* git.run(['rev-parse', 'HEAD'])
					).stdout.trim();
					const exported = yield* git.exportRepository;
					return {
						result: GitWorkspaceDiagnosticResult.make({
							...first,
							reopenedCommit,
							rollbackCommit
						}),
						archive: exported.archive
					};
				})
			);
			sessionStorage.setItem(cacheKey, JSON.stringify(completed.result));
			return completed;
		} finally {
			await reopenedRuntime.dispose();
		}
	} finally {
		await runtime.dispose();
	}
};

export function GitWorkspaceDiagnostic() {
	const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
		state: 'running'
	});

	useEffect(() => {
		const workspaceId =
			new URLSearchParams(globalThis.location.search).get('workspace') ?? 'diagnostic';
		let active = true;
		let archiveUrl: string | undefined;
		void runDiagnostic(workspaceId)
			.then(({ result, archive }) => {
				if (!active) {
					return;
				}
				archiveUrl = URL.createObjectURL(
					new Blob([archive.slice().buffer], { type: 'application/x-tar' })
				);
				setDiagnostic({ state: 'complete', result, archiveUrl });
			})
			.catch((error: unknown) => {
				if (!active) {
					return;
				}
				setDiagnostic({
					state: 'failed',
					message: error instanceof Error ? error.message : String(error)
				});
			});
		return () => {
			active = false;
			if (archiveUrl !== undefined) {
				URL.revokeObjectURL(archiveUrl);
			}
		};
	}, []);

	return (
		<main>
			<pre data-testid='git-diagnostic-result' data-state={diagnostic.state}>
				{diagnostic.result === undefined
					? (diagnostic.message ?? 'Running embedded Git proof…')
					: JSON.stringify(diagnostic.result)}
			</pre>
			{diagnostic.archiveUrl === undefined ? null : (
				<a href={diagnostic.archiveUrl} download='flect-repository.tar'>
					Download repository
				</a>
			)}
		</main>
	);
}
