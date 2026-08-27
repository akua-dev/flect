import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Request, type Route, test } from '@playwright/test';
import { Effect } from 'effect';
import { decodeShareArchive } from '../../src/sharing/share-archive';
import { makeInitialSharingFixture, makeSharingFixtureSet } from '../fixtures/sharing/generate';
import { resetBrowserWorkspace } from './reset-browser-workspace';

const browserFailures = new WeakMap<Page, Array<string>>();
const completedPromptPages = new WeakSet<Page>();
const completedShapePages = new WeakSet<Page>();

const isCompletedSessionAbort = (page: Page, failure: string) =>
	(completedPromptPages.has(page) &&
		/request: POST .*\/api\/sessions\/session-browser-test-\d+\/prompts net::ERR_ABORTED$/.test(
			failure
		)) ||
	(completedShapePages.has(page) &&
		/request: POST .*\/api\/sessions\/session-browser-test-\d+\/shape net::ERR_ABORTED$/.test(
			failure
		));

const run = async (directory: string, args: ReadonlyArray<string>) => {
	const [command, ...rest] = args;
	if (command === undefined) throw new Error('Missing command');
	const [exitCode, stdout, stderr] = await new Promise<readonly [number, string, string]>(
		(resolve, reject) => {
			const child = spawn(command, rest, {
				cwd: directory,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			const output: Array<Buffer> = [];
			const errors: Array<Buffer> = [];
			child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
			child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
			child.once('error', reject);
			child.once('close', (code) =>
				resolve([
					code ?? 1,
					Buffer.concat(output).toString('utf8'),
					Buffer.concat(errors).toString('utf8')
				])
			);
		}
	);
	expect(exitCode, `${args.join(' ')}\n${stderr}`).toBe(0);
	return stdout;
};

const materializePublicGit = async (
	files: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>
) => {
	const root = await mkdtemp(join(tmpdir(), 'flect-public-git-'));
	for (const directory of ['objects/pack', 'refs/heads', 'refs/tags']) {
		await mkdir(join(root, 'weather.git', directory), { recursive: true });
	}
	for (const file of files) {
		const path = join(root, 'weather.git', file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.contents);
	}
	return root;
};

const gitHttpResponse = async (root: string, request: Request) => {
	const url = new URL(request.url());
	const requestBody = request.postDataBuffer() ?? Buffer.alloc(0);
	const headers = await request.allHeaders();
	const [exitCode, stdout, stderr] = await new Promise<readonly [number, Buffer, string]>(
		(resolve, reject) => {
			const child = spawn('git', ['http-backend'], {
				env: {
					...process.env,
					CONTENT_LENGTH: String(requestBody.byteLength),
					CONTENT_TYPE: headers['content-type'] ?? '',
					GIT_HTTP_EXPORT_ALL: '1',
					GIT_PROJECT_ROOT: root,
					HTTP_GIT_PROTOCOL: headers['git-protocol'] ?? '',
					PATH_INFO: url.pathname,
					QUERY_STRING: url.search.slice(1),
					REMOTE_ADDR: '127.0.0.1',
					REQUEST_METHOD: request.method(),
					SCRIPT_NAME: '',
					SERVER_NAME: url.hostname,
					SERVER_PORT: '443',
					SERVER_PROTOCOL: 'HTTP/1.1'
				},
				stdio: ['pipe', 'pipe', 'pipe']
			});
			const output: Array<Buffer> = [];
			const errors: Array<Buffer> = [];
			child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
			child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
			child.once('error', reject);
			child.once('close', (code) =>
				resolve([code ?? 1, Buffer.concat(output), Buffer.concat(errors).toString('utf8')])
			);
			child.stdin.end(requestBody);
		}
	);
	expect(exitCode, stderr).toBe(0);
	const separator = stdout.indexOf(Buffer.from('\r\n\r\n'));
	expect(separator).toBeGreaterThanOrEqual(0);
	const responseHeaders: Record<string, string> = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Expose-Headers': 'Content-Type',
		'Cross-Origin-Resource-Policy': 'cross-origin'
	};
	let status = 200;
	for (const line of stdout.subarray(0, separator).toString('utf8').split('\r\n')) {
		const delimiter = line.indexOf(':');
		if (delimiter < 1) continue;
		const name = line.slice(0, delimiter);
		const value = line.slice(delimiter + 1).trim();
		if (name.toLowerCase() === 'status') status = Number(value.slice(0, 3));
		else responseHeaders[name] = value;
	}
	return {
		status,
		headers: responseHeaders,
		body: stdout.subarray(separator + 4)
	};
};

const routePublicGit = async (
	route: Route,
	request: Request,
	root: string,
	files: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>
) => {
	if (request.method() === 'OPTIONS') {
		await route.fulfill({
			status: 204,
			headers: {
				'Access-Control-Allow-Headers': 'Content-Type, Git-Protocol',
				'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin'
			}
		});
		return '204 preflight';
	}
	const url = new URL(request.url());
	const prefix = '/weather.git/';
	const path = url.pathname.startsWith(prefix)
		? decodeURIComponent(url.pathname.slice(prefix.length))
		: '';
	const file = files.find((entry) => entry.path === path);
	if (
		(request.method() === 'GET' || request.method() === 'HEAD') &&
		!url.searchParams.has('service') &&
		file !== undefined
	) {
		const contentType = path.endsWith('.pack')
			? 'application/x-git-packed-objects'
			: path.endsWith('.idx')
				? 'application/x-git-packed-objects-toc'
				: path === 'info/refs'
					? 'text/plain; charset=utf-8'
					: 'application/octet-stream';
		await route.fulfill({
			status: 200,
			contentType,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin'
			},
			body: request.method() === 'HEAD' ? Buffer.alloc(0) : Buffer.from(file.contents)
		});
		return `200 ${contentType} ${file.contents.byteLength}b`;
	}
	const response = await gitHttpResponse(root, request);
	await route.fulfill(response);
	return `${response.status} ${response.headers['Content-Type'] ?? response.headers['content-type'] ?? 'unknown'} ${response.body.byteLength}b`;
};

