import { Context, Effect, Layer, Schema } from 'effect';
import { ExtensionCapability, type ExtensionManifest } from '../../packages/product/src/extensions';
import type { InvalidInterfaceDocument } from '../../shared/interface-document';
import type { InvalidRevisionTransition } from '../../shared/revisions';
import type { CapabilityIntent, ExtensionIntentContext, SandboxResult } from '../../shared/sandbox';
import type { InterfaceStorageError } from '../lib/interface-store';
import type { ExtensionIntentRejected } from '../lib/shaping-kernel';

export class CapabilityDenied extends Schema.TaggedErrorClass<CapabilityDenied>()(
	'CapabilityDenied',
	{
		extensionId: Schema.String,
		capability: ExtensionCapability,
		reason: Schema.Literals(['undeclared', 'not-granted']),
		message: Schema.Literal('The extension capability was denied.')
	}
) {}

export class CapabilityAdapterFailure extends Schema.TaggedErrorClass<CapabilityAdapterFailure>()(
	'CapabilityAdapterFailure',
	{
		reason: Schema.Literal('unsupported'),
		message: Schema.Literal('The extension interface intent is unsupported.')
	}
) {}

export type CapabilityAdapterError =
	| CapabilityAdapterFailure
	| ExtensionIntentRejected
	| InvalidInterfaceDocument
	| InvalidRevisionTransition
	| InterfaceStorageError;

export const isExtensionIntentPackageFailure = (error: CapabilityAdapterError) =>
	error._tag === 'CapabilityAdapterFailure' ||
	(error._tag === 'ExtensionIntentRejected' &&
		(error.reason === 'empty' || error.reason === 'target-not-found'));

export interface CapabilityAdapterShape {
	readonly apply: (
		context: ExtensionIntentContext,
		intents: ReadonlyArray<CapabilityIntent>
	) => Effect.Effect<void, CapabilityAdapterError>;
}

export class CapabilityAdapter extends Context.Service<CapabilityAdapter, CapabilityAdapterShape>()(
	'flect/CapabilityAdapter'
) {}

export interface SandboxCapabilityBrokerShape {
	readonly apply: (
		context: ExtensionIntentContext,
		manifest: ExtensionManifest,
		result: SandboxResult,
		grants: ReadonlyArray<ExtensionCapability>
	) => Effect.Effect<void, CapabilityDenied | CapabilityAdapterError>;
}

export class SandboxCapabilityBroker extends Context.Service<
	SandboxCapabilityBroker,
	SandboxCapabilityBrokerShape
>()('flect/SandboxCapabilityBroker') {}

const capabilityForIntent = (intent: CapabilityIntent): ExtensionCapability => {
	switch (intent.type) {
		case 'set-text':
			return 'interface:propose';
	}
};

const denied = (
	manifest: ExtensionManifest,
	capability: ExtensionCapability,
	reason: CapabilityDenied['reason']
) =>
	CapabilityDenied.make({
		extensionId: manifest.id,
		capability,
		reason,
		message: 'The extension capability was denied.'
	});

export const SandboxCapabilityBrokerLive = Layer.effect(
	SandboxCapabilityBroker,
	Effect.gen(function* () {
		const adapter = yield* CapabilityAdapter;

		return {
			apply: Effect.fn('SandboxCapabilityBroker.apply')(function* (
				context: ExtensionIntentContext,
				manifest: ExtensionManifest,
				result: SandboxResult,
				grants: ReadonlyArray<ExtensionCapability>
			) {
				if (context.extensionId !== manifest.id) {
					return yield* Effect.fail(
						CapabilityAdapterFailure.make({
							reason: 'unsupported',
							message: 'The extension interface intent is unsupported.'
						})
					);
				}
				const intents = result.intents.map((intent) => ({
					intent,
					capability: capabilityForIntent(intent)
				}));

				for (const { capability } of intents) {
					if (!manifest.capabilities.includes(capability)) {
						return yield* Effect.fail(denied(manifest, capability, 'undeclared'));
					}
					if (!grants.includes(capability)) {
						return yield* Effect.fail(denied(manifest, capability, 'not-granted'));
					}
				}

				if (intents.length === 0) {
					return;
				}

				yield* adapter.apply(
					context,
					intents.map(({ intent }) => intent)
				);
			})
		};
	})
);
