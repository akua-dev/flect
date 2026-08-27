import { Effect, Schema, type SchemaAST } from 'effect';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export const MAX_PORTABLE_EXTENSION_SOURCE_BYTES = 256 * 1024;

const IdentifierText = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z][a-z0-9-]*$/)
);

export const ExtensionCapability = Schema.Literals(['interface:read', 'interface:propose']);
export type ExtensionCapability = typeof ExtensionCapability.Type;

export class ExtensionManifest extends Schema.Class<ExtensionManifest>('ExtensionManifest')({
	version: Schema.Literal(1),
	id: IdentifierText,
	name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256 * 1024)),
	capabilities: Schema.Array(ExtensionCapability).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(2)
	)
}) {}

export class InvalidExtensionManifest extends Schema.TaggedErrorClass<InvalidExtensionManifest>()(
	'InvalidExtensionManifest',
	{
		message: Schema.Literal('The extension manifest is invalid.')
	}
) {}

const invalidManifest = () =>
	InvalidExtensionManifest.make({
		message: 'The extension manifest is invalid.'
	});

export const validateExtensionManifest = Effect.fn('Flect.ExtensionManifest.validate')(
	(input: unknown) =>
		Schema.decodeUnknownEffect(
			ExtensionManifest,
			strictOptions
		)(input).pipe(Effect.mapError(invalidManifest))
);

const CapsulePath = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(100),
	Schema.isPattern(
		/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
	)
);
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const SemanticVersion = Schema.String.check(
	Schema.isMinLength(5),
	Schema.isMaxLength(40),
	Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
);
const BoundedText = (minimum: number, maximum: number) =>
	Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

export const PortableExtensionRole = Schema.Literals(['app', 'shaper']);
export type PortableExtensionRole = typeof PortableExtensionRole.Type;

export const PortableExtensionBinding = Schema.Literals(['accepted', 'candidate']);
export type PortableExtensionBinding = typeof PortableExtensionBinding.Type;

export class PortableExtensionCapabilityRequest extends Schema.Class<PortableExtensionCapabilityRequest>(
	'PortableExtensionCapabilityRequest'
)({
	id: ExtensionCapability,
	required: Schema.Boolean
}) {}

export class PortableExtensionContribution extends Schema.Class<PortableExtensionContribution>(
	'PortableExtensionContribution'
)({
	id: IdentifierText,
	name: BoundedText(1, 80),
	description: BoundedText(1, 240)
}) {}

export class PortableExtensionResources extends Schema.Class<PortableExtensionResources>(
	'PortableExtensionResources'
)({
	deadlineMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
	memoryBytes: Schema.Int.check(
		Schema.isBetween({ minimum: 1024 * 1024, maximum: 16 * 1024 * 1024 })
	),
	inputBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1024 * 1024 })),
	outputBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1024 * 1024 })),
	maxIntents: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))
}) {}

export class PortableExtensionPackage extends Schema.Class<PortableExtensionPackage>(
	'PortableExtensionPackage'
)({
	formatVersion: Schema.Literal(1),
	id: IdentifierText,
	name: BoundedText(1, 80),
	description: BoundedText(1, 500),
	version: SemanticVersion,
	bundle: CapsulePath,
	sourceMap: Schema.optionalKey(CapsulePath),
	roles: Schema.Array(PortableExtensionRole).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
	compatibility: Schema.Struct({
		flect: BoundedText(1, 80),
		extensionApi: Schema.Literal(1),
		platforms: Schema.Array(Schema.Literals(['browser', 'macos', 'windows', 'linux'])).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(4)
		)
	}),
	capabilities: Schema.Array(PortableExtensionCapabilityRequest).check(Schema.isMaxLength(16)),
	publicInstructions: Schema.String.check(Schema.isMaxLength(4_000)),
	commands: Schema.Array(PortableExtensionContribution).check(Schema.isMaxLength(32)),
	tools: Schema.Array(PortableExtensionContribution).check(Schema.isMaxLength(16)),
	resources: PortableExtensionResources,
	provenance: Schema.Struct({
		publisher: BoundedText(1, 120),
		source: BoundedText(1, 500),
		revision: BoundedText(1, 120),
		bundleSha256: Sha256,
		sourceMapSha256: Schema.optionalKey(Sha256)
	})
}) {}

export class PortableExtensionFailure extends Schema.Class<PortableExtensionFailure>(
	'PortableExtensionFailure'
)({
	version: Schema.Literal(1),
	reason: Schema.Literals([
		'invalid-input',
		'source-limit',
		'input-limit',
		'output-limit',
		'deadline',
		'memory',
		'execution',
		'invalid-result',
		'worker',
		'capability-denied',
		'incompatible',
		'startup'
	]),
	message: Schema.Literal('The portable extension failed safely.'),
	recovery: Schema.Literal('Disable the extension or ask Flect to fix it.')
}) {}

export class PortableExtensionRoleState extends Schema.Class<PortableExtensionRoleState>(
	'PortableExtensionRoleState'
)({
	version: Schema.Literal(1),
	capsuleId: Schema.String.check(
		Schema.isMinLength(3),
		Schema.isMaxLength(120),
		Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
	),
	extensionId: IdentifierText,
	packageVersion: SemanticVersion,
	bundleSha256: Sha256,
	provenanceRevision: BoundedText(1, 120),
	role: PortableExtensionRole,
	binding: PortableExtensionBinding,
	state: Schema.Literals([
		'available',
		'enabled',
		'disabled',
		'failed',
		'conflict',
		'incompatible'
	]),
	requestedCapabilities: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
	requiredCapabilities: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
	grantedCapabilities: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
	pinned: Schema.Boolean,
	forkRevision: Schema.optionalKey(BoundedText(1, 120)),
	tested: Schema.Boolean,
	failureCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
	failure: Schema.optionalKey(PortableExtensionFailure)
}) {}

