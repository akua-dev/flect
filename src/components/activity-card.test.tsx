// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToolActivity } from '../../shared/control';
import { ActivityCard } from './activity-card';

describe('ActivityCard', () => {
	it('shows live status and exposes bounded tool evidence accessibly', async () => {
		const user = userEvent.setup();
		const onFixInShape = vi.fn();
		render(
			<ActivityCard
				activity={ToolActivity.make({
					version: 1,
					id: 'activity-component-tool',
					callId: 'tool-call-component',
					operationId: 'operation-component-tool',
					role: 'shaper',
					toolName: 'bash',
					phase: 'failed',
					startedAt: 10,
					updatedAt: 20,
					completedAt: 20,
					durationMs: 10,
					command: 'bun test',
					output: '1 test failed',
					resultSummary: 'Tool failed',
					exitCode: 1
				})}
				onFixInShape={onFixInShape}
			/>
		);

		expect(screen.getByText('Command failed')).toBeVisible();
		expect(screen.queryByText('Error')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /Bash details/i }));
		expect(screen.getAllByText('bun test')).toHaveLength(2);
		expect(screen.getByText('1 test failed')).toBeVisible();
		expect(screen.getByText('Exit 1')).toBeVisible();
		await user.click(screen.getByRole('button', { name: 'Fix with Flect' }));
		expect(onFixInShape).toHaveBeenCalledOnce();
	});
});
