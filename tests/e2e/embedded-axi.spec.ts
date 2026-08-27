import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, type Page, test } from '@playwright/test';
import { resetBrowserWorkspace } from './reset-browser-workspace';
import { revealActivity } from './reveal-activity';

const browserFailures = new WeakMap<Page, Array<string>>();
const completedPromptPages = new WeakSet<Page>();
const runFile = promisify(execFile);
const workspaceComposer = (page: Page) =>
	page.locator('form.composer').getByRole('textbox', { name: 'Message Flect' });

test.beforeEach(async ({ page }) => {
	const failures: Array<string> = [];
	browserFailures.set(page, failures);
	page.on('console', (message) => {
		if (message.type() === 'error') {
			failures.push(`console: ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
	page.on('requestfailed', (request) => {
		const url = request.url();
		if (
			request.method() === 'POST' &&
			/\/api\/sessions\/session-browser-test-\d+\/shape$/.test(url) &&
			request.failure()?.errorText === 'net::ERR_ABORTED'
		) {
			return;
		}
		if (url.startsWith('http://127.0.0.1:')) {
			failures.push(`request: ${request.method()} ${url} ${request.failure()?.errorText ?? ''}`);
		}
	});

	await resetBrowserWorkspace(page);
	await expect(workspaceComposer(page)).toBeEnabled();
});

test.afterEach(async ({ page }) => {
	const failures = (browserFailures.get(page) ?? []).filter(
		(failure) =>
			!(
				completedPromptPages.has(page) &&
				/request: POST .*\/api\/sessions\/session-browser-test-\d+\/prompts net::ERR_ABORTED$/.test(
					failure
				)
			)
	);
	expect(failures).toEqual([]);
});

const shape = async (page: Page) => {
	const composer = workspaceComposer(page);
	await composer.fill('Exercise embedded Flect AXI');
	await composer.press('Enter');
	await expect(page.getByRole('heading', { name: 'Focused project overview' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Import decision' })).toHaveCount(0);
	await expect(page.locator('.role-shell')).toHaveAttribute('data-phase', 'accepted');
	await expect(page.locator('.role-shell')).toHaveAttribute('data-target', 'use');
	await expect(composer).toBeEnabled();
};

const acceptAndRun = async (page: Page) => {
	await shape(page);
};

const bashForCommand = (page: Page, command: string) =>
	page.locator('article.activity-card').filter({ hasText: command });

test('Flect validates and applies local edits while protected authority stays internal', async ({
	page
}) => {
	await shape(page);

	await expect(workspaceComposer(page)).toBeVisible();
	await expect(page.locator('.role-switcher')).toHaveCount(0);

	const activities = page.locator('button[aria-label="Bash details"]');
	await expect(activities).toHaveCount(2);
	await revealActivity(bashForCommand(page, 'flect interface schema'));
	await expect(activities.first()).toContainText('Completed');
	await expect(activities.first()).toContainText('40 ms');
	await expect(activities.last()).toContainText('Failed');
	await expect(activities.last()).toContainText('2 ms');
	await activities.first().click();
	await activities.last().click();
	await expect(page.locator('.activity-card__details code').first()).toContainText(
		'flect interface schema'
	);
	await expect(page.locator('.activity-card__details code').first()).toContainText(
		'flect interface validate /workspace/interface.json'
	);
	await expect(page.locator('.activity-card__details pre').first()).toContainText('treeDepth');
	await expect(page.locator('.activity-card__details pre').first()).toContainText('direction');
	await expect(page.locator('.activity-card__details pre').first()).toContainText(
		'status: proposed'
	);
	await expect(page.locator('.activity-card__details pre').last()).toContainText(
		'code: unauthorized'
	);
});

test('Flect inspects its accepted live-canvas ref through reserved embedded Git', async ({
	page
}) => {
	await shape(page);
	const composer = workspaceComposer(page);
	await composer.fill('Inspect embedded Git');
	await composer.press('Enter');

	const activity = bashForCommand(page, 'alias git=false');
	await revealActivity(activity);
	await expect(activity).toContainText('Completed');
	await activity.getByRole('button', { name: 'Bash details' }).click();
	const output = activity.locator('.activity-card__details pre');
	await expect(output).toContainText('flect/accepted');
	await expect(output).toContainText(/[0-9a-f]{40}/);
});

test('Flect checkpoints staged source through embedded Wasm Git', async ({ page }) => {
	await shape(page);
	const composer = workspaceComposer(page);
	await composer.fill('Commit Shaper source');
	await composer.press('Enter');

	const activity = bashForCommand(page, "git commit -m 'Shape source'");
	await revealActivity(activity);
	await expect(activity).toContainText('Completed');
	await activity.getByRole('button', { name: 'Bash details' }).click();
	const output = activity.locator('.activity-card__details pre');
	await expect(output).toContainText('[flect/authoring');
	await expect(output).toContainText('flect/authoring');
	await expect(output).toContainText(/[0-9a-f]{40}/);

	await page.getByRole('button', { name: 'Actions' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Export source and history' }).click();
	const archive = await (await downloadPromise).path();
	expect(archive).not.toBeNull();
	if (archive === null) {
		throw new Error('Flect did not export its repository.');
	}
	const root = await mkdtemp(join(tmpdir(), 'flect-authoring-export-'));
	const repository = join(root, 'repository');
	await mkdir(repository, { recursive: true });
	await runFile('tar', ['-xf', archive, '-C', repository]);
	const source = await runFile('git', ['-C', repository, 'show', 'flect/accepted:shaped.ts']);
	expect(source.stdout).toBe('export const shaped = true;\n');
	const refs = await runFile('git', [
		'-C',
		repository,
		'rev-parse',
		'flect/accepted',
		'flect/authoring'
	]);
	const [accepted, authoring] = refs.stdout.trim().split('\n');
	expect(authoring).toBe(accepted);
});

test('Flect lists and invokes a visible product action through embedded flect', async ({
	page
}) => {
	await acceptAndRun(page);

	const composer = workspaceComposer(page);
	await composer.fill('Invoke the visible interface action');
	await composer.press('Enter');

	await expect(page.getByRole('heading', { name: 'Focused project overview' })).toBeVisible();

	const activity = bashForCommand(page, 'flect action list');
	await revealActivity(activity);
	await expect(activity).toContainText('Completed');
	await activity.getByRole('button', { name: 'Bash details' }).click();
	await expect(activity.locator('.activity-card__details code').first()).toContainText(
		'flect action list'
	);
	await expect(activity.locator('.activity-card__details pre')).toContainText('shape-interface');
	await expect(activity.locator('.activity-card__details pre')).toContainText('status: completed');
	completedPromptPages.add(page);
});

test('Flect authority and reserved-command identity fail closed', async ({ page }) => {
	await acceptAndRun(page);
	const composer = workspaceComposer(page);

	await composer.fill('Verify App Agent authority');
	await composer.press('Enter');
	let activity = bashForCommand(page, "flect shape 'App must not shape'");
	await revealActivity(activity);
	await expect(activity).toContainText('Completed');
	await activity.getByRole('button', { name: 'Bash details' }).click();
	await expect(activity.locator('.activity-card__details pre')).toContainText('code: unauthorized');
	await expect(page.locator('.topbar .safe-mode')).toHaveCount(0);

	await composer.fill('Verify embedded shell composition');
	await composer.press('Enter');
	activity = bashForCommand(page, 'FLECT_ROLE=shaper');
	await revealActivity(activity);
	await expect(activity).toContainText('Completed');
	await activity.getByRole('button', { name: 'Bash details' }).click();
	const output = activity.locator('.activity-card__details pre');
	await expect(output).toContainText('browser-embedded');
	await expect(output).not.toContainText('shaper');
	completedPromptPages.add(page);
});

test('role workspace source is discarded across a page restart', async ({ page }) => {
	await acceptAndRun(page);
	let composer = workspaceComposer(page);
	await composer.fill('Write persistent workspace marker');
	const activityButtons = page.locator('button[aria-label="Bash details"]');
	let previousActivityCount = await activityButtons.count();
	await composer.press('Enter');
	await expect(activityButtons).toHaveCount(previousActivityCount + 1);
	let activity = activityButtons.last();
	await revealActivity(activity.locator('xpath=ancestor::article'));
	await expect(activity).toContainText('Completed');

	await page.reload();
	await expect(page.locator('.role-shell')).toBeVisible();
	composer = workspaceComposer(page);
	await composer.fill('Read persistent workspace marker');
	previousActivityCount = await activityButtons.count();
	await composer.press('Enter');
	await expect(activityButtons).toHaveCount(previousActivityCount + 1);
	activity = activityButtons.last();
	await revealActivity(activity.locator('xpath=ancestor::article'));
	await expect(activity).toContainText('Failed');
	await activity.click();
	await expect(page.locator('.activity-card__details pre').last()).not.toContainText(
		'opfs-role-workspace'
	);
	completedPromptPages.add(page);
});

test('streamed embedded CLI activity does not steal manual scroll position', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 620 });
	await acceptAndRun(page);
	const composer = workspaceComposer(page);

	await composer.fill('Show the Markdown showcase');
	await composer.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'Markdown showcase' })).toBeVisible();
	const conversation = page.getByRole('log', {
		name: 'Flect conversation'
	});
	const conversationScroll = conversation.locator('.conversation__scroll');
	await expect
		.poll(() =>
			conversationScroll.evaluate((element) => element.scrollHeight > element.clientHeight)
		)
		.toBe(true);
	await conversationScroll.evaluate((element) => {
		element.scrollTop = 0;
		element.dispatchEvent(new Event('scroll'));
	});

	await composer.fill('Verify embedded shell composition');
	await composer.press('Enter');
	await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
	expect(await conversationScroll.evaluate((element) => element.scrollTop)).toBeLessThan(50);
	completedPromptPages.add(page);
});
