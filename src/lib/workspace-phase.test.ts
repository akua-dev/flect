import { describe, expect, it } from 'vitest';
import { defaultInterfaceDocument, InterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import { workspacePhase } from './workspace-phase';

const customizedDocument = InterfaceDocument.make({
	version: 2,
	name: 'Projects',
	root: {
		id: 'root',
		type: 'text',
		text: 'Projects',
		style: 'headline'
	}
});

const revision = (id: string, source: InterfaceRevision['source'], document = customizedDocument) =>
	InterfaceRevision.make({
		version: 1,
		id: RevisionId.make(id),
		status: 'accepted',
		source,
		document,
		createdAt: id === 'built-in' ? 0 : 1
	});

const builtIn = revision('built-in', 'built-in', defaultInterfaceDocument);

const snapshot = (
	active: InterfaceRevision,
	options: {
		readonly proposal?: InterfaceRevision;
		readonly safeMode?: boolean;
	} = {}
) =>
	ShapingSnapshot.make({
		version: 1,
		active,
		lastKnownGood: active,
		...(options.proposal === undefined ? {} : { proposal: options.proposal }),
		safeMode: options.safeMode ?? false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: active.id === 'built-in' ? 0 : 1,
			type: active.id === 'built-in' ? 'initialized' : 'revision-accepted',
			revisionId: active.id
		})
	});

describe('workspacePhase', () => {
	it('routes the built-in workspace to blank Edit mode', () => {
		expect(workspacePhase(snapshot(builtIn), false)).toBe('blank');
	});

	it('routes an accepted custom revision to Run mode', () => {
		expect(workspacePhase(snapshot(revision('revision-1', 'shaper')), false)).toBe('accepted');
	});

	it('keeps an unresolved preview in Edit mode', () => {
		const proposal = InterfaceRevision.make({
			version: 1,
			id: RevisionId.make('revision-2'),
			parentId: builtIn.id,
			status: 'previewed',
			source: 'shaper',
			document: customizedDocument,
			createdAt: 2
		});

		expect(workspacePhase(snapshot(builtIn, { proposal }), false)).toBe('preview');
	});

	it('gives explicit and persisted safe mode precedence', () => {
		const accepted = snapshot(revision('revision-1', 'shaper'));
		expect(workspacePhase(accepted, true)).toBe('safe');
		expect(
			workspacePhase(snapshot(revision('revision-1', 'shaper'), { safeMode: true }), false)
		).toBe('safe');
	});
});
