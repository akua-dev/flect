import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.goto('/?capsule-diagnostic=1');
});

test('runs an interactive capsule through an opaque typed bridge', async ({ page }) => {
	const frame = page.frameLocator('iframe[title="Flect app"]');
	await expect(frame.getByRole('heading', { name: 'Isolated product' })).toBeVisible();
	await frame.getByRole('button', { name: 'Refresh product' }).click();
	await expect(frame.getByText('1', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Capsule intent')).toHaveText('product.refresh:{"count":1}');
	await expect(frame.getByLabel('Product result')).toHaveText('{"observed":{"count":1}}');
});

test('keeps an unstyled capsule readable against the dark host canvas', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.reload();

	await expect(page.locator('iframe[title="Flect app"]')).toHaveCSS(
		'background-color',
		'rgb(255, 255, 255)'
	);
});

test('denies parent, storage, Tauri, and network authority', async ({ page }) => {
	const element = page.locator('iframe[title="Flect app"]');
	await expect(element).toBeVisible();
	const frame = await (await element.elementHandle())?.contentFrame();
	expect(frame).toBeDefined();
	if (frame === undefined || frame === null) return;
	const result = await frame.evaluate(async () => {
		const denied = async (run: () => unknown | Promise<unknown>) => {
			try {
				await run();
				return false;
			} catch {
				return true;
			}
		};
		return {
			origin: location.origin,
			parent: await denied(() => parent.document.body),
			storage: await denied(() => localStorage.setItem('escape', '1')),
			tauri: '__TAURI_INTERNALS__' in globalThis,
			pi: 'pi' in globalThis,
			network: await denied(() => fetch('/api/runtime'))
		};
	});
	expect(result).toEqual({
		origin: 'null',
		parent: true,
		storage: true,
		tauri: false,
		pi: false,
		network: true
	});
	expect(await page.evaluate(() => localStorage.getItem('escape'))).toBeNull();
});

test('replacing a capsule disposes its frame', async ({ page }) => {
	const frame = page.locator('iframe[title="Flect app"]');
	const handle = await frame.elementHandle();
	await page.getByRole('button', { name: 'Replace capsule' }).click();
	await expect(frame).toHaveCount(0);
	expect(await handle?.evaluate((element) => element.isConnected)).toBe(false);
});

for (const trigger of ['Send malformed', 'Send oversized', 'Flood host']) {
	test(`fails closed when capsule tries to ${trigger.toLowerCase()}`, async ({ page }) => {
		const frame = page.frameLocator('iframe[title="Flect app"]');
		await frame.getByRole('button', { name: trigger }).click();
		await expect(page.getByRole('status').filter({ hasText: 'stopped safely' })).toBeVisible();
		await expect(page.locator('iframe[title="Flect app"]')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Replace capsule' })).toBeEnabled();
	});
}
