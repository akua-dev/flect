import { expect, type Page, test } from '@playwright/test';
import { FlectPerformanceBudgets } from '../../shared/performance-budgets';
import { resetBrowserWorkspace } from './reset-browser-workspace';

const budget = FlectPerformanceBudgets.browser;

// Shared macOS runners occasionally stall the whole browser process long
// enough for several independent budgets to fail together. Re-measure a noisy
// CI sample on a fresh page; local runs stay fail-fast and the budgets remain
// unchanged.
test.describe.configure({ retries: process.env.CI === 'true' ? 2 : 0 });

const networkProfiles = [
	{
		cpuRate: 4,
		downloadThroughput: ((9 * 1_000 * 1_000) / 8) * 0.9,
		label: 'Fast 4G',
		latencyMs: 60 * 2.75,
		lcpBudgetMs: budget.lcpFast4gMs,
		reportPrefix: 'fast4g',
		uploadThroughput: ((1.5 * 1_000 * 1_000) / 8) * 0.9
	},
	{
		cpuRate: 4,
		downloadThroughput: ((1.6 * 1_000 * 1_000) / 8) * 0.9,
		label: 'Slow 4G',
		latencyMs: 150 * 3.75,
		lcpBudgetMs: budget.lcpSlow4gMs,
		reportPrefix: 'slow4g',
		uploadThroughput: ((750 * 1_000) / 8) * 0.9
	}
] as const;

type NavigationPaintMetrics = {
	readonly cls: number;
	readonly fcpMs: number;
	readonly lcpMs: number;
	readonly longestTaskMs: number;
};

const report = (metrics: Readonly<Record<string, number>>) => {
	console.log(JSON.stringify({ type: 'flect-performance', ...metrics }));
};

const elapsed = async <A>(use: () => Promise<A>) => {
	const startedAt = performance.now();
	const value = await use();
	return { durationMs: performance.now() - startedAt, value };
};

const percentile95 = (values: ReadonlyArray<number>) =>
	[...values].sort((left, right) => left - right)[
		Math.max(0, Math.ceil(values.length * 0.95) - 1)
	] ?? Number.POSITIVE_INFINITY;

const heapUsed = async (page: Page) => {
	const session = await page.context().newCDPSession(page);
	await session.send('Performance.enable');
	await session.send('HeapProfiler.collectGarbage');
	const response = await session.send('Performance.getMetrics');
	await session.detach();
	return response.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
};

const activate = async (page: Page) => {
	const composer = page.getByRole('textbox', { name: 'Message Flect' });
	const activationMs = await composer.evaluate(
		(element) =>
			new Promise<number>((resolve, reject) => {
				if (!(element instanceof HTMLTextAreaElement)) {
					reject(new Error('Flect activation control is not a textarea.'));
					return;
				}
				const startedAt = performance.now();
				const ready = () =>
					document
						.querySelector('[aria-label="Workbench status"]')
						?.textContent?.includes('Flect is ready') === true;
				const observer = new MutationObserver(() => {
					if (!ready()) return;
					observer.disconnect();
					clearTimeout(timeout);
					resolve(performance.now() - startedAt);
				});
				const timeout = setTimeout(() => {
					observer.disconnect();
					reject(new Error('Flect activation did not become ready.'));
				}, 10_000);
				observer.observe(document.documentElement, {
					attributes: true,
					childList: true,
					subtree: true
				});
				element.focus();
				document.dispatchEvent(new CustomEvent('flect:activate'));
				if (ready()) {
					observer.disconnect();
					clearTimeout(timeout);
					resolve(performance.now() - startedAt);
				}
			})
	);
	await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
		'Flect is ready'
	);
	await expect(page.locator('.role-shell')).toBeVisible();
	return activationMs;
};

