// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterfaceActionProjection } from '../../shared/interface-actions';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import { InterfaceRenderer } from './interface-renderer';

afterEach(cleanup);

describe('InterfaceRenderer', () => {
	it('renders the trusted component document with semantic controls', async () => {
		const onAction = vi.fn();
		const user = userEvent.setup();

		render(
			<InterfaceRenderer
				document={defaultInterfaceDocument}
				onAction={onAction}
				renderPrompt={(node) => (
					<label>
						Prompt
						<textarea placeholder={node.placeholder} />
					</label>
				)}
			/>
		);

		expect(screen.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible();
		expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
			'placeholder',
			'Build, change, or connect anything'
		);

		await user.click(screen.getByRole('button', { name: 'Start building' }));
		expect(onAction).toHaveBeenCalledWith('shape', 'shape-interface');
	});

	it('disables unavailable actions using the shared projection', async () => {
		const onAction = vi.fn();
		const user = userEvent.setup();
		render(
			<InterfaceRenderer
				actions={[
					InterfaceActionProjection.make({
						nodeId: 'shape-interface',
						label: 'Start building',
						action: 'shape',
						available: false,
						unavailableReason: 'Leave safe mode first.'
					})
				]}
				document={defaultInterfaceDocument}
				onAction={onAction}
				renderPrompt={() => null}
			/>
		);

		const button = screen.getByRole('button', { name: 'Start building' });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('title', 'Leave safe mode first.');
		await user.click(button);
		expect(onAction).not.toHaveBeenCalled();
	});

	it('selects a semantic canvas node without invoking its normal action', async () => {
		const onAction = vi.fn();
		const onSelectionChange = vi.fn();
		const user = userEvent.setup();
		render(
			<InterfaceRenderer
				document={defaultInterfaceDocument}
				onAction={onAction}
				onSelectionChange={onSelectionChange}
				renderPrompt={() => null}
				selectionMode
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Start building' }));

		expect(onAction).not.toHaveBeenCalled();
		expect(onSelectionChange).toHaveBeenCalledWith(
			expect.objectContaining({
				version: 1,
				semanticId: 'shape-interface',
				tag: 'button',
				label: 'Start building'
			}),
			'shape-interface'
		);
	});
});
