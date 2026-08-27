import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { decodeShareArchive } from '../../../src/sharing/share-archive';
import { makeSharingFixtureSet, type SharingFixture } from './generate';

const run = Effect.fn('Flect.TestFixture.runNative')(function* (
	directory: string,
	args: ReadonlyArray<string>
) {
	const [command, ...rest] = args;
	assert.isDefined(command);
	const result = yield* Effect.promise(
		() =>
			new Promise<readonly [number, string, string]>((resolve, reject) => {
				const child = spawn(command, rest, {
					cwd: directory,
					stdio: ['ignore', 'pipe', 'pipe']
				});
				const stdout: Array<Buffer> = [];
				const stderr: Array<Buffer> = [];
				child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
				child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
				child.once('error', reject);
				child.once('close', (code) =>
					resolve([
						code ?? 1,
						Buffer.concat(stdout).toString('utf8'),
						Buffer.concat(stderr).toString('utf8')
					])
				);
			})
	);
	assert.strictEqual(result[0], 0, result[2]);
	return result[1].trim();
});

const inspectRepository = Effect.fn('Flect.TestFixture.inspectRepository')(function* (
	fixture: SharingFixture
) {
	const decoded = yield* decodeShareArchive(fixture.archive);
	return yield* Effect.acquireUseRelease(
		Effect.promise(() => mkdtemp(join(tmpdir(), 'flect-sharing-proof-'))),
		(directory) =>
			Effect.gen(function* () {
				const repositoryPath = join(directory, 'repository.tar');
				yield* Effect.promise(() => writeFile(repositoryPath, decoded.repository));
				yield* run(directory, ['tar', '-xf', repositoryPath, '-C', directory]);
				yield* run(directory, ['git', 'init', '-q']);
				yield* run(directory, [
					'git',
					'fsck',
					'--full',
					'--no-reflogs',
					decoded.manifest.repository.commit
				]);
				const payloadParents = yield* run(directory, [
					'git',
					'show',
					'-s',
					'--format=%P',
					fixture.commit
				]);
				const descriptorParents = yield* run(directory, [
					'git',
					'show',
					'-s',
					'--format=%P',
					fixture.descriptorCommit
				]);
				return { decoded, payloadParents, descriptorParents };
			}),
		(directory) => Effect.promise(() => rm(directory, { force: true, recursive: true }))
	);
});

describe('deterministic sharing fixtures', () => {
	it.effect(
		'produces real update lineages, all artifact kinds, private source metadata, and a malicious archive',
		() =>
			Effect.gen(function* () {
				const first = yield* makeSharingFixtureSet();
				const second = yield* makeSharingFixtureSet();

				for (const key of [
					'initial',
					'compatibleUpdate',
					'conflictingUpdate',
					'allArtifacts',
					'malicious'
				] as const) {
					assert.strictEqual(first[key].commit, second[key].commit);
					assert.strictEqual(
						Buffer.compare(Buffer.from(first[key].archive), Buffer.from(second[key].archive)),
						0
					);
				}

				const initial = yield* inspectRepository(first.initial);
				const compatible = yield* inspectRepository(first.compatibleUpdate);
				const conflicting = yield* inspectRepository(first.conflictingUpdate);
				const allArtifacts = yield* inspectRepository(first.allArtifacts);

				assert.strictEqual(initial.decoded.manifest.version, '1.0.0');
				assert.strictEqual(compatible.decoded.manifest.version, '1.1.0');
				assert.strictEqual(conflicting.decoded.manifest.version, '2.0.0-conflict');
				assert.deepStrictEqual(
					allArtifacts.decoded.manifest.artifacts.map((artifact) => artifact.kind),
					['experience', 'component', 'theme', 'workflow', 'extension']
				);
				assert.strictEqual(allArtifacts.decoded.artifacts.length, 2);

				assert.strictEqual(first.compatibleUpdate.parentCommit, first.initial.commit);
				assert.strictEqual(first.conflictingUpdate.parentCommit, first.initial.commit);
				assert.match(first.initial.descriptorCommit, /^[0-9a-f]{40}$/);
				assert.notStrictEqual(first.initial.descriptorCommit, first.initial.commit);
				assert.strictEqual(initial.payloadParents, '');
				assert.strictEqual(initial.descriptorParents, first.initial.commit);
				assert.strictEqual(compatible.payloadParents, first.initial.commit);
				assert.strictEqual(compatible.descriptorParents, first.compatibleUpdate.commit);
				assert.strictEqual(conflicting.payloadParents, first.initial.commit);
				assert.strictEqual(conflicting.descriptorParents, first.conflictingUpdate.commit);
				assert.strictEqual(allArtifacts.payloadParents, first.initial.commit);
				assert.strictEqual(allArtifacts.descriptorParents, first.allArtifacts.commit);

				assert.strictEqual(first.privateAdapter.adapterId, 'fixture-vault');
				assert.strictEqual(first.privateAdapter.reference, 'weather/team-alpha');
				assert.notInclude(
					new TextDecoder().decode(first.privateAdapter.fixture.archive),
					first.privateAdapter.secretSentinel
				);

				assert.strictEqual(first.publicGit.descriptorCommit, first.initial.descriptorCommit);
				assert.include(
					first.publicGit.files.map((file) => file.path),
					'HEAD'
				);
				assert.include(
					first.publicGit.files.map((file) => file.path),
					'info/refs'
				);
				assert.isTrue(first.publicGit.files.some((file) => file.path.startsWith('objects/')));
				assert.deepStrictEqual(
					first.publicGit.files.map((file) => file.path),
					second.publicGit.files.map((file) => file.path)
				);
				for (let index = 0; index < first.publicGit.files.length; index += 1) {
					assert.strictEqual(
						Buffer.compare(
							Buffer.from(first.publicGit.files[index]?.contents ?? []),
							Buffer.from(second.publicGit.files[index]?.contents ?? [])
						),
						0
					);
				}

				const malicious = yield* Effect.exit(decodeShareArchive(first.malicious.archive));
				assert.strictEqual(malicious._tag, 'Failure');
			}),
		15_000
	);
});
