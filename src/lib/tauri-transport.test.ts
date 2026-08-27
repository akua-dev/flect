import { assert, describe, it } from '@effect/vitest';
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Ref, Result, Stream } from 'effect';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import { AgentIntegration } from './agent-integration';
import { FlectClient } from './api';
import { NativeUpdate } from './native-update';
import { ShellLink } from './shell-link';
import { TauriNativeHost, type TauriNativeHostShape } from './tauri-native-host';
import {
	makeTauriAgentIntegrationLayer,
	makeTauriNativeUpdateLayer,
	makeTauriShellLinkLayer,
	nativeApplicationPath
} from './tauri-native-lifecycle-transport';
import { makeTauriFlectClientLayer, TauriBridge, type TauriBridgeShape } from './tauri-transport';

describe('Tauri RPC transport', () => {
	it.effect('routes agent integration lifecycle through the private runtime', () =>
		Effect.gen(function* () {
			const listener = yield* Ref.make<((payload: unknown) => void) | undefined>(undefined);
			const tags = yield* Ref.make<ReadonlyArray<string>>([]);
			const bridge: TauriBridgeShape = {
				listen: (handler) => Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
				send: (request) =>
					Effect.gen(function* () {
						if (!('id' in request) || !('tag' in request)) {
							return;
						}
						yield* Ref.update(tags, (current) => [...current, request.tag]);
						const host = 'codex' as const;
						const value =
							request.tag === 'SetupAgentStatus'
								? [
										{
											host,
											state: 'absent',
											path: '/fixture/codex',
											changed: false
										}
									]
								: {
										host,
										state: 'installed',
										path: '/fixture/codex',
										changed: true
									};
						const active = yield* Ref.get(listener);
						active?.({
							_tag: 'Exit',
							requestId: request.id,
							exit: { _tag: 'Success', value }
						});
					})
			};

			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const integrations = yield* AgentIntegration;
					return {
						statuses: yield* integrations.statusAll,
						installed: yield* integrations.install('codex')
					};
				}).pipe(
					Effect.provide(
						makeTauriAgentIntegrationLayer().pipe(Layer.provide(Layer.succeed(TauriBridge)(bridge)))
					)
				)
			);

			assert.strictEqual(result.statuses[0]?.state, 'absent');
			assert.strictEqual(result.installed.state, 'installed');
			assert.deepStrictEqual(yield* Ref.get(tags), ['SetupAgentStatus', 'SetupAgentInstall']);
		})
	);

	it.effect('accepts only a bounded native Flect application path', () =>
		Effect.gen(function* () {
			const accepted = yield* nativeApplicationPath.pipe(
				Effect.provide(
					Layer.succeed(TauriNativeHost)({
						invoke: () => Effect.succeed('/Applications/Flect.app')
					})
				)
			);
			const rejected = yield* Effect.result(
				nativeApplicationPath.pipe(
					Effect.provide(
						Layer.succeed(TauriNativeHost)({
							invoke: () => Effect.succeed('/Users/test')
						})
					)
				)
			);

			assert.strictEqual(accepted, '/Applications/Flect.app');
			assert.isTrue(Result.isFailure(rejected));
		})
	);

	it.effect('routes only fixed native update operations through the host', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make<
				ReadonlyArray<{ readonly command: string; readonly args?: object }>
			>([]);
			const host: TauriNativeHostShape = {
				invoke: (command, args) =>
					Ref.update(calls, (current) => [
						...current,
						{ command, ...(args === undefined ? {} : { args }) }
					]).pipe(
						Effect.as(
							command === 'native_update_status'
								? {
										version: 1,
										state: 'current',
										installedVersion: '0.2.0',
										checkedAtMillis: 1
									}
								: command === 'native_update_check'
									? {
											version: 1,
											state: 'available',
											installedVersion: '0.2.0',
											candidate: {
												version: '0.2.1',
												token: 'candidate-token-0001',
												notes: 'A bounded update.',
												target: 'darwin-aarch64'
											}
										}
									: command === 'native_update_install'
										? {
												version: 1,
												state: 'ready-to-relaunch',
												installedVersion: '0.2.0',
												candidate: {
													version: '0.2.1',
													token: 'candidate-token-0001',
													notes: 'A bounded update.',
													target: 'darwin-aarch64'
												},
												progress: { downloadedBytes: 1, totalBytes: 1 }
											}
										: undefined
						)
					)
			};

			const values = yield* Effect.gen(function* () {
				const updates = yield* NativeUpdate;
				return {
					status: yield* updates.status,
					checked: yield* updates.check,
					installed: yield* updates.install('candidate-token-0001'),
					relaunched: yield* updates.relaunch
				};
			}).pipe(
				Effect.provide(
					makeTauriNativeUpdateLayer().pipe(Layer.provide(Layer.succeed(TauriNativeHost)(host)))
				)
			);

			assert.strictEqual(values.status.state, 'current');
			assert.strictEqual(values.checked.state, 'available');
			assert.strictEqual(values.installed.state, 'ready-to-relaunch');
			assert.isUndefined(values.relaunched);
			assert.deepStrictEqual(yield* Ref.get(calls), [
				{ command: 'native_update_status' },
				{ command: 'native_update_check' },
				{
					command: 'native_update_install',
					args: { token: 'candidate-token-0001' }
				},
				{ command: 'native_update_relaunch' }
			]);
		})
	);

	it.effect('rejects malformed native update output', () =>
		Effect.gen(function* () {
			const host: TauriNativeHostShape = {
				invoke: () => Effect.succeed({ state: 'available', privateKey: 'no' })
			};
			const result = yield* Effect.gen(function* () {
				const updates = yield* NativeUpdate;
				return yield* Effect.result(updates.check);
			}).pipe(
				Effect.provide(
					makeTauriNativeUpdateLayer().pipe(Layer.provide(Layer.succeed(TauriNativeHost)(host)))
				)
			);

			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, 'unavailable');
				assert.notInclude(result.failure.message, 'privateKey');
			}
		})
	);

	it.effect('routes only fixed shell-link operations through the native host', () =>
		Effect.gen(function* () {
			const commands = yield* Ref.make<ReadonlyArray<string>>([]);
			const host: TauriNativeHostShape = {
				invoke: (command) =>
					Ref.update(commands, (current) => [...current, command]).pipe(
						Effect.as({
							state: command === 'shell_link_remove' ? 'absent' : 'installed',
							path: '/Users/test/.local/bin/flect',
							changed: command !== 'shell_link_status'
						})
					)
			};

			const values = yield* Effect.gen(function* () {
				const shell = yield* ShellLink;
				return {
					status: yield* shell.status,
					installed: yield* shell.install,
					removed: yield* shell.remove
				};
			}).pipe(
				Effect.provide(
					makeTauriShellLinkLayer().pipe(Layer.provide(Layer.succeed(TauriNativeHost)(host)))
				)
			);

			assert.strictEqual(values.status.state, 'installed');
			assert.isTrue(values.installed.changed);
			assert.strictEqual(values.removed.state, 'absent');
			assert.deepStrictEqual(yield* Ref.get(commands), [
				'shell_link_status',
				'shell_link_install',
				'shell_link_remove'
			]);
		})
	);

	it.effect('encodes the selected agent role for private operations', () =>
		Effect.gen(function* () {
			const listener = yield* Ref.make<((payload: unknown) => void) | undefined>(undefined);
			const requests = yield* Ref.make<ReadonlyArray<unknown>>([]);

			const bridge: TauriBridgeShape = {
				listen: (handler) => Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
				send: (request) =>
					Effect.gen(function* () {
						yield* Ref.update(requests, (current) => [...current, request]);
						if (typeof request === 'object' && request !== null && 'id' in request) {
							const active = yield* Ref.get(listener);
							active?.({
								_tag: 'Exit',
								requestId: request.id,
								exit: { _tag: 'Success', value: null }
							});
						}
					})
			};

			yield* Effect.scoped(
				Effect.gen(function* () {
					const client = yield* FlectClient;
					yield* client.cancel('session-1', 'app');
					yield* client.completeShellRequest(
						'session-1',
						'shaper',
						'shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2',
						{
							version: 1,
							exitCode: 0,
							stdout: '42\n',
							stderr: ''
						}
					);
				}).pipe(
					Effect.provide(
						makeTauriFlectClientLayer().pipe(Layer.provide(Layer.succeed(TauriBridge)(bridge)))
					)
				)
			);

			const encoded = JSON.stringify(yield* Ref.get(requests));
			assert.include(encoded, '"role":"app"');
			assert.include(encoded, '"role":"shaper"');
		})
	);

	it.effect('routes an Effect RPC request through invoke and a private event', () =>
		Effect.gen(function* () {
			const listener = yield* Ref.make<((payload: unknown) => void) | undefined>(undefined);
			const unlistenCount = yield* Ref.make(0);
			const requests = yield* Ref.make<ReadonlyArray<unknown>>([]);

			const bridge: TauriBridgeShape = {
				listen: (handler) =>
					Ref.set(listener, handler).pipe(
						Effect.as(Ref.update(unlistenCount, (count) => count + 1))
					),
				send: (request) =>
					Effect.gen(function* () {
						yield* Ref.update(requests, (current) => [...current, request]);
						if (typeof request === 'object' && request !== null && 'id' in request) {
							const active = yield* Ref.get(listener);
							active?.({
								_tag: 'Exit',
								requestId: request.id,
								exit: {
									_tag: 'Success',
									value: { version: 1, status: 'ready' }
								}
							});
						}
					})
			};

			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const client = yield* FlectClient;
					return yield* client.status;
				}).pipe(
					Effect.provide(
						makeTauriFlectClientLayer().pipe(Layer.provide(Layer.succeed(TauriBridge)(bridge)))
					)
				)
			);

			const sent = yield* Ref.get(requests);
			const releases = yield* Ref.get(unlistenCount);
			assert.strictEqual(result.status, 'ready');
			assert.strictEqual(sent.length, 1);
			assert.strictEqual(releases, 1);
		})
	);

	it.effect('encodes shape documents before crossing the private bridge', () =>
		Effect.gen(function* () {
			const listener = yield* Ref.make<((payload: unknown) => void) | undefined>(undefined);
			const requests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const encodedDocument = {
				version: defaultInterfaceDocument.version,
				name: defaultInterfaceDocument.name,
				root: defaultInterfaceDocument.root
			};

			const bridge: TauriBridgeShape = {
				listen: (handler) => Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
				send: (request) =>
					Effect.gen(function* () {
						yield* Ref.update(requests, (current) => [...current, request]);
						if (typeof request === 'object' && request !== null && 'id' in request) {
							const active = yield* Ref.get(listener);
							active?.({
								_tag: 'Chunk',
								requestId: request.id,
								values: [
									{
										type: 'shape_completed',
										document: encodedDocument
									}
								]
							});
							active?.({
								_tag: 'Exit',
								requestId: request.id,
								exit: { _tag: 'Success', value: null }
							});
						}
					})
			};

			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const client = yield* FlectClient;
					return yield* client
						.shape('session-1', 'Keep this focused', defaultInterfaceDocument)
						.pipe(Stream.runCollect);
				}).pipe(
					Effect.provide(
						makeTauriFlectClientLayer().pipe(Layer.provide(Layer.succeed(TauriBridge)(bridge)))
					)
				)
			);

			const sent = yield* Ref.get(requests);
			assert.strictEqual(result[0]?.type, 'shape_completed');
			assert.strictEqual(
				result[0]?.type === 'shape_completed' && result[0].document !== undefined
					? result[0].document.name
					: '',
				defaultInterfaceDocument.name
			);
			assert.strictEqual(sent.length, 2);

			const request = sent[0];
			assert.isTrue(
				typeof request === 'object' &&
					request !== null &&
					'payload' in request &&
					typeof request.payload === 'object' &&
					request.payload !== null &&
					'document' in request.payload &&
					typeof request.payload.document === 'object' &&
					request.payload.document !== null &&
					Object.getPrototypeOf(request.payload.document) === Object.prototype
			);
		})
	);

	it.effect('fails pending calls when the private runtime stops', () =>
		Effect.gen(function* () {
			const listener = yield* Ref.make<((payload: unknown) => void) | undefined>(undefined);
			const requestSent = yield* Deferred.make<undefined>();

			const bridge: TauriBridgeShape = {
				listen: (handler) => Ref.set(listener, handler).pipe(Effect.as(Effect.void)),
				send: (request) =>
					Effect.gen(function* () {
						if (typeof request === 'object' && request !== null && 'id' in request) {
							yield* Deferred.succeed(requestSent, undefined);
							const active = yield* Ref.get(listener);
							active?.({
								_tag: 'ClientProtocolError',
								error: {
									_tag: 'RpcClientError',
									reason: {
										_tag: 'RpcClientDefect',
										message: 'The private runtime is unavailable.',
										cause: null
									}
								}
							});
						}
						return yield* Effect.never;
					})
			};

			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const client = yield* FlectClient;
					const pending = yield* Effect.forkScoped(client.status);
					yield* Deferred.await(requestSent);
					return yield* Fiber.await(pending);
				}).pipe(
					Effect.provide(
						makeTauriFlectClientLayer().pipe(Layer.provide(Layer.succeed(TauriBridge)(bridge)))
					)
				)
			);

			assert.isTrue(Exit.isFailure(result));
			if (Exit.isFailure(result)) {
				const error = Cause.findError(result.cause);
				assert.isTrue(Result.isSuccess(error));
				if (Result.isSuccess(error)) {
					assert.strictEqual(error.success._tag, 'FlectUnavailableError');
				}
			}
		})
	);
});