const shape = async (page: Page, instruction: string, enforceBudget = true) => {
	const input = page.getByRole('textbox', { name: 'Message Flect' });
	const shell = page.locator('.role-shell');
	const revisionBefore = await shell.getAttribute('data-active-revision');
	await input.fill(instruction);
	const result = await elapsed(async () => {
		await input.press('Enter');
		await expect(shell).not.toHaveAttribute('data-active-revision', revisionBefore ?? '', {
			timeout: 10_000
		});
		await expect(input).toBeEnabled();
		await expect(shell).toHaveAttribute('data-phase', 'accepted');
		await expect(page.getByRole('region', { name: 'Import decision' })).toHaveCount(0);
	});
	const candidateRebuildMs = await page.evaluate(
		() =>
			performance
				.getEntriesByType('resource')
				.map((entry) => entry as PerformanceResourceTiming)
				.findLast((entry) => /\/api\/sessions\/[^/]+\/shape$/.test(entry.name))?.duration
	);
	expect(candidateRebuildMs, 'candidate rebuild resource timing').toBeDefined();
	if (enforceBudget) {
		expect(
			candidateRebuildMs ?? Number.POSITIVE_INFINITY,
			'candidate rebuild resource milliseconds'
		).toBeLessThan(budget.candidateRebuildMs);
	}
	return {
		candidateRebuildMs: candidateRebuildMs ?? Number.POSITIVE_INFINITY,
		endToEndMs: result.durationMs
	};
};

const measureVisibleShapeResponse = async (page: Page) => {
	const instruction = 'Create a focused project overview';
	const input = page.getByRole('textbox', { name: 'Message Flect' });
	await input.fill(instruction);
	return input.evaluate(
		(element, expectedInstruction) =>
			new Promise<{
				readonly canvasChangeMs: number;
				readonly firstActivityMs: number;
				readonly sendAcknowledgeMs: number;
			}>((resolve, reject) => {
				if (!(element instanceof HTMLTextAreaElement)) {
					reject(new Error('Flect composer is not a textarea.'));
					return;
				}
				const form = element.closest('form');
				const send = form?.querySelector('button[aria-label="Send to Flect"]');
				const shell = document.querySelector('.role-shell');
				if (
					!(form instanceof HTMLFormElement) ||
					!(send instanceof HTMLButtonElement) ||
					!(shell instanceof HTMLElement)
				) {
					reject(new Error('Flect visible send controls are unavailable.'));
					return;
				}
				const revisionBefore = shell.dataset.activeRevision;
				const startedAt = performance.now();
				let sendAcknowledgeMs: number | undefined;
				let firstActivityMs: number | undefined;
				let canvasChangeMs: number | undefined;
				const visible = (candidate: Element | null) =>
					candidate instanceof HTMLElement &&
					candidate.getClientRects().length > 0 &&
					getComputedStyle(candidate).visibility !== 'hidden';
				const sample = () => {
					const elapsedMs = performance.now() - startedAt;
					const conversation = document.querySelector(
						'[role="log"][aria-label="Flect conversation"]'
					);
					const workbench = document.querySelector(
						'[role="status"][aria-label="Workbench status"]'
					);
					const stop = document.querySelector('button[aria-label="Stop Flect"]');
					if (
						sendAcknowledgeMs === undefined &&
						conversation?.textContent?.includes(expectedInstruction) === true &&
						workbench?.textContent?.includes('Flect is responding') === true &&
						visible(stop)
					) {
						sendAcknowledgeMs = elapsedMs;
					}
					const activity = document.querySelector('.work-log, article.activity-card');
					if (firstActivityMs === undefined && visible(activity)) {
						firstActivityMs = elapsedMs;
					}
					const heading = [...document.querySelectorAll('h1, h2, h3')].find(
						(candidate) => candidate.textContent?.trim() === 'Focused project overview'
					);
					if (
						canvasChangeMs === undefined &&
						visible(heading ?? null) &&
						shell.dataset.activeRevision !== revisionBefore
					) {
						canvasChangeMs = elapsedMs;
					}
					if (
						sendAcknowledgeMs !== undefined &&
						firstActivityMs !== undefined &&
						canvasChangeMs !== undefined
					) {
						observer.disconnect();
						clearTimeout(timeout);
						resolve({
							canvasChangeMs,
							firstActivityMs,
							sendAcknowledgeMs
						});
					}
				};
				const observer = new MutationObserver(sample);
				const timeout = setTimeout(() => {
					observer.disconnect();
					reject(
						new Error('Flect did not visibly acknowledge, show activity, and change the canvas.')
					);
				}, 10_000);
				observer.observe(document.documentElement, {
					attributes: true,
					childList: true,
					subtree: true
				});
				send.click();
				sample();
			}),
		instruction
	);
};

