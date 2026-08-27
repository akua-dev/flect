import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { Effect, Schema } from 'effect';
import {
	GitShareImportDiagnosticResult,
	GitShareLifecycleDiagnosticResult,
	GitTransactionDiagnosticResult,
	GitWorkspaceDiagnosticResult
} from '../../shared/git-workspace';

const execFileAsync = promisify(execFile);

test('retains, merges, conflicts, rejects, and deletes guarded shared Git history', async ({
	page
}) => {
	test.setTimeout(120_000);
	const workspace = `share-lifecycle-${Date.now()}`;
	await page.goto(`/?git-share-lifecycle-diagnostic=1&workspace=${workspace}`);
	const resultNode = page.getByTestId('git-share-lifecycle-result');
	await expect(resultNode).not.toHaveAttribute('data-state', 'running', {
		timeout: 90_000
	});
	await expect(resultNode).toHaveAttribute('data-state', 'complete', {
		timeout: 1_000
	});
	const result = await Schema.decodeUnknownPromise(GitShareLifecycleDiagnosticResult)(
		JSON.parse((await resultNode.textContent()) ?? '{}')
	);

	expect(result.forkCommit).not.toBe(result.baseCommit);
	expect(result.upstreamCommit).not.toBe(result.baseCommit);
	expect(result.mergedCommit).not.toBe(result.forkCommit);
	expect(result.mergeParents).toEqual([result.forkCommit, result.upstreamCommit]);
	expect(result.conflictPaths).toEqual(['components/card/shared.ts']);
	expect(result.candidateRemoved).toBe(true);
	expect(result.forkRemoved).toBe(true);
	expect(result.unrelatedPreserved).toBe(true);

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download shared history' }).click();
	const download = await downloadPromise;
	const archive = await download.path();
	expect(archive).not.toBeNull();
	if (archive === null) throw new Error('The shared Git history download did not produce a file.');
	const extractionRoot = await mkdtemp(join(tmpdir(), 'flect-share-git-'));
	await mkdir(join(extractionRoot, 'repository'), { recursive: true });
	await execFileAsync('tar', ['-xf', archive, '-C', join(extractionRoot, 'repository')]);
	await execFileAsync('git', ['-C', join(extractionRoot, 'repository'), 'init', '-q']);
	await execFileAsync('git', ['-C', join(extractionRoot, 'repository'), 'fsck', '--full']);
	const { stdout: parents } = await execFileAsync('git', [
		'-C',
		join(extractionRoot, 'repository'),
		'show',
		'-s',
		'--format=%P',
		result.mergedCommit
	]);
	expect(parents.trim().split(/\s+/)).toEqual(result.mergeParents);
});

test('imports an exact shared payload through disposable OPFS Git', async ({ page }) => {
	test.setTimeout(120_000);
	const workspace = `share-${Date.now()}`;
	await page.goto(`/?git-share-import-diagnostic=1&workspace=${workspace}`);
	const resultNode = page.getByTestId('git-share-import-result');
	await expect(resultNode).toHaveAttribute('data-state', 'complete', {
		timeout: 90_000
	});
	const result = await Schema.decodeUnknownPromise(GitShareImportDiagnosticResult)(
		JSON.parse((await resultNode.textContent()) ?? '{}')
	);

	expect(result.descriptorCommit).not.toBe(result.payloadCommit);
	expect(result.importedCommit).toBe(result.payloadCommit);
	expect(result.fileCount).toBe(1);
	expect(result.repositoryBytes).toBeGreaterThan(1_024);
	expect(result.manifestFound).toBe(true);
	expect(result.payloadFound).toBe(true);
});

