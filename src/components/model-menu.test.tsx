// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSummary } from '../../shared/contracts';
import { ModelMenu, modelValue } from './model-menu';

afterEach(cleanup);

const model = new ModelSummary({
	provider: 'openai-codex',
	id: 'gpt-5.6',
	name: 'GPT-5.6',
	reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh']
});

const defaults = {
	favoriteKeys: [] as ReadonlyArray<string>,
	onToggleFavorite: vi.fn(() => Promise.resolve())
};

describe('ModelMenu', () => {
	it('selects an authenticated Pi model from the popover', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={onSelect}
				selectedModel={undefined}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));
		await user.click(screen.getByRole('radio', { name: 'GPT-5.6 by openai-codex' }));

		expect(onSelect).toHaveBeenCalledWith(model);
	});

	it('returns to automatic Pi model selection', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={onSelect}
				selectedModel={model}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: GPT-5.6' }));
		await user.click(screen.getByRole('radio', { name: 'Auto via Pi' }));

		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	it('selects a supported reasoning level independently of the model', async () => {
		const user = userEvent.setup();
		const onSelectReasoning = vi.fn();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={vi.fn()}
				onSelectReasoning={onSelectReasoning}
				reasoningLevel='medium'
				selectedModel={model}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: GPT-5.6' }));
		expect(screen.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true');
		await user.click(screen.getByRole('radio', { name: 'High' }));
		expect(onSelectReasoning).toHaveBeenCalledWith('high');
	});

	it('marks the current selection and exposes provider detail', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={vi.fn()}
				selectedModel={model}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: GPT-5.6' }));

		expect(
			screen.getByRole('radio', {
				name: 'GPT-5.6 by openai-codex'
			})
		).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('region', { name: 'openai-codex' })).toBeVisible();
	});

	it('explains when Pi has no authenticated models', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));

		expect(screen.getByText('No authenticated Pi models')).toBeVisible();
	});

	it('dismisses with Escape and restores trigger focus', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		const trigger = screen.getByRole('button', {
			name: 'Model: Auto via Pi'
		});
		await user.click(trigger);
		await user.keyboard('{Escape}');

		expect(screen.queryByRole('dialog', { name: 'Choose model' })).not.toBeInTheDocument();
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it('uses the native top layer and dismisses from its backdrop', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		const trigger = screen.getByRole('button', {
			name: 'Model: Auto via Pi'
		});
		await user.click(trigger);
		const dialog = screen.getByRole('dialog', { name: 'Choose model' });
		expect(dialog).toHaveAttribute('open');
		fireEvent.pointerDown(dialog);

		expect(screen.queryByRole('dialog', { name: 'Choose model' })).not.toBeInTheDocument();
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it('cannot open while model changes are disabled', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled
				models={[model]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		const trigger = screen.getByRole('button', {
			name: 'Model: Auto via Pi'
		});
		expect(trigger).toBeDisabled();
		await user.click(trigger);
		expect(screen.queryByRole('dialog', { name: 'Choose model' })).not.toBeInTheDocument();
	});

	it('searches across model and provider names', async () => {
		const user = userEvent.setup();
		const other = new ModelSummary({
			provider: 'anthropic',
			id: 'claude-sonnet',
			name: 'Claude Sonnet',
			reasoningLevels: ['off', 'low', 'medium', 'high']
		});
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model, other]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));
		await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'anth');

		expect(
			screen.getByRole('radio', {
				name: 'Claude Sonnet by anthropic'
			})
		).toBeVisible();
		expect(
			screen.queryByRole('radio', {
				name: 'GPT-5.6 by openai-codex'
			})
		).not.toBeInTheDocument();
	});

	it('persists favorites through the supplied controller', async () => {
		const user = userEvent.setup();
		const onToggleFavorite = vi.fn(() => Promise.resolve());
		render(
			<ModelMenu
				disabled={false}
				favoriteKeys={[]}
				models={[model]}
				onSelect={vi.fn()}
				onToggleFavorite={onToggleFavorite}
				selectedModel={undefined}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));
		await user.click(screen.getByRole('button', { name: 'Add GPT-5.6 to favorites' }));

		expect(onToggleFavorite).toHaveBeenCalledWith('openai-codex:gpt-5.6');
	});

	it('uses a provider rail and opens on favorites when favorites exist', async () => {
		const user = userEvent.setup();
		const anthropic = new ModelSummary({
			provider: 'anthropic',
			id: 'claude-sonnet',
			name: 'Claude Sonnet',
			reasoningLevels: ['off', 'low', 'medium', 'high']
		});
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				favoriteKeys={[modelValue(model)]}
				models={[model, anthropic]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		const trigger = screen.getByRole('button', {
			name: 'Model: Auto via Pi'
		});
		await user.click(trigger);

		expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
		expect(screen.getByRole('navigation', { name: 'Model providers' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(screen.getByRole('radio', { name: 'GPT-5.6 by openai-codex' })).toBeVisible();
		expect(
			screen.queryByRole('radio', { name: 'Claude Sonnet by anthropic' })
		).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'anthropic' }));
		expect(screen.getByRole('radio', { name: 'Claude Sonnet by anthropic' })).toBeVisible();
		expect(
			screen.queryByRole('radio', { name: 'GPT-5.6 by openai-codex' })
		).not.toBeInTheDocument();
	});

	it('gives model search a stable form identity', async () => {
		const user = userEvent.setup();
		render(
			<ModelMenu
				{...defaults}
				disabled={false}
				models={[model]}
				onSelect={vi.fn()}
				selectedModel={undefined}
			/>
		);

		await user.click(screen.getByRole('button', { name: 'Model: Auto via Pi' }));
		const search = screen.getByRole('searchbox', { name: 'Search models' });

		expect(search).toHaveAttribute('name', 'model-search');
		expect(search).toHaveAttribute('id');
		expect(search.id).not.toBe('');
	});
});
