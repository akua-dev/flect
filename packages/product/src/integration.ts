import { Cause, Effect, Schema, type SchemaAST, type Stream } from 'effect';
import {
	type AuthorizedProductOperation,
	ProductCapabilityManifest,
	type ProductJson,
	type ProductOperationFailure
} from './product-capability.js';
import type { ProductEvent, ProductEventRequest } from './product-events.js';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const encoder = new TextEncoder();
const SemanticVersion = Schema.String.check(
	Schema.isMinLength(5),
	Schema.isMaxLength(40),
	Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
);
const FlectRange = Schema.String.check(
	Schema.isMinLength(13),
	Schema.isMaxLength(80),
	Schema.isPattern(/^>=\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? <\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
);
const ProductId = Schema.String.check(
	Schema.isMinLength(3),
	Schema.isMaxLength(120),
	Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
);
const BoundedText = (minimum: number, maximum: number) =>
	Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));
const Revision = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(128),
	Schema.isPattern(/^[A-Za-z0-9._:/-]+$/)
);
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const ExtensionId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z][a-z0-9-]*$/)
);

export const ProductInferenceOwner = Schema.Literals(['user', 'product']);
export type ProductInferenceOwner = typeof ProductInferenceOwner.Type;
export const ProductConnectionKind = Schema.Literals(['offline', 'browser-direct', 'brokered']);
export type ProductConnectionKind = typeof ProductConnectionKind.Type;
export const ProductAuthenticationOwner = Schema.Literals(['none', 'product', 'host']);
export type ProductAuthenticationOwner = typeof ProductAuthenticationOwner.Type;
export const ProductPlatform = Schema.Literals(['browser', 'macos', 'windows', 'linux']);
export type ProductPlatform = typeof ProductPlatform.Type;

export class ProductInferencePolicy extends Schema.Class<ProductInferencePolicy>(
	'ProductInferencePolicy'
)(
	Schema.Struct({
		allowedOwners: Schema.Array(ProductInferenceOwner).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(2),
			Schema.isUnique()
		),
		defaultOwner: ProductInferenceOwner
	}).check(
		Schema.makeFilter((policy) => policy.allowedOwners.includes(policy.defaultOwner), {
			expected: 'default inference owner included in allowed owners'
		})
	)
) {}

export class ProductCompatibility extends Schema.Class<ProductCompatibility>(
	'ProductCompatibility'
)({
	flect: FlectRange,
	platforms: Schema.Array(ProductPlatform).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(4),
		Schema.isUnique()
	)
}) {}

export class ProductDescriptor extends Schema.Class<ProductDescriptor>('ProductDescriptor')(
	Schema.Struct({
		version: Schema.Literal(1),
		id: ProductId,
		name: BoundedText(1, 80),
		description: BoundedText(1, 500),
		integrationVersion: SemanticVersion,
		revision: Revision,
		productApiVersion: Schema.Literal(1),
		connection: ProductConnectionKind,
		authenticationOwner: ProductAuthenticationOwner,
		compatibility: ProductCompatibility,
		inference: ProductInferencePolicy
	}).check(
		Schema.makeFilter(
			(descriptor) =>
				descriptor.connection === 'offline'
					? descriptor.authenticationOwner === 'none'
					: descriptor.authenticationOwner !== 'none',
			{
				expected: 'offline authentication owner none or connected authentication owner product/host'
			}
		)
	)
) {}

export class ProductExperienceDescriptor extends Schema.Class<ProductExperienceDescriptor>(
	'ProductExperienceDescriptor'
)({
	version: Schema.Literal(1),
	capsuleId: ProductId,
	capsuleVersion: SemanticVersion,
	archiveSha256: Sha256,
	provenanceRevision: Revision,
	appExtensionIds: Schema.Array(ExtensionId).check(Schema.isMaxLength(32), Schema.isUnique()),
	shaperExtensionIds: Schema.Array(ExtensionId).check(Schema.isMaxLength(32), Schema.isUnique())
}) {}

export class ProductMigration extends Schema.Class<ProductMigration>('ProductMigration')({
	version: Schema.Literal(1),
	from: SemanticVersion,
	to: SemanticVersion,
	disposition: Schema.Literals(['compatible', 'review', 'blocked'])
}) {}

