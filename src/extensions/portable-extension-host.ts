import { Context, Effect, Layer, Schema } from 'effect';
import { decodeCapsule } from '../../packages/product/src/capsule';
import {
	ExtensionManifest,
	PortableExtensionDescriptor,
	type PortableExtensionPackage,
	type PortableExtensionRole
} from '../../packages/product/src/extensions';
import type { SandboxExecutionFailed, SandboxResult } from '../../shared/sandbox';
import { ExtensionIntentContext } from '../../shared/sandbox';
import { CapsuleStore } from '../capsule/capsule-store';
import {
	type CapabilityAdapterError,
	type CapabilityDenied,
	isExtensionIntentPackageFailure,
	SandboxCapabilityBroker
} from '../sandbox/capability-broker';
import { ExtensionSandbox } from '../sandbox/extension-sandbox';
import {
	ExtensionCatalog,
	type ExtensionCatalogFailure,
	type PortableExtensionKey
} from './extension-catalog';

export interface ResolvedPortableExtension {
	readonly capsuleId: string;
	readonly binding: 'accepted' | 'candidate';
	readonly manifest: PortableExtensionPackage;
	readonly source: string;
}

export class PortableExtensionSourceFailure extends Schema.TaggedErrorClass<PortableExtensionSourceFailure>()(
	'PortableExtensionSourceFailure',
	{
		message: Schema.Literal('Portable extension source is unavailable.')
	}
) {}

export class PortableExtensionPersistenceDegraded extends Schema.TaggedErrorClass<PortableExtensionPersistenceDegraded>()(
	'PortableExtensionPersistenceDegraded',
	{
		extensionId: Schema.String,
		operationId: Schema.String,
		message: Schema.Literal('Portable extension state needs recovery.')
	}
) {}

const sourceFailure = () =>
	PortableExtensionSourceFailure.make({
		message: 'Portable extension source is unavailable.'
	});

export interface PortableExtensionSourceShape {
	readonly list: (
		binding: 'accepted' | 'candidate'
	) => Effect.Effect<ReadonlyArray<ResolvedPortableExtension>, PortableExtensionSourceFailure>;
}

export class PortableExtensionSource extends Context.Service<
	PortableExtensionSource,
	PortableExtensionSourceShape
>()('flect/PortableExtensionSource') {}

export const PortableExtensionSourceLive = Layer.effect(
	PortableExtensionSource,
	Effect.gen(function* () {
		const store = yield* CapsuleStore;
		return {
			list: Effect.fn('Flect.PortableExtensionSource.list')((binding) =>
				Effect.gen(function* () {
					const archives = yield* store.load;
					const archive = binding === 'accepted' ? archives.accepted : archives.candidate;
					if (archive === undefined) return [];
					const capsule = yield* decodeCapsule(archive);
					const decoder = new TextDecoder('utf-8', { fatal: true });
					return yield* Effect.forEach(capsule.manifest.extensions ?? [], (manifest) =>
						Effect.try({
							try: () => {
								const bundle = capsule.files.find((file) => file.path === manifest.bundle);
								if (bundle === undefined) throw sourceFailure();
								return {
									capsuleId: capsule.manifest.id,
									binding,
									manifest,
									source: decoder.decode(bundle.contents)
								} satisfies ResolvedPortableExtension;
							},
							catch: sourceFailure
						})
					);
				}).pipe(Effect.mapError(sourceFailure))
			)
		};
	})
);

export class PortableExtensionUnavailable extends Schema.TaggedErrorClass<PortableExtensionUnavailable>()(
	'PortableExtensionUnavailable',
	{
		extensionId: Schema.String,
		reason: Schema.Literals([
			'missing',
			'disabled',
			'wrong-role',
			'wrong-binding',
			'incompatible',
			'conflict',
			'failed'
		]),
		message: Schema.Literal('The portable extension is unavailable.')
	}
) {}

const unavailable = (extensionId: string, reason: PortableExtensionUnavailable['reason']) =>
	PortableExtensionUnavailable.make({
		extensionId,
		reason,
		message: 'The portable extension is unavailable.'
	});

export interface PortableExtensionCallSource {
	readonly role: PortableExtensionRole;
	readonly binding: 'accepted' | 'candidate';
	readonly operationId: string;
}

