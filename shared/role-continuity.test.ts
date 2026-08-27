import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { RevisionId } from './revisions';
import {
	ContinuityDrafts,
	ContinuityMessage,
	ContinuityRecovery,
	decodeRoleContinuityRecord,
	emptyRoleContinuityRecord,
	encodeRoleContinuityRecord,
	RoleContinuityRecord
} from './role-continuity';

const message = (id: string, content = 'Completed response') =>
	ContinuityMessage.make({
		version: 1,
		id,
		role: 'assistant',
		content,
		createdAt: 1
	});

describe('role continuity contract', () => {
	it.effect('round-trips bounded, role-isolated continuity', () =>
		Effect.gen(function* () {
			const record = RoleContinuityRecord.make({
				version: 1,
				generation: 7,
				revisionSequence: 12,
				drafts: ContinuityDrafts.make({
					acceptedUse: 'Ask the accepted app',
					candidateUse: 'Test the candidate',
					shape: 'Make the totals quieter'
				}),
				app: [message('app-message')],
				previewApp: [message('preview-message')],
				shaper: [message('shaper-message')],
				candidateRevisionId: RevisionId.make('revision-12'),
				recovery: ContinuityRecovery.make({
					reason: 'interrupted-turn',
					recordedAt: 2
				})
			});

			const encoded = yield* encodeRoleContinuityRecord(record);
			const decoded = yield* decodeRoleContinuityRecord(encoded);

			expect(decoded).toEqual(record);
			expect(decoded.app).not.toEqual(decoded.shaper);
			expect(decoded.previewApp).not.toEqual(decoded.app);
		})
	);

	it.effect('rejects unknown versions and excess private fields', () =>
		Effect.gen(function* () {
			const base = emptyRoleContinuityRecord(0);
			const unknownVersion = yield* decodeRoleContinuityRecord(
				JSON.stringify({ ...base, version: 2 })
			).pipe(Effect.flip);
			const credential = yield* decodeRoleContinuityRecord(
				JSON.stringify({ ...base, providerCredential: 'must-not-persist' })
			).pipe(Effect.flip);
			const authEvent = yield* decodeRoleContinuityRecord(
				JSON.stringify({ ...base, authEvent: { loginId: 'login-private' } })
			).pipe(Effect.flip);
			const controlGrant = yield* decodeRoleContinuityRecord(
				JSON.stringify({ ...base, controlGrant: 'grant-private' })
			).pipe(Effect.flip);

			expect(unknownVersion._tag).toBe('InvalidRoleContinuity');
			expect(credential._tag).toBe('InvalidRoleContinuity');
			expect(authEvent._tag).toBe('InvalidRoleContinuity');
			expect(controlGrant._tag).toBe('InvalidRoleContinuity');
		})
	);

	it.effect('rejects oversized fields, collections, and aggregate records', () =>
		Effect.gen(function* () {
			const base = emptyRoleContinuityRecord(0);
			const oversizedDraft = yield* decodeRoleContinuityRecord(
				JSON.stringify({
					...base,
					drafts: { ...base.drafts, acceptedUse: 'x'.repeat(100_001) }
				})
			).pipe(Effect.flip);
			const tooManyMessages = yield* decodeRoleContinuityRecord(
				JSON.stringify({
					...base,
					app: Array.from({ length: 201 }, (_, index) => message(`message-${index}`))
				})
			).pipe(Effect.flip);
			const aggregate = RoleContinuityRecord.make({
				...base,
				app: Array.from({ length: 6 }, (_, index) => message(`large-${index}`, 'x'.repeat(100_000)))
			});
			const oversizedAggregate = yield* encodeRoleContinuityRecord(aggregate).pipe(Effect.flip);

			expect(oversizedDraft._tag).toBe('InvalidRoleContinuity');
			expect(tooManyMessages._tag).toBe('InvalidRoleContinuity');
			expect(oversizedAggregate._tag).toBe('RoleContinuityTooLarge');
		})
	);

	it.effect('rejects malformed JSON and malformed candidate bindings', () =>
		Effect.gen(function* () {
			const malformed = yield* decodeRoleContinuityRecord('{bad').pipe(Effect.flip);
			const invalidCandidate = yield* decodeRoleContinuityRecord(
				JSON.stringify({
					...emptyRoleContinuityRecord(0),
					candidateRevisionId: 'candidate without a revision id'
				})
			).pipe(Effect.flip);

			expect(malformed._tag).toBe('InvalidRoleContinuity');
			expect(invalidCandidate._tag).toBe('InvalidRoleContinuity');
		})
	);
});