export class ProductIntegrationMetadata extends Schema.Class<ProductIntegrationMetadata>(
	'ProductIntegrationMetadata'
)(
	Schema.Struct({
		version: Schema.Literal(1),
		descriptor: ProductDescriptor,
		experience: ProductExperienceDescriptor,
		capabilities: Schema.Array(Schema.suspend(() => ProductCapabilityManifest)).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(128)
		),
		migrations: Schema.Array(ProductMigration).check(Schema.isMaxLength(64))
	}).check(
		Schema.makeFilter(
			(metadata) =>
				metadata.experience.capsuleId === metadata.descriptor.id &&
				new Set(metadata.capabilities.map((capability) => capability.id)).size ===
					metadata.capabilities.length &&
				new Set(metadata.migrations.map((migration) => `${migration.from}->${migration.to}`))
					.size === metadata.migrations.length,
			{
				expected: 'matching capsule/product IDs and unique capabilities/migrations'
			}
		)
	)
) {}

export interface ProductOperationDefinition {
	readonly id: string;
	readonly capabilityId: string;
	readonly authorize: (
		input: ProductJson
	) => Effect.Effect<AuthorizedProductOperation, ProductOperationFailure>;
	readonly execute: (input: ProductJson) => Effect.Effect<ProductJson, ProductOperationFailure>;
}

export interface ProductEventDefinition {
	readonly id: string;
	readonly capabilityId: string;
	readonly policyId: string;
	readonly authorize: (
		input: ProductJson
	) => Effect.Effect<AuthorizedProductOperation, ProductOperationFailure>;
	readonly request: (
		input: ProductJson
	) => Effect.Effect<ProductEventRequest, ProductOperationFailure>;
}

/**
 * `defineProductIntegration` rejected the input: invalid metadata, an
 * operation/event whose ID is not declared by exactly one capability, an
 * unsupported migration shape, an unselectable inference owner, or a
 * recommended-experience archive that failed to load or does not hash to
 * the declared `archiveSha256`. `message` is safe to show to a user;
 * `recovery` is a stable suggested next step.
 */
export class ProductIntegrationFailure extends Schema.TaggedErrorClass<ProductIntegrationFailure>()(
	'ProductIntegrationFailure',
	{
		reason: Schema.Literals(['invalid-metadata', 'invalid-operations', 'invalid-experience']),
		message: Schema.Literal('The product integration is invalid.'),
		recovery: Schema.Literal('Review the product integration and keep the current experience.')
	}
) {}

const failure = (reason: ProductIntegrationFailure['reason']): ProductIntegrationFailure =>
	ProductIntegrationFailure.make({
		reason,
		message: 'The product integration is invalid.',
		recovery: 'Review the product integration and keep the current experience.'
	});

/**
 * Input to {@link defineProductIntegration}. `metadata` is decoded strictly
 * against `ProductIntegrationMetadata` (unknown fields fail), so build it as
 * a plain object rather than an already-validated class instance.
 * `loadRecommendedExperience` must resolve to the exact `.flect` archive
 * bytes whose SHA-256 matches `metadata.experience.archiveSha256` -
 * mismatches fail with `ProductIntegrationFailure` reason
 * `'invalid-experience'`.
 */
export interface ProductIntegrationInput {
	readonly metadata: unknown;
	readonly operations: ReadonlyArray<ProductOperationDefinition>;
	readonly events: ReadonlyArray<ProductEventDefinition>;
	readonly selectedInferenceOwner: ProductInferenceOwner;
	readonly loadRecommendedExperience: Effect.Effect<Uint8Array, ProductIntegrationFailure>;
}

/**
 * A validated product integration returned by {@link defineProductIntegration}.
 * Only that function can produce a value satisfying {@link isProductIntegration};
 * treat the shape as opaque and pass it to Flect's runtime bridge rather than
 * constructing or mutating one by hand.
 */
export interface ProductIntegration {
	readonly metadata: ProductIntegrationMetadata;
	readonly operations: ReadonlyArray<ProductOperationDefinition>;
	readonly events: ReadonlyArray<ProductEventDefinition>;
	readonly selectedInferenceOwner: ProductInferenceOwner;
	readonly capabilityDigest: string;
	readonly extensionDigest: string;
	readonly loadRecommendedExperience: Effect.Effect<Uint8Array>;
}

class ValidatedProductIntegration implements ProductIntegration {
	constructor(
		readonly metadata: ProductIntegrationMetadata,
		readonly operations: ReadonlyArray<ProductOperationDefinition>,
		readonly events: ReadonlyArray<ProductEventDefinition>,
		readonly selectedInferenceOwner: ProductInferenceOwner,
		readonly capabilityDigest: string,
		readonly extensionDigest: string,
		readonly loadRecommendedExperience: Effect.Effect<Uint8Array>
	) {}
}

