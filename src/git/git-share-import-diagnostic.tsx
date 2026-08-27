import { Effect, ManagedRuntime } from 'effect';
import { useEffect, useState } from 'react';
import {
	GitShareImportDiagnosticResult,
	type GitWorkspaceFailure
} from '../../shared/git-workspace';
import { GitWorkspace, GitWorkspaceLive } from './git-workspace';

interface DiagnosticState {
	readonly state: 'running' | 'complete' | 'failed';
	readonly result?: GitShareImportDiagnosticResult;
	readonly message?: string;
}

const encoder = new TextEncoder();

const runDiagnostic = (workspaceId: string) => {
	const runtime = ManagedRuntime.make(GitWorkspaceLive);
	return runtime
		.runPromise(
			Effect.gen(function* () {
				const git = yield* GitWorkspace;
				const sourceWorkspace = `${workspaceId}-source`;
				const targetWorkspace = `${workspaceId}-target`;
				yield* git.open({ workspaceId: sourceWorkspace, reset: true });
				const payload = yield* git.checkpoint({
					branch: 'flect/share-source',
					files: [
						{
							path: 'components/card/index.ts',
							contents: encoder.encode('export const card = true;\n')
						}
					],
					message: 'Create shared component payload'
				});
				const manifest = {
					formatVersion: 1,
					id: 'dev.flect.diagnostic-card',
					name: 'Diagnostic card',
					version: '1.0.0',
					repository: { _tag: 'git', commit: payload.commit },
					artifacts: [
						{
							id: 'dev.flect.diagnostic-card.component',
							kind: 'component',
							version: '1.0.0',
							sourceRoot: 'components/card',
							contentSha256: 'b'.repeat(64)
						}
					],
					compatibility: {
						flect: '>=0.2.0 <1.0.0',
						platforms: ['browser', 'macos']
					},
					provenance: {
						publisher: 'Flect diagnostics',
						source: 'local-diagnostic',
						revision: payload.commit,
						builder: 'Flect'
					},
					signatures: [],
					migrations: []
				};
				const descriptor = yield* git.checkpoint({
					branch: 'flect/share-source',
					expectedCommit: payload.commit,
					files: [
						{
							path: '.flect/share.json',
							contents: encoder.encode(JSON.stringify(manifest))
						}
					],
					message: 'Describe shared component payload'
				});
				const descriptorInspection = yield* git.inspectShare({
					commit: descriptor.commit,
					manifestRequired: true
				});
				const payloadInspection = yield* git.inspectShare({
					commit: payload.commit,
					manifestRequired: false
				});
				yield* git.open({ workspaceId: targetWorkspace, reset: true });
				const imported = yield* git.importRepository({
					archive: payloadInspection.repository,
					commit: payload.commit
				});
				const inspected = yield* git.inspectShare({
					commit: payload.commit,
					manifestRequired: false
				});
				const result = GitShareImportDiagnosticResult.make({
					descriptorCommit: descriptor.commit,
					payloadCommit: payload.commit,
					importedCommit: imported.commit,
					fileCount: imported.fileCount,
					repositoryBytes: payloadInspection.repository.byteLength,
					manifestFound: descriptorInspection.manifest !== undefined,
					payloadFound: inspected.files.some((file) => file.path === 'components/card/index.ts')
				});
				yield* git.remove;
				yield* git.open({ workspaceId: sourceWorkspace });
				yield* git.remove;
				return result;
			}).pipe(Effect.catch((error: GitWorkspaceFailure) => Effect.fail(new Error(error.message))))
		)
		.finally(() => runtime.dispose());
};

export function GitShareImportDiagnostic() {
	const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
		state: 'running'
	});

	useEffect(() => {
		const workspaceId =
			new URLSearchParams(globalThis.location.search).get('workspace') ?? 'share-import';
		let active = true;
		void runDiagnostic(workspaceId)
			.then((result) => {
				if (active) setDiagnostic({ state: 'complete', result });
			})
			.catch(() => {
				if (active) {
					setDiagnostic({
						state: 'failed',
						message: 'The Git share import diagnostic failed safely.'
					});
				}
			});
		return () => {
			active = false;
		};
	}, []);

	return (
		<main>
			<pre data-testid='git-share-import-result' data-state={diagnostic.state}>
				{diagnostic.result === undefined
					? (diagnostic.message ?? 'Running Git share import proof…')
					: JSON.stringify(diagnostic.result)}
			</pre>
		</main>
	);
}