const verifyPortableFork = async (archive: Uint8Array, commit: string) => {
	const decoded = await Effect.runPromise(decodeShareArchive(archive));
	expect(decoded.manifest.id).toBe('dev.flect.weather');
	expect(decoded.manifest.repository.commit).toBe(commit);
	expect(decoded.manifest.signatures).toEqual([]);
	const directory = await mkdtemp(join(tmpdir(), 'flect-share-e2e-'));
	try {
		const repositoryPath = join(directory, 'repository.tar');
		await writeFile(repositoryPath, decoded.repository);
		await run(directory, ['tar', '-xf', repositoryPath, '-C', directory]);
		await run(directory, ['git', 'init', '-q']);
		await run(directory, ['git', 'cat-file', '-e', `${commit}^{commit}`]);
		await run(directory, ['git', 'fsck', '--full', '--no-reflogs', commit]);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
};

const parsePortableForkExport = async (archive: Uint8Array) => {
	const decoded = await Effect.runPromise(decodeShareArchive(archive));
	const directory = await mkdtemp(join(tmpdir(), 'flect-share-inspect-'));
	try {
		const repositoryPath = join(directory, 'repository.tar');
		await writeFile(repositoryPath, decoded.repository);
		await run(directory, ['tar', '-xf', repositoryPath, '-C', directory]);
		await run(directory, ['git', 'init', '-q']);
		await run(directory, [
			'git',
			'fsck',
			'--full',
			'--no-reflogs',
			decoded.manifest.repository.commit
		]);
		const lineage = (
			await run(directory, [
				'git',
				'rev-list',
				'--parents',
				'-n',
				'1',
				decoded.manifest.repository.commit
			])
		)
			.trim()
			.split(' ');
		return {
			decoded,
			parents: lineage.slice(1),
			personalized: await run(directory, [
				'git',
				'show',
				`${decoded.manifest.repository.commit}:components/weather/personal-note.md`
			]),
			upstream: await run(directory, [
				'git',
				'show',
				`${decoded.manifest.repository.commit}:components/weather/index.ts`
			])
		};
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
};

const parseResolvedWeatherExport = async (archive: Uint8Array) => {
	const decoded = await Effect.runPromise(decodeShareArchive(archive));
	const directory = await mkdtemp(join(tmpdir(), 'flect-share-resolved-'));
	try {
		const repositoryPath = join(directory, 'repository.tar');
		await writeFile(repositoryPath, decoded.repository);
		await run(directory, ['tar', '-xf', repositoryPath, '-C', directory]);
		await run(directory, ['git', 'init', '-q']);
		await run(directory, [
			'git',
			'fsck',
			'--full',
			'--no-reflogs',
			decoded.manifest.repository.commit
		]);
		const lineage = (
			await run(directory, [
				'git',
				'rev-list',
				'--parents',
				'-n',
				'1',
				decoded.manifest.repository.commit
			])
		)
			.trim()
			.split(' ');
		return {
			decoded,
			parents: lineage.slice(1),
			weather: await run(directory, [
				'git',
				'show',
				`${decoded.manifest.repository.commit}:components/weather/index.ts`
			])
		};
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
};

const expectAccessible = async (page: Page, include: string) => {
	const result = await new AxeBuilder({ page })
		.include(include)
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(
		result.violations.map((violation) => ({
			id: violation.id,
			nodes: violation.nodes.map((node) => ({
				summary: node.failureSummary,
				target: node.target
			}))
		}))
	).toEqual([]);
};

test.beforeEach(async ({ page }) => {
	const failures: Array<string> = [];
	browserFailures.set(page, failures);
	page.on('console', (message) => {
		if (message.type() === 'error') failures.push(`console: ${message.text()}`);
	});
	page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
	page.on('requestfailed', (request) => {
		if (request.url().startsWith('http://127.0.0.1:')) {
			const failure = `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`;
			if (!isCompletedSessionAbort(page, failure)) failures.push(failure);
		}
	});
	await resetBrowserWorkspace(page);
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeEnabled();
});

test.afterEach(async ({ page }) => {
	expect(
		(browserFailures.get(page) ?? []).filter((failure) => !isCompletedSessionAbort(page, failure))
	).toEqual([]);
});

test('retains, previews, exports, removes, and explicitly deletes a real Git share', async ({
	page
}, testInfo) => {
	test.setTimeout(120_000);
	const fixture = await Effect.runPromise(makeInitialSharingFixture());
	const initialScroll = await page.evaluate(() => window.scrollY);
	await page.locator('input[type="file"][aria-label="Open shared file"]').setInputFiles({
		name: fixture.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixture.archive)
	});

	const review = page.getByRole('region', { name: 'Weather workspace' });
	await expect(review).toBeVisible();
	await expect(review).toBeFocused();
	expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
	await expect(review.getByText('Inactive until you activate it')).toBeVisible();
	await expect(review.getByText('0 authority-affecting changes')).toBeVisible();
	await expect(page.locator('.agent-rail-container')).toHaveAttribute('inert', '');
	await expectAccessible(page, '.share-review');

	await review.getByRole('button', { name: 'Open URL or Git' }).click();
	const sourceDialog = page.getByRole('dialog', {
		name: 'Review a shared source'
	});
	await expect(sourceDialog.getByRole('checkbox')).not.toBeChecked();
	await expect(sourceDialog.getByRole('button', { name: 'Review source' })).toBeDisabled();
	await sourceDialog.getByRole('button', { name: 'Close shared source dialog' }).click();

	await review.getByRole('button', { name: 'Retain selected' }).click();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	// The decision can render while staging is finishing. The controller must
	// serialize this immediate decision behind activation instead of racing Git.
	await page.getByRole('button', { name: 'Activate app' }).click();
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	const library = page.getByRole('dialog', { name: 'Shared sources' });
	await expect(library.getByText('1 part in app')).toBeVisible();
	await expectAccessible(page, '.share-library');
	await page.screenshot({
		path: testInfo.outputPath('sharing-source-library.png')
	});

	const firstDownload = page.waitForEvent('download');
	await library.getByRole('button', { name: 'Export fork' }).click();
	const firstPath = await (await firstDownload).path();
	expect(firstPath).not.toBeNull();
	await verifyPortableFork(new Uint8Array(await readFile(firstPath ?? '')), fixture.commit);

	await library.getByRole('button', { name: 'Remove dev.flect.weather from app' }).click();
	await library.getByRole('button', { name: 'Confirm remove dev.flect.weather' }).click();
	await expect(library.getByText('Kept locally')).toBeVisible();

	const retainedDownload = page.waitForEvent('download');
	await library.getByRole('button', { name: 'Export fork' }).click();
	const retainedPath = await (await retainedDownload).path();
	expect(retainedPath).not.toBeNull();
	await verifyPortableFork(new Uint8Array(await readFile(retainedPath ?? '')), fixture.commit);

	await library
		.getByRole('button', {
			name: 'Delete local data for dev.flect.weather'
		})
		.click();
	await expect(library.getByText(/Browser deletion cannot be undone/)).toBeVisible();
	await expect(library.getByText(fixture.commit)).toBeVisible();
	await library.getByRole('button', { name: 'Confirm delete dev.flect.weather' }).click();
	await expect(library.getByText('No shared sources yet')).toBeVisible();
	await library.getByRole('button', { name: 'Close shared sources' }).click();

	await page.reload();
	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	await expect(
		page.getByRole('dialog', { name: 'Shared sources' }).getByText('No shared sources yet')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('prepares and activates an exact fast-forward update from real Git history', async ({
	page
}) => {
	test.setTimeout(120_000);
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const fileInput = page.locator('input[type="file"][aria-label="Open shared file"]');
	await fileInput.setInputFiles({
		name: fixtures.initial.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.initial.archive)
	});
	let review = page.getByRole('region', { name: 'Weather workspace' });
	await review.getByRole('button', { name: 'Retain selected' }).click();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeVisible();

	await fileInput.setInputFiles({
		name: fixtures.compatibleUpdate.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.compatibleUpdate.archive)
	});
	review = page.getByRole('region', { name: 'Weather workspace' });
	await expect(review).toBeVisible();
	await expect(review.getByText(/1\.1\.0 · update/)).toBeVisible();
	await expect(review.getByText('1 reviewed changes')).toBeVisible();
	await review.getByRole('button', { name: 'Prepare update' }).click();
	await expect(review.getByRole('button', { name: 'Preview selected' })).toBeEnabled();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	const library = page.getByRole('dialog', { name: 'Shared sources' });
	await expect(library.getByText('1.1.0', { exact: true })).toBeVisible();
	const download = page.waitForEvent('download');
	await library.getByRole('button', { name: 'Export fork' }).click();
	const path = await (await download).path();
	expect(path).not.toBeNull();
	await verifyPortableFork(
		new Uint8Array(await readFile(path ?? '')),
		fixtures.compatibleUpdate.commit
	);
	await library.getByRole('button', { name: 'Close shared sources' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('routes fork personalization through one composer and activates a real two-parent merge', async ({
	page
}) => {
	test.setTimeout(120_000);
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const fileInput = page.locator('input[type="file"][aria-label="Open shared file"]');
	await fileInput.setInputFiles({
		name: fixtures.initial.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.initial.archive)
	});
	let review = page.getByRole('region', { name: 'Weather workspace' });
	await review.getByRole('button', { name: 'Retain selected' }).click();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();

	const composer = page.getByRole('textbox', { name: 'Message Flect' });
	await composer.fill(`Personalize shared fork ${fixtures.initial.commit}`);
	await composer.press('Enter');
	await expect(page.locator('form.composer')).toHaveAttribute('aria-busy', 'false', {
		timeout: 30_000
	});
	completedPromptPages.add(page);
	await expect(page.getByRole('region', { name: 'Import decision' })).toHaveCount(0);

	await fileInput.setInputFiles({
		name: fixtures.compatibleUpdate.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.compatibleUpdate.archive)
	});
	review = page.getByRole('region', { name: 'Weather workspace' });
	await expect(review.getByText(/1\.1\.0 · update/)).toBeVisible({
		timeout: 30_000
	});
	await review.getByRole('button', { name: 'Prepare update' }).click();
	await expect(review.getByText(/1\.1\.0 · fork/)).toBeVisible({
		timeout: 30_000
	});
	await expect(review.getByRole('button', { name: 'Preview selected' })).toBeEnabled();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	const library = page.getByRole('dialog', { name: 'Shared sources' });
	const download = page.waitForEvent('download');
	await library.getByRole('button', { name: 'Export fork' }).click();
	const path = await (await download).path();
	expect(path).not.toBeNull();
	const exported = await parsePortableForkExport(new Uint8Array(await readFile(path ?? '')));
	expect(exported.parents).toHaveLength(2);
	expect(exported.parents[0]).not.toBe(fixtures.initial.commit);
	expect(exported.parents[1]).toBe(fixtures.compatibleUpdate.commit);
	expect(exported.personalized).toContain('My weather layout');
	expect(exported.upstream).toContain('refreshed: true');
	expect(exported.decoded.manifest.signatures).toEqual([]);
	await library.getByRole('button', { name: 'Close shared sources' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('resolves a real Git conflict with Flect and activates only the explicit resolution', async ({
	page
}) => {
	test.setTimeout(120_000);
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const fileInput = page.locator('input[type="file"][aria-label="Open shared file"]');
	await fileInput.setInputFiles({
		name: fixtures.initial.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.initial.archive)
	});
	let review = page.getByRole('region', { name: 'Weather workspace' });
	await review.getByRole('button', { name: 'Retain selected' }).click();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();

	const composer = page.getByRole('textbox', { name: 'Message Flect' });
	await composer.fill(`Personalize shared conflict fork ${fixtures.initial.commit}`);
	await composer.press('Enter');
	await expect(page.locator('form.composer')).toHaveAttribute('aria-busy', 'false', {
		timeout: 30_000
	});
	completedPromptPages.add(page);
	await expect(page.getByRole('region', { name: 'Import decision' })).toHaveCount(0);

	await fileInput.setInputFiles({
		name: fixtures.conflictingUpdate.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.conflictingUpdate.archive)
	});
	review = page.getByRole('region', { name: 'Weather workspace' });
	await review.getByRole('button', { name: 'Prepare update' }).click();
	await expect(review.getByText(/2\.0\.0-conflict · conflict/)).toBeVisible({
		timeout: 30_000
	});
	await expect(review.getByRole('button', { name: 'Continue with my fork' })).toBeEnabled();
	await expect(review.getByRole('button', { name: 'Resolve conflict with Flect' })).toBeEnabled();
	await expect(review.getByRole('button', { name: 'Discard update' })).toBeEnabled();
	await expect(review.getByRole('button', { name: 'Preview selected' })).toHaveCount(0);
	await expectAccessible(page, '.share-review');

	await review.getByRole('button', { name: 'Resolve conflict with Flect' }).click();
	await expect(page.locator('.agent-rail-container')).not.toHaveAttribute('inert', '');
	await expect(review.getByText(/2\.0\.0-conflict · fork/)).toBeVisible({
		timeout: 30_000
	});
	completedShapePages.add(page);
	await expect(page.getByRole('region', { name: 'Import decision' })).toHaveCount(0);
	await expect(review.getByRole('button', { name: 'Preview selected' })).toBeEnabled();
	await review.getByRole('button', { name: 'Preview selected' }).click();
	await page.getByRole('button', { name: 'Activate app' }).click();

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	const library = page.getByRole('dialog', { name: 'Shared sources' });
	const download = page.waitForEvent('download');
	await library.getByRole('button', { name: 'Export fork' }).click();
	const path = await (await download).path();
	expect(path).not.toBeNull();
	const exported = await parseResolvedWeatherExport(new Uint8Array(await readFile(path ?? '')));
	expect(exported.parents).toHaveLength(2);
	expect(exported.parents[0]).not.toBe(fixtures.initial.commit);
	expect(exported.parents[1]).toBe(fixtures.conflictingUpdate.commit);
	expect(exported.weather).toContain('label: "Storm"');
	expect(exported.weather).toContain('personal: true');
	expect(exported.weather).toContain('warning: true');
	expect(exported.decoded.manifest.signatures).toEqual([]);
	await library.getByRole('button', { name: 'Close shared sources' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('reviews a credential-free HTTPS share through the same inactive boundary', async ({
	page
}) => {
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const url = 'https://fixtures.flect.test/weather.flect-share';
	let requestHeaders: Record<string, string> | undefined;
	await page.route(url, async (route) => {
		requestHeaders = await route.request().allHeaders();
		await route.fulfill({
			status: 200,
			contentType: 'application/octet-stream',
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin'
			},
			body: Buffer.from(fixtures.initial.archive)
		});
	});

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Review shared source' }).click();
	const dialog = page.getByRole('dialog', { name: 'Review a shared source' });
	await dialog.getByLabel('Shared file URL').fill(url);
	await dialog.getByRole('button', { name: 'Review source' }).click();

	const review = page.getByRole('region', { name: 'Weather workspace' });
	await expect(review).toBeVisible();
	await expect(review.getByText('Shared file URL', { exact: true })).toBeVisible();
	expect(requestHeaders?.authorization).toBeUndefined();
	expect(requestHeaders?.cookie).toBeUndefined();
	await expect(review.getByText('Inactive until you activate it')).toBeVisible();
	await review.getByRole('button', { name: 'Discard shared source' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('clones and reviews an exact public Git descriptor through wasm-git', async ({ page }) => {
	test.setTimeout(120_000);
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const root = await materializePublicGit(fixtures.publicGit.files);
	const requests: Array<string> = [];
	const pattern = /^https:\/\/fixtures\.flect\.test\/weather\.git(?:\/.*)?(?:\?.*)?$/;
	try {
		await page.route(pattern, async (route, request) => {
			const path = `${request.method()} ${new URL(request.url()).pathname}`;
			const response = await routePublicGit(route, request, root, fixtures.publicGit.files);
			requests.push(`${path} -> ${response}`);
		});
		await page.getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('menuitem', { name: 'Review shared source' }).click();
		const dialog = page.getByRole('dialog', {
			name: 'Review a shared source'
		});
		await dialog.getByRole('tab', { name: 'Public Git' }).click();
		await dialog.getByLabel('Repository URL').fill('https://fixtures.flect.test/weather.git');
		await dialog.getByLabel('Exact commit').fill(fixtures.publicGit.descriptorCommit);
		await dialog.getByRole('button', { name: 'Review source' }).click();

		const review = page.getByRole('region', { name: 'Weather workspace' });
		const sourceError = dialog.getByRole('alert');
		await expect
			.poll(async () => (await review.isVisible()) || (await sourceError.isVisible()), {
				timeout: 30_000
			})
			.toBe(true);
		expect(
			await sourceError.isVisible(),
			`Git HTTP requests: ${requests.join(', ') || 'none'}`
		).toBe(false);
		await expect(review).toBeVisible({ timeout: 30_000 });
		await expect(review.getByText('Public Git revision', { exact: true })).toBeVisible();
		await review.getByText('Source and lineage details').click();
		await expect(review.getByText(fixtures.publicGit.descriptorCommit)).toBeVisible();
		expect(requests.some((request) => request.includes('/info/refs'))).toBe(true);
		expect(
			requests.some(
				(request) => request.includes('/objects/') || request.includes('/git-upload-pack')
			)
		).toBe(true);
		await review.getByRole('button', { name: 'Discard shared source' }).click();
	} finally {
		await page.unroute(pattern);
		await rm(root, { force: true, recursive: true });
	}
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('opens a host-composed private adapter without exposing its credential closure', async ({
	page
}) => {
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	await page.addInitScript(
		({ adapterId, archive, name, reference, secretSentinel }) => {
			Reflect.set(globalThis, '__flectPrivateShareDiagnostic', {
				adapterId,
				archive: new Uint8Array(archive),
				name,
				reference,
				secretSentinel
			});
		},
		{
			adapterId: fixtures.privateAdapter.adapterId,
			archive: [...fixtures.privateAdapter.fixture.archive],
			name: 'Fixture vault',
			reference: fixtures.privateAdapter.reference,
			secretSentinel: fixtures.privateAdapter.secretSentinel
		}
	);
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).toBeEnabled();
	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Review shared source' }).click();
	const dialog = page.getByRole('dialog', { name: 'Review a shared source' });
	await dialog.getByRole('tab', { name: 'Private source' }).click();
	await dialog.getByLabel('Private reference').fill(fixtures.privateAdapter.reference);
	await dialog.getByRole('button', { name: 'Review source' }).click();

	const review = page.getByRole('region', { name: 'Weather workspace' });
	await expect(review).toBeVisible();
	await expect(review.getByText('Private source · fixture-vault', { exact: true })).toBeVisible();
	await review.getByText('Source and lineage details').click();
	await expect(review.getByText('Opaque reference digest')).toBeVisible();
	await expect(page.locator('body')).not.toContainText(fixtures.privateAdapter.secretSentinel);
	expect(await page.evaluate(() => Reflect.has(globalThis, '__flectPrivateShareDiagnostic'))).toBe(
		false
	);
	await review.getByRole('button', { name: 'Discard shared source' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});

test('sharing review and source library remain contained at 320px and 200 percent text', async ({
	page
}) => {
	const fixture = await Effect.runPromise(makeInitialSharingFixture());
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({
		colorScheme: 'light',
		forcedColors: 'active',
		reducedMotion: 'reduce'
	});
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '200%';
	});
	await page.locator('input[type="file"][aria-label="Open shared file"]').setInputFiles({
		name: fixture.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixture.archive)
	});
	await expect(page.getByRole('button', { name: 'Discard shared source' })).toBeVisible();
	const geometry = await page.evaluate(() => {
		const review = document.querySelector('.share-review');
		if (!(review instanceof HTMLElement)) throw new Error('Review is missing');
		const bounds = review.getBoundingClientRect();
		return {
			documentWidth: document.documentElement.scrollWidth,
			left: bounds.left,
			right: bounds.right,
			viewportWidth: window.innerWidth
		};
	});
	expect(geometry.documentWidth).toBe(geometry.viewportWidth);
	expect(geometry.left).toBeGreaterThanOrEqual(0);
	expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
	await expectAccessible(page, '.share-review');
	await page.getByRole('button', { name: 'Discard shared source' }).click();
});

test('inspects every artifact kind inertly and contains a malicious local archive', async ({
	page
}, testInfo) => {
	test.setTimeout(120_000);
	const fixtures = await Effect.runPromise(makeSharingFixtureSet());
	const fileInput = page.locator('input[type="file"][aria-label="Open shared file"]');

	await fileInput.setInputFiles({
		name: fixtures.allArtifacts.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.allArtifacts.archive)
	});
	const review = page.getByRole('region', {
		name: 'Portable artifact showcase'
	});
	await expect(review).toBeVisible();
	await expect(review.getByRole('checkbox')).toHaveCount(5);
	for (const kind of ['experience', 'component', 'theme', 'workflow', 'extension']) {
		await expect(review.getByText(kind, { exact: true })).toBeVisible();
	}
	await expect(review.getByText('Inactive until you activate it')).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Flect' })).not.toBeVisible();
	await expectAccessible(page, '.share-review');
	await page.screenshot({
		path: testInfo.outputPath('sharing-all-artifacts-review.png')
	});

	await review.getByRole('button', { name: 'Retain selected' }).click();
	await expect(review.getByRole('button', { name: 'Preview selected' })).toBeEnabled();
	await review.getByRole('button', { name: 'Discard shared source' }).click();
	await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();

	await page.getByRole('button', { name: 'Actions' }).click();
	await page.getByRole('menuitem', { name: 'Manage shared sources' }).click();
	const library = page.getByRole('dialog', { name: 'Shared sources' });
	await expect(library.getByText('5 parts in app')).toBeVisible();
	await library.getByRole('button', { name: 'Close shared sources' }).click();

	await fileInput.setInputFiles({
		name: fixtures.malicious.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.malicious.archive)
	});
	const failure = page.getByRole('alert');
	await expect(failure).toHaveText(/The shared file could not be reviewed safely/);
	await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
	await expect(page.getByText('private archive detail')).toHaveCount(0);
	await expect(page.locator('body')).not.toContainText(fixtures.privateAdapter.secretSentinel);

	await fileInput.setInputFiles({
		name: fixtures.initial.fileName,
		mimeType: 'application/octet-stream',
		buffer: Buffer.from(fixtures.initial.archive)
	});
	await expect(page.getByRole('region', { name: 'Weather workspace' })).toBeVisible();
	await expect(failure).not.toBeVisible();
	await page.getByRole('button', { name: 'Discard shared source' }).click();
	await expect(page.getByRole('button', { name: 'Open settings' })).toContainText(
		'Local control off'
	);
});
