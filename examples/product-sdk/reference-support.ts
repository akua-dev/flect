import {
	AuthorizedProductOperation,
	encodeCapsule,
	hashCapsuleArchive,
	makeProductOperationFailure,
	type ProductCapabilityManifest,
	type ProductJson,
	type ProductOperationFailure
} from '@flect/product';
import { Effect, Schema, type SchemaAST } from 'effect';

const encoder = new TextEncoder();
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const sha256 = (contents: Uint8Array) =>
	Effect.promise(async () => {
		const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(contents));
		return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
			''
		);
	});

export interface ReferenceExperienceInput {
	readonly id: string;
	readonly name: string;
	readonly revision: string;
	readonly capabilities: ReadonlyArray<ProductCapabilityManifest>;
	readonly publicInstructions: string;
	readonly body: string;
}

export const makeReferenceExperience = Effect.fn('Flect.Examples.makeReferenceExperience')(
	function* (input: ReferenceExperienceInput) {
		const extensionId = `${input.id.split('.').at(-1)}-guide`;
		const bundle = `extensions/${extensionId}.mjs`;
		const source = encoder.encode('() => []');
		const bundleSha256 = yield* sha256(source);
		const archive = yield* encodeCapsule({
			manifest: {
				formatVersion: 1,
				id: input.id,
				name: input.name,
				version: '1.0.0',
				entrypoints: [{ id: 'main', path: 'ui/index.html' }],
				capabilities: input.capabilities.map((capability) => ({
					id: capability.id,
					required: true
				})),
				extensions: [
					{
						formatVersion: 1,
						id: extensionId,
						name: `${input.name} guide`,
						description: 'Public App Agent and optional Shaper guidance.',
						version: '1.0.0',
						bundle,
						roles: ['app', 'shaper'],
						compatibility: {
							flect: '>=0.2.0 <1.0.0',
							extensionApi: 1,
							platforms: ['browser', 'macos']
						},
						capabilities: [
							{ id: 'interface:read', required: true },
							{ id: 'interface:propose', required: false }
						],
						publicInstructions: input.publicInstructions,
						commands: [],
						tools: [],
						resources: {
							deadlineMs: 100,
							memoryBytes: 16 * 1024 * 1024,
							inputBytes: 64 * 1024,
							outputBytes: 64 * 1024,
							maxIntents: 8
						},
						provenance: {
							publisher: 'akua-dev',
							source: 'https://github.com/akua-dev/flect',
							revision: input.revision,
							bundleSha256
						}
					}
				],
				compatibility: {
					flect: '>=0.2.0 <1.0.0',
					schemaVersion: 1,
					platforms: ['browser', 'macos']
				},
				provenance: {
					publisher: 'akua-dev',
					source: 'https://github.com/akua-dev/flect',
					revision: input.revision,
					builder: 'flect-product-sdk-reference'
				},
				signatures: []
			},
			files: [
				{
					path: 'ui/index.html',
					contents: encoder.encode(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${input.name}</title></head>
<body><main data-product="${input.id}"><h1>${input.name}</h1>${input.body}</main></body></html>`)
				},
				{ path: bundle, contents: source }
			]
		});
		return {
			archive,
			archiveSha256: yield* hashCapsuleArchive(archive),
			appExtensionIds: [extensionId],
			shaperExtensionIds: [extensionId]
		};
	}
);

export const decodeOperationInput = <A>(
	operationId: string,
	schema: Schema.ConstraintDecoder<A, never>,
	input: ProductJson
): Effect.Effect<A, ProductOperationFailure> =>
	Schema.decodeUnknownEffect(
		schema,
		strict
	)(input).pipe(Effect.mapError(() => makeProductOperationFailure(operationId, 'invalid-input')));

export const authorizeOperation = (
	operationId: string,
	capabilityId: string,
	resourceIds: ReadonlyArray<string>,
	dataClassIds: ReadonlyArray<string>,
	allowed: Effect.Effect<boolean>
) =>
	allowed.pipe(
		Effect.flatMap((accepted) =>
			accepted
				? Effect.succeed(
						AuthorizedProductOperation.make({
							version: 1,
							capabilityId,
							operationId,
							resourceIds: [...resourceIds],
							dataClassIds: [...dataClassIds]
						})
					)
				: Effect.fail(makeProductOperationFailure(operationId, 'product-denied'))
		)
	);