const validatedIntegrations = new WeakSet<ProductIntegration>();

/**
 * True only for a {@link ProductIntegration} produced by
 * {@link defineProductIntegration}. Flect's runtime bridge uses this to
 * refuse a hand-built object that merely satisfies the interface's shape.
 */
export const isProductIntegration = (value: ProductIntegration): value is ProductIntegration =>
	validatedIntegrations.has(value);

const digestBytes = Effect.fn('Flect.ProductIntegration.digestBytes')(
	(contents: Uint8Array, reason: ProductIntegrationFailure['reason']) =>
		Effect.tryPromise({
			try: async () => {
				const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(contents));
				return Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, '0')
				).join('');
			},
			catch: () => failure(reason)
		})
);

const digestJson = Effect.fn('Flect.ProductIntegration.digestJson')((value: ProductJson) =>
	digestBytes(encoder.encode(JSON.stringify(value)), 'invalid-metadata')
);

const sanitizeArchive = (effect: Effect.Effect<Uint8Array, ProductIntegrationFailure>) =>
	effect.pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterrupts(cause)
				? Effect.failCause(cause)
				: Effect.fail(failure('invalid-experience'))
		)
	);

/**
 * Validate one product's metadata, capability manifests, named
 * operation/event closures, selected inference owner, and recommended
 * `.flect` experience, returning a branded {@link ProductIntegration}. This
 * is the SDK's primary entry point: every operation ID must belong to
 * exactly one declared capability, every capability's operations must be
 * defined, migrations must target the current `integrationVersion`, and the
 * loaded experience archive must hash to the declared digest. Fails with
 * {@link ProductIntegrationFailure} on the first violation; never partially
 * validates.
 */
export const defineProductIntegration = Effect.fn('Flect.ProductIntegration.define')(function* (
	input: ProductIntegrationInput
) {
	const metadata = yield* Schema.decodeUnknownEffect(
		ProductIntegrationMetadata,
		strict
	)(input.metadata).pipe(Effect.mapError(() => failure('invalid-metadata')));
	const definitions = [...input.operations, ...input.events];
	const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
	const capabilitiesById = new Map(
		metadata.capabilities.map((capability) => [capability.id, capability])
	);
	const validDefinitions =
		definitions.length > 0 &&
		definitionsById.size === definitions.length &&
		definitions.every((definition) => {
			const capability = capabilitiesById.get(definition.capabilityId);
			return capability?.operationIds.includes(definition.id) === true;
		}) &&
		metadata.capabilities.every((capability) =>
			capability.operationIds.every((operationId) => definitionsById.has(operationId))
		) &&
		new Set(input.events.map((event) => event.policyId)).size === input.events.length;
	const validMigrations =
		metadata.migrations.every(
			(migration) =>
				migration.from !== migration.to && migration.to === metadata.descriptor.integrationVersion
		) &&
		new Set(metadata.migrations.map((migration) => migration.from)).size ===
			metadata.migrations.length;
	if (
		!validDefinitions ||
		!validMigrations ||
		!metadata.descriptor.inference.allowedOwners.includes(input.selectedInferenceOwner)
	) {
		return yield* Effect.fail(failure('invalid-operations'));
	}

	const archive = yield* sanitizeArchive(input.loadRecommendedExperience);
	const archiveDigest = yield* digestBytes(archive, 'invalid-experience');
	if (archiveDigest !== metadata.experience.archiveSha256) {
		return yield* Effect.fail(failure('invalid-experience'));
	}
	const capabilityDigest = yield* digestJson(
		metadata.capabilities
			.map((capability) => ({
				id: capability.id,
				operations: [...capability.operationIds].sort(),
				resources: [...capability.resourceIds].sort(),
				dataClasses: [...capability.dataClassIds].sort()
			}))
			.sort((left, right) => left.id.localeCompare(right.id))
	);
	const extensionDigest = yield* digestJson({
		app: [...metadata.experience.appExtensionIds].sort(),
		shaper: [...metadata.experience.shaperExtensionIds].sort()
	});
	const integration = new ValidatedProductIntegration(
		metadata,
		[...input.operations],
		[...input.events],
		input.selectedInferenceOwner,
		capabilityDigest,
		extensionDigest,
		Effect.sync(() => Uint8Array.from(archive))
	);
	validatedIntegrations.add(integration);
	return integration;
});

export type ProductEventStream = Stream.Stream<ProductEvent, ProductOperationFailure>;
