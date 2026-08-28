import { ChevronDownIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ToolActivity } from '../../shared/control';
import type { AgentWorkspaceController, ConversationMessage } from '../hooks/use-agent-session';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton
} from './ai-elements/conversation';
import { MessageContent as AIMessageContent, Message } from './ai-elements/message';

const ActivityCard = lazy(() =>
	import('./activity-card').then((module) => ({
		default: module.ActivityCard
	}))
);
const MessageContent = lazy(() =>
	import('./message-content').then((module) => ({
		default: module.MessageContent
	}))
);
const StreamingReasoning = lazy(() =>
	import('./streaming-reasoning').then((module) => ({
		default: module.StreamingReasoning
	}))
);

const SurfaceFallback = ({ label }: { readonly label: string }) => (
	// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- role='status' is the WAI-ARIA live-region announcer pattern (implicit aria-live=polite); <output> is for calculated form results, not live-region text, so it is not the right semantic swap here.
	<span className='sr-only' role='status'>
		{label}
	</span>
);

const formatWorkDuration = (durationMs: number | undefined) => {
	if (durationMs === undefined) return undefined;
	if (durationMs < 1_000) return `${durationMs} ms`;
	const seconds = durationMs / 1_000;
	return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, '') : Math.round(seconds)} s`;
};

const workSpanMs = (activities: NonNullable<AgentWorkspaceController['app']['activities']>) => {
	let earliestStart: number | undefined;
	let latestEnd: number | undefined;
	for (const activity of activities) {
		const end =
			activity.completedAt ??
			(activity.durationMs === undefined ? undefined : activity.startedAt + activity.durationMs);
		if (end === undefined) return undefined;
		earliestStart =
			earliestStart === undefined
				? activity.startedAt
				: Math.min(earliestStart, activity.startedAt);
		latestEnd = latestEnd === undefined ? end : Math.max(latestEnd, end);
	}
	return earliestStart === undefined || latestEnd === undefined
		? undefined
		: latestEnd - earliestStart;
};

function WorkLog({
	activities,
	needsAttention,
	onFixFailure
}: {
	readonly activities: NonNullable<AgentWorkspaceController['app']['activities']>;
	readonly needsAttention: boolean;
	readonly onFixFailure?: (activity: ToolActivity) => void;
}) {
	const running = activities.some(
		(activity) => activity.phase === 'queued' || activity.phase === 'running'
	);
	const [expanded, setExpanded] = useState(needsAttention);
	useEffect(() => {
		if (needsAttention) setExpanded(true);
	}, [needsAttention]);
	const count = activities.length;
	const duration = formatWorkDuration(workSpanMs(activities));
	const stateLabel = running
		? 'Working'
		: needsAttention
			? 'Needs attention'
			: duration === undefined
				? 'Worked'
				: `Worked for ${duration}`;
	const action = expanded ? 'Hide' : 'Show';
	const state = running ? 'active' : needsAttention ? 'failed' : 'complete';

	return (
		<section
			aria-label={`${count} tool ${count === 1 ? 'call' : 'calls'}`}
			className={`work-log work-log--${state}`}
		>
			<button
				aria-expanded={expanded}
				aria-label={`${action} ${count} ${running ? 'active' : 'completed'} ${count === 1 ? 'step' : 'steps'}`}
				className='work-log__summary'
				onClick={() => setExpanded((current) => !current)}
				type='button'
			>
				<span aria-hidden='true' className='work-log__mark' />
				<strong>{stateLabel}</strong>
				<span>{`${count} ${count === 1 ? 'step' : 'steps'}`}</span>
				<ChevronDownIcon aria-hidden='true' />
			</button>
			<div className='work-log__entries' hidden={!expanded}>
				{activities.map((activity) => (
					<Suspense
						fallback={<SurfaceFallback label='Opening activity details' />}
						key={activity.id}
					>
						<ActivityCard
							activity={activity}
							{...(onFixFailure === undefined ? {} : { onFixInShape: onFixFailure })}
						/>
					</Suspense>
				))}
			</div>
		</section>
	);
}

type TimelineEntry =
	| {
			readonly kind: 'message';
			readonly message: ConversationMessage;
			readonly timestamp: number | undefined;
			readonly turnId: string | undefined;
	  }
	| {
			readonly activities: NonNullable<AgentWorkspaceController['app']['activities']>;
			readonly kind: 'activities';
			readonly timestamp: number;
			readonly turnId: string | undefined;
	  };

interface TimelineTurn {
	readonly entries: ReadonlyArray<TimelineEntry>;
	readonly key: string;
	readonly turnId: string | undefined;
}

const turnEntryOrder = (entry: TimelineEntry) => {
	if (entry.kind === 'activities') return 1;
	return entry.message.role === 'user' ? 0 : 2;
};

const orderTurnEntries = (entries: ReadonlyArray<TimelineEntry>): ReadonlyArray<TimelineEntry> =>
	entries
		.map((entry, sequence) => ({ entry, sequence }))
		.sort(
			(left, right) =>
				turnEntryOrder(left.entry) - turnEntryOrder(right.entry) || left.sequence - right.sequence
		)
		.map(({ entry }) => entry);

const timelineEntryKey = (entry: TimelineEntry) =>
	entry.kind === 'message' ? entry.message.id : entry.activities[0].id;

const timelineEntries = (
	messages: ReadonlyArray<ConversationMessage>,
	activities: NonNullable<AgentWorkspaceController['app']['activities']>
): ReadonlyArray<TimelineEntry> => {
	const ordered = [
		...messages.map((message, sequence) => ({
			kind: 'message' as const,
			message,
			sequence,
			timestamp: message.createdAt
		})),
		...activities.map((activity, sequence) => ({
			activity,
			kind: 'activity' as const,
			sequence: messages.length + sequence,
			timestamp: activity.startedAt
		}))
	].sort((left, right) =>
		left.timestamp === undefined || right.timestamp === undefined
			? left.sequence - right.sequence
			: left.timestamp - right.timestamp || left.sequence - right.sequence
	);

	return ordered.reduce<Array<TimelineEntry>>((entries, entry) => {
		if (entry.kind === 'message') {
			entries.push({
				kind: 'message',
				message: entry.message,
				timestamp: entry.timestamp,
				turnId: entry.message.turnId
			});
			return entries;
		}
		const previous = entries.at(-1);
		if (previous?.kind === 'activities' && previous.turnId === entry.activity.turnId) {
			entries[entries.length - 1] = {
				...previous,
				activities: [...previous.activities, entry.activity]
			};
			return entries;
		}
		entries.push({
			activities: [entry.activity],
			kind: 'activities',
			timestamp: entry.timestamp,
			turnId: entry.activity.turnId
		});
		return entries;
	}, []);
};

const timelineTurns = (
	messages: ReadonlyArray<ConversationMessage>,
	activities: NonNullable<AgentWorkspaceController['app']['activities']>
): ReadonlyArray<TimelineTurn> =>
	timelineEntries(messages, activities).reduce<Array<TimelineTurn>>((turns, entry) => {
		if (entry.turnId === undefined) {
			turns.push({
				entries: [entry],
				key:
					entry.kind === 'message'
						? `legacy-${entry.message.id}`
						: `legacy-${entry.activities[0].id}`,
				turnId: undefined
			});
			return turns;
		}
		const existingIndex = turns.findIndex((turn) => turn.turnId === entry.turnId);
		if (existingIndex === -1) {
			turns.push({
				entries: [entry],
				key: entry.turnId,
				turnId: entry.turnId
			});
			return turns;
		}
		const existing = turns[existingIndex];
		turns[existingIndex] = {
			...existing,
			entries: orderTurnEntries([...existing.entries, entry])
		};
		return turns;
	}, []);

function TimelineEntryView({
	entry,
	label,
	latestMessageId,
	onFixFailure,
	status
}: {
	readonly entry: TimelineEntry;
	readonly label: string;
	readonly latestMessageId: string | undefined;
	readonly onFixFailure?: (activity: ToolActivity) => void;
	readonly status: AgentWorkspaceController['app']['status'];
}) {
	if (entry.kind === 'activities') {
		const failed = entry.activities.some((activity) => activity.phase === 'failed');
		return (
			<WorkLog
				activities={entry.activities}
				needsAttention={failed && status === 'error'}
				{...(onFixFailure === undefined ? {} : { onFixFailure })}
			/>
		);
	}
	const { message } = entry;
	const isLatest = message.id === latestMessageId;
	return (
		<Message
			className={`message message--${message.role}`}
			from={message.role === 'user' ? 'user' : 'assistant'}
		>
			<AIMessageContent>
				<span className='sr-only'>{message.role === 'user' ? 'You' : label}</span>
				{message.content ? (
					<Suspense fallback={<span>{message.content}</span>}>
						<MessageContent
							content={message.content}
							messageRole={message.role}
							streaming={message.role === 'assistant' && isLatest && status === 'streaming'}
						/>
					</Suspense>
				) : (
					isLatest &&
					(status === 'submitting' || status === 'streaming') && (
						<Suspense fallback={<span>{`${label} is responding`}</span>}>
							<StreamingReasoning label={label} />
						</Suspense>
					)
				)}
			</AIMessageContent>
		</Message>
	);
}

function HistoricalTurn({
	entries,
	label,
	latestMessageId,
	onFixFailure,
	prompt,
	status
}: {
	readonly entries: ReadonlyArray<TimelineEntry>;
	readonly label: string;
	readonly latestMessageId: string | undefined;
	readonly onFixFailure?: (activity: ToolActivity) => void;
	readonly prompt: string;
	readonly status: AgentWorkspaceController['app']['status'];
}) {
	const [expanded, setExpanded] = useState(false);
	const summary = prompt.replace(/\s+/g, ' ').trim().slice(0, 120);
	const context = entries.filter(
		(entry) => entry.kind !== 'message' || entry.message.role !== 'assistant'
	);
	const answers = entries.filter(
		(entry) => entry.kind === 'message' && entry.message.role === 'assistant'
	);
	return (
		<section aria-label={`Earlier turn: ${summary}`} className='historical-turn'>
			<button
				aria-expanded={expanded}
				aria-label={`${expanded ? 'Hide' : 'Show'} earlier request: ${summary}`}
				className='historical-turn__summary'
				onClick={() => setExpanded((current) => !current)}
				type='button'
			>
				<span>Asked</span>
				<strong>{summary}</strong>
				<ChevronDownIcon aria-hidden='true' />
			</button>
			<div className='historical-turn__context' hidden={!expanded}>
				{context.map((entry) => (
					<TimelineEntryView
						entry={entry}
						key={timelineEntryKey(entry)}
						label={label}
						latestMessageId={latestMessageId}
						status={status}
						{...(onFixFailure === undefined ? {} : { onFixFailure })}
					/>
				))}
			</div>
			{answers.map((entry) => (
				<TimelineEntryView
					entry={entry}
					key={timelineEntryKey(entry)}
					label={label}
					latestMessageId={latestMessageId}
					status={status}
					{...(onFixFailure === undefined ? {} : { onFixFailure })}
				/>
			))}
		</section>
	);
}

export function ConversationTimeline({
	messages,
	activities,
	status,
	label,
	onFixFailure
}: {
	readonly messages: ReadonlyArray<ConversationMessage>;
	readonly activities: NonNullable<AgentWorkspaceController['app']['activities']>;
	readonly status: AgentWorkspaceController['app']['status'];
	readonly label: string;
	readonly onFixFailure?: (activity: ToolActivity) => void;
}) {
	const turns = timelineTurns(messages, activities);
	const latestMessageId = messages.at(-1)?.id;
	return (
		<Conversation aria-label={`${label} conversation`} className='conversation conversation-shell'>
			<ConversationContent className='conversation__content' scrollClassName='conversation__scroll'>
				{turns.map((turn, turnIndex) => {
					const prompt = turn.entries.find(
						(entry) => entry.kind === 'message' && entry.message.role === 'user'
					);
					const hasAnswer = turn.entries.some(
						(entry) =>
							entry.kind === 'message' &&
							entry.message.role === 'assistant' &&
							entry.message.content.length > 0
					);
					const historical =
						turn.turnId !== undefined &&
						turnIndex < turns.length - 1 &&
						prompt?.kind === 'message' &&
						hasAnswer;
					if (historical) {
						return (
							<HistoricalTurn
								entries={turn.entries}
								key={turn.key}
								label={label}
								latestMessageId={latestMessageId}
								prompt={prompt.message.content}
								status={status}
								{...(onFixFailure === undefined ? {} : { onFixFailure })}
							/>
						);
					}
					return turn.entries.map((entry) => (
						<TimelineEntryView
							entry={entry}
							key={`${turn.key}-${timelineEntryKey(entry)}`}
							label={label}
							latestMessageId={latestMessageId}
							status={status}
							{...(onFixFailure === undefined ? {} : { onFixFailure })}
						/>
					));
				})}
			</ConversationContent>
			<ConversationScrollButton aria-label='Jump to latest' />
		</Conversation>
	);
}
