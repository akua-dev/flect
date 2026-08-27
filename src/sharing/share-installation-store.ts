import {
	Context,
	Effect,
	Layer,
	Schema,
	type SchemaAST,
	type Stream,
	SubscriptionRef
} from 'effect';
import {
	ShareInstallationFailure,
	type ShareInstallationRecord,
	ShareInstallationSnapshot,
	shareInstallationPersistenceFailure,
	validateShareInstallationRecord
} from '../../shared/share-installation';
import { InterfaceStorage } from '../lib/interface-store';

const STORAGE_KEY = 'flect.share-installations.v1';
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const emptySnapshot = (warning?: ShareInstallationSnapshot['warning']) =>
	ShareInstallationSnapshot.make({
		formatVersion: 1,
		entries: [],
		...(warning === undefined ? {} : { warning })
	});

const sortEntries = (entries: ReadonlyArray<ShareInstallationRecord>) =>
	[...entries].toSorted((left, right) => left.shareId.localeCompare(right.shareId));

const decodeStored = Effect.fn('Flect.ShareInstallationStore.decode')(function* (raw: string) {
	const input = yield* Effect.try({
		try: (): unknown => JSON.parse(raw),
		catch: () =>
			ShareInstallationFailure.make({
				reason: 'invalid-record',
				message: 'The shared installation record is invalid.'
			})
	});
	const snapshot = yield* Schema.decodeUnknownEffect(
		ShareInstallationSnapshot,
		strict
	)(input).pipe(
		Effect.mapError(() =>
			ShareInstallationFailure.make({
				reason: 'invalid-record',
				message: 'The shared installation record is invalid.'
			})
		)
	);
	const entries = yield* Effect.forEach(snapshot.entries, validateShareInstallationRecord);
	if (new Set(entries.map((entry) => entry.shareId)).size !== entries.length) {
		return yield* Effect.fail(
			ShareInstallationFailure.make({
				reason: 'invalid-record',
				message: 'The shared installation record is invalid.'
			})
		);
	}
	return ShareInstallationSnapshot.make({
		formatVersion: 1,
		entries: sortEntries(entries)
	});
});

export interface ShareInstallationStoreShape {
	readonly snapshot: Effect.Effect<ShareInstallationSnapshot>;
	readonly changes: Stream.Stream<ShareInstallationSnapshot>;
	readonly get: (shareId: string) => Effect.Effect<ShareInstallationRecord | undefined>;
	readonly save: (record: ShareInstallationRecord) => Effect.Effect<void, ShareInstallationFailure>;
	readonly remove: (shareId: string) => Effect.Effect<void, ShareInstallationFailure>;
}

export class ShareInstallationStore extends Context.Service<
	ShareInstallationStore,
	ShareInstallationStoreShape
>()('flect/ShareInstallationStore') {}

export const makeShareInstallationStoreLayer = () =>
	Layer.effect(
		ShareInstallationStore,
		Effect.gen(function* () {
			const storage = yield* InterfaceStorage;
			const stored = yield* storage.read(STORAGE_KEY).pipe(Effect.result);
			const initial =
				stored._tag === 'Failure'
					? emptySnapshot('storage-unavailable')
					: stored.success === null
						? emptySnapshot()
						: yield* decodeStored(stored.success).pipe(
								Effect.orElseSucceed(() => emptySnapshot('invalid-record'))
							);
			const state = yield* SubscriptionRef.make(initial);

			const persist = (next: ShareInstallationSnapshot) =>
				storage
					.write(
						STORAGE_KEY,
						JSON.stringify(
							ShareInstallationSnapshot.make({
								formatVersion: 1,
								entries: sortEntries(next.entries)
							})
						)
					)
					.pipe(Effect.mapError(shareInstallationPersistenceFailure));

			const mutate = (
				change: (
					current: ShareInstallationSnapshot
				) => Effect.Effect<ShareInstallationSnapshot, ShareInstallationFailure>
			) =>
				SubscriptionRef.modifyEffect(state, (current) =>
					change(current).pipe(
						Effect.tap(persist),
						Effect.map((next) => [undefined, next] as const)
					)
				);

			const save = Effect.fn('Flect.ShareInstallationStore.save')(
				(input: ShareInstallationRecord) =>
					validateShareInstallationRecord(input).pipe(
						Effect.flatMap((record) =>
							mutate((current) => {
								const entries = current.entries.filter((entry) => entry.shareId !== record.shareId);
								entries.push(record);
								if (entries.length > 256) {
									return Effect.fail(
										ShareInstallationFailure.make({
											reason: 'persistence',
											message: 'Shared installation state could not be saved.'
										})
									);
								}
								return Effect.succeed(
									ShareInstallationSnapshot.make({
										formatVersion: 1,
										entries: sortEntries(entries)
									})
								);
							})
						)
					)
			);

			const remove = Effect.fn('Flect.ShareInstallationStore.remove')((shareId: string) =>
				mutate((current) =>
					Effect.succeed(
						ShareInstallationSnapshot.make({
							formatVersion: 1,
							entries: current.entries.filter((entry) => entry.shareId !== shareId)
						})
					)
				)
			);

			return {
				snapshot: SubscriptionRef.get(state),
				changes: SubscriptionRef.changes(state),
				get: (shareId) =>
					SubscriptionRef.get(state).pipe(
						Effect.map((snapshot) => snapshot.entries.find((entry) => entry.shareId === shareId))
					),
				save,
				remove
			} satisfies ShareInstallationStoreShape;
		})
	);
