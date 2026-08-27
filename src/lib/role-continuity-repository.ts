import { Context, Effect, Layer, Schema, Semaphore } from 'effect';
import {
	type ContinuityRecoveryReason,
	decodeRoleContinuityRecord,
	encodeRoleContinuityRecord,
	type InvalidRoleContinuity,
	RoleContinuityRecord,
	type RoleContinuityTooLarge
} from '../../shared/role-continuity';
import { InterfaceStorage, type InterfaceStorageError } from './interface-store';

const ROLE_CONTINUITY_KEY = 'flect.role-continuity.v1';
const ROLE_CONTINUITY_LOCK = 'flect.role-continuity';

export class ContinuityConflict extends Schema.TaggedErrorClass<ContinuityConflict>()(
	'ContinuityConflict',
	{
		message: Schema.Literal('Role continuity changed before this update could be saved.'),
		expectedGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		currentGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
	}
) {}

export class ContinuityBlocked extends Schema.TaggedErrorClass<ContinuityBlocked>()(
	'ContinuityBlocked',
	{
		message: Schema.Literal('Recover or discard the saved role continuity before replacing it.'),
		reason: Schema.Literals(['corrupt-record', 'incompatible-record'])
	}
) {}

export type RoleContinuityLoad =
	| { readonly status: 'empty' }
	| {
			readonly status: 'ready';
			readonly record: RoleContinuityRecord;
	  }
	| {
			readonly status: 'recovery';
			readonly reason: ContinuityRecoveryReason;
	  };

export type RoleContinuitySaveError =
	| InterfaceStorageError
	| InvalidRoleContinuity
	| RoleContinuityTooLarge
	| ContinuityConflict
	| ContinuityBlocked;

export interface ContinuityLockShape {
	readonly exclusive: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

export class ContinuityLock extends Context.Service<ContinuityLock, ContinuityLockShape>()(
	'flect/ContinuityLock'
) {}

export interface RoleContinuityRepositoryShape {
	readonly load: Effect.Effect<RoleContinuityLoad>;
	readonly save: (
		expectedGeneration: number,
		record: RoleContinuityRecord
	) => Effect.Effect<RoleContinuityRecord, RoleContinuitySaveError>;
	readonly discard: Effect.Effect<void, InterfaceStorageError>;
	readonly export: Effect.Effect<
		string,
		InterfaceStorageError | InvalidRoleContinuity | RoleContinuityTooLarge
	>;
}

export class RoleContinuityRepository extends Context.Service<
	RoleContinuityRepository,
	RoleContinuityRepositoryShape
>()('flect/RoleContinuityRepository') {}

const recoveryReason = (raw: string): 'corrupt-record' | 'incompatible-record' => {
	try {
		const input: unknown = JSON.parse(raw);
		return typeof input === 'object' && input !== null && 'version' in input && input.version !== 1
			? 'incompatible-record'
			: 'corrupt-record';
	} catch {
		return 'corrupt-record';
	}
};

export const makeRoleContinuityRepositoryLayer = Layer.effect(
	RoleContinuityRepository,
	Effect.gen(function* () {
		const storage = yield* InterfaceStorage;
		const lock = yield* ContinuityLock;

		const load = Effect.fn('Flect.RoleContinuityRepository.load')(() =>
			storage.read(ROLE_CONTINUITY_KEY).pipe(
				Effect.flatMap((raw): Effect.Effect<RoleContinuityLoad> => {
					if (raw === null) {
						return Effect.succeed({ status: 'empty' });
					}
					return decodeRoleContinuityRecord(raw).pipe(
						Effect.map((record): RoleContinuityLoad => ({ status: 'ready', record })),
						Effect.catch(() =>
							Effect.succeed({
								status: 'recovery' as const,
								reason: recoveryReason(raw)
							})
						)
					);
				}),
				Effect.catchTag('InterfaceStorageError', () =>
					Effect.succeed({
						status: 'recovery' as const,
						reason: 'storage-unavailable' as const
					})
				)
			)
		);

		const save = Effect.fn('Flect.RoleContinuityRepository.save')(
			(expectedGeneration: number, proposed: RoleContinuityRecord) =>
				lock.exclusive(
					Effect.gen(function* () {
						const raw = yield* storage.read(ROLE_CONTINUITY_KEY);
						let currentGeneration = 0;
						if (raw !== null) {
							const current = yield* decodeRoleContinuityRecord(raw).pipe(
								Effect.mapError(() =>
									ContinuityBlocked.make({
										message: 'Recover or discard the saved role continuity before replacing it.',
										reason: recoveryReason(raw)
									})
								)
							);
							currentGeneration = current.generation;
						}
						if (currentGeneration !== expectedGeneration) {
							return yield* Effect.fail(
								ContinuityConflict.make({
									message: 'Role continuity changed before this update could be saved.',
									expectedGeneration,
									currentGeneration
								})
							);
						}

						const next = RoleContinuityRecord.make({
							...proposed,
							generation: currentGeneration + 1
						});
						const encoded = yield* encodeRoleContinuityRecord(next);
						yield* storage.write(ROLE_CONTINUITY_KEY, encoded);
						return next;
					})
				)
		);

		return {
			load: load(),
			save,
			discard: lock.exclusive(storage.remove(ROLE_CONTINUITY_KEY)),
			export: lock.exclusive(
				storage.read(ROLE_CONTINUITY_KEY).pipe(
					Effect.flatMap((raw) =>
						raw === null
							? encodeRoleContinuityRecord(
									// A missing record has no private state to disclose.
									RoleContinuityRecord.make({
										version: 1,
										generation: 0,
										revisionSequence: 0,
										drafts: {
											acceptedUse: '',
											candidateUse: '',
											shape: ''
										},
										app: [],
										previewApp: [],
										shaper: []
									})
								)
							: decodeRoleContinuityRecord(raw).pipe(Effect.flatMap(encodeRoleContinuityRecord))
					)
				)
			)
		};
	})
);

export const makeContinuityLockLayer = (locks: LockManager | undefined) =>
	Layer.effect(
		ContinuityLock,
		Effect.gen(function* () {
			const fallbackPermit = yield* Semaphore.make(1);

			return {
				exclusive: <A, E>(effect: Effect.Effect<A, E>) => {
					if (locks === undefined) {
						return fallbackPermit.withPermits(1)(effect);
					}
					return Effect.tryPromise({
						try: (signal) =>
							locks.request(ROLE_CONTINUITY_LOCK, { mode: 'exclusive', signal }, () =>
								Effect.runPromiseExit(effect, { signal })
							),
						catch: (error) =>
							error instanceof Error ? error : new Error('The role continuity lock failed.')
					}).pipe(
						Effect.orDie,
						Effect.flatMap((exit) =>
							exit._tag === 'Success' ? Effect.succeed(exit.value) : Effect.failCause(exit.cause)
						)
					);
				}
			};
		})
	);

export const ContinuityLockLive = makeContinuityLockLayer(globalThis.navigator?.locks);
