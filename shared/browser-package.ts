import { Schema } from 'effect';

const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const PackagePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));

export class BrowserPackageRequest extends Schema.Class<BrowserPackageRequest>(
	'BrowserPackageRequest'
)({
	version: Schema.Literal(1),
	packageJson: Schema.Uint8Array,
	packageLock: Schema.optionalKey(Schema.Uint8Array)
}) {}

export class BrowserPackageFile extends Schema.Class<BrowserPackageFile>('BrowserPackageFile')({
	path: PackagePath,
	contents: Schema.Uint8Array
}) {}

export class BrowserPackageResolution extends Schema.Class<BrowserPackageResolution>(
	'BrowserPackageResolution'
)({
	version: Schema.Literal(1),
	inputDigest: Digest,
	lockDigest: Digest,
	graphDigest: Digest,
	packageCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2_048 })),
	lockfile: Schema.Uint8Array,
	files: Schema.Array(BrowserPackageFile).check(Schema.isMaxLength(2_048)),
	cacheHit: Schema.Boolean
}) {}

export class BrowserPackageFailure extends Schema.TaggedErrorClass<BrowserPackageFailure>()(
	'BrowserPackageFailure',
	{
		inputDigest: Digest,
		reason: Schema.Literals([
			'invalid-input',
			'resolution',
			'invalid-lock',
			'oversized',
			'storage'
		]),
		message: Schema.String.check(Schema.isMaxLength(500))
	}
) {}
