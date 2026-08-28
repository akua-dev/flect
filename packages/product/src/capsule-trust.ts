import { Effect, Schema } from 'effect';
import {
	type CapsuleSource,
	type DecodedCapsule,
	decodeCapsule,
	encodeCapsule,
	hashCapsuleArchive,
	InvalidCapsule
} from './capsule.js';

const encoder = new TextEncoder();

export const CapsuleSignatureStatus = Schema.Literals([
	'unsigned',
	'verified',
	'unknown-key',
	'revoked',
	'expired',
	'changed-after-signing',
	'invalid',
	'locally-forked'
]);
export type CapsuleSignatureStatus = typeof CapsuleSignatureStatus.Type;

export class CapsuleSignatureAssessment extends Schema.Class<CapsuleSignatureAssessment>(
	'CapsuleSignatureAssessment'
)({
	status: CapsuleSignatureStatus,
	keyIds: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
	contentSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
	authoritative: Schema.Literal(false)
}) {}

export interface CapsulePublisherKey {
	readonly keyId: string;
	readonly publicKey: CryptoKey;
	readonly status: 'active' | 'revoked';
	readonly validFrom?: string;
	readonly validUntil?: string;
	readonly replacedBy?: string;
}

export class CapsuleTrustFailure extends Schema.TaggedErrorClass<CapsuleTrustFailure>()(
	'CapsuleTrustFailure',
	{
		reason: Schema.Literals([
			'invalid-capsule',
			'invalid-key',
			'duplicate-key',
			'crypto-unavailable'
		]),
		message: Schema.Literal('Capsule trust could not be evaluated safely.')
	}
) {}

const failure = (reason: CapsuleTrustFailure['reason']) =>
	CapsuleTrustFailure.make({
		reason,
		message: 'Capsule trust could not be evaluated safely.'
	});

const toSource = (capsule: DecodedCapsule, manifest: CapsuleSource['manifest']): CapsuleSource => ({
	manifest,
	files: capsule.files.map((file) => ({
		path: file.path,
		contents: file.contents
	}))
});

const manifestWithoutFiles = (manifest: DecodedCapsule['manifest']) => {
	const { files: _files, ...source } = manifest;
	return source;
};

const canonicalUnsigned = Effect.fn('CapsuleTrust.canonicalUnsigned')(function* (
	archive: Uint8Array
) {
	const capsule = yield* decodeCapsule(archive).pipe(
		Effect.mapError(() => failure('invalid-capsule'))
	);
	const manifest = manifestWithoutFiles(capsule.manifest);
	const unsigned = yield* encodeCapsule(toSource(capsule, { ...manifest, signatures: [] })).pipe(
		Effect.mapError(() => failure('invalid-capsule'))
	);
	return {
		capsule,
		manifest,
		archive: unsigned,
		contentSha256: yield* hashCapsuleArchive(unsigned).pipe(
			Effect.mapError(() => failure('crypto-unavailable'))
		)
	};
});

export const hashCapsuleSignedContent = Effect.fn('CapsuleTrust.hashSignedContent')(
	(archive: Uint8Array) =>
		canonicalUnsigned(archive).pipe(Effect.map((value) => value.contentSha256))
);

const signaturePayload = (contentSha256: string, keyId: string, signedAt: string) =>
	encoder.encode(`Flect capsule signature v1\n${contentSha256}\n${keyId}\n${signedAt}\n`);

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const decodeBase64 = (value: string) => {
	if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) return undefined;
	try {
		const decoded = atob(value);
		return decoded.length === 64
			? Uint8Array.from(decoded, (character) => character.charCodeAt(0))
			: undefined;
	} catch {
		return undefined;
	}
};

const validDate = (value: string) =>
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
	Number.isFinite(Date.parse(value));

export const signCapsule = Effect.fn('CapsuleTrust.sign')(function* (
	archive: Uint8Array,
	options: {
		readonly keyId: string;
		readonly privateKey: CryptoKey;
		readonly signedAt: string;
	}
) {
	if (options.keyId.length === 0 || options.keyId.length > 200 || !validDate(options.signedAt)) {
		return yield* Effect.fail(failure('invalid-key'));
	}
	const canonical = yield* canonicalUnsigned(archive);
	if (canonical.capsule.manifest.signatures.some((claim) => claim.keyId === options.keyId)) {
		return yield* Effect.fail(failure('duplicate-key'));
	}
	const signature = yield* Effect.tryPromise({
		try: async () =>
			new Uint8Array(
				await crypto.subtle.sign(
					'Ed25519',
					options.privateKey,
					signaturePayload(canonical.contentSha256, options.keyId, options.signedAt)
				)
			),
		catch: () => failure('crypto-unavailable')
	});
	return yield* encodeCapsule(
		toSource(canonical.capsule, {
			...canonical.manifest,
			signatures: [
				...canonical.capsule.manifest.signatures,
				{
					algorithm: 'ed25519',
					keyId: options.keyId,
					contentSha256: canonical.contentSha256,
					signedAt: options.signedAt,
					signature: encodeBase64(signature)
				}
			]
		})
	).pipe(Effect.mapError(() => failure('invalid-capsule')));
});

const keyDateStatus = (
	key: CapsulePublisherKey,
	signedAt: string
): 'active' | 'revoked' | 'expired' => {
	if (key.status === 'revoked') return 'revoked';
	const timestamp = Date.parse(signedAt);
	if (
		(key.validFrom !== undefined && timestamp < Date.parse(key.validFrom)) ||
		(key.validUntil !== undefined && timestamp > Date.parse(key.validUntil))
	) {
		return 'expired';
	}
	return 'active';
};