export interface PortableExtensionHostShape {
	readonly list: (
		role: PortableExtensionRole,
		binding: 'accepted' | 'candidate'
	) => Effect.Effect<ReadonlyArray<PortableExtensionDescriptor>, PortableExtensionSourceFailure>;
	readonly describe: (
		role: PortableExtensionRole,
		binding: 'accepted' | 'candidate',
		extensionId: string
	) => Effect.Effect<
		PortableExtensionDescriptor,
		PortableExtensionSourceFailure | PortableExtensionUnavailable
	>;
	readonly call: (
		source: PortableExtensionCallSource,
		extensionId: string,
		input: unknown
	) => Effect.Effect<
		SandboxResult,
		| CapabilityAdapterError
		| CapabilityDenied
		| ExtensionCatalogFailure
		| PortableExtensionSourceFailure
		| PortableExtensionUnavailable
		| PortableExtensionPersistenceDegraded
		| SandboxExecutionFailed
	>;
}

export class PortableExtensionHost extends Context.Service<
	PortableExtensionHost,
	PortableExtensionHostShape
>()('flect/PortableExtensionHost') {}

const keyFor = (
	resolved: ResolvedPortableExtension,
	role: PortableExtensionRole
): PortableExtensionKey => ({
	capsuleId: resolved.capsuleId,
	extensionId: resolved.manifest.id,
	role,
	binding: resolved.binding
});