test.beforeEach(async ({ page }) => {
	await resetBrowserWorkspace(page, { viewOnly: true });
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-flect-state', 'inactive');
	await expect(page.getByRole('status', { name: 'Workbench status' })).toHaveCount(0);
});

test('enforces the static Astro shell and cold/warm interaction budgets', async ({ page }) => {
	const session = await page.context().newCDPSession(page);
	await session.send('Network.enable');
	await session.send('Network.setCacheDisabled', { cacheDisabled: true });
	const viewOnly = new URL(page.url());
	viewOnly.searchParams.set('view', '1');
	const coldView = await elapsed(async () => {
		await page.goto(`${viewOnly.pathname}${viewOnly.search}`);
		await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();
	});
	await session.send('Network.setCacheDisabled', { cacheDisabled: false });
	await session.detach();
	expect(coldView.durationMs, 'cold view-only startup milliseconds').toBeLessThan(
		budget.coldInteractiveMs
	);

	const initialResources = await page.evaluate(() =>
		performance.getEntriesByType('resource').map((entry) => {
			const resource = entry as PerformanceResourceTiming;
			return {
				decoded: resource.decodedBodySize,
				name: resource.name,
				transfer: resource.transferSize
			};
		})
	);
	const initialDecodedBytes = initialResources.reduce(
		(total, resource) => total + resource.decoded,
		0
	);
	const initialTransferBytes = initialResources.reduce(
		(total, resource) => total + resource.transfer,
		0
	);
	expect(initialDecodedBytes, 'view-only decoded bytes').toBeLessThanOrEqual(
		budget.initialShellDecodedBytes
	);
	expect(initialTransferBytes, 'view-only transfer bytes').toBeLessThanOrEqual(
		budget.initialShellGzipBytes
	);
	expect(
		initialResources.filter((resource) =>
			/workspace-entry|react|quickjs|rifty|rolldown|wasm|worker/i.test(resource.name)
		),
		'view-only route must not fetch the Flect toolchain'
	).toEqual([]);

	const coldActivationMs = await activate(page);
	expect(coldActivationMs, 'cold Flect activation milliseconds').toBeLessThan(
		budget.coldInteractiveMs
	);

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();
	const warmActivationMs = await activate(page);
	const warmActivationLimitMs =
		process.env.CI === 'true' ? budget.coldInteractiveMs : budget.warmInteractiveMs;
	expect(warmActivationMs, 'warm Flect activation milliseconds').toBeLessThan(
		warmActivationLimitMs
	);

	const composer = page.getByRole('textbox', { name: 'Message Flect' });
	const inputDurations: Array<number> = [];
	for (let index = 0; index < 20; index += 1) {
		inputDurations.push(
			(await elapsed(() => composer.fill(`performance probe ${index}`))).durationMs
		);
	}
	const composerP95Ms = percentile95(inputDurations);
	expect(composerP95Ms, 'composer input p95 milliseconds').toBeLessThan(budget.composerP95Ms);

	const selection = await elapsed(async () => {
		await composer.evaluate((element) => {
			if (!(element instanceof HTMLTextAreaElement)) {
				throw new Error('Flect composer is not a textarea.');
			}
			element.setSelectionRange(0, element.value.length);
		});
		await expect(composer).toHaveJSProperty('selectionStart', 0);
	});
	expect(selection.durationMs, 'selection milliseconds').toBeLessThan(budget.interactionLatencyMs);
	await composer.fill('');

	const modelMenu = await elapsed(async () => {
		await page.getByRole('button', { name: 'Model: Auto via Pi' }).click();
		await expect(page.getByRole('dialog', { name: 'Choose model' })).toBeVisible();
	});
	expect(modelMenu.durationMs, 'model menu milliseconds').toBeLessThan(budget.interactionLatencyMs);
	await page.keyboard.press('Escape');

	report({
		coldActivationMs: Math.round(coldActivationMs),
		coldViewOnlyMs: Math.round(coldView.durationMs),
		composerP95Ms: Math.round(composerP95Ms),
		initialDecodedBytes,
		initialTransferBytes,
		modelMenuMs: Math.round(modelMenu.durationMs),
		warmActivationLimitMs,
		warmActivationMs: Math.round(warmActivationMs)
	});
});