export class PortableExtensionCatalogRecord extends Schema.Class<PortableExtensionCatalogRecord>(
	'PortableExtensionCatalogRecord'
)({
	version: Schema.Literal(1),
	entries: Schema.Array(PortableExtensionRoleState).check(Schema.isMaxLength(256))
}) {}

export class PortableExtensionCatalogSnapshot extends Schema.Class<PortableExtensionCatalogSnapshot>(
	'PortableExtensionCatalogSnapshot'
)({
	version: Schema.Literal(1),
	entries: Schema.Array(PortableExtensionRoleState).check(Schema.isMaxLength(256)),
	warning: Schema.optionalKey(
		Schema.Literals(['invalid-record', 'storage-unavailable', 'persistence-failed'])
	)
}) {}

export class PortableExtensionDescriptor extends Schema.Class<PortableExtensionDescriptor>(
	'PortableExtensionDescriptor'
)({
	version: Schema.Literal(1),
	capsuleId: Schema.String.check(
		Schema.isMinLength(3),
		Schema.isMaxLength(120),
		Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
	),
	id: IdentifierText,
	name: BoundedText(1, 80),
	description: BoundedText(1, 500),
	packageVersion: SemanticVersion,
	role: PortableExtensionRole,
	binding: PortableExtensionBinding,
	state: Schema.Literals(['enabled']),
	publicInstructions: Schema.String.check(Schema.isMaxLength(4_000)),
	commands: Schema.Array(PortableExtensionContribution).check(Schema.isMaxLength(32)),
	tools: Schema.Array(PortableExtensionContribution).check(Schema.isMaxLength(16)),
	requestedCapabilities: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
	grantedCapabilities: Schema.Array(ExtensionCapability).check(Schema.isMaxLength(16)),
	publisher: BoundedText(1, 120),
	provenanceSource: BoundedText(1, 500),
	provenanceRevision: BoundedText(1, 120),
	bundleSha256: Sha256,
	resources: PortableExtensionResources
}) {}

const hasDuplicates = (values: ReadonlyArray<string>) => new Set(values).size !== values.length;

export const validatePortableExtensionPackage = Effect.fn(
	'Flect.PortableExtensionPackage.validate'
)(function* (input: unknown) {
	const decoded = yield* Schema.decodeUnknownEffect(
		PortableExtensionPackage,
		strictOptions
	)(input).pipe(Effect.mapError(invalidManifest));
	if (
		hasDuplicates(decoded.roles) ||
		hasDuplicates(decoded.capabilities.map((capability) => capability.id)) ||
		hasDuplicates(decoded.commands.map((command) => command.id)) ||
		hasDuplicates(decoded.tools.map((tool) => tool.id)) ||
		(decoded.sourceMap === undefined) !== (decoded.provenance.sourceMapSha256 === undefined)
	) {
		return yield* Effect.fail(invalidManifest());
	}
	return decoded;
});

interface PortableExtensionGrantPackage {
	readonly roles: ReadonlyArray<string>;
	readonly capabilities: ReadonlyArray<{
		readonly id: ExtensionCapability;
	}>;
}

export const intersectPortableExtensionGrants = (
	extension: PortableExtensionGrantPackage,
	role: string,
	grants: ReadonlyArray<ExtensionCapability>
): ReadonlyArray<ExtensionCapability> => {
	if ((role !== 'app' && role !== 'shaper') || !extension.roles.includes(role)) return [];
	const requested = new Set(extension.capabilities.map((capability) => capability.id));
	return [...new Set(grants)].filter((grant) => requested.has(grant));
};

interface PortableExtensionUpdatePackage {
	readonly id: string;
	readonly version: string;
	readonly roles: ReadonlyArray<string>;
	readonly capabilities: ReadonlyArray<{
		readonly id: ExtensionCapability;
		readonly required: boolean;
	}>;
}

export interface PortableExtensionUpdateAssessment {
	readonly status: 'compatible' | 'authority-review' | 'pinned' | 'conflict';
}

export const assessPortableExtensionUpdate = (
	current: PortableExtensionUpdatePackage,
	candidate: PortableExtensionUpdatePackage,
	local: { readonly pinned?: boolean; readonly forkRevision?: string } = {}
): PortableExtensionUpdateAssessment => {
	if (local.pinned === true) return { status: 'pinned' };
	if (local.forkRevision !== undefined) return { status: 'conflict' };
	const currentRoles = new Set(current.roles);
	const currentCapabilities = new Set(
		current.capabilities.map((capability) => `${capability.id}:${String(capability.required)}`)
	);
	const expandsAuthority =
		current.id !== candidate.id ||
		candidate.roles.some((role) => !currentRoles.has(role)) ||
		candidate.capabilities.some(
			(capability) => !currentCapabilities.has(`${capability.id}:${String(capability.required)}`)
		);
	return { status: expandsAuthority ? 'authority-review' : 'compatible' };
};
