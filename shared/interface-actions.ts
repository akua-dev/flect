import { Schema } from 'effect';
import { InterfaceAction, type InterfaceDocument, type InterfaceNode } from './interface-document';
import type { ShapingSnapshot } from './revisions';

const NodeId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(64),
	Schema.isPattern(/^[a-z][a-z0-9-]*$/)
);

export class InterfaceActionProjection extends Schema.Class<InterfaceActionProjection>(
	'InterfaceActionProjection'
)({
	nodeId: NodeId,
	label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	action: InterfaceAction,
	available: Schema.Boolean,
	unavailableReason: Schema.optionalKey(
		Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160))
	)
}) {}

const unavailableReason = (
	action: InterfaceAction,
	shaping: ShapingSnapshot
): string | undefined => {
	if (shaping.safeMode) {
		return 'Leave safe mode first.';
	}
	switch (action) {
		case 'shape':
		case 'safe-mode':
			return undefined;
		case 'accept-revision':
		case 'reject-revision':
			return shaping.proposal === undefined
				? 'There is no interface proposal to decide.'
				: undefined;
		case 'rollback-revision':
			return shaping.active.id === shaping.lastKnownGood.id
				? 'There is no earlier accepted revision to restore.'
				: undefined;
	}
};

export const projectInterfaceActions = (
	document: InterfaceDocument,
	shaping: ShapingSnapshot
): ReadonlyArray<InterfaceActionProjection> => {
	const actions: Array<InterfaceActionProjection> = [];
	const pending: Array<InterfaceNode> = [document.root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			continue;
		}
		if (node.type === 'stack') {
			for (let index = node.children.length - 1; index >= 0; index -= 1) {
				const child = node.children[index];
				if (child !== undefined) {
					pending.push(child);
				}
			}
			continue;
		}
		if (node.type === 'button') {
			const reason = unavailableReason(node.action, shaping);
			actions.push(
				InterfaceActionProjection.make({
					nodeId: node.id,
					label: node.label,
					action: node.action,
					available: reason === undefined,
					...(reason === undefined ? {} : { unavailableReason: reason })
				})
			);
		}
	}
	return actions;
};

export const findInterfaceAction = (
	actions: ReadonlyArray<InterfaceActionProjection>,
	nodeId: string
) => actions.find((action) => action.nodeId === nodeId);
