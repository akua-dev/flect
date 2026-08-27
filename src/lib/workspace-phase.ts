import { Schema } from 'effect';
import type { ShapingSnapshot } from '../../shared/revisions';

export const WorkspacePhase = Schema.Literals(['blank', 'preview', 'accepted', 'safe']);
export type WorkspacePhase = typeof WorkspacePhase.Type;

export const workspacePhase = (
	snapshot: ShapingSnapshot,
	explicitSafeMode: boolean
): WorkspacePhase => {
	if (explicitSafeMode || snapshot.safeMode) {
		return 'safe';
	}
	if (snapshot.proposal?.status === 'previewed') {
		return 'preview';
	}
	return snapshot.active.source === 'built-in' ? 'blank' : 'accepted';
};
