import { Effect, ManagedRuntime } from 'effect';
import { useEffect, useState } from 'react';
import { GitTransactionDiagnosticResult } from '../../shared/git-workspace';
import { GitWorkspace, GitWorkspaceLive } from './git-workspace';

type DiagnosticState =
	| { readonly state: 'opening' }
	| {
			readonly state: 'ready';
			readonly runtime: ManagedRuntime.ManagedRuntime<GitWorkspace, never>;
	  }
	| {
			readonly state: 'complete';
			readonly result: GitTransactionDiagnosticResult;
	  };

const encoder = new TextEncoder();

export function GitTransactionDiagnostic() {
	const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
		state: 'opening'
	});
	const query = new URLSearchParams(globalThis.location.search);
	const workspaceId = query.get('workspace') ?? 'transaction-diagnostic';
	const expectedCommit = query.get('expected') ?? undefined;
	const value = query.get('value') ?? 'initial';

	useEffect(() => {
		const runtime = ManagedRuntime.make(GitWorkspaceLive);
		let active = true;
		void runtime
			.runPromise(
				Effect.gen(function* () {
					const git = yield* GitWorkspace;
					yield* git.open({ workspaceId, reset: expectedCommit === undefined });
				})
			)
			.then(() => {
				if (active) {
					setDiagnostic({ state: 'ready', runtime });
				}
			})
			.catch(() => {
				if (active) {
					setDiagnostic({
						state: 'complete',
						result: GitTransactionDiagnosticResult.make({ state: 'failed' })
					});
				}
			});
		return () => {
			active = false;
			void runtime.dispose();
		};
	}, [expectedCommit, workspaceId]);

	const checkpoint = () => {
		if (diagnostic.state !== 'ready') {
			return;
		}
		const runtime = diagnostic.runtime;
		setDiagnostic({ state: 'opening' });
		void runtime
			.runPromise(
				Effect.gen(function* () {
					const git = yield* GitWorkspace;
					const checkpointed = yield* git.checkpoint({
						branch: 'flect/accepted',
						...(expectedCommit === undefined ? {} : { expectedCommit }),
						files: [
							{
								path: 'flect.json',
								contents: encoder.encode(`${JSON.stringify({ value })}\n`)
							},
							...(expectedCommit === undefined
								? [
										{
											path: 'obsolete.txt',
											contents: encoder.encode('remove me\n')
										}
									]
								: [])
						],
						removals: expectedCommit === undefined ? [] : ['obsolete.txt'],
						message: `Diagnostic ${value}`
					});
					const snapshot = yield* git.snapshotRef({
						branch: 'flect/accepted',
						expectedCommit: checkpointed.commit
					});
					const file = snapshot.files.find((candidate) => candidate.path === 'flect.json');
					const snapshotValue = JSON.parse(new TextDecoder().decode(file?.contents)).value;
					return {
						checkpointed,
						snapshotValue,
						snapshotPaths: snapshot.files.map((candidate) => candidate.path)
					};
				}).pipe(
					Effect.match({
						onFailure: (error) =>
							GitTransactionDiagnosticResult.make({
								state: error.reason === 'stale-ref' ? 'stale-ref' : 'failed',
								reason: error.reason
							}),
						onSuccess: ({ checkpointed, snapshotPaths, snapshotValue }) =>
							GitTransactionDiagnosticResult.make({
								state: 'success',
								commit: checkpointed.commit,
								snapshotValue,
								snapshotPaths
							})
					})
				)
			)
			.then((result) => {
				setDiagnostic({
					state: 'complete',
					result
				});
			})
			.catch(() => {
				setDiagnostic({
					state: 'complete',
					result: GitTransactionDiagnosticResult.make({ state: 'failed' })
				});
			});
	};

	const result =
		diagnostic.state === 'complete' ? JSON.stringify(diagnostic.result) : diagnostic.state;

	return (
		<main>
			<button type='button' disabled={diagnostic.state !== 'ready'} onClick={checkpoint}>
				Run checkpoint
			</button>
			<pre data-testid='git-transaction-result' data-state={diagnostic.state}>
				{result}
			</pre>
		</main>
	);
}
