import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { Schema } from 'effect';

const DocumentGeometry = Schema.Struct({
	documentWidth: Schema.Number,
	viewportWidth: Schema.Number
});
const decodeDocumentGeometry = Schema.decodeUnknownSync(DocumentGeometry);

test('proves deterministic product adoption, recovery, and private-state boundaries', async ({
	page
}, testInfo) => {
	const browserFailures: Array<string> = [];
	const requestBodies: Array<string> = [];
	page.on('console', (message) => {
		if (message.type() === 'error') browserFailures.push(message.text());
	});
	page.on('pageerror', (error) => browserFailures.push(error.message));
	page.on('request', (request) => {
		requestBodies.push(request.postData() ?? '');
	});

	await page.goto('/?product-adoption-diagnostic=1');
	await expect(page.getByRole('heading', { name: 'Product adoption SDK' })).toBeVisible();
	await expect(page.getByRole('article')).toHaveCount(3);

	const offline = page.getByRole('article', { name: 'Offline board' });
	const browser = page.getByRole('article', { name: 'Browser projects' });
	const broker = page.getByRole('article', { name: 'Brokered incidents' });

	await offline.getByRole('combobox').selectOption('product-update');
	await expect(offline.getByRole('status')).toHaveText('Review');
	await expect(offline).toContainText('A reviewed product integration update is available.');
	await expect(offline).toContainText('Personal fork preserved');
	await offline.getByRole('combobox').selectOption('detached');
	await expect(offline.getByRole('status')).toHaveText('Detached');
	await expect(offline).toContainText(
		'The product connection was removed without removing user-owned work.'
	);
	await expect(offline).toContainText('The personal fork and export remain owned by the user.');

	await browser.getByRole('combobox').selectOption('offline');
	await expect(browser.getByRole('status')).toHaveText('Offline');
	await expect(browser).toContainText('the accepted interface remains available');
	await browser.getByRole('combobox').selectOption('capability-review');
	await expect(browser).toContainText('Review changed product capabilities');
	await expect(browser).toContainText('Protected review required');
	await browser.getByRole('combobox').selectOption('extension-review');
	await expect(browser).toContainText('Review changed product extensions');

	await broker.getByRole('combobox').selectOption('authentication-unavailable');
	await expect(broker.getByRole('status')).toHaveText('Blocked');
	await expect(broker).toContainText('Product authentication is unavailable');
	await broker.getByRole('combobox').selectOption('ready');
	await expect(broker.getByRole('status')).toHaveText('Ready');
	await broker.getByRole('combobox').selectOption('incompatible-host');
	await expect(broker).toContainText('This host is not compatible');
	await broker.getByRole('combobox').selectOption('migration-blocked');
	await expect(broker).toContainText('This product update cannot be applied safely');

	await broker.getByRole('combobox').focus();
	await expect(broker.getByRole('combobox')).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(broker.getByRole('combobox')).not.toBeFocused();

	const accessibility = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(accessibility.violations).toEqual([]);
	const geometry = decodeDocumentGeometry(
		await page.evaluate(() => ({
			documentWidth: document.documentElement.scrollWidth,
			viewportWidth: window.innerWidth
		}))
	);
	expect(geometry.documentWidth).toBe(geometry.viewportWidth);

	await expect(page.locator('body')).not.toContainText('product-sdk-private-secret');
	expect(requestBodies.join('\n')).not.toContain('product-sdk-private-secret');
	expect(browserFailures).toEqual([]);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath('product-adoption.png')
	});

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Product adoption SDK' })).toBeVisible();
	await expect(page.getByRole('article')).toHaveCount(3);
	await expect(page.locator('body')).not.toContainText('product-sdk-private-secret');
	expect(browserFailures).toEqual([]);
});
