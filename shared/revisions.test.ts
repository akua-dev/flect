import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { defaultInterfaceDocument } from './interface-document';
import {
	InterfaceRevision,
	isRollbackAvailable,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot,
	validateInterfaceRevision,
	validateShapingSnapshot
} from './revisions';

const revision = (status: 'proposed' | 'previewed' | 'accepted' | 'rejected') =>
	({
		version: 1,
		id: 'revision-1',
		parentId: 'revision-0',
		status,
		source: 'shaper',
		document: defaultInterfaceDocument,
		createdAt: 1
	}) as const;

const deeplyNestedDocument = (depth: number) => {
	let node: unknown = {
		id: 'leaf',
		type: 'text',
		text: 'Too deep',
		style: 'body'
	};

	for (let index = 0; index < depth; index += 1) {
		node = {
			id: `stack-${index}`,
			type: 'stack',
			direction: 'column',
			gap: 'sm',
			children: [node]
		};
	}

	return {
		version: 2,
		name: 'Pathological depth',
		root: node
	};
};

describe('interface revisions', () => {
	it.effect('decodes a schema-defined immutable revision', () =>
		Effect.gen(function* () {
			const decoded = yield* validateInterfaceRevision(revision('proposed'));

			assert.instanceOf(decoded, InterfaceRevision);
			assert.strictEqual(decoded.id, RevisionId.make('revision-1'));
			assert.strictEqual(decoded.status, 'proposed');
		})
	);

	it.effect('rejects credentials and provider payloads in revision records', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				validateInterfaceRevision({
					...revision('proposed'),
					apiKey: 'must-never-land-here'
				})
			);

			assert.strictEqual(error._tag, 'InvalidRevision');
			assert.notInclude(error.message, 'must-never-land-here');
		})
	);

	it.effect('rejects pathological proposal depth before recursive journal decoding', () =>
		Effect.gen(function* () {
			const builtIn = {
				version: 1 as const,
				id: 'built-in',
				status: 'accepted' as const,
				source: 'built-in' as const,
				document: defaultInterfaceDocument,
				createdAt: 0
			};
			const error = yield* Effect.flip(
				validateShapingSnapshot({
					version: 1,
					active: builtIn,
					lastKnownGood: builtIn,
					proposal: {
						...revision('proposed'),
						parentId: 'built-in',
						document: deeplyNestedDocument(2_000)
					},
					safeMode: false,
					disabledExtensions: [],
					lastEvent: {
						version: 1,
						sequence: 1,
						type: 'revision-proposed',
						revisionId: 'revision-1'
					}
				})
			);

			assert.strictEqual(error._tag, 'InvalidRevision');
		})
	);

	it.effect('rejects built-in revisions outside the exact initial revision', () =>
		Effect.gen(function* () {
			const initial = InterfaceRevision.make({
				version: 1,
				id: RevisionId.make('built-in'),
				status: 'accepted',
				source: 'built-in',
				document: defaultInterfaceDocument,
				createdAt: 0
			});
			const forged = InterfaceRevision.make({
				version: 1,
				id: RevisionId.make('revision-1'),
				parentId: initial.id,
				status: 'accepted',
				source: 'built-in',
				document: defaultInterfaceDocument,
				createdAt: 1
			});
			const validActive = InterfaceRevision.make({
				version: 1,
				id: RevisionId.make('revision-2'),
				parentId: forged.id,
				status: 'accepted',
				source: 'shaper',
				document: defaultInterfaceDocument,
				createdAt: 2
			});
			const activeForged = ShapingSnapshot.make({
				version: 1,
				active: forged,
				lastKnownGood: initial,
				safeMode: false,
				disabledExtensions: [],
				lastEvent: ShapingEvent.make({
					version: 1,
					sequence: 1,
					type: 'revision-accepted',
					revisionId: forged.id
				})
			});
			const lastKnownGoodForged = ShapingSnapshot.make({
				version: 1,
				active: validActive,
				lastKnownGood: forged,
				safeMode: false,
				disabledExtensions: [],
				lastEvent: ShapingEvent.make({
					version: 1,
					sequence: 1,
					type: 'revision-accepted',
					revisionId: validActive.id
				})
			});

			const activeError = yield* Effect.flip(validateShapingSnapshot(activeForged));
			const lastKnownGoodError = yield* Effect.flip(validateShapingSnapshot(lastKnownGoodForged));

			assert.strictEqual(activeError._tag, 'InvalidRevision');
			assert.strictEqual(lastKnownGoodError._tag, 'InvalidRevision');
		})
	);

	it.effect('rejects impossible safe-mode event and state combinations', () =>
		Effect.gen(function* () {
			const initial = {
				version: 1 as const,
				id: 'built-in',
				status: 'accepted' as const,
				source: 'built-in' as const,
				document: defaultInterfaceDocument,
				createdAt: 0
			};
			const custom = {
				version: 1 as const,
				id: 'revision-1',
				parentId: 'built-in',
				status: 'accepted' as const,
				source: 'shaper' as const,
				document: defaultInterfaceDocument,
				createdAt: 1
			};
			const invalidSnapshots = [
				{
					version: 1 as const,
					active: custom,
					lastKnownGood: initial,
					safeMode: false,
					disabledExtensions: [],
					lastEvent: {
						version: 1 as const,
						sequence: 2,
						type: 'safe-mode-entered' as const,
						revisionId: 'built-in'
					}
				},
				{
					version: 1 as const,
					active: custom,
					lastKnownGood: custom,
					safeMode: true,
					disabledExtensions: ['weather-card'],
					lastEvent: {
						version: 1 as const,
						sequence: 3,
						type: 'recovery-requested' as const,
						revisionId: 'revision-1',
						extensionId: 'weather-card'
					}
				}
			];

			const errors = yield* Effect.forEach(invalidSnapshots, (snapshot) =>
				validateShapingSnapshot(snapshot).pipe(Effect.flip)
			);

			assert.deepStrictEqual(
				errors.map((error) => error._tag),
				['InvalidRevision', 'InvalidRevision']
			);
		})
	);

	it('only offers rollback for an accepted customization without a pending proposal', () => {
		const builtIn = InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('built-in'),
			status: 'accepted',
			source: 'built-in',
			document: defaultInterfaceDocument,
			createdAt: 0
		});
		const custom = InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-1'),
			parentId: builtIn.id,
			status: 'accepted',
			source: 'shaper',
			document: defaultInterfaceDocument,
			createdAt: 1
		});
		const proposed = InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-2'),
			parentId: custom.id,
			status: 'proposed',
			source: 'shaper',
			document: defaultInterfaceDocument,
			createdAt: 2
		});
		const snapshot = (
			active: InterfaceRevision,
			lastKnownGood: InterfaceRevision,
			options?: {
				readonly proposal?: InterfaceRevision;
				readonly safeMode?: boolean;
			}
		) =>
			ShapingSnapshot.make({
				version: 1,
				active,
				lastKnownGood,
				...(options?.proposal === undefined ? {} : { proposal: options.proposal }),
				safeMode: options?.safeMode ?? false,
				disabledExtensions: [],
				lastEvent: ShapingEvent.make({
					version: 1,
					sequence: 1,
					type: 'revision-accepted',
					revisionId: active.id
				})
			});

		assert.isFalse(isRollbackAvailable(snapshot(builtIn, builtIn)));
		assert.isTrue(isRollbackAvailable(snapshot(custom, builtIn)));
		assert.isFalse(isRollbackAvailable(snapshot(custom, builtIn, { proposal: proposed })));
		assert.isFalse(isRollbackAvailable(snapshot(builtIn, builtIn, { safeMode: true })));
		assert.isFalse(isRollbackAvailable(snapshot(custom, custom)));
	});
});
