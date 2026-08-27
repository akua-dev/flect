import { describe, expect, it } from '@effect/vitest';
import {
	AgentWorkspaceSnapshot,
	ConversationMessage,
	RoleConversationSnapshot,
	UserCommandSource
} from '../../shared/control';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import {
	ContinuityDrafts,
	ContinuityMessage,
	emptyRoleContinuityRecord,
	RoleContinuityRecord
} from '../../shared/role-continuity';
import { projectAgentContinuity, restoreAgentContinuity } from './role-continuity';

const source = UserCommandSource.make({ kind: 'user' });

const conversation = (role: 'app' | 'shaper', status: 'ready' | 'streaming', prefix: string) =>
	RoleConversationSnapshot.make({
		role,
		status,
		messages: [
			ConversationMessage.make({
				version: 1,
				id: `${prefix}-user`,
				turnId: `operation-${prefix}-turn-0001`,
				role: 'user',
				content: `${prefix} question`,
				createdAt: 1,
				source
			}),
			ConversationMessage.make({
				version: 1,
				id: `${prefix}-assistant`,
				turnId: `operation-${prefix}-turn-0001`,
				role: 'assistant',
				content: `${prefix} partial answer`,
				createdAt: 2,
				source
			})
		],
		activities: [],
		lastPrompt: `${prefix} question`
	});

const agent = AgentWorkspaceSnapshot.make({
	models: [],
	favoriteModels: [],
	externalExtensions: { app: false, shaper: false },
	app: conversation('app', 'ready', 'app'),
	previewApp: conversation('app', 'ready', 'preview'),
	shaper: conversation('shaper', 'streaming', 'shape')
});

const builtIn = InterfaceRevision.make({
	version: 1,
	id: RevisionId.make('built-in'),
	status: 'accepted',
	source: 'built-in',
	document: defaultInterfaceDocument,
	createdAt: 0
});

const initialized = ShapingEvent.make({
	version: 1,
	sequence: 0,
	type: 'initialized',
	revisionId: builtIn.id
});

const shaping = (candidateId?: string) =>
	ShapingSnapshot.make({
		version: 1,
		active: builtIn,
		lastKnownGood: builtIn,
		...(candidateId === undefined
			? {}
			: {
					proposal: {
						...builtIn,
						id: RevisionId.make(candidateId),
						parentId: builtIn.id,
						source: 'shaper' as const,
						status: 'previewed' as const,
						createdAt: 2
					}
				}),
		safeMode: false,
		disabledExtensions: [],
		lastEvent: initialized
	});

describe('role continuity projection', () => {
	it('preserves typed turn identity across durable projection and restore', () => {
		const projected = projectAgentContinuity(
			agent,
			shaping('revision-candidate'),
			emptyRoleContinuityRecord(0)
		);
		const restored = restoreAgentContinuity(agent, projected, shaping());

		expect(projected.app.map((message) => message.turnId)).toEqual([
			'operation-app-turn-0001',
			'operation-app-turn-0001'
		]);
		expect(restored.app.messages.map((message) => message.turnId)).toEqual([
			'operation-app-turn-0001',
			'operation-app-turn-0001'
		]);
	});

	it('persists completed projections and omits an active partial assistant', () => {
		const projected = projectAgentContinuity(
			agent,
			shaping('revision-candidate'),
			emptyRoleContinuityRecord(0)
		);

		expect(projected.app.map((message) => message.content)).toEqual([
			'app question',
			'app partial answer'
		]);
		expect(projected.previewApp.map((message) => message.content)).toEqual([
			'preview question',
			'preview partial answer'
		]);
		expect(projected.shaper.map((message) => message.content)).toEqual(['shape question']);
		expect(projected.candidateRevisionId).toBe('revision-candidate');
		expect(JSON.stringify(projected)).not.toContain('activities');
		expect(JSON.stringify(projected)).not.toContain('models');
	});

	it('restores roles separately and normalizes them for runtime refresh', () => {
		const record = RoleContinuityRecord.make({
			...emptyRoleContinuityRecord(3),
			drafts: ContinuityDrafts.make({
				acceptedUse: 'accepted draft',
				candidateUse: 'candidate draft',
				shape: 'shape draft'
			}),
			app: [
				ContinuityMessage.make({
					version: 1,
					id: 'restored-app',
					role: 'assistant',
					content: 'app restored',
					createdAt: 3
				})
			],
			previewApp: [
				ContinuityMessage.make({
					version: 1,
					id: 'restored-preview',
					role: 'assistant',
					content: 'preview restored',
					createdAt: 4
				})
			],
			shaper: [
				ContinuityMessage.make({
					version: 1,
					id: 'restored-shaper',
					role: 'assistant',
					content: 'shaper restored',
					createdAt: 5
				})
			],
			candidateRevisionId: RevisionId.make('revision-candidate')
		});

		const restored = restoreAgentContinuity(
			AgentWorkspaceSnapshot.make({
				...agent,
				app: conversation('app', 'streaming', 'old-app'),
				previewApp: conversation('app', 'streaming', 'old-preview'),
				shaper: conversation('shaper', 'streaming', 'old-shaper')
			}),
			record,
			shaping('revision-candidate')
		);

		expect(restored.app.status).toBe('booting');
		expect(restored.app.messages[0]?.content).toBe('app restored');
		expect(restored.previewApp.messages[0]?.content).toBe('preview restored');
		expect(restored.shaper.messages[0]?.content).toBe('shaper restored');
		expect(restored.app.messages[0]?.source).toEqual(source);
	});

	it('discards candidate-only continuity on an exact revision mismatch', () => {
		const record = projectAgentContinuity(
			agent,
			shaping('revision-old'),
			emptyRoleContinuityRecord(0)
		);
		const restored = restoreAgentContinuity(agent, record, shaping('revision-new'));

		expect(restored.app.messages).toHaveLength(2);
		expect(restored.shaper.messages).toHaveLength(1);
		expect(restored.previewApp.messages).toEqual([]);
	});
});
