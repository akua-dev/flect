import { Effect, ManagedRuntime } from 'effect';
import { useEffect, useState } from 'react';
import { GitWorkspace, GitWorkspaceLive } from './git-workspace';

const reset = async () => {
	const runtime = ManagedRuntime.make(GitWorkspaceLive);
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const git = yield* GitWorkspace;
				yield* git.open({ workspaceId: 'default', reset: true });
				yield* git.remove;
			})
		);
	} finally {
		await runtime.dispose();
	}
	const root = await navigator.storage.getDirectory();
	for await (const [name] of root.entries()) {
		await root.removeEntry(name, { recursive: true });
	}
	localStorage.clear();
};

export function StorageResetDiagnostic() {
	const [state, setState] = useState<'running' | 'complete' | 'failed'>('running');

	useEffect(() => {
		void reset().then(
			() => setState('complete'),
			() => setState('failed')
		);
	}, []);

	return (
		<main data-state={state} data-testid='storage-reset-diagnostic'>
			{state}
		</main>
	);
}
