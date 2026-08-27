import { assert, describe, it } from '@effect/vitest';
import { findInterfaceAction, projectInterfaceActions } from './interface-actions';
import { InterfaceDocument } from './interface-document';
import { InterfaceRevision, RevisionId, ShapingEvent, ShapingSnapshot } from './revisions';

const document = InterfaceDocument.make({
	version: 2,
	name: 'Actions',
	root: {
		id: 'root',
		type: 'stack',
		direction: 'column',
		gap: 'md',
		children: [
			{
				id: 'nested',
				type: 'stack',
				direction: 'row',
				gap: 'sm',
				children: [
					{
						id: 'shape-action',
						type: 'button',
						label: 'Shape',
						action: 'shape'
					},
					{
						id: 'accept-action',
						type: 'button',
						label: 'Accept',
						action: 'accept-revision'
					}
				]
			}
		]
	}
});

const revision = (id: string, status: 'accepted' | 'previewed') =>
	InterfaceRevision.make({
		version: 1,
		id: RevisionId.make(id),
		status,
		source: status === 'accepted' ? 'built-in' : 'shaper',
		document,
		createdAt: status === 'accepted' ? 0 : 1
	});

const lastEvent = (revisionId: RevisionId) =>
	ShapingEvent.make({
		version: 1,
		sequence: 0,
		type: 'initialized',
		revisionId
	});

describe('interface action projection', () => {
	it('walks nested buttons and reports availability from shaping state', () => {
		const active = revision('action-active', 'accepted');
		const actions = projectInterfaceActions(
			document,
			ShapingSnapshot.make({
				version: 1,
				active,
				lastKnownGood: active,
				proposal: revision('action-proposal', 'previewed'),
				safeMode: false,
				disabledExtensions: [],
				lastEvent: lastEvent(active.id)
			})
		);

		assert.deepStrictEqual(
			actions.map(({ nodeId, action, available }) => ({
				nodeId,
				action,
				available
			})),
			[
				{ nodeId: 'shape-action', action: 'shape', available: true },
				{
					nodeId: 'accept-action',
					action: 'accept-revision',
					available: true
				}
			]
		);
		assert.strictEqual(findInterfaceAction(actions, 'accept-action')?.label, 'Accept');
	});

	it('returns a definitive empty state and disables protected actions safely', () => {
		const active = revision('action-safe', 'accepted');
		assert.deepStrictEqual(
			projectInterfaceActions(
				InterfaceDocument.make({
					...document,
					root: {
						id: 'empty-root',
						type: 'stack',
						direction: 'column',
						gap: 'sm',
						children: []
					}
				}),
				ShapingSnapshot.make({
					version: 1,
					active,
					lastKnownGood: active,
					safeMode: false,
					disabledExtensions: [],
					lastEvent: lastEvent(active.id)
				})
			),
			[]
		);

		const [shape] = projectInterfaceActions(
			document,
			ShapingSnapshot.make({
				version: 1,
				active,
				lastKnownGood: active,
				safeMode: true,
				disabledExtensions: [],
				lastEvent: lastEvent(active.id)
			})
		);
		assert.strictEqual(shape?.available, false);
		assert.strictEqual(shape?.unavailableReason, 'Leave safe mode first.');
	});
});
