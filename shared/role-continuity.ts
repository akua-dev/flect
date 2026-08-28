import { Effect, Schema, type SchemaAST } from 'effect';
import { OperationId } from './control';
import { RevisionId } from './revisions';

export const ROLE_CONTINUITY_MAX_BYTES = 512 * 1_024;

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const DraftText = Schema.String.check(Schema.isMaxLength(100_000));

export class ContinuityDrafts extends Schema.Class<ContinuityDrafts>('ContinuityDrafts')({
	acceptedUse: DraftText,
	candidateUse: DraftText,
	shape: Schema.String.check(Schema.isMaxLength(4_000))
}) {}

export class ContinuityMessage extends Schema.Class<ContinuityMessage>('ContinuityMessage')({
	version: Schema.Literal(1),
	id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	turnId: Schema.optionalKey(OperationId),
	role: Schema.Literals(['user', 'assistant']),
	content: Schema.String.check(Schema.isMaxLength(100_000)),
	createdAt: Timestamp
}) {}

const ContinuityMessages = Schema.Array(ContinuityMessage).check(Schema.isMaxLength(200));

export const ContinuityRecoveryReason = Schema.Literals([
	'interrupted-turn',
	'storage-unavailable',
	'quota-exhausted',
	'corrupt-record',
	'incompatible-record',
	'stale-write',
	'candidate-mismatch'
]);
export type ContinuityRecoveryReason = typeof ContinuityRecoveryReason.Type;

export class ContinuityRecovery extends Schema.Class<ContinuityRecovery>('ContinuityRecovery')({
	reason: ContinuityRecoveryReason,
	recordedAt: Timestamp
}) {}

export class RoleContinuityRecord extends Schema.Class<RoleContinuityRecord>(
	'RoleContinuityRecord'
)({
	version: Schema.Literal(1),
	generation: Sequence,
	revisionSequence: Sequence,
	drafts: ContinuityDrafts,
	app: ContinuityMessages,
	previewApp: ContinuityMessages,
	shaper: ContinuityMessages,
	candidateRevisionId: Schema.optionalKey(RevisionId),
	recovery: Schema.optionalKey(ContinuityRecovery)
}) {}

export class InvalidRoleContinuity extends Schema.TaggedErrorClass<InvalidRoleContinuity>()(
	'InvalidRoleContinuity',
	{
		message: Schema.Literal('The saved role continuity is invalid.')
	}
) {}

export class RoleContinuityTooLarge extends Schema.TaggedErrorClass<RoleContinuityTooLarge>()(
	'RoleContinuityTooLarge',
	{
		message: Schema.Literal('The saved role continuity exceeds its limit.'),
		bytes: Schema.Int.check(Schema.isGreaterThan(ROLE_CONTINUITY_MAX_BYTES))
	}
) {}

export type RoleContinuityCodecError = InvalidRoleContinuity | RoleContinuityTooLarge;

const invalidContinuity = () =>
	InvalidRoleContinuity.make({
		message: 'The saved role continuity is invalid.'
	});

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const ensureBounded = (encoded: string) => {
	const bytes = byteLength(encoded);
	return bytes > ROLE_CONTINUITY_MAX_BYTES
		? Effect.fail(
				RoleContinuityTooLarge.make({
					message: 'The saved role continuity exceeds its limit.',
					bytes
				})
			)
		: Effect.succeed(encoded);
};

export const emptyRoleContinuityRecord = (revisionSequence: number): RoleContinuityRecord =>
	RoleContinuityRecord.make({
		version: 1,
		generation: 0,
		revisionSequence,
		drafts: ContinuityDrafts.make({
			acceptedUse: '',
			candidateUse: '',
			shape: ''
		}),
		app: [],
		previewApp: [],
		shaper: []
	});

export const decodeRoleContinuityRecord = Effect.fn('RoleContinuity.decode')(function* (
	raw: string
) {
	yield* ensureBounded(raw);
	const input = yield* Effect.try({
		try: (): unknown => JSON.parse(raw),
		catch: invalidContinuity
	});
	return yield* Schema.decodeUnknownEffect(
		RoleContinuityRecord,
		strictOptions
	)(input).pipe(Effect.mapError(invalidContinuity));
});

export const encodeRoleContinuityRecord = Effect.fn('RoleContinuity.encode')(function* (
	record: RoleContinuityRecord
) {
	const validated = yield* Schema.decodeUnknownEffect(
		RoleContinuityRecord,
		strictOptions
	)(record).pipe(Effect.mapError(invalidContinuity));
	const encoded = yield* Effect.try({
		try: () => JSON.stringify(validated),
		catch: invalidContinuity
	});
	return yield* ensureBounded(encoded);
});
