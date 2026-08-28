import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import { ExtensionManifest } from '../../packages/product/src/extensions';
import { ExtensionIntentContext, SandboxResult, SetTextIntent } from '../../shared/sandbox';
import {
	CapabilityAdapter,
	SandboxCapabilityBroker,
	SandboxCapabilityBrokerLive
} from './capability-broker';

const manifest = (capabilities: ExtensionManifest['capabilities']) =>
	ExtensionManifest.make({
		version: 1,
		id: 'weather-card',
		name: 'Weather card',
		source: "() => ({ type: 'set-text', target: 'weather', text: 'Berlin' })",
		capabilities
	});

const result = SandboxResult.make({
	version: 1,
	intents: [
		SetTextIntent.make({
			type: 'set-text',
			target: 'weather',
			text: 'Berlin'
		})
	]
});

const makeHarness = () => {
	const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
	const adapter = Layer.succeed(CapabilityAdapter)({
		apply: (_context, intents) =>
			Ref.update(calls, (current) => [
				...current,
				...intents.flatMap((intent) => (intent.type === 'set-text' ? [intent.target] : []))
			])
	});

	return {
		calls,
		layer: SandboxCapabilityBrokerLive.pipe(Layer.provide(adapter))
	};
};

describe('SandboxCapabilityBroker', () => {
	const allowed = makeHarness();

	it.layer(allowed.layer)((it) => {
		it.effect('applies only declared and granted capability intents', () =>
			Effect.gen(function* () {
				const broker = yield* SandboxCapabilityBroker;
				yield* broker.apply(
					ExtensionIntentContext.make({
						extensionId: 'weather-card',
						role: 'app',
						binding: 'accepted',
						operationId: 'operation-test'
					}),
					manifest(['interface:propose']),
					result,
					['interface:propose']
				);

				assert.deepStrictEqual(yield* Ref.get(allowed.calls), ['weather']);
			})
		);
	});

	const empty = makeHarness();

	it.layer(empty.layer)((it) => {
		it.effect('accepts a no-op result without creating an interface revision', () =>
			Effect.gen(function* () {
				const broker = yield* SandboxCapabilityBroker;
				yield* broker.apply(
					ExtensionIntentContext.make({
						extensionId: 'weather-card',
						role: 'app',
						binding: 'accepted',
						operationId: 'operation-test'
					}),
					manifest(['interface:read']),
					SandboxResult.make({ version: 1, intents: [] }),
					['interface:read']
				);

				assert.deepStrictEqual(yield* Ref.get(empty.calls), []);
			})
		);
	});

	const undeclared = makeHarness();

	it.layer(undeclared.layer)((it) => {
		it.effect('denies undeclared intents without invoking an adapter', () =>
			Effect.gen(function* () {
				const broker = yield* SandboxCapabilityBroker;
				const error = yield* broker
					.apply(
						ExtensionIntentContext.make({
							extensionId: 'weather-card',
							role: 'app',
							binding: 'accepted',
							operationId: 'operation-test'
						}),
						manifest(['interface:read']),
						result,
						['interface:propose']
					)
					.pipe(Effect.flip);

				if (error._tag === 'CapabilityDenied') {
					assert.strictEqual(error.reason, 'undeclared');
				} else {
					assert.fail(`Expected CapabilityDenied, received ${error._tag}`);
				}
				assert.deepStrictEqual(yield* Ref.get(undeclared.calls), []);
			})
		);
	});

	const ungranted = makeHarness();

	it.layer(ungranted.layer)((it) => {
		it.effect('denies ungranted intents without invoking an adapter', () =>
			Effect.gen(function* () {
				const broker = yield* SandboxCapabilityBroker;
				const error = yield* broker
					.apply(
						ExtensionIntentContext.make({
							extensionId: 'weather-card',
							role: 'app',
							binding: 'accepted',
							operationId: 'operation-test'
						}),
						manifest(['interface:propose']),
						result,
						[]
					)
					.pipe(Effect.flip);

				if (error._tag === 'CapabilityDenied') {
					assert.strictEqual(error.reason, 'not-granted');
				} else {
					assert.fail(`Expected CapabilityDenied, received ${error._tag}`);
				}
				assert.deepStrictEqual(yield* Ref.get(ungranted.calls), []);
			})
		);
	});
});
