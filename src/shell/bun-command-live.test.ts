import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import { InMemoryFs } from 'just-bash/browser';
import {
	BunCommandRequest,
	BunCommandResult,
	WorkspaceDelta,
	WorkspaceFileWrite
} from '../../shared/bun-command';
import { BunModuleExecution, type BunModuleOperation } from '../execution/bun-module-execution';
import { fixtureRegistryFetch } from '../execution/fixtures/package-registry';
import { BunCommand } from './bun-command';
import { makeShellBunCommandLiveLayer } from './bun-command-live';
import { makeLiveSandboxedShellLayer, SandboxedShell } from './sandboxed-shell';

const result = (stdout: string) =>
	BunCommandResult.make({
		version: 1,
		exitCode: 0,
		stdout,
		stderr: ''
	});

const build = (stdout: string) => ({
	result: result(stdout),
	delta: WorkspaceDelta.make({ version: 1, files: [], byteLength: 0 })
});

describe('Shell Bun command live composition', () => {
	it.effect('applies package deltas before the next module run', () =>
		Effect.gen(function* () {
			const fs = new InMemoryFs({
				'/workspace/package.json':
					'{\n  "name": "fixture-app",\n  "private": true,\n  "dependencies": {}\n}\n',
				'/workspace/src/index.ts': 'console.log(42);\n'
			});
			const runs = yield* Ref.make<Array<BunModuleOperation>>([]);
			const moduleLayer = Layer.succeed(BunModuleExecution)({
				run: (operation) =>
					Ref.update(runs, (current) => [...current, operation]).pipe(Effect.as(result('42\n'))),
				build: () => Effect.succeed(build('/workspace/src/index.ts\n')),
				stop: () => Effect.succeed(result('Stopped\n'))
			});
			const layer = makeShellBunCommandLiveLayer({
				fs,
				moduleLayer,
				packageFetch: fixtureRegistryFetch,
				registryBaseUrl: 'https://registry.flect.invalid'
			});

			const [added, ran] = yield* Effect.gen(function* () {
				const command = yield* BunCommand;
				return [
					yield* command.execute(
						BunCommandRequest.make({
							version: 1,
							argv: ['add', 'flect-fixture@1.0.0'],
							cwd: '/workspace'
						})
					),
					yield* command.execute(
						BunCommandRequest.make({
							version: 1,
							argv: ['run', 'src/index.ts'],
							cwd: '/workspace'
						})
					)
				] as const;
			}).pipe(Effect.provide(layer));

			assert.include(added.stdout, '1 package');
			assert.strictEqual(ran.stdout, '42\n');
			const manifest = yield* Effect.promise(() => fs.readFile('/workspace/package.json'));
			assert.strictEqual(JSON.parse(manifest).dependencies['flect-fixture'], '1.0.0');
			const [run] = yield* Ref.get(runs);
			assert.isDefined(run?.workspace.files['/workspace/node_modules/flect-fixture/package.json']);
		})
	);

	it.effect('runs the composed command through the live just-bash shell', () =>
		Effect.gen(function* () {
			const moduleLayer = Layer.succeed(BunModuleExecution)({
				run: () => Effect.succeed(result('42\n')),
				build: () => Effect.succeed(build('/workspace/src/index.ts\n')),
				stop: () => Effect.succeed(result('Stopped\n'))
			});
			const shellLayer = makeLiveSandboxedShellLayer({
				role: 'shaper',
				files: {
					'/workspace/package.json':
						'{\n  "name": "fixture-app",\n  "private": true,\n  "dependencies": {}\n}\n',
					'/workspace/src/index.ts': 'console.log(42);\n'
				},
				moduleLayer,
				packageFetch: fixtureRegistryFetch,
				registryBaseUrl: 'https://registry.flect.invalid'
			});

			const output = yield* Effect.gen(function* () {
				const shell = yield* SandboxedShell;
				return yield* shell.execute(
					'shaper',
					'bun add flect-fixture@1.0.0 && bun run src/index.ts'
				);
			}).pipe(Effect.provide(shellLayer));

			assert.strictEqual(output.exitCode, 0);
			assert.strictEqual(output.stdout, 'Installed 1 package.\n42\n');
		})
	);

	it.effect('applies typed build output to the disposable workspace', () =>
		Effect.gen(function* () {
			const fs = new InMemoryFs({
				'/workspace/package.json': '{"name":"fixture"}\n',
				'/workspace/src/index.ts': 'console.log(42);\n'
			});
			const moduleLayer = Layer.succeed(BunModuleExecution)({
				run: () => Effect.succeed(result('42\n')),
				build: () =>
					Effect.succeed({
						result: result('/workspace/.flect-build/src/index.js\n'),
						delta: WorkspaceDelta.make({
							version: 1,
							files: [
								WorkspaceFileWrite.make({
									operation: 'write',
									path: '/workspace/.flect-build/src/index.js',
									content: new TextEncoder().encode('console.log(42);\n')
								})
							],
							byteLength: 'console.log(42);\n'.length
						})
					}),
				stop: () => Effect.succeed(result('Stopped\n'))
			});
			const layer = makeShellBunCommandLiveLayer({
				fs,
				moduleLayer,
				packageFetch: fixtureRegistryFetch,
				registryBaseUrl: 'https://registry.flect.invalid'
			});

			const output = yield* Effect.gen(function* () {
				const command = yield* BunCommand;
				return yield* command.execute(
					BunCommandRequest.make({
						version: 1,
						argv: ['build', 'src/index.ts'],
						cwd: '/workspace'
					})
				);
			}).pipe(Effect.provide(layer));
			const built = yield* Effect.promise(() =>
				fs.readFile('/workspace/.flect-build/src/index.js', 'utf8')
			);

			assert.strictEqual(output.stdout, '/workspace/.flect-build/src/index.js\n');
			assert.strictEqual(built, 'console.log(42);\n');
		})
	);
});
