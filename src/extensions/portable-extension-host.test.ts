import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import { PortableExtensionPackage, type PortableExtensionRole } from '../../shared/extensions';
import { SandboxExecutionFailed, SandboxResult, SetTextIntent } from '../../shared/sandbox';
import { InterfaceStorage } from '../lib/interface-store';
import { CapabilityAdapter, SandboxCapabilityBrokerLive } from '../sandbox/capability-broker';
import { makeExtensionSandboxTestLayer } from '../sandbox/extension-sandbox';
import { ExtensionCatalog, makeExtensionCatalogLayer } from './extension-catalog';
import {
	PortableExtensionHost,
	PortableExtensionHostLive,
	PortableExtensionSource
} from './portable-extension-host';

const extension = (id: string, roles: ReadonlyArray<PortableExtensionRole>) =>
	PortableExtensionPackage.make({
		formatVersion: 1,
		id,
		name: id === 'app-weather' ? 'App weather' : 'Shape weather',
		description: 'Adds a bounded weather projection.',
		version: '1.0.0',
		bundle: `extensions/${id}/bundle.mjs`,
		roles: [...roles],
		compatibility: {
			flect: '>=0.2.0 <1.0.0',
			extensionApi: 1,
			platforms: ['browser', 'macos']
		},
		capabilities: [
			{ id: 'interface:read', required: true },
			{ id: 'interface:propose', required: false }
		],
		publicInstructions: 'Use only when weather context is useful.',
		commands: [
			{
				id: 'forecast',
				name: 'Forecast',
				description: 'Project a public forecast.'
			}
		],
		tools: [],
		resources: {
			deadlineMs: 100,
			memoryBytes: 16 * 1024 * 1024,
			inputBytes: 1024 * 1024,
			outputBytes: 1024 * 1024,
			maxIntents: 20
		},
		provenance: {
			publisher: 'akua-dev',
			source: `https://github.com/akua-dev/${id}`,
			revision: 'v1.0.0',
			bundleSha256: id === 'app-weather' ? 'a'.repeat(64) : 'b'.repeat(64)
		}
	});

const appPackage = extension('app-weather', ['app']);
const shaperPackage = extension('shape-weather', ['shaper']);

const makeHarness = (options?: {
	readonly sandboxFailure?: 'execution' | 'deadline';
	readonly proposedIntent?: boolean;
}) => {
	const stored = Ref.makeUnsafe<string | null>(null);
	const storage = Layer.succeed(InterfaceStorage)({
		read: () => Ref.get(stored),
		write: (_key, value) => Ref.set(stored, value),
		remove: () => Ref.set(stored, null)
	});
	const catalog = makeExtensionCatalogLayer().pipe(Layer.provide(storage));
	const sandboxCalls = Ref.makeUnsafe(0);
	const sandbox = makeExtensionSandboxTestLayer({
		run: () =>
			Ref.update(sandboxCalls, (count) => count + 1).pipe(
				Effect.andThen(
					options?.sandboxFailure === undefined
						? Effect.succeed(
								SandboxResult.make({
									version: 1,
									intents: [
										SetTextIntent.make({
											type: 'set-text',
											target: 'weather',
											text: 'Berlin'
										})
									]
								})
							)
						: Effect.fail(
								SandboxExecutionFailed.make({
									reason: options.sandboxFailure,
									message: 'Extension execution failed safely.'
								})
							)
				)
			)
	});
	const adapterCalls = Ref.makeUnsafe(0);
	const broker = SandboxCapabilityBrokerLive.pipe(
		Layer.provide(
			Layer.succeed(CapabilityAdapter)({
				apply: () => Ref.update(adapterCalls, (count) => count + 1)
			})
		)
	);
	const source = Layer.succeed(PortableExtensionSource)({
		list: (binding) =>
			Effect.succeed(
				binding === 'accepted'
					? []
					: [appPackage, shaperPackage].map((manifest) => ({
							capsuleId: 'dev.akua.weather',
							binding,
							manifest,
							source: options?.proposedIntent
								? "() => ({ type: 'set-text', target: 'weather', text: 'Berlin' })"
								: '() => []'
						}))
			)
	});
	const layer = PortableExtensionHostLive.pipe(
		Layer.provideMerge(Layer.mergeAll(catalog, sandbox.layer, broker, source))
	);
	return { layer, sandboxCalls, adapterCalls };
};

const stage = Effect.gen(function* () {
	const catalog = yield* ExtensionCatalog;
	yield* catalog.stageCandidate({
		capsuleId: 'dev.akua.weather',
		packages: [appPackage, shaperPackage],
		flectVersion: '0.2.0',
		platform: 'browser'
	});
});

