import { Schema } from 'effect';

export const AxiAudience = Schema.Literals(['native', 'app', 'shaper']);
export type AxiAudience = typeof AxiAudience.Type;

export const AxiFormat = Schema.Literals(['toon', 'json']);
export type AxiFormat = typeof AxiFormat.Type;

export class AxiInvocation extends Schema.Class<AxiInvocation>('AxiInvocation')({
	audience: AxiAudience,
	bin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
	format: AxiFormat,
	full: Schema.Boolean
}) {}

export class AxiPublicError extends Schema.Class<AxiPublicError>('AxiPublicError')({
	code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
	help: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))).check(
		Schema.isMaxLength(4)
	)
}) {}

export class AxiRunResult extends Schema.Class<AxiRunResult>('AxiRunResult')({
	exitCode: Schema.Literals([0, 1, 2]),
	stdout: Schema.String,
	stderr: Schema.String
}) {}

export class AxiFormatError extends Schema.TaggedErrorClass<AxiFormatError>()('AxiFormatError', {
	message: Schema.Literals([
		'Flect output could not be encoded safely.',
		'Flect output exceeded its safe size limit.'
	])
}) {}
