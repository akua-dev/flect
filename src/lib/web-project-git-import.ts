import { Effect, type Scope } from 'effect';
import { type GitWorkspaceShape, makeGitWorkspace } from '../git/git-workspace';
import {
	importWebProject,
	WebProjectImportFailure,
	type WebProjectImportResult
} from './web-project-import';

const failure = (message: string) => WebProjectImportFailure.make({ message });

export const importWebProjectFromGit = Effect.fn('Flect.WebProject.importGit')(function* (
	url: string,
	commit: string,
	options?: {
		readonly createWorkspace?: Effect.Effect<GitWorkspaceShape, never, Scope.Scope>;
		readonly workspaceId?: () => string;
	}
): Effect.fn.Return<WebProjectImportResult, WebProjectImportFailure> {
	if (!/^https:\/\/(?!(?:[^/]*@))\S+$/.test(url) || !/^[0-9a-f]{40}$/.test(commit)) {
		return yield* Effect.fail(
			failure('Use a credential-free HTTPS Git URL and the exact lowercase 40-character commit ID.')
		);
	}
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const workspace = yield* options?.createWorkspace ?? makeGitWorkspace();
			yield* Effect.acquireRelease(
				workspace
					.open({
						workspaceId:
							options?.workspaceId?.() ??
							`project-${crypto.randomUUID().replaceAll('-', '').slice(0, 32)}`,
						reset: true
					})
					.pipe(Effect.mapError(() => failure('The isolated Git workspace could not start.'))),
				() => workspace.remove.pipe(Effect.catchCause(() => Effect.void))
			);
			const source = yield* workspace
				.inspectShare({ url, commit, manifestRequired: false })
				.pipe(
					Effect.mapError((error) =>
						failure(
							error.reason === 'invalid-ref'
								? 'That exact Git commit is not available from the repository.'
								: 'The public Git repository could not be cloned safely. Check HTTPS/CORS access and the exact commit.'
						)
					)
				);
			return yield* importWebProject(source.files, {
				source: 'git',
				revision: source.commit,
				sourceLabel: url
			});
		})
	);
});
