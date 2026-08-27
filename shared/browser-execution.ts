import { Schema } from 'effect';

const OutputText = Schema.String.check(Schema.isMaxLength(1_048_576));
const ArgumentText = Schema.String.check(Schema.isMaxLength(4_096));
const RequestId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^request-[a-z0-9]+$/)
);
const PackageName = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(214),
	Schema.isPattern(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
);
const VersionRange = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const Environment = Schema.Record(
	Schema.String.check(Schema.isMaxLength(128)),
	Schema.String.check(Schema.isMaxLength(4_096))
).check(Schema.isMaxProperties(64));

export class BrowserExecutionCapabilities extends Schema.Class<BrowserExecutionCapabilities>(
	'BrowserExecutionCapabilities'
)({
	version: Schema.Literal(1),
	worker: Schema.Boolean,
	webAssembly: Schema.Boolean,
	crossOriginIsolated: Schema.Boolean,
	opfs: Schema.Boolean
}) {}

export class JavaScriptExecutionRequest extends Schema.Class<JavaScriptExecutionRequest>(
	'JavaScriptExecutionRequest'
)({
	version: Schema.Literal(1),
	source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(262_144))
}) {}

export class JavaScriptExecutionResult extends Schema.Class<JavaScriptExecutionResult>(
	'JavaScriptExecutionResult'
)({
	version: Schema.Literal(1),
	value: Schema.Unknown,
	stdout: OutputText,
	stderr: OutputText
}) {}

export class WasiExecutionRequest extends Schema.Class<WasiExecutionRequest>(
	'WasiExecutionRequest'
)({
	version: Schema.Literal(1),
	module: Schema.Uint8Array,
	args: Schema.Array(ArgumentText).check(Schema.isMaxLength(64)),
	env: Environment
}) {}

export class WasiExecutionResult extends Schema.Class<WasiExecutionResult>('WasiExecutionResult')({
	version: Schema.Literal(1),
	exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
	stdout: OutputText,
	stderr: OutputText
}) {}

export class PackageMirrorRequest extends Schema.Class<PackageMirrorRequest>(
	'PackageMirrorRequest'
)({
	version: Schema.Literal(1),
	name: PackageName,
	packageVersion: VersionRange,
	dependencies: Schema.Record(PackageName, VersionRange).check(Schema.isMaxProperties(64))
}) {}

export class PackageMirrorResult extends Schema.Class<PackageMirrorResult>('PackageMirrorResult')({
	version: Schema.Literal(1),
	packageCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2_048 })),
	lockfileWritten: Schema.Boolean
}) {}

export class BrowserExecutionFailed extends Schema.TaggedErrorClass<BrowserExecutionFailed>()(
	'BrowserExecutionFailed',
	{
		reason: Schema.Literals([
			'unsupported',
			'invalid-input',
			'startup',
			'worker',
			'deadline',
			'execution',
			'invalid-result',
			'package'
		]),
		operation: Schema.Literals(['probe', 'javascript', 'wasi', 'package-mirror']),
		message: Schema.String.check(Schema.isMaxLength(500))
	}
) {}

export class WasiWorkerRequest extends Schema.Class<WasiWorkerRequest>('WasiWorkerRequest')({
	type: Schema.Literal('run'),
	id: RequestId,
	request: WasiExecutionRequest
}) {}

export class WasiWorkerSuccess extends Schema.Class<WasiWorkerSuccess>('WasiWorkerSuccess')({
	type: Schema.Literal('success'),
	id: RequestId,
	result: WasiExecutionResult
}) {}

export class WasiWorkerFailure extends Schema.Class<WasiWorkerFailure>('WasiWorkerFailure')({
	type: Schema.Literal('failure'),
	id: RequestId,
	error: BrowserExecutionFailed
}) {}

export const WasiWorkerResponse = Schema.Union([WasiWorkerSuccess, WasiWorkerFailure]);
export type WasiWorkerResponse = typeof WasiWorkerResponse.Type;
