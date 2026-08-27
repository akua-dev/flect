import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import {
	JavaScriptExecutionRequest,
	PackageMirrorRequest,
	WasiExecutionRequest
} from '../../shared/browser-execution';
import { NOOP_WASI_MODULE } from './fixtures/noop-wasi';
import { RiftyJavaScriptExecution } from './rifty-js-runtime';
import { RiftyPackageMirror } from './rifty-package-mirror';
import { RiftyWasiExecution } from './rifty-wasi-runtime';
import { executionRuntime } from './runtime';

interface DiagnosticState {
	readonly status: 'running' | 'passed' | 'failed';
	readonly javascript: string;
	readonly capabilities: string;
	readonly vfsIsolation: string;
	readonly wasi: string;
	readonly packages: string;
	readonly release: string;
}

const initialState: DiagnosticState = {
	status: 'running',
	javascript: '',
	capabilities: '',
	vfsIsolation: '',
	wasi: '',
	packages: '',
	release: 'pending'
};

const deniedCapabilityExpressions = [
	'fetch("https://example.invalid/")',
	'globalThis.localStorage.getItem("flect")',
	'globalThis.sessionStorage.getItem("flect")',
	'globalThis.indexedDB.open("flect")',
	'globalThis.caches.open("flect")',
	'globalThis.navigator.storage.getDirectory()',
	'new WebSocket("wss://example.invalid/")',
	'new EventSource("https://example.invalid/")',
	'new Worker("data:text/javascript,void 0")',
	'importScripts("https://example.invalid/worker.js")',
	'globalThis.showOpenFilePicker()'
] as const;

export function BrowserExecutionDiagnostic() {
	const [state, setState] = useState(initialState);

	useEffect(() => {
		let active = true;
		void executionRuntime
			.runPromise(
				Effect.gen(function* () {
					const javascript = yield* RiftyJavaScriptExecution;
					const wasi = yield* RiftyWasiExecution;
					const packages = yield* RiftyPackageMirror;

					const javascriptResult = yield* javascript.evaluate(
						JavaScriptExecutionRequest.make({
							version: 1,
							source: '40 + 2'
						})
					);
					const capabilityResults = yield* Effect.forEach(
						deniedCapabilityExpressions,
						(expression) =>
							javascript.evaluate(
								JavaScriptExecutionRequest.make({
									version: 1,
									source: `Promise.resolve()
  .then(() => ${expression})
  .then(() => console.log("escaped"))
  .catch(() => console.log("blocked"))`
								})
							),
						{ concurrency: 2 }
					);
					yield* javascript.evaluate(
						JavaScriptExecutionRequest.make({
							version: 1,
							source: `const { mkdirSync, writeFileSync } = require("node:fs");
mkdirSync("/workspace", { recursive: true });
writeFileSync("/workspace/.flect-memory-probe", "written");
console.log("written");`
						})
					);
					const vfsIsolationResult = yield* javascript.evaluate(
						JavaScriptExecutionRequest.make({
							version: 1,
							source: `const { existsSync } = require("node:fs");
console.log(existsSync("/workspace/.flect-memory-probe") ? "persistent" : "isolated");`
						})
					);
					const wasiResult = yield* wasi.run(
						WasiExecutionRequest.make({
							version: 1,
							module: NOOP_WASI_MODULE,
							args: ['flect-diagnostic'],
							env: {}
						})
					);
					const packageResult = yield* packages.install(
						PackageMirrorRequest.make({
							version: 1,
							name: 'flect-diagnostic',
							packageVersion: '1.0.0',
							dependencies: {
								'flect-fixture': '1.0.0'
							}
						})
					);

					return {
						javascript: javascriptResult.stdout.trim(),
						capabilities: capabilityResults
							.map((result) => (result.stdout.trim() === 'escaped' ? 'escaped' : 'blocked'))
							.join(','),
						vfsIsolation: vfsIsolationResult.stdout.trim(),
						wasi: String(wasiResult.exitCode),
						packages: String(packageResult.packageCount)
					};
				})
			)
			.then((result) => {
				if (active) {
					setState({
						status: 'passed',
						...result,
						release: 'disposed'
					});
				}
			})
			.catch(() => {
				if (active) {
					setState({
						status: 'failed',
						javascript: '',
						capabilities: '',
						vfsIsolation: '',
						wasi: '',
						packages: '',
						release: 'disposed'
					});
				}
			});

		return () => {
			active = false;
		};
	}, []);

	return (
		<main
			data-testid='execution-diagnostic'
			data-status={state.status}
			aria-label='Browser execution diagnostic'
		>
			<output data-testid='execution-js'>{state.javascript}</output>
			<output data-testid='execution-capabilities'>{state.capabilities}</output>
			<output data-testid='execution-vfs-isolation'>{state.vfsIsolation}</output>
			<output data-testid='execution-wasi'>{state.wasi}</output>
			<output data-testid='execution-packages'>{state.packages}</output>
			<output data-testid='execution-release'>{state.release}</output>
		</main>
	);
}
