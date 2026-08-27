// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import {
	loadProductAdoptionDiagnosticModels,
	ProductAdoptionDiagnostic
} from './product-adoption-diagnostic';

afterEach(cleanup);

describe('ProductAdoptionDiagnostic', () => {
	it('renders three SDK products with public connection, auth, inference, and experience facts', async () => {
		const products = await Effect.runPromise(loadProductAdoptionDiagnosticModels);
		render(<ProductAdoptionDiagnostic products={products} />);

		expect(screen.getByRole('heading', { name: 'Product adoption SDK' })).toBeVisible();
		expect(screen.getAllByRole('article')).toHaveLength(3);
		const offline = screen.getByRole('article', { name: 'Offline board' });
		expect(within(offline).getAllByText('Offline')).toHaveLength(2);
		expect(within(offline).getByText('No authentication')).toBeVisible();
		expect(within(offline).getByText('User inference · Product optional')).toBeVisible();
		expect(within(offline).getByText('Recommended 1.0.0')).toBeVisible();
		expect(within(offline).getByText('The product integration is ready.')).toBeVisible();
		expect(document.body).not.toHaveTextContent('product-sdk-private-secret');
		expect(document.body).not.toHaveTextContent('https://products.flect.test');
	});

	it('switches deterministically between recovery states without losing user-owned facts', async () => {
		const products = await Effect.runPromise(loadProductAdoptionDiagnosticModels);
		render(<ProductAdoptionDiagnostic products={products} />);

		const browser = screen.getByRole('article', { name: 'Browser projects' });
		await userEvent.selectOptions(
			within(browser).getByRole('combobox', { name: 'Browser projects state' }),
			'offline'
		);
		expect(
			within(browser).getByText(
				'The product connection is offline; the accepted interface remains available.'
			)
		).toBeVisible();
		expect(within(browser).getByText('Personal fork preserved')).toBeVisible();

		await userEvent.selectOptions(
			within(browser).getByRole('combobox', { name: 'Browser projects state' }),
			'capability-review'
		);
		expect(
			within(browser).getByText('Review changed product capabilities before using them.')
		).toBeVisible();
		expect(within(browser).getByText('Protected review required')).toBeVisible();

		const broker = screen.getByRole('article', { name: 'Brokered incidents' });
		await userEvent.selectOptions(
			within(broker).getByRole('combobox', {
				name: 'Brokered incidents state'
			}),
			'authentication-unavailable'
		);
		expect(
			within(broker).getByText('Product authentication is unavailable on this host.')
		).toBeVisible();
		expect(within(broker).getByRole('status')).toHaveTextContent('Blocked');
	});
});