test('visibly responds to Send before completing the canvas change', async ({ page }) => {
	await activate(page);
	const metrics = await measureVisibleShapeResponse(page);

	expect(metrics.sendAcknowledgeMs, 'visible send acknowledgement milliseconds').toBeLessThan(
		budget.sendVisualAcknowledgeMs
	);
	expect(metrics.firstActivityMs, 'first visible agent activity milliseconds').toBeLessThan(
		budget.firstVisibleActivityMs
	);
	expect(metrics.canvasChangeMs, 'deterministic visible canvas change milliseconds').toBeLessThan(
		budget.deterministicCanvasChangeMs
	);
	// React may commit acknowledgement and activity in the same render. The
	// contract is that acknowledgement is already visible by completion, not
	// that separate commits must be observable on every machine.
	expect(metrics.sendAcknowledgeMs).toBeLessThanOrEqual(metrics.canvasChangeMs);
	expect(metrics.firstActivityMs).toBeLessThanOrEqual(metrics.canvasChangeMs);
	await expect(page.getByRole('heading', { name: 'Focused project overview' })).toBeVisible();
	await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
		'Flect is ready'
	);
	report({
		canvasChangeMs: Math.round(metrics.canvasChangeMs),
		firstVisibleActivityMs: Math.round(metrics.firstActivityMs),
		sendVisualAcknowledgeMs: Math.round(metrics.sendAcknowledgeMs)
	});
});

