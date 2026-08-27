import { expect, test } from '@playwright/test';

test('builds a portable TSX and CSS project in a disposed browser Worker', async ({ page }) => {
	test.setTimeout(120_000);
	await page.goto(`/?build-diagnostic=1&workspace=build-${Date.now().toString(36)}`);

	const result = page.getByTestId('browser-build-result');
	await expect(result).toHaveAttribute('data-state', 'complete', {
		timeout: 90_000
	});
	await expect(result).toHaveAttribute('data-last-good', 'retained');
	await expect(result).toHaveAttribute('data-restored', 'fresh');
	await expect(result).toHaveAttribute('data-cross-origin-isolated', 'true');
	await expect(result).toContainText('app.js');
	await expect(result).toContainText('.css');

	const preview = page.frameLocator('[data-testid="browser-build-preview"]');
	await expect(preview.getByRole('button', { name: 'Flect build ready' })).toBeVisible();
	await expect(preview.getByRole('button')).toHaveCSS('background-color', 'rgb(20, 86, 230)');
	await preview.getByRole('button').click();
	await expect(preview.getByRole('button', { name: 'Built 1' })).toBeVisible();

	await page.reload();
	await expect(result).toHaveAttribute('data-state', 'complete', {
		timeout: 30_000
	});
	await expect(result).toHaveAttribute('data-restored', 'reopened');
	await expect(result).toHaveAttribute('data-last-good', 'retained');
	await expect(preview.getByRole('button', { name: 'Flect build ready' })).toBeVisible();
});