test('uses a persistent real Git repository without system Git', async ({ page }) => {
	test.setTimeout(120_000);
	const workspace = `e2e-${Date.now()}`;
	await page.goto(`/?git-diagnostic=1&workspace=${workspace}`);

	const resultNode = page.getByTestId('git-diagnostic-result');
	await expect(resultNode).toHaveAttribute('data-state', 'complete', {
		timeout: 90_000
	});

	const result = await Schema.decodeUnknownPromise(GitWorkspaceDiagnosticResult)(
		JSON.parse((await resultNode.textContent()) ?? '{}')
	);

	expect(result.initialCommit).toMatch(/^[0-9a-f]{40}$/);
	expect(result.proposalCommit).toMatch(/^[0-9a-f]{40}$/);
	expect(result.acceptedCommit).toMatch(/^[0-9a-f]{40}$/);
	expect(result.reopenedCommit).toBe(result.acceptedCommit);
	expect(result.rollbackCommit).toBe(result.initialCommit);
	expect(result.conflictPaths).toEqual(['flect.json']);
	expect(result.diff).toContain('candidate');
	expect(result.status).toContain('flect.json');

	await page.reload();
	await expect(resultNode).toHaveAttribute('data-state', 'complete', {
		timeout: 90_000
	});
	const reloaded = await Schema.decodeUnknownPromise(GitWorkspaceDiagnosticResult)(
		JSON.parse((await resultNode.textContent()) ?? '{}')
	);
	expect(reloaded.reopenedCommit).toBe(result.rollbackCommit);

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download repository' }).click();
	const download = await downloadPromise;
	const archive = await download.path();
	expect(archive).not.toBeNull();
	if (archive === null) {
		throw new Error('The Git repository download did not produce a file.');
	}

	const extractionRoot = await mkdtemp(join(tmpdir(), 'flect-git-export-'));
	await mkdir(join(extractionRoot, 'repository'), { recursive: true });
	await execFileAsync('tar', ['-xf', archive, '-C', join(extractionRoot, 'repository')]);
	await execFileAsync('git', ['-C', join(extractionRoot, 'repository'), 'fsck', '--full']);
	const { stdout } = await execFileAsync('git', [
		'-C',
		join(extractionRoot, 'repository'),
		'rev-parse',
		'HEAD'
	]);
	expect(stdout.trim()).toBe(result.rollbackCommit);
	const [{ stdout: userName }, { stdout: userEmail }] = await Effect.runPromise(
		Effect.all(
			[
				Effect.promise(() =>
					execFileAsync('git', [
						'-C',
						join(extractionRoot, 'repository'),
						'config',
						'--local',
						'--get',
						'user.name'
					])
				),
				Effect.promise(() =>
					execFileAsync('git', [
						'-C',
						join(extractionRoot, 'repository'),
						'config',
						'--local',
						'--get',
						'user.email'
					])
				)
			],
			{ concurrency: 'unbounded' }
		)
	);
	expect(userName.trim()).toBe('Flect');
	expect(userEmail.trim()).toBe('workspace@flect.local');
});

test('serializes competing browser checkpoints and rejects the stale writer', async ({
	context,
	page
}) => {
	test.setTimeout(120_000);
	const workspace = `race-${Date.now()}`;
	const transactionResult = (target: typeof page) => target.getByTestId('git-transaction-result');

	await page.goto(`/?git-transaction-diagnostic=1&workspace=${workspace}&value=initial`);
	await expect(transactionResult(page)).toHaveAttribute('data-state', 'ready', {
		timeout: 90_000
	});
	await page.getByRole('button', { name: 'Run checkpoint' }).click();
	await expect(transactionResult(page)).toHaveAttribute('data-state', 'complete');
	const initial = await Schema.decodeUnknownPromise(GitTransactionDiagnosticResult)(
		JSON.parse((await transactionResult(page).textContent()) ?? '{}')
	);
	expect(initial.state).toBe('success');
	expect(initial.snapshotValue).toBe('initial');
	expect(initial.snapshotPaths).toContain('obsolete.txt');
	expect(initial.commit).toMatch(/^[0-9a-f]{40}$/);
	if (initial.commit === undefined) {
		throw new Error('The initial checkpoint did not return an object ID.');
	}

	const first = await context.newPage();
	const second = await context.newPage();
	const makeUrl = (value: string) => {
		const query = new URLSearchParams({
			'git-transaction-diagnostic': '1',
			workspace,
			expected: initial.commit ?? '',
			value
		});
		return `/?${query.toString()}`;
	};
	await Effect.runPromise(
		Effect.all(
			[
				Effect.promise(() => first.goto(makeUrl('first'))),
				Effect.promise(() => second.goto(makeUrl('second')))
			],
			{ concurrency: 'unbounded', discard: true }
		)
	);
	await Effect.runPromise(
		Effect.forEach(
			[first, second],
			(target) =>
				Effect.promise(() =>
					expect(transactionResult(target)).toHaveAttribute('data-state', 'ready', {
						timeout: 90_000
					})
				),
			{ concurrency: 'unbounded', discard: true }
		)
	);
	await Effect.runPromise(
		Effect.forEach(
			[first, second],
			(target) =>
				Effect.promise(() => target.getByRole('button', { name: 'Run checkpoint' }).click()),
			{ concurrency: 'unbounded', discard: true }
		)
	);
	await Effect.runPromise(
		Effect.forEach(
			[first, second],
			(target) =>
				Effect.promise(() =>
					expect(transactionResult(target)).toHaveAttribute('data-state', 'complete')
				),
			{ concurrency: 'unbounded', discard: true }
		)
	);
	const outcomes = await Effect.runPromise(
		Effect.forEach(
			[first, second],
			(target) =>
				Effect.promise(async () =>
					Schema.decodeUnknownPromise(GitTransactionDiagnosticResult)(
						JSON.parse((await transactionResult(target).textContent()) ?? '{}')
					)
				),
			{ concurrency: 'unbounded' }
		)
	);
	expect(outcomes).toContainEqual(
		expect.objectContaining({ state: 'stale-ref', reason: 'stale-ref' })
	);
	expect(outcomes).toContainEqual(expect.objectContaining({ state: 'success' }));
	const winner = outcomes.find((outcome) => outcome.state === 'success');
	expect(winner?.snapshotPaths).not.toContain('obsolete.txt');
});
