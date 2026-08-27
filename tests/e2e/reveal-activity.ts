import { expect, type Locator } from '@playwright/test';

export const revealActivity = async (activity: Locator) => {
	if (await activity.isVisible()) return;
	await activity
		.locator("xpath=ancestor::section[contains(@class, 'work-log')]")
		.locator('.work-log__summary')
		.click();
	await expect(activity).toBeVisible();
};
