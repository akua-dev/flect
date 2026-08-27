// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationMessage, ToolActivity, UserCommandSource } from '../../shared/control';
import { ConversationTimeline } from './conversation-timeline';

afterEach(cleanup);

describe('ConversationTimeline', () => {
	it('folds historical request context while keeping every final answer visible', async () => {
		const source = UserCommandSource.make({ kind: 'user' });
		render(
			<ConversationTimeline
				activities={[
					ToolActivity.make({
						version: 1,
						id: 'activity-history-1',
						callId: 'tool-call-history-1',
						operationId: 'operation-history-0001',
						turnId: 'operation-history-0001',
						role: 'app',
						toolName: 'bash',
						phase: 'succeeded',
						startedAt: 20,
						updatedAt: 21,
						durationMs: 10
					})
				]}
				label='Flect'
				messages={[
					ConversationMessage.make({
						version: 1,
						id: 'message-history-user',
						turnId: 'operation-history-0001',
						role: 'user',
						content: 'Build the first project dashboard with a long request',
						createdAt: 10,
						source
					}),
					ConversationMessage.make({
						version: 1,
						id: 'message-history-assistant',
						turnId: 'operation-history-0001',
						role: 'assistant',
						content: 'The first dashboard is ready.',
						createdAt: 30,
						source
					}),
					ConversationMessage.make({
						version: 1,
						id: 'message-current-user',
						turnId: 'operation-current-0001',
						role: 'user',
						content: 'Make the current dashboard calmer',
						createdAt: 40,
						source
					}),
					ConversationMessage.make({
						version: 1,
						id: 'message-current-assistant',
						turnId: 'operation-current-0001',
						role: 'assistant',
						content: 'The calmer dashboard is ready.',
						createdAt: 50,
						source
					})
				]}
				status='ready'
			/>
		);

		const historical = screen.getByRole('region', {
			name: 'Earlier turn: Build the first project dashboard with a long request'
		});
		expect(
			within(historical).getByRole('button', {
				name: 'Show earlier request: Build the first project dashboard with a long request'
			})
		).toHaveAttribute('aria-expanded', 'false');
		expect(within(historical).getByText('The first dashboard is ready.')).toBeVisible();
		expect(screen.getByText('The calmer dashboard is ready.')).toBeVisible();
		expect(
			within(historical).getByText('Build the first project dashboard with a long request', {
				selector: '.message--user *'
			})
		).not.toBeVisible();
		expect(
			within(historical).getByRole('region', {
				hidden: true,
				name: '1 tool call'
			})
		).not.toBeVisible();

		await userEvent.click(
			within(historical).getByRole('button', {
				name: 'Show earlier request: Build the first project dashboard with a long request'
			})
		);
		expect(
			within(historical).getByText('Build the first project dashboard with a long request', {
				selector: '.message--user *'
			})
		).toBeVisible();
		expect(within(historical).getByRole('region', { name: '1 tool call' })).toBeVisible();
	});

	it('keeps compact tool work inside the turn that produced it', async () => {
		render(
			<ConversationTimeline
				activities={[
					ToolActivity.make({
						version: 1,
						id: 'activity-timeline-read-1',
						callId: 'tool-call-timeline-read-1',
						operationId: 'operation-timeline-read-1',
						turnId: 'operation-timeline-turn-1',
						role: 'app',
						toolName: 'flect',
						phase: 'succeeded',
						startedAt: 20,
						updatedAt: 21,
						durationMs: 12
					}),
					ToolActivity.make({
						version: 1,
						id: 'activity-timeline-build-1',
						callId: 'tool-call-timeline-build-1',
						operationId: 'operation-timeline-build-1',
						turnId: 'operation-timeline-turn-1',
						role: 'app',
						toolName: 'bash',
						phase: 'succeeded',
						startedAt: 1_220,
						updatedAt: 1_238,
						durationMs: 18
					})
				]}
				label='Flect'
				messages={[
					ConversationMessage.make({
						version: 1,
						id: 'message-user',
						turnId: 'operation-timeline-turn-1',
						role: 'user',
						content: 'Make it calmer',
						createdAt: 10,
						source: UserCommandSource.make({ kind: 'user' })
					}),
					ConversationMessage.make({
						version: 1,
						id: 'message-assistant',
						turnId: 'operation-timeline-turn-1',
						role: 'assistant',
						content: 'I softened the interface.',
						createdAt: 1_300,
						source: UserCommandSource.make({ kind: 'user' })
					})
				]}
				status='ready'
				onFixFailure={vi.fn()}
			/>
		);

		expect(await screen.findByRole('region', { name: '2 tool calls' })).toBeVisible();
		expect(screen.getByText('Worked for 1.2 s')).toBeVisible();
		expect(screen.getByText('2 steps')).toBeVisible();

		const userMessage = screen.getByText('Make it calmer');
		const work = screen.getByRole('region', { name: '2 tool calls' });
		const assistantMessage = screen.getByText('I softened the interface.');
		expect(
			userMessage.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			work.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		const details = await screen.findAllByRole('button', {
			hidden: true,
			name: /details/i
		});
		expect(details).toHaveLength(2);
		expect(details[0]).not.toBeVisible();
		expect(details[1]).not.toBeVisible();

		await userEvent.click(within(work).getByRole('button', { name: 'Show 2 completed steps' }));
		expect(details[0]).toBeVisible();
		expect(details[1]).toBeVisible();
	});

	it('only asks for attention when the complete turn failed', async () => {
		const activity = ToolActivity.make({
			version: 1,
			id: 'activity-timeline-failed-1',
			callId: 'tool-call-timeline-failed-1',
			operationId: 'operation-timeline-failed-1',
			role: 'app',
			toolName: 'bash',
			phase: 'failed',
			startedAt: 20,
			updatedAt: 21
		});
		const { rerender } = render(
			<ConversationTimeline activities={[activity]} label='Flect' messages={[]} status='ready' />
		);

		const work = await screen.findByRole('region', { name: '1 tool call' });
		expect(within(work).getByText('Worked')).toBeVisible();
		expect(within(work).queryByText('Needs attention')).not.toBeInTheDocument();

		rerender(
			<ConversationTimeline activities={[activity]} label='Flect' messages={[]} status='error' />
		);
		expect(within(work).getByText('Needs attention')).toBeVisible();
	});
});