const statusPriority = [
	'changed-after-signing',
	'invalid',
	'revoked',
	'expired',
	'unknown-key',
	'verified'
] as const;

export const verifyCapsuleSignatures = Effect.fn('CapsuleTrust.verify')(function* (
	archive: Uint8Array,
	keys: ReadonlyArray<CapsulePublisherKey>
) {
	const canonical = yield* canonicalUnsigned(archive);
	const signatures = canonical.capsule.manifest.signatures;
	if (signatures.length === 0) {
		return CapsuleSignatureAssessment.make({
			status:
				canonical.capsule.manifest.lineage?.kind === 'local-fork' ? 'locally-forked' : 'unsigned',
			keyIds: [],
			contentSha256: canonical.contentSha256,
			authoritative: false
		});
	}
	const keyIds = signatures.map((claim) => claim.keyId);
	if (new Set(keyIds).size !== keyIds.length) {
		return CapsuleSignatureAssessment.make({
			status: 'invalid',
			keyIds: [...new Set(keyIds)].toSorted(),
			contentSha256: canonical.contentSha256,
			authoritative: false
		});
	}
	const registry = new Map(keys.map((key) => [key.keyId, key]));
	const statuses = yield* Effect.forEach(signatures, (claim) =>
		Effect.gen(function* () {
			if (
				claim.contentSha256 === undefined ||
				claim.signedAt === undefined ||
				!validDate(claim.signedAt)
			) {
				return 'invalid' as const;
			}
			if (claim.contentSha256 !== canonical.contentSha256) {
				return 'changed-after-signing' as const;
			}
			const signature = decodeBase64(claim.signature);
			if (signature === undefined) return 'invalid' as const;
			const key = registry.get(claim.keyId);
			if (key === undefined) return 'unknown-key' as const;
			const dateStatus = keyDateStatus(key, claim.signedAt);
			if (dateStatus !== 'active') return dateStatus;
			const contentSha256 = claim.contentSha256;
			const signedAt = claim.signedAt;
			const verified = yield* Effect.promise(() =>
				crypto.subtle.verify(
					'Ed25519',
					key.publicKey,
					signature,
					signaturePayload(contentSha256, claim.keyId, signedAt)
				)
			).pipe(Effect.catch(() => Effect.succeed(false)));
			return verified ? ('verified' as const) : ('invalid' as const);
		})
	);
	return CapsuleSignatureAssessment.make({
		status: statusPriority.find((status) => statuses.includes(status)) ?? 'invalid',
		keyIds: keyIds.toSorted(),
		contentSha256: canonical.contentSha256,
		authoritative: false
	});
});

export const forkCapsule = Effect.fn('CapsuleTrust.fork')(function* (
	archive: Uint8Array,
	options: {
		readonly revision: string;
		readonly publisher?: string;
	}
) {
	const canonical = yield* canonicalUnsigned(archive);
	const source = canonical.capsule.manifest.provenance;
	return yield* encodeCapsule(
		toSource(canonical.capsule, {
			...canonical.manifest,
			provenance: {
				...source,
				publisher: options.publisher ?? 'local-user',
				source: `local-fork:${source.source}`.slice(0, 500),
				revision: options.revision.slice(0, 120)
			},
			lineage: {
				kind: 'local-fork',
				parentContentSha256: canonical.contentSha256,
				parentSource: source.source,
				parentRevision: source.revision
			},
			signatures: []
		})
	).pipe(Effect.mapError(() => failure('invalid-capsule')));
});

export const CapsuleTrustPolicy = Schema.Union([
	Schema.Struct({ mode: Schema.Literal('allow-unverified') }),
	Schema.Struct({ mode: Schema.Literal('require-verified') }),
	Schema.Struct({
		mode: Schema.Literal('approved-keys'),
		keyIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(64))
	})
]);
export type CapsuleTrustPolicy = typeof CapsuleTrustPolicy.Type;

export class CapsuleTrustDecision extends Schema.Class<CapsuleTrustDecision>(
	'CapsuleTrustDecision'
)({
	allowed: Schema.Boolean,
	reason: Schema.Literals([
		'accepted',
		'verification-required',
		'publisher-not-approved',
		'invalid-signature'
	]),
	permissionAuthorityChanged: Schema.Literal(false)
}) {}

export const evaluateCapsuleTrustPolicy = (
	assessment: CapsuleSignatureAssessment,
	policy: CapsuleTrustPolicy
) => {
	const invalid = ['invalid', 'changed-after-signing', 'revoked', 'expired'].includes(
		assessment.status
	);
	const verified = assessment.status === 'verified';
	const approved =
		policy.mode !== 'approved-keys' ||
		assessment.keyIds.every((keyId) => policy.keyIds.includes(keyId));
	return CapsuleTrustDecision.make({
		allowed: !invalid && (policy.mode === 'allow-unverified' || (verified && approved)),
		reason: invalid
			? 'invalid-signature'
			: policy.mode !== 'allow-unverified' && !verified
				? 'verification-required'
				: !approved
					? 'publisher-not-approved'
					: 'accepted',
		permissionAuthorityChanged: false
	});
};

export const mapCapsuleTrustError = (error: unknown) =>
	Schema.is(CapsuleTrustFailure)(error)
		? error
		: Schema.is(InvalidCapsule)(error)
			? failure('invalid-capsule')
			: failure('crypto-unavailable');