describe('PortableExtensionHost', () => {
	it.effect('discovers only enabled packages for the authenticated role and binding', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			yield* stage;
			const catalog = yield* ExtensionCatalog;
			yield* catalog.enable(
				{
					capsuleId: 'dev.akua.weather',
					extensionId: 'app-weather',
					role: 'app',
					binding: 'candidate'
				},
				['interface:read']
			);
			const host = yield* PortableExtensionHost;
			const app = yield* host.list('app', 'candidate');
			const shaper = yield* host.list('shaper', 'candidate');
			const accepted = yield* host.list('app', 'accepted');

			assert.deepStrictEqual(
				app.map((entry) => entry.id),
				['app-weather']
			);
			assert.deepStrictEqual(shaper, []);
			assert.deepStrictEqual(accepted, []);
			assert.notProperty(app[0] ?? {}, 'source');
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect(
		'rejects inactive, wrong-role, and wrong-binding calls before worker acquisition',
		() => {
			const harness = makeHarness();
			return Effect.gen(function* () {
				yield* stage;
				const host = yield* PortableExtensionHost;
				const inactive = yield* host
					.call(
						{
							role: 'app',
							binding: 'candidate',
							operationId: 'operation-extension-test'
						},
						'app-weather',
						{}
					)
					.pipe(Effect.flip);
				const wrongRole = yield* host
					.call(
						{
							role: 'shaper',
							binding: 'candidate',
							operationId: 'operation-extension-test'
						},
						'app-weather',
						{}
					)
					.pipe(Effect.flip);
				const wrongBinding = yield* host
					.call(
						{
							role: 'app',
							binding: 'accepted',
							operationId: 'operation-extension-test'
						},
						'app-weather',
						{}
					)
					.pipe(Effect.flip);

				assert.strictEqual(inactive._tag, 'PortableExtensionUnavailable');
				if (inactive._tag === 'PortableExtensionUnavailable') {
					assert.strictEqual(inactive.reason, 'disabled');
				}
				assert.strictEqual(wrongRole._tag, 'PortableExtensionUnavailable');
				if (wrongRole._tag === 'PortableExtensionUnavailable') {
					assert.strictEqual(wrongRole.reason, 'wrong-role');
				}
				assert.strictEqual(wrongBinding._tag, 'PortableExtensionUnavailable');
				if (wrongBinding._tag === 'PortableExtensionUnavailable') {
					assert.strictEqual(wrongBinding.reason, 'wrong-binding');
				}
				assert.strictEqual(yield* Ref.get(harness.sandboxCalls), 0);
			}).pipe(Effect.provide(harness.layer));
		}
	);

	it.effect('executes with the exact role grants and marks only that candidate tested', () => {
		const harness = makeHarness({ proposedIntent: true });
		return Effect.gen(function* () {
			yield* stage;
			const catalog = yield* ExtensionCatalog;
			yield* catalog.enable(
				{
					capsuleId: 'dev.akua.weather',
					extensionId: 'app-weather',
					role: 'app',
					binding: 'candidate'
				},
				['interface:read', 'interface:propose']
			);
			const host = yield* PortableExtensionHost;
			const result = yield* host.call(
				{
					role: 'app',
					binding: 'candidate',
					operationId: 'operation-extension-test'
				},
				'app-weather',
				{ city: 'Berlin' }
			);

			assert.strictEqual(result.intents[0]?.type, 'set-text');
			assert.strictEqual(yield* Ref.get(harness.sandboxCalls), 1);
			assert.strictEqual(yield* Ref.get(harness.adapterCalls), 1);
			const snapshot = yield* catalog.snapshot;
			assert.strictEqual(
				snapshot.entries.find((entry) => entry.extensionId === 'app-weather')?.tested,
				true
			);
			assert.strictEqual(
				snapshot.entries.find((entry) => entry.extensionId === 'shape-weather')?.tested,
				false
			);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('records capability denial without applying an intent or exposing details', () => {
		const harness = makeHarness({ proposedIntent: true });
		return Effect.gen(function* () {
			yield* stage;
			const catalog = yield* ExtensionCatalog;
			yield* catalog.enable(
				{
					capsuleId: 'dev.akua.weather',
					extensionId: 'app-weather',
					role: 'app',
					binding: 'candidate'
				},
				['interface:read']
			);
			const host = yield* PortableExtensionHost;
			const denied = yield* host
				.call(
					{
						role: 'app',
						binding: 'candidate',
						operationId: 'operation-extension-test'
					},
					'app-weather',
					{ credential: 'must-not-escape' }
				)
				.pipe(Effect.flip);

			assert.strictEqual(denied._tag, 'CapabilityDenied');
			assert.strictEqual(yield* Ref.get(harness.adapterCalls), 0);
			const failed = (yield* catalog.snapshot).entries.find(
				(entry) => entry.extensionId === 'app-weather'
			);
			assert.strictEqual(failed?.state, 'failed');
			assert.strictEqual(failed?.failure?.reason, 'capability-denied');
			assert.notInclude(failed?.failure?.message ?? '', 'must-not-escape');
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('contains sandbox failure to the offending package role', () => {
		const harness = makeHarness({ sandboxFailure: 'deadline' });
		return Effect.gen(function* () {
			yield* stage;
			const catalog = yield* ExtensionCatalog;
			yield* catalog.enable(
				{
					capsuleId: 'dev.akua.weather',
					extensionId: 'app-weather',
					role: 'app',
					binding: 'candidate'
				},
				['interface:read']
			);
			const host = yield* PortableExtensionHost;
			const timeout = yield* host
				.call(
					{
						role: 'app',
						binding: 'candidate',
						operationId: 'operation-extension-test'
					},
					'app-weather',
					{}
				)
				.pipe(Effect.flip);

			assert.strictEqual(timeout._tag, 'SandboxExecutionFailed');
			const snapshot = yield* catalog.snapshot;
			assert.strictEqual(
				snapshot.entries.find((entry) => entry.extensionId === 'app-weather')?.state,
				'failed'
			);
			assert.strictEqual(
				snapshot.entries.find((entry) => entry.extensionId === 'shape-weather')?.state,
				'available'
			);
		}).pipe(Effect.provide(harness.layer));
	});
});
