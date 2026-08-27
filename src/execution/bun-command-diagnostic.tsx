import { Effect, ManagedRuntime } from 'effect';
import { useEffect, useState } from 'react';
import { makeLiveSandboxedShellLayer, SandboxedShell } from '../shell/sandboxed-shell';
import { fixtureRegistryFetch } from './fixtures/package-registry';

const serverSource = `
const networkDenied = fetch("https://example.invalid/")
  .then(() => false)
  .catch(() => true);
const opfsDenied = globalThis.navigator?.storage?.getDirectory
  ? globalThis.navigator.storage.getDirectory()
      .then(() => false)
      .catch(() => true)
  : Promise.resolve(true);

Bun.serve({
  port: 3417,
  async fetch(request) {
    const network = await networkDenied;
    const opfs = await opfsDenied;
    const path = new URL(request.url).pathname;
    return new Response(
      \`<!doctype html>
      <meta charset="utf-8">
      <title>Flect preview</title>
      <main>
        <h1 data-testid="preview-heading">Flect preview</h1>
        <p data-testid="preview-path">\${path}</p>
        <output data-testid="network-denied">\${network}</output>
        <output data-testid="opfs-denied">\${opfs}</output>
      </main>\`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
});
`;

const diagnosticLayer = makeLiveSandboxedShellLayer({
	role: 'shaper',
	files: {
		'/workspace/package.json':
			'{\n  "name": "flect-bun-diagnostic",\n  "private": true,\n  "type": "module",\n  "dependencies": {}\n}\n',
		'/workspace/src/index.ts': 'export const answer: number = 42;\nconsole.log(answer);\n',
		'/workspace/src/server.ts': serverSource
	},
	packageFetch: fixtureRegistryFetch,
	registryBaseUrl: 'https://registry.flect.invalid'
});

const diagnosticRuntime = ManagedRuntime.make(diagnosticLayer);

interface DiagnosticState {
	readonly status: 'running' | 'passed' | 'failed' | 'stopped';
	readonly run: string;
	readonly packages: string;
	readonly previewUrl?: string;
	readonly stop: string;
	readonly error?: string;
}

const initialState: DiagnosticState = {
	status: 'running',
	run: '',
	packages: '',
	stop: 'pending'
};

const describeFailure = (error: unknown) =>
	error instanceof Error
		? error.message
		: typeof error === 'object' &&
			  error !== null &&
			  'message' in error &&
			  typeof error.message === 'string'
			? error.message
			: 'Browser Bun diagnostic failed.';

export function BunCommandDiagnostic() {
	const [state, setState] = useState(initialState);

	useEffect(() => {
		let active = true;
		void diagnosticRuntime
			.runPromise(
				Effect.gen(function* () {
					const shell = yield* SandboxedShell;
					const run = yield* shell.execute('shaper', 'bun run src/index.ts');
					const packages = yield* shell.execute('shaper', 'bun add flect-fixture@1.0.0');
					const preview = yield* shell.execute('shaper', 'bun run src/server.ts');
					return {
						run: run.stdout.trim(),
						packages: packages.stdout.trim(),
						previewUrl: preview.previewUrl
					};
				})
			)
			.then((output) => {
				if (active && output.previewUrl !== undefined) {
					setState({
						status: 'passed',
						...output,
						previewUrl: output.previewUrl,
						stop: 'active'
					});
				} else if (active) {
					setState({ ...initialState, status: 'failed' });
				}
			})
			.catch((error: unknown) => {
				if (active) {
					setState({
						...initialState,
						status: 'failed',
						error: describeFailure(error)
					});
				}
			});

		return () => {
			active = false;
		};
	}, []);

	const stop = () => {
		void diagnosticRuntime
			.runPromise(
				Effect.gen(function* () {
					const shell = yield* SandboxedShell;
					return yield* shell.stop('shaper');
				})
			)
			.then(() => {
				setState((current) => ({
					...current,
					status: 'stopped',
					stop: 'disposed'
				}));
			})
			.catch(() => {
				setState((current) => ({ ...current, status: 'failed' }));
			});
	};

	return (
		<main
			data-testid='bun-diagnostic'
			data-status={state.status}
			aria-label='Browser Bun command diagnostic'
		>
			<output data-testid='bun-run'>{state.run}</output>
			<output data-testid='bun-packages'>{state.packages}</output>
			<output data-testid='bun-preview-url'>{state.previewUrl ?? ''}</output>
			<output data-testid='bun-stop'>{state.stop}</output>
			<output data-testid='bun-error'>{state.error ?? ''}</output>
			{state.previewUrl === undefined ? null : (
				<iframe title='Flect preview' src={state.previewUrl} />
			)}
			<button type='button' onClick={stop}>
				Stop preview
			</button>
		</main>
	);
}