test('gates the static Astro shell on Fast and Slow 4G with 4x CPU', async ({ page }) => {
	test.setTimeout(90_000);
	await page.addInitScript(() => {
		const target = window as typeof window & {
			__flectNavigationMetrics?: {
				cls: number;
				lcpMs: number;
				longestTaskMs: number;
			};
		};
		const metrics = {
			cls: 0,
			lcpMs: 0,
			longestTaskMs: 0
		};
		target.__flectNavigationMetrics = metrics;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				metrics.lcpMs = Math.max(metrics.lcpMs, entry.startTime);
			}
		}).observe({ buffered: true, type: 'largest-contentful-paint' });
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const shift = entry as PerformanceEntry & {
					readonly hadRecentInput: boolean;
					readonly value: number;
				};
				if (!shift.hadRecentInput) metrics.cls += shift.value;
			}
		}).observe({ buffered: true, type: 'layout-shift' });
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				metrics.longestTaskMs = Math.max(metrics.longestTaskMs, entry.duration);
			}
		}).observe({ buffered: true, type: 'longtask' });
	});

	const session = await page.context().newCDPSession(page);
	const workspace = new URL(page.url()).searchParams.get('workspace');
	if (workspace === null) throw new Error('Performance workspace is missing.');
	const viewUrl = (network: string) =>
		`/?workspace=${encodeURIComponent(workspace)}&view=1&network=${encodeURIComponent(network)}`;
	const results: Array<{
		readonly label: string;
		readonly metrics: NavigationPaintMetrics;
		readonly reportPrefix: string;
	}> = [];
	let warmFast4gActivationMs = Number.POSITIVE_INFINITY;
	let warmFast4gActivationMinMs = Number.POSITIVE_INFINITY;
	let warmFast4gActivationMaxMs = Number.POSITIVE_INFINITY;

	try {
		await session.send('Network.enable');
		for (const profile of networkProfiles) {
			await session.send('Network.emulateNetworkConditions', {
				connectionType: 'cellular4g',
				downloadThroughput: profile.downloadThroughput,
				latency: profile.latencyMs,
				offline: false,
				uploadThroughput: profile.uploadThroughput
			});
			await session.send('Emulation.setCPUThrottlingRate', {
				rate: profile.cpuRate
			});
			await session.send('Network.setCacheDisabled', { cacheDisabled: true });

			await page.goto(viewUrl(profile.reportPrefix), {
				waitUntil: 'networkidle'
			});
			await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();
			await page.waitForFunction(() => {
				const target = window as typeof window & {
					__flectNavigationMetrics?: { readonly lcpMs: number };
				};
				return (
					(target.__flectNavigationMetrics?.lcpMs ?? 0) > 0 &&
					performance.getEntriesByName('first-contentful-paint').length > 0
				);
			});

			const metrics = await page.evaluate(() => {
				const target = window as typeof window & {
					__flectNavigationMetrics?: {
						readonly cls: number;
						readonly lcpMs: number;
						readonly longestTaskMs: number;
					};
				};
				const observed = target.__flectNavigationMetrics;
				const fcp = performance.getEntriesByName('first-contentful-paint')[0];
				if (observed === undefined || fcp === undefined) {
					throw new Error('Navigation paint metrics were not observed.');
				}
				return {
					cls: observed.cls,
					fcpMs: fcp.startTime,
					lcpMs: observed.lcpMs,
					longestTaskMs: observed.longestTaskMs
				};
			});
			results.push({
				label: profile.label,
				metrics,
				reportPrefix: profile.reportPrefix
			});

			if (profile.reportPrefix === 'fast4g') {
				await session.send('Network.setCacheDisabled', {
					cacheDisabled: false
				});
				await page.goto(viewUrl('fast4g-warmup'));
				await activate(page);
				const warmSamples: Array<number> = [];
				for (let sample = 0; sample < 3; sample += 1) {
					await page.goto(viewUrl(`fast4g-warm-${sample + 1}`));
					warmSamples.push(await activate(page));
				}
				const orderedWarmSamples = warmSamples.toSorted((left, right) => left - right);
				warmFast4gActivationMs = orderedWarmSamples[1] ?? Number.POSITIVE_INFINITY;
				warmFast4gActivationMinMs = orderedWarmSamples[0] ?? Number.POSITIVE_INFINITY;
				warmFast4gActivationMaxMs = orderedWarmSamples[2] ?? Number.POSITIVE_INFINITY;
			}
		}
	} finally {
		await session.send('Network.emulateNetworkConditions', {
			downloadThroughput: -1,
			latency: 0,
			offline: false,
			uploadThroughput: -1
		});
		await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		await session.send('Network.setCacheDisabled', { cacheDisabled: false });
		await session.detach();
	}

	const reported: Record<string, number> = {
		warmFast4gActivationMs: Math.round(warmFast4gActivationMs),
		warmFast4gActivationMaxMs: Math.round(warmFast4gActivationMaxMs),
		warmFast4gActivationMinMs: Math.round(warmFast4gActivationMinMs)
	};
	for (const result of results) {
		const profile = networkProfiles.find(
			(candidate) => candidate.reportPrefix === result.reportPrefix
		);
		expect(profile, `${result.label} profile`).toBeDefined();
		expect(result.metrics.lcpMs, `${result.label} LCP milliseconds`).toBeLessThan(
			profile?.lcpBudgetMs ?? 0
		);
		expect(result.metrics.cls, `${result.label} CLS`).toBeLessThan(0.1);
		expect(
			result.metrics.longestTaskMs,
			`${result.label} longest main-thread task milliseconds`
		).toBeLessThan(budget.longTaskMs);
		reported[`${result.reportPrefix}FcpMs`] = Math.round(result.metrics.fcpMs);
		reported[`${result.reportPrefix}LcpMs`] = Math.round(result.metrics.lcpMs);
		reported[`${result.reportPrefix}ClsMilli`] = Math.round(result.metrics.cls * 1_000);
		reported[`${result.reportPrefix}LongestTaskMs`] = Math.round(result.metrics.longestTaskMs);
	}
	expect(
		warmFast4gActivationMs,
		'warmed protected workspace on Fast 4G / 4x CPU milliseconds'
	).toBeLessThan(budget.coldInteractiveMs);
	report(reported);
});

