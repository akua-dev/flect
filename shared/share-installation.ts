import { Effect, Schema, type SchemaAST } from 'effect';
import { ShareArtifactKind, ShareManifest } from '../packages/product/src/share';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const Identifier = Schema.String.check(
	Schema.isMinLength(3),
	Schema.isMaxLength(120),
	Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
);
const SemanticVersion = Schema.String.check(
	Schema.isMaxLength(40),
	Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
);
const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const HttpsUrl = Schema.String.check(
	Schema.isMaxLength(2_048),
	Schema.isPattern(/^https:\/\/(?![^/]*@)[^\s#]+$/)
);
const AdapterId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)
);
const Timestamp = Schema.Int.check(
	Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
);

export class ShareLocalInstallationSource extends Schema.TaggedClass<ShareLocalInstallationSource>()(
	'local',
	{ archiveSha256: Hash }
) {}

export class ShareUrlInstallationSource extends Schema.TaggedClass<ShareUrlInstallationSource>()(
	'url',
	{ url: HttpsUrl, archiveSha256: Hash }
) {}

export class ShareGitInstallationSource extends Schema.TaggedClass<ShareGitInstallationSource>()(
	'git',
	{ url: HttpsUrl, descriptorCommit: ObjectId, archiveSha256: Hash }
) {}

export class SharePrivateInstallationSource extends Schema.TaggedClass<SharePrivateInstallationSource>()(
	'private',
	{ adapterId: AdapterId, referenceSha256: Hash, archiveSha256: Hash }
) {}

export const ShareInstallationSource = Schema.Union([
	ShareLocalInstallationSource,
	ShareUrlInstallationSource,
	ShareGitInstallationSource,
	SharePrivateInstallationSource
]);
export type ShareInstallationSource = typeof ShareInstallationSource.Type;

export const ShareLineage = Schema.Literals(['new', 'update', 'fork', 'replacement', 'conflict']);
export type ShareLineage = typeof ShareLineage.Type;

export class SharePendingCandidate extends Schema.Class<SharePendingCandidate>(
	'SharePendingCandidate'
)({
	archiveSha256: Hash,
	lineage: ShareLineage,
	origin: ShareInstallationSource,
	conflictPaths: Schema.Array(
		Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
	).check(Schema.isMaxLength(100)),
	retainedAt: Timestamp
}) {}

export class ShareInstalledArtifact extends Schema.Class<ShareInstalledArtifact>(
	'ShareInstalledArtifact'
)({
	id: Identifier,
	kind: ShareArtifactKind,
	version: SemanticVersion,
	contentSha256: Hash,
	capsuleSha256: Schema.optionalKey(Hash)
}) {}

export class ShareInstallationRefs extends Schema.Class<ShareInstallationRefs>(
	'ShareInstallationRefs'
)({
	base: ObjectId,
	upstream: ObjectId,
	fork: ObjectId,
	candidate: Schema.optionalKey(ObjectId)
}) {}

export class ShareInstallationRecord extends Schema.Class<ShareInstallationRecord>(
	'ShareInstallationRecord'
)({
	formatVersion: Schema.Literal(1),
	shareId: Identifier,
	version: SemanticVersion,
	source: ShareInstallationSource,
	manifestSha256: Hash,
	repositorySha256: Hash,
	manifest: Schema.optionalKey(ShareManifest),
	artifacts: Schema.Array(ShareInstalledArtifact).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(64)
	),
	installedArtifactIds: Schema.Array(Identifier).check(Schema.isMaxLength(64)),
	refs: ShareInstallationRefs,
	pending: Schema.optionalKey(SharePendingCandidate),
	createdAt: Timestamp,
	updatedAt: Timestamp
}) {}

export class ShareInstallationFailure extends Schema.TaggedErrorClass<ShareInstallationFailure>()(
	'ShareInstallationFailure',
	{
		reason: Schema.Literals(['invalid-record', 'persistence']),
		message: Schema.String
	}
) {}

export class ShareInstallationSnapshot extends Schema.Class<ShareInstallationSnapshot>(
	'ShareInstallationSnapshot'
)({
	formatVersion: Schema.Literal(1),
	entries: Schema.Array(ShareInstallationRecord).check(Schema.isMaxLength(256)),
	warning: Schema.optionalKey(Schema.Literals(['invalid-record', 'storage-unavailable']))
}) {}

const failure = (reason: ShareInstallationFailure['reason'] = 'invalid-record') =>
	ShareInstallationFailure.make({
		reason,
		message:
			reason === 'persistence'
				? 'Shared installation state could not be saved.'
				: 'The shared installation record is invalid.'
	});

export const validateShareInstallationRecord = Effect.fn('ShareInstallation.validate')(function* (
	input: unknown
) {
	const record = yield* Schema.decodeUnknownEffect(
		ShareInstallationRecord,
		strict
	)(input).pipe(Effect.mapError(() => failure()));
	const artifactIds = record.artifacts.map((artifact) => artifact.id);
	const installedIds = record.installedArtifactIds;
	const manifestArtifacts = record.manifest?.artifacts;
	if (
		new Set(artifactIds).size !== artifactIds.length ||
		new Set(installedIds).size !== installedIds.length ||
		installedIds.some((id) => !artifactIds.includes(id)) ||
		record.updatedAt < record.createdAt ||
		record.refs.candidate === record.refs.fork ||
		(record.refs.candidate !== undefined && record.pending === undefined) ||
		(record.pending !== undefined && record.pending.retainedAt > record.updatedAt) ||
		(record.pending !== undefined &&
			!['new', 'conflict'].includes(record.pending.lineage) &&
			record.refs.candidate === undefined) ||
		(record.manifest !== undefined &&
			(record.manifest.id !== record.shareId ||
				record.manifest.version !== record.version ||
				manifestArtifacts?.length !== record.artifacts.length ||
				record.artifacts.some((artifact, index) => {
					const declared = manifestArtifacts?.[index];
					return (
						declared === undefined ||
						declared.id !== artifact.id ||
						declared.kind !== artifact.kind ||
						declared.version !== artifact.version ||
						declared.contentSha256 !== artifact.contentSha256
					);
				})))
	) {
		return yield* Effect.fail(failure());
	}
	return record;
});

export const shareInstallationPersistenceFailure = () => failure('persistence');
