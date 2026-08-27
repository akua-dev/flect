import { Schema } from 'effect';
import { ShareArtifactKind } from '../packages/product/src/share';
import { ShareInstallationSource, ShareLineage } from './share-installation';

const Path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));

export class ShareSignatureAssessment extends Schema.Class<ShareSignatureAssessment>(
	'ShareSignatureAssessment'
)({
	status: Schema.Literals(['unsigned', 'present-unverified', 'verified', 'invalid']),
	keyIds: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
	authoritative: Schema.Literal(false)
}) {}

export class ShareReviewArtifact extends Schema.Class<ShareReviewArtifact>('ShareReviewArtifact')({
	id: Schema.String,
	kind: ShareArtifactKind,
	version: Schema.String,
	sourceRoot: Path
}) {}

export class ShareReviewChange extends Schema.Class<ShareReviewChange>('ShareReviewChange')({
	category: Schema.Literals([
		'source',
		'interface',
		'instructions',
		'extension',
		'capability',
		'dependency',
		'migration'
	]),
	kind: Schema.Literals(['added', 'modified', 'removed', 'conflict']),
	path: Path,
	authorityAffecting: Schema.Boolean
}) {}

export class ShareReview extends Schema.Class<ShareReview>('ShareReview')({
	formatVersion: Schema.Literal(1),
	shareId: Schema.String,
	name: Schema.String,
	version: Schema.String,
	lineage: ShareLineage,
	origin: ShareInstallationSource,
	publisher: Schema.String,
	source: Schema.String,
	revision: Schema.String,
	compatible: Schema.Boolean,
	signature: ShareSignatureAssessment,
	artifacts: Schema.Array(ShareReviewArtifact).check(Schema.isMaxLength(64)),
	changes: Schema.Array(ShareReviewChange).check(Schema.isMaxLength(4_096)),
	blockers: Schema.Array(
		Schema.Literals([
			'invalid-signature',
			'incompatible',
			'conflict',
			'migration-review-required',
			'extension-test-required',
			'grant-review-required'
		])
	).check(Schema.isMaxLength(6)),
	actions: Schema.Array(
		Schema.Literals([
			'install',
			'fork',
			'merge-update',
			'keep-replacement',
			'continue-fork',
			'shape-conflict',
			'reject'
		])
	).check(Schema.isMaxLength(3)),
	inactive: Schema.Literal(true)
}) {}
