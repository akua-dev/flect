import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import { defaultInterfaceDocument, InterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import {
	InterfaceRepository,
	makeInterfaceRepositoryLayer,
	REVISION_JOURNAL_KEY
} from './interface-repository';
import { InterfaceStorage, InterfaceStorageError } from './interface-store';
import {
	makePersistentShapingKernelLayer,
	makeShapingKernelTestLayer,
	ShapingKernel
} from './shaping-kernel';

const customizedDocument = (headline: string) =>
	InterfaceDocument.make({
		version: 2,
		name: headline,
		root: {
			id: 'root',
			type: 'stack',
			direction: 'column',
			gap: 'lg',
			children: [
				{
					id: 'headline',
					type: 'text',
					text: headline,
					style: 'headline'
				},
				{
					id: 'prompt',
					type: 'prompt',
					placeholder: 'Describe what to shape'
				}
			]
		}
	});

const makePersistentHarness = (initial: string | null = null) => {
	const values = new Map<string, string>();
	if (initial !== null) values.set(REVISION_JOURNAL_KEY, initial);
	const stored = Ref.makeUnsafe(values);
	const storage = Layer.succeed(InterfaceStorage)({
		read: (key) => Ref.get(stored).pipe(Effect.map((current) => current.get(key) ?? null)),
		write: (key, value) => Ref.update(stored, (current) => new Map(current).set(key, value)),
		remove: (key) =>
			Ref.update(stored, (current) => {
				const next = new Map(current);
				next.delete(key);
				return next;
			})
	});
	const repository = makeInterfaceRepositoryLayer({
		safeMode: false
	}).pipe(Layer.provide(storage));

	return makePersistentShapingKernelLayer({
		nextId: (() => {
			let sequence = 0;
			return () => {
				sequence += 1;
				return `revision-${sequence}`;
			};
		})(),
		now: () => 1
	}).pipe(Layer.provideMerge(repository));
};

const makeFailingRepairHarness = (initial: string) => {
	const storage = Layer.succeed(InterfaceStorage)({
		read: (key) => Effect.succeed(key === REVISION_JOURNAL_KEY ? initial : null),
		write: () =>
			Effect.fail(
				new InterfaceStorageError({
					message: 'Interface storage is unavailable.'
				})
			),
		remove: () => Effect.void
	});
	const repository = makeInterfaceRepositoryLayer({
		safeMode: false
	}).pipe(Layer.provide(storage));

	return makePersistentShapingKernelLayer().pipe(Layer.provideMerge(repository));
};

describe('ShapingKernel', () => {
	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('commits a local edit in one accepted transition', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const document = customizedDocument('Continuous live canvas');
				const accepted = yield* kernel.applyLocalRevision(document, 'shaper');
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(accepted.status, 'accepted');
				assert.deepStrictEqual(snapshot.active.document, document);
				assert.deepStrictEqual(snapshot.lastKnownGood.document, defaultInterfaceDocument);
				assert.isUndefined(snapshot.proposal);
				assert.strictEqual(snapshot.lastEvent.type, 'revision-accepted');
				assert.strictEqual(snapshot.lastEvent.sequence, 1);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('proposes without changing the active interface', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const proposal = yield* kernel.propose(customizedDocument('A focused workspace'), 'shaper');
				const snapshot = yield* kernel.snapshot;

				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.proposal?.id, proposal.id);
				assert.strictEqual(snapshot.proposal?.status, 'proposed');
				assert.strictEqual(snapshot.lastEvent.type, 'revision-proposed');
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('rejects proposals after safe mode wins the race', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				yield* kernel.enterSafeMode;

				const error = yield* kernel
					.propose(customizedDocument('Unsafe replacement'), 'shaper')
					.pipe(Effect.flip);
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(error._tag, 'InvalidRevisionTransition');
				assert.strictEqual(snapshot.safeMode, true);
				assert.strictEqual(snapshot.proposal, undefined);
				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('preserves an undecided proposal instead of replacing it', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const first = yield* kernel.propose(customizedDocument('First proposal'), 'shaper');
				yield* kernel.preview(first.id);

				const error = yield* kernel
					.propose(customizedDocument('Second proposal'), 'shaper')
					.pipe(Effect.flip);
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(error._tag, 'InvalidRevisionTransition');
				assert.strictEqual(snapshot.proposal?.id, first.id);
				assert.strictEqual(snapshot.proposal?.status, 'previewed');
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('atomically supersedes a preview without changing accepted state', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const first = yield* kernel.propose(customizedDocument('First candidate'), 'shaper');
				yield* kernel.preview(first.id);

				const second = yield* kernel.supersede(
					first.id,
					customizedDocument('Corrected candidate'),
					'shaper'
				);
				const snapshot = yield* kernel.snapshot;

				assert.notStrictEqual(second.id, first.id);
				assert.strictEqual(second.status, 'previewed');
				assert.strictEqual(snapshot.proposal?.id, second.id);
				assert.strictEqual(snapshot.proposal?.document.name, 'Corrected candidate');
				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.lastEvent.type, 'revision-previewed');
				assert.strictEqual(snapshot.lastEvent.revisionId, second.id);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('preserves the current candidate after stale or invalid supersede', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const first = yield* kernel.propose(customizedDocument('Stable candidate'), 'shaper');
				yield* kernel.preview(first.id);

				const stale = yield* kernel
					.supersede(
						RevisionId.make('revision-stale'),
						customizedDocument('Stale candidate'),
						'shaper'
					)
					.pipe(Effect.flip);
				const invalid = yield* kernel
					.supersede(first.id, { executable: '<script />' }, 'shaper')
					.pipe(Effect.flip);
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(stale._tag, 'RevisionNotFound');
				assert.strictEqual(invalid._tag, 'InvalidInterfaceDocument');
				assert.strictEqual(snapshot.proposal?.id, first.id);
				assert.strictEqual(snapshot.proposal?.document.name, 'Stable candidate');
			})
		);
	});

	const pendingProposalSnapshot = ShapingSnapshot.make({
		version: 1,
		active: InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('built-in'),
			status: 'accepted',
			source: 'built-in',
			document: defaultInterfaceDocument,
			createdAt: 0
		}),
		lastKnownGood: InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('built-in'),
			status: 'accepted',
			source: 'built-in',
			document: defaultInterfaceDocument,
			createdAt: 0
		}),
		proposal: InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-1'),
			parentId: RevisionId.make('built-in'),
			status: 'proposed',
			source: 'shaper',
			document: customizedDocument('Pending workspace'),
			createdAt: 1
		}),
		safeMode: false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 1,
			type: 'revision-proposed',
			revisionId: RevisionId.make('revision-1')
		})
	});

	it.layer(makePersistentHarness(JSON.stringify(pendingProposalSnapshot)))((it) => {
		it.effect('reconciles a persisted proposal into a visible preview', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const snapshot = yield* kernel.snapshot;
				const repository = yield* InterfaceRepository;
				const persisted = yield* repository.load;

				assert.strictEqual(snapshot.proposal?.status, 'previewed');
				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.lastEvent.type, 'revision-previewed');
				assert.strictEqual(snapshot.lastEvent.sequence, 2);
				assert.deepStrictEqual(persisted.snapshot, snapshot);
			})
		);
	});

	it.layer(makeFailingRepairHarness(JSON.stringify(pendingProposalSnapshot)))((it) => {
		it.effect('keeps recovery available when proposal repair cannot persist', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(snapshot.proposal?.status, 'previewed');
				assert.strictEqual(snapshot.lastEvent.type, 'revision-previewed');
				assert.strictEqual(snapshot.lastEvent.sequence, 2);
			})
		);
	});

	const restoredDocument = customizedDocument('Restored workspace');
	const restoredSnapshot = ShapingSnapshot.make({
		version: 1,
		active: InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-2'),
			parentId: RevisionId.make('revision-1'),
			status: 'accepted',
			source: 'shaper',
			document: restoredDocument,
			createdAt: 2
		}),
		lastKnownGood: InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-1'),
			status: 'accepted',
			source: 'user',
			document: defaultInterfaceDocument,
			createdAt: 1
		}),
		safeMode: false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 4,
			type: 'revision-accepted',
			revisionId: RevisionId.make('revision-2')
		})
	});

	it.layer(makePersistentHarness(JSON.stringify(restoredSnapshot)))((it) => {
		it.effect('restores the active and last-known-good journal state', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const snapshot = yield* kernel.snapshot;

				assert.deepStrictEqual(snapshot.active.document, restoredDocument);
				assert.deepStrictEqual(snapshot.lastKnownGood.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.lastEvent.sequence, 4);
			})
		);
	});

	const safeModeRestoredSnapshot = ShapingSnapshot.make({
		version: restoredSnapshot.version,
		active: restoredSnapshot.active,
		lastKnownGood: restoredSnapshot.lastKnownGood,
		safeMode: true,
		disabledExtensions: restoredSnapshot.disabledExtensions,
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 5,
			type: 'safe-mode-entered',
			revisionId: restoredSnapshot.active.id
		})
	});

	it.layer(makePersistentHarness(JSON.stringify(safeModeRestoredSnapshot)))((it) => {
		it.effect('restores safe mode on the built-in document', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const snapshot = yield* kernel.snapshot;

				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.deepStrictEqual(snapshot.lastKnownGood.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.safeMode, true);
				assert.strictEqual(snapshot.proposal, undefined);
				assert.strictEqual(snapshot.lastEvent.type, 'safe-mode-entered');
				assert.strictEqual(snapshot.lastEvent.revisionId, 'built-in');
			})
		);
	});

	it.layer(makePersistentHarness())((it) => {
		it.effect('persists accepted revisions as one journal transaction', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const repository = yield* InterfaceRepository;
				const proposal = yield* kernel.propose(customizedDocument('Persisted workspace'), 'shaper');
				yield* kernel.preview(proposal.id);
				yield* kernel.accept(proposal.id);

				const current = yield* kernel.snapshot;
				const persisted = yield* repository.load;

				assert.deepStrictEqual(persisted.snapshot, current);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('previews and accepts a validated proposal atomically', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const document = customizedDocument('A focused workspace');
				const proposal = yield* kernel.propose(document, 'shaper');

				yield* kernel.preview(proposal.id);
				const preview = yield* kernel.snapshot;
				assert.strictEqual(preview.proposal?.status, 'previewed');
				assert.deepStrictEqual(preview.active.document, defaultInterfaceDocument);

				const accepted = yield* kernel.accept(proposal.id);
				const snapshot = yield* kernel.snapshot;
				assert.strictEqual(accepted.status, 'accepted');
				assert.deepStrictEqual(snapshot.active.document, document);
				assert.strictEqual(snapshot.proposal, undefined);
				assert.deepStrictEqual(snapshot.lastKnownGood.document, defaultInterfaceDocument);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('rejects a proposal without changing the active interface', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const proposal = yield* kernel.propose(customizedDocument('Rejected'), 'user');

				yield* kernel.reject(proposal.id);
				const snapshot = yield* kernel.snapshot;

				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.proposal, undefined);
				assert.strictEqual(snapshot.lastEvent.type, 'revision-rejected');
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('rejects rollback while a proposal is undecided', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const first = yield* kernel.propose(customizedDocument('First'), 'user');
				yield* kernel.preview(first.id);
				yield* kernel.accept(first.id);
				const second = yield* kernel.propose(customizedDocument('Second'), 'shaper');
				yield* kernel.preview(second.id);

				const error = yield* kernel.rollback.pipe(Effect.flip);
				const snapshot = yield* kernel.snapshot;

				assert.strictEqual(error._tag, 'InvalidRevisionTransition');
				assert.deepStrictEqual(snapshot.active.document, customizedDocument('First'));
				assert.strictEqual(snapshot.proposal?.id, second.id);
				assert.strictEqual(snapshot.proposal?.status, 'previewed');
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('rolls back to the last-known-good interface', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;
				const firstDocument = customizedDocument('First');
				const first = yield* kernel.propose(firstDocument, 'user');
				yield* kernel.preview(first.id);
				yield* kernel.accept(first.id);

				const second = yield* kernel.propose(customizedDocument('Second'), 'shaper');
				yield* kernel.preview(second.id);
				yield* kernel.accept(second.id);
				yield* kernel.rollback;

				const snapshot = yield* kernel.snapshot;
				assert.deepStrictEqual(snapshot.active.document, firstDocument);
				assert.deepStrictEqual(snapshot.lastKnownGood.document, firstDocument);
				assert.strictEqual(snapshot.safeMode, false);
				assert.strictEqual(snapshot.lastEvent.type, 'revision-rolled-back');

				yield* kernel.enterSafeMode;
				const recovered = yield* kernel.snapshot;
				assert.deepStrictEqual(recovered.active.document, defaultInterfaceDocument);
				assert.deepStrictEqual(recovered.lastKnownGood.document, firstDocument);

				yield* kernel.restoreLastKnownGood;
				const restored = yield* kernel.snapshot;
				assert.deepStrictEqual(restored.active.document, firstDocument);
				assert.strictEqual(restored.safeMode, false);
			})
		);
	});

	it.layer(makeShapingKernelTestLayer())((it) => {
		it.effect('requests recovery once after three consecutive extension failures', () =>
			Effect.gen(function* () {
				const kernel = yield* ShapingKernel;

				yield* kernel.recordExtensionFailure('weather-card');
				yield* kernel.recordExtensionSuccess('weather-card');
				yield* kernel.recordExtensionFailure('weather-card');
				yield* kernel.recordExtensionFailure('weather-card');
				const beforeThreshold = yield* kernel.snapshot;

				assert.strictEqual(beforeThreshold.safeMode, false);

				yield* kernel.recordExtensionFailure('weather-card');

				const snapshot = yield* kernel.snapshot;
				assert.strictEqual(snapshot.safeMode, true);
				assert.deepStrictEqual(snapshot.disabledExtensions, ['weather-card']);
				assert.deepStrictEqual(snapshot.active.document, defaultInterfaceDocument);
				assert.strictEqual(snapshot.lastEvent.type, 'recovery-requested');

				const recoverySequence = snapshot.lastEvent.sequence;
				yield* kernel.recordExtensionFailure('weather-card');
				const repeated = yield* kernel.snapshot;

				assert.strictEqual(repeated.lastEvent.sequence, recoverySequence);
				assert.strictEqual(repeated.lastEvent.type, 'recovery-requested');
			})
		);
	});
});
