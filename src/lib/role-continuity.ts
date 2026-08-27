import { Schema } from 'effect';
import {
	AgentWorkspaceSnapshot,
	ConversationMessage,
	type RoleConversationSnapshot,
	UserCommandSource
} from '../../shared/control';
import type { ShapingSnapshot } from '../../shared/revisions';
import { ContinuityMessage, RoleContinuityRecord } from '../../shared/role-continuity';

const ROLE_MESSAGE_BYTES = 112 * 1_024;
const MESSAGE_CONTENT_LENGTH = 16_000;
const encoder = new TextEncoder();
const restoredSource = UserCommandSource.make({ kind: 'user' });

const ActiveConversationStatus = Schema.Literals(['submitting', 'streaming', 'cancelling']);
const isActive = (status: RoleConversationSnapshot['status']) =>
	Schema.is(ActiveConversationStatus)(status);

const projectMessages = (
	conversation: RoleConversationSnapshot
): ReadonlyArray<ContinuityMessage> => {
	const candidates =
		isActive(conversation.status) && conversation.messages.at(-1)?.role === 'assistant'
			? conversation.messages.slice(0, -1)
			: conversation.messages;
	const selected: Array<ContinuityMessage> = [];
	let bytes = 0;
	for (const candidate of [...candidates].reverse()) {
		const content = candidate.content.slice(-MESSAGE_CONTENT_LENGTH);
		const size = encoder.encode(content).byteLength;
		if (bytes + size > ROLE_MESSAGE_BYTES) {
			continue;
		}
		selected.push(
			ContinuityMessage.make({
				version: 1,
				id: candidate.id,
				...(candidate.turnId === undefined ? {} : { turnId: candidate.turnId }),
				role: candidate.role,
				content,
				createdAt: candidate.createdAt
			})
		);
		bytes += size;
		if (selected.length === 200) {
			break;
		}
	}
	return selected.reverse();
};

const restoreConversation = (
	current: RoleConversationSnapshot,
	messages: ReadonlyArray<ContinuityMessage>
) => {
	const restored = messages.map((candidate) =>
		ConversationMessage.make({
			version: 1,
			id: candidate.id,
			...(candidate.turnId === undefined ? {} : { turnId: candidate.turnId }),
			role: candidate.role,
			content: candidate.content,
			createdAt: candidate.createdAt,
			source: restoredSource
		})
	);
	const lastPrompt = [...restored]
		.reverse()
		.find((candidate) => candidate.role === 'user')?.content;
	return {
		role: current.role,
		status: 'booting' as const,
		messages: restored,
		activities: [],
		lastPrompt: lastPrompt ?? ''
	};
};

const candidateRevisionId = (shaping: ShapingSnapshot) =>
	shaping.safeMode ? undefined : shaping.proposal?.id;

export const projectAgentContinuity = (
	agent: AgentWorkspaceSnapshot,
	shaping: ShapingSnapshot,
	current: RoleContinuityRecord
): RoleContinuityRecord => {
	const candidate = candidateRevisionId(shaping);
	return RoleContinuityRecord.make({
		version: 1,
		generation: current.generation,
		revisionSequence: shaping.lastEvent.sequence,
		drafts: candidate === undefined ? { ...current.drafts, candidateUse: '' } : current.drafts,
		app: projectMessages(agent.app),
		previewApp: candidate === undefined ? [] : projectMessages(agent.previewApp),
		shaper: projectMessages(agent.shaper),
		...(candidate === undefined ? {} : { candidateRevisionId: candidate }),
		...(current.recovery === undefined ? {} : { recovery: current.recovery })
	});
};

export const restoreAgentContinuity = (
	current: AgentWorkspaceSnapshot,
	record: RoleContinuityRecord,
	shaping: ShapingSnapshot
): AgentWorkspaceSnapshot => {
	const candidate = candidateRevisionId(shaping);
	const candidateMatches = candidate !== undefined && candidate === record.candidateRevisionId;
	return AgentWorkspaceSnapshot.make({
		...current,
		app: restoreConversation(current.app, record.app),
		previewApp: restoreConversation(current.previewApp, candidateMatches ? record.previewApp : []),
		shaper: restoreConversation(current.shaper, record.shaper)
	});
};
