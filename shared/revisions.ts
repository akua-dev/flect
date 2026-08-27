import { Effect, Equal, Schema, type SchemaAST } from 'effect';
import {
	defaultInterfaceDocument,
	InterfaceDocument,
	validateInterfaceDocument
} from './interface-document';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const IdentifierText = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z][a-z0-9-]*$/)
);

export const RevisionId = IdentifierText.pipe(Schema.brand('RevisionId'));
export type RevisionId = typeof RevisionId.Type;

export class InterfaceRevision extends Schema.Class<InterfaceRevision>('InterfaceRevision')({
	version: Schema.Literal(1),
	id: RevisionId,
	parentId: Schema.optionalKey(RevisionId),
	status: Schema.Literals(['proposed', 'previewed', 'accepted', 'rejected']),
	source: Schema.Literals(['built-in', 'user', 'shaper', 'extension', 'recovery']),
	document: InterfaceDocument,
	createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ShapingEvent extends Schema.Class<ShapingEvent>('ShapingEvent')({
	version: Schema.Literal(1),
	sequence: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	type: Schema.Literals([
		'initialized',
		'revision-proposed',
		'revision-previewed',
		'revision-accepted',
		'revision-rejected',
		'revision-rolled-back',
		'extension-failed',
		'recovery-requested',
		'safe-mode-entered'
	]),
	revisionId: Schema.optionalKey(RevisionId),
	extensionId: Schema.optionalKey(IdentifierText),
	operationId: Schema.optionalKey(IdentifierText)
}) {}

export class ShapingSnapshot extends Schema.Class<ShapingSnapshot>('ShapingSnapshot')({
	version: Schema.Literal(1),
	active: InterfaceRevision,
	lastKnownGood: InterfaceRevision,
	proposal: Schema.optionalKey(InterfaceRevision),
	safeMode: Schema.Boolean,
	disabledExtensions: Schema.Array(IdentifierText),
	lastEvent: ShapingEvent
}) {}

export const isRollbackAvailable = (snapshot: ShapingSnapshot) =>
	!snapshot.safeMode &&
	snapshot.proposal === undefined &&
	snapshot.active.id !== snapshot.lastKnownGood.id;

export class InvalidRevision extends Schema.TaggedErrorClass<InvalidRevision>()('InvalidRevision', {
	message: Schema.Literal('The interface revision is invalid.')
}) {}

export class RevisionNotFound extends Schema.TaggedErrorClass<RevisionNotFound>()(
	'RevisionNotFound',
	{
		id: RevisionId,
		message: Schema.Literal('The interface revision was not found.')
	}
) {}

export class InvalidRevisionTransition extends Schema.TaggedErrorClass<InvalidRevisionTransition>()(
	'InvalidRevisionTransition',
	{
		id: RevisionId,
		message: Schema.Literal('The interface revision cannot make that transition.')
	}
) {}

const invalidRevision = () =>
	InvalidRevision.make({
		message: 'The interface revision is invalid.'
	});

const readProperty = (input: unknown, key: string) =>
	typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;

const validateRawRevisionDocument = Effect.fn('Flect.InterfaceRevision.preflightDocument')(
	(input: unknown) =>
		validateInterfaceDocument(readProperty(input, 'document')).pipe(
			Effect.mapError(invalidRevision),
			Effect.asVoid
		)
);

export const validateInterfaceRevision = Effect.fn('Flect.InterfaceRevision.validate')(function* (
	input: unknown
) {
	yield* validateRawRevisionDocument(input);
	return yield* Schema.decodeUnknownEffect(
		InterfaceRevision,
		strictOptions
	)(input).pipe(Effect.mapError(invalidRevision));
});

const validateRevisionDocument = Effect.fn('Flect.ShapingSnapshot.validateRevisionDocument')(
	(revision: InterfaceRevision) =>
		validateInterfaceDocument(revision.document).pipe(
			Effect.mapError(() => invalidRevision()),
			Effect.as(revision)
		)
);

const isProposalStatus = (
	status: InterfaceRevision['status']
): status is 'proposed' | 'previewed' => status === 'proposed' || status === 'previewed';

const isInitialRevision = (revision: InterfaceRevision) =>
	revision.id === 'built-in' &&
	revision.parentId === undefined &&
	revision.status === 'accepted' &&
	revision.source === 'built-in' &&
	revision.createdAt === 0 &&
	Equal.equals(revision.document, defaultInterfaceDocument);

export const validateShapingSnapshot = Effect.fn('Flect.ShapingSnapshot.validate')(function* (
	input: unknown
): Effect.fn.Return<ShapingSnapshot, InvalidRevision, never> {
	yield* validateRawRevisionDocument(readProperty(input, 'active'));
	yield* validateRawRevisionDocument(readProperty(input, 'lastKnownGood'));
	const rawProposal = readProperty(input, 'proposal');
	if (rawProposal !== undefined) {
		yield* validateRawRevisionDocument(rawProposal);
	}

	const snapshot = yield* Schema.decodeUnknownEffect(
		ShapingSnapshot,
		strictOptions
	)(input).pipe(Effect.mapError(invalidRevision));

	yield* validateRevisionDocument(snapshot.active);
	yield* validateRevisionDocument(snapshot.lastKnownGood);

	if (snapshot.active.status !== 'accepted' || snapshot.lastKnownGood.status !== 'accepted') {
		return yield* Effect.fail(invalidRevision());
	}

	if (
		[snapshot.active, snapshot.lastKnownGood].some(
			(revision) => revision.source === 'built-in' && !isInitialRevision(revision)
		)
	) {
		return yield* Effect.fail(invalidRevision());
	}

	if (snapshot.proposal !== undefined) {
		yield* validateRevisionDocument(snapshot.proposal);
		if (
			!isProposalStatus(snapshot.proposal.status) ||
			snapshot.proposal.source === 'built-in' ||
			snapshot.proposal.parentId !== snapshot.active.id
		) {
			return yield* Effect.fail(invalidRevision());
		}
	}

	if (new Set(snapshot.disabledExtensions).size !== snapshot.disabledExtensions.length) {
		return yield* Effect.fail(invalidRevision());
	}

	const event = snapshot.lastEvent;
	if (event.type === 'initialized') {
		if (
			event.sequence !== 0 ||
			event.revisionId !== snapshot.active.id ||
			event.extensionId !== undefined ||
			!isInitialRevision(snapshot.active) ||
			!isInitialRevision(snapshot.lastKnownGood) ||
			snapshot.proposal !== undefined ||
			snapshot.safeMode ||
			snapshot.disabledExtensions.length > 0
		) {
			return yield* Effect.fail(invalidRevision());
		}
	} else if (event.sequence === 0) {
		return yield* Effect.fail(invalidRevision());
	}

	const hasRevisionOnly = event.revisionId !== undefined && event.extensionId === undefined;
	const hasExtensionOnly = event.revisionId === undefined && event.extensionId !== undefined;
	const isBuiltInSafeState =
		snapshot.safeMode && isInitialRevision(snapshot.active) && snapshot.proposal === undefined;

	const eventMatchesState = (() => {
		switch (event.type) {
			case 'initialized':
				return true;
			case 'revision-proposed':
				return (
					!snapshot.safeMode &&
					hasRevisionOnly &&
					snapshot.proposal?.status === 'proposed' &&
					snapshot.proposal.id === event.revisionId
				);
			case 'revision-previewed':
				return (
					!snapshot.safeMode &&
					hasRevisionOnly &&
					snapshot.proposal?.status === 'previewed' &&
					snapshot.proposal.id === event.revisionId
				);
			case 'revision-accepted':
				return (
					!snapshot.safeMode &&
					hasRevisionOnly &&
					snapshot.proposal === undefined &&
					snapshot.active.id === event.revisionId
				);
			case 'revision-rejected':
				return !snapshot.safeMode && hasRevisionOnly && snapshot.proposal === undefined;
			case 'revision-rolled-back':
				return (
					!snapshot.safeMode &&
					hasRevisionOnly &&
					snapshot.proposal === undefined &&
					snapshot.active.id === event.revisionId &&
					snapshot.lastKnownGood.id === event.revisionId &&
					snapshot.active.source === 'recovery'
				);
			case 'extension-failed':
				return !snapshot.safeMode && hasExtensionOnly;
			case 'recovery-requested':
				return (
					isBuiltInSafeState &&
					event.revisionId === snapshot.lastKnownGood.id &&
					event.extensionId !== undefined &&
					snapshot.disabledExtensions.includes(event.extensionId)
				);
			case 'safe-mode-entered':
				return (
					isBuiltInSafeState && hasRevisionOnly && event.revisionId === snapshot.lastKnownGood.id
				);
		}
	})();

	if (!eventMatchesState) {
		return yield* Effect.fail(invalidRevision());
	}

	return snapshot;
});
