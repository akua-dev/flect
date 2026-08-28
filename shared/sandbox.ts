import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';
import { MAX_PORTABLE_EXTENSION_SOURCE_BYTES } from '../packages/product/src/extensions';

const IdentifierText = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z][a-z0-9-]*$/)
);

export class ExtensionIntentContext extends Schema.Class<ExtensionIntentContext>(
	'ExtensionIntentContext'
)({
	extensionId: IdentifierText,
	role: Schema.Literals(['app', 'shaper']),
	binding: Schema.Literals(['accepted', 'candidate']),
	operationId: IdentifierText
}) {}

export class SetTextIntent extends Schema.Class<SetTextIntent>('SetTextIntent')({
	type: Schema.Literal('set-text'),
	target: IdentifierText,
	text: Schema.String.check(Schema.isMaxLength(2_000))
}) {}

export const CapabilityIntent = Schema.Union([SetTextIntent]);
export type CapabilityIntent = typeof CapabilityIntent.Type;

export class SandboxResult extends Schema.Class<SandboxResult>('SandboxResult')({
	version: Schema.Literal(1),
	intents: Schema.Array(CapabilityIntent).check(Schema.isMaxLength(20))
}) {}

export class SandboxExecutionFailed extends Schema.TaggedErrorClass<SandboxExecutionFailed>()(
	'SandboxExecutionFailed',
	{
		reason: Schema.Literals([
			'invalid-input',
			'source-limit',
			'input-limit',
			'output-limit',
			'deadline',
			'memory',
			'execution',
			'invalid-result',
			'worker'
		]),
		message: Schema.Literal('Extension execution failed safely.')
	}
) {}

export interface QuickJsExtensionRequest {
	readonly extensionId: string;
	readonly source: string;
	readonly input: unknown;
}

export class ExecuteExtension extends Rpc.make('ExecuteExtension', {
	payload: {
		extensionId: IdentifierText,
		source: Schema.String.check(
			Schema.isMinLength(1),
			Schema.isMaxLength(MAX_PORTABLE_EXTENSION_SOURCE_BYTES)
		),
		input: Schema.Unknown
	},
	success: SandboxResult,
	error: SandboxExecutionFailed
}) {}

export const SandboxRpcs = RpcGroup.make(ExecuteExtension);

export class SandboxWorkerRequest extends Schema.Class<SandboxWorkerRequest>(
	'SandboxWorkerRequest'
)({
	id: IdentifierText,
	request: Schema.Struct({
		extensionId: IdentifierText,
		source: Schema.String.check(
			Schema.isMinLength(1),
			Schema.isMaxLength(MAX_PORTABLE_EXTENSION_SOURCE_BYTES)
		),
		input: Schema.Unknown
	})
}) {}

export class SandboxWorkerSuccess extends Schema.Class<SandboxWorkerSuccess>(
	'SandboxWorkerSuccess'
)({
	type: Schema.Literal('success'),
	id: IdentifierText,
	result: SandboxResult
}) {}

export class SandboxWorkerFailure extends Schema.Class<SandboxWorkerFailure>(
	'SandboxWorkerFailure'
)({
	type: Schema.Literal('failure'),
	id: IdentifierText,
	error: SandboxExecutionFailed
}) {}

export const SandboxWorkerResponse = Schema.Union([SandboxWorkerSuccess, SandboxWorkerFailure]);
export type SandboxWorkerResponse = typeof SandboxWorkerResponse.Type;