test('bounds 50 accepted edit cycles, Markdown rendering, and heap growth', async ({ page }) => {
	test.setTimeout(180_000);
	await activate(page);
	await shape(page, 'Create the performance baseline', false);
	const before = await heapUsed(page);
	expect(before, 'baseline JS heap metric').toBeDefined();

	const rebuilds: Array<{
		readonly candidateRebuildMs: number;
		readonly endToEndMs: number;
	}> = [];
	for (let index = 0; index < budget.repeatedCycleCount; index += 1) {
		rebuilds.push(await shape(page, `Create deterministic local edit ${index + 1}`));
	}

	const afterCycles = await heapUsed(page);
	expect(afterCycles, 'post-cycle JS heap metric').toBeDefined();
	expect(afterCycles ?? Number.POSITIVE_INFINITY, 'post-cycle JS heap bytes').toBeLessThan(
		budget.heapCeilingBytes
	);
	expect(
		(afterCycles ?? Number.POSITIVE_INFINITY) - (before ?? 0),
		'50-cycle JS heap growth bytes'
	).toBeLessThan(budget.repeatedCycleGrowthBytes);

	const input = page.getByRole('textbox', { name: 'Message Flect' });
	await input.fill('Show the Markdown showcase');
	const markdown = await elapsed(async () => {
		await input.press('Enter');
		await expect(page.getByRole('heading', { level: 1, name: 'Markdown showcase' })).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();
		await expect(page.locator('.markdown-code .shiki')).toBeVisible();
	});
	expect(markdown.durationMs, 'Markdown render milliseconds').toBeLessThan(budget.markdownRenderMs);

	const afterMarkdown = await heapUsed(page);
	expect(afterMarkdown, 'final JS heap metric').toBeDefined();
	report({
		baselineHeapBytes: Math.round(before ?? 0),
		finalHeapBytes: Math.round(afterMarkdown ?? 0),
		markdownRenderMs: Math.round(markdown.durationMs),
		repeatedCycleGrowthBytes: Math.round((afterCycles ?? 0) - (before ?? 0)),
		worstAcceptedEndToEndMs: Math.round(Math.max(...rebuilds.map((result) => result.endToEndMs))),
		worstCandidateRebuildMs: Math.round(
			Math.max(...rebuilds.map((result) => result.candidateRebuildMs))
		)
	});
	expect(afterMarkdown ?? Number.POSITIVE_INFINITY, 'final JS heap bytes').toBeLessThan(
		budget.heapCeilingBytes
	);
});

test('acknowledges cancellation within the interaction budget', async ({ page }) => {
	await activate(page);
	const input = page.getByRole('textbox', { name: 'Message Flect' });
	await input.fill('Create a candidate that will be cancelled');
	await input.press('Enter');
	const stop = page.getByRole('button', { name: 'Stop Flect' });
	await expect(stop).toBeVisible();
	const cancellationMs = await stop.evaluate(
		(button) =>
			new Promise<number>((resolve, reject) => {
				if (!(button instanceof HTMLButtonElement)) {
					reject(new Error('Flect stop control is not a button.'));
					return;
				}
				const composer = document.querySelector('[aria-label="Message Flect"]');
				if (!(composer instanceof HTMLTextAreaElement)) {
					reject(new Error('Flect composer is not a textarea.'));
					return;
				}
				const startedAt = performance.now();
				const observer = new MutationObserver(() => {
					if (composer.disabled) return;
					observer.disconnect();
					resolve(performance.now() - startedAt);
				});
				observer.observe(composer, { attributes: true });
				button.click();
				if (!composer.disabled) {
					observer.disconnect();
					resolve(performance.now() - startedAt);
				}
			})
	);
	await expect(input).toBeEnabled();
	expect(cancellationMs, 'cancellation acknowledgement milliseconds').toBeLessThan(
		budget.cancellationAcknowledgeMs
	);
	report({
		cancellationAcknowledgeMs: Math.round(cancellationMs)
	});
});