export const PortableExtensionHostLive = Layer.effect(
	PortableExtensionHost,
	Effect.gen(function* () {
		const catalog = yield* ExtensionCatalog;
		const source = yield* PortableExtensionSource;
		const sandbox = yield* ExtensionSandbox;
		const broker = yield* SandboxCapabilityBroker;

		const descriptor = Effect.fn('Flect.PortableExtensionHost.descriptor')(function* (
			role: PortableExtensionRole,
			binding: 'accepted' | 'candidate',
			extensionId: string
		) {
			const resolved = (yield* source.list(binding)).find(
				(entry) => entry.manifest.id === extensionId
			);
			if (resolved === undefined) {
				const otherBinding = binding === 'accepted' ? 'candidate' : 'accepted';
				const existsElsewhere = (yield* source.list(otherBinding)).some(
					(entry) => entry.manifest.id === extensionId
				);
				return yield* Effect.fail(
					unavailable(extensionId, existsElsewhere ? 'wrong-binding' : 'missing')
				);
			}
			if (!resolved.manifest.roles.includes(role))
				return yield* Effect.fail(unavailable(extensionId, 'wrong-role'));
			const entry = (yield* catalog.snapshot).entries.find(
				(candidate) =>
					candidate.capsuleId === resolved.capsuleId &&
					candidate.extensionId === extensionId &&
					candidate.role === role &&
					candidate.binding === binding
			);
			if (entry === undefined) return yield* Effect.fail(unavailable(extensionId, 'disabled'));
			if (entry.state !== 'enabled')
				return yield* Effect.fail(
					unavailable(
						extensionId,
						entry.state === 'incompatible'
							? 'incompatible'
							: entry.state === 'conflict'
								? 'conflict'
								: entry.state === 'failed'
									? 'failed'
									: 'disabled'
					)
				);
			return {
				resolved,
				entry,
				descriptor: PortableExtensionDescriptor.make({
					version: 1,
					capsuleId: resolved.capsuleId,
					id: resolved.manifest.id,
					name: resolved.manifest.name,
					description: resolved.manifest.description,
					packageVersion: resolved.manifest.version,
					role,
					binding,
					state: 'enabled',
					publicInstructions: resolved.manifest.publicInstructions,
					commands: resolved.manifest.commands,
					tools: resolved.manifest.tools,
					requestedCapabilities: entry.requestedCapabilities,
					grantedCapabilities: entry.grantedCapabilities,
					publisher: resolved.manifest.provenance.publisher,
					provenanceSource: resolved.manifest.provenance.source,
					provenanceRevision: resolved.manifest.provenance.revision,
					bundleSha256: resolved.manifest.provenance.bundleSha256,
					resources: resolved.manifest.resources
				})
			};
		});

		const list = Effect.fn('Flect.PortableExtensionHost.list')(function* (
			role: PortableExtensionRole,
			binding: 'accepted' | 'candidate'
		) {
			const resolved = yield* source.list(binding);
			const entries = (yield* catalog.snapshot).entries;
			return resolved
				.filter((candidate) => candidate.manifest.roles.includes(role))
				.flatMap((candidate) => {
					const entry = entries.find(
						(state) =>
							state.capsuleId === candidate.capsuleId &&
							state.extensionId === candidate.manifest.id &&
							state.role === role &&
							state.binding === binding &&
							state.state === 'enabled'
					);
					return entry === undefined
						? []
						: [
								PortableExtensionDescriptor.make({
									version: 1,
									capsuleId: candidate.capsuleId,
									id: candidate.manifest.id,
									name: candidate.manifest.name,
									description: candidate.manifest.description,
									packageVersion: candidate.manifest.version,
									role,
									binding,
									state: 'enabled',
									publicInstructions: candidate.manifest.publicInstructions,
									commands: candidate.manifest.commands,
									tools: candidate.manifest.tools,
									requestedCapabilities: entry.requestedCapabilities,
									grantedCapabilities: entry.grantedCapabilities,
									publisher: candidate.manifest.provenance.publisher,
									provenanceSource: candidate.manifest.provenance.source,
									provenanceRevision: candidate.manifest.provenance.revision,
									bundleSha256: candidate.manifest.provenance.bundleSha256,
									resources: candidate.manifest.resources
								})
							];
				})
				.sort((left, right) => left.id.localeCompare(right.id));
		});

		const describe = Effect.fn('Flect.PortableExtensionHost.describe')(function* (
			role: PortableExtensionRole,
			binding: 'accepted' | 'candidate',
			extensionId: string
		) {
			return (yield* descriptor(role, binding, extensionId)).descriptor;
		});

		const call = Effect.fn('Flect.PortableExtensionHost.call')(function* (
			callSource: PortableExtensionCallSource,
			extensionId: string,
			input: unknown
		) {
			let selectedKey: PortableExtensionKey | undefined;
			return yield* Effect.gen(function* () {
				const selected = yield* descriptor(callSource.role, callSource.binding, extensionId);
				const runtimeManifest = ExtensionManifest.make({
					version: 1,
					id: selected.resolved.manifest.id,
					name: selected.resolved.manifest.name,
					source: selected.resolved.source,
					capabilities: selected.resolved.manifest.capabilities.map((capability) => capability.id)
				});
				const key = keyFor(selected.resolved, callSource.role);
				selectedKey = key;
				const result = yield* sandbox.execute({
					extensionId,
					source: selected.resolved.source,
					input: {
						version: 1,
						role: callSource.role,
						binding: callSource.binding,
						value: input
					}
				});
				const beforeCatalog = yield* catalog.snapshot;
				yield* catalog.recordSuccess(key);
				yield* broker
					.apply(
						ExtensionIntentContext.make({
							extensionId,
							role: callSource.role,
							binding: callSource.binding,
							operationId: callSource.operationId
						}),
						runtimeManifest,
						result,
						selected.entry.grantedCapabilities
					)
					.pipe(
						Effect.catch((error) =>
							catalog.restore(beforeCatalog).pipe(
								Effect.mapError(() =>
									PortableExtensionPersistenceDegraded.make({
										extensionId,
										operationId: callSource.operationId,
										message: 'Portable extension state needs recovery.'
									})
								),
								Effect.andThen(Effect.fail(error))
							)
						)
					);
				return result;
			}).pipe(
				Effect.tapError((error) =>
					selectedKey === undefined
						? Effect.void
						: error._tag === 'CapabilityDenied'
							? catalog.recordFailure(selectedKey, 'capability-denied').pipe(Effect.ignore)
							: error._tag === 'SandboxExecutionFailed'
								? catalog.recordFailure(selectedKey, error.reason).pipe(Effect.ignore)
								: error._tag === 'CapabilityAdapterFailure' ||
									  (error._tag === 'ExtensionIntentRejected' &&
											isExtensionIntentPackageFailure(error))
									? catalog.recordFailure(selectedKey, 'execution').pipe(Effect.ignore)
									: Effect.void
				)
			);
		});

		return { list, describe, call };
	})
);
