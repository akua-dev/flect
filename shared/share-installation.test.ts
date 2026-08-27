import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	ShareGitInstallationSource,
	ShareInstallationRecord,
	ShareInstallationRefs,
	ShareInstalledArtifact,
	SharePendingCandidate,
	validateShareInstallationRecord
} from './share-installation';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);

const record = () =>
	ShareInstallationRecord.make({
		formatVersion: 1,
		shareId: 'dev.flect.shared-suite',
		version: '1.0.0',
		source: ShareGitInstallationSource.make({
			_tag: 'git',
			url: 'https://example.test/shared-suite.git',
			descriptorCommit: 'c'.repeat(40),
			archiveSha256: hash
		}),
		manifestSha256: hash,
		repositorySha256: hash,
		artifacts: [
			ShareInstalledArtifact.make({
				id: 'dev.flect.shared-suite.component',
				kind: 'component',
				version: '1.0.0',
				contentSha256: hash
			}),
			ShareInstalledArtifact.make({
				id: 'dev.flect.shared-suite.theme',
				kind: 'theme',
				version: '1.0.0',
				contentSha256: hash
			})
		],
		installedArtifactIds: ['dev.flect.shared-suite.component', 'dev.flect.shared-suite.theme'],
		refs: ShareInstallationRefs.make({
			base: commit,
			upstream: commit,
			fork: commit
		}),
		createdAt: 1,
		updatedAt: 1
	});

describe('share installation records', () => {
	it.effect('decodes a strict authority-free installation receipt', () =>
		Effect.gen(function* () {
			const decoded = yield* validateShareInstallationRecord(record());
			assert.strictEqual(decoded.refs.base, decoded.refs.fork);
			assert.deepStrictEqual(decoded.installedArtifactIds, [
				'dev.flect.shared-suite.component',
				'dev.flect.shared-suite.theme'
			]);
			assert.notInclude(JSON.stringify(decoded), 'grant');
			assert.notInclude(JSON.stringify(decoded), 'credential');
		})
	);

	it.effect('persists a bounded inactive candidate recovery pointer', () =>
		Effect.gen(function* () {
			const pending = SharePendingCandidate.make({
				archiveSha256: 'd'.repeat(64),
				lineage: 'update',
				origin: ShareGitInstallationSource.make({
					_tag: 'git',
					url: 'https://example.test/shared-suite.git',
					descriptorCommit: 'e'.repeat(40),
					archiveSha256: 'f'.repeat(64)
				}),
				conflictPaths: [],
				retainedAt: 2
			});
			const decoded = yield* validateShareInstallationRecord({
				...record(),
				refs: {
					...record().refs,
					upstream: 'e'.repeat(40),
					candidate: 'e'.repeat(40)
				},
				pending,
				updatedAt: 2
			});

			assert.deepStrictEqual(decoded.pending, pending);
			assert.notInclude(JSON.stringify(decoded.pending), 'token');
		})
	);

	it.effect('preserves a retained receipt after every artifact is removed', () =>
		Effect.gen(function* () {
			const decoded = yield* validateShareInstallationRecord({
				...record(),
				installedArtifactIds: [],
				updatedAt: 2
			});

			assert.deepStrictEqual(decoded.installedArtifactIds, []);
			assert.strictEqual(decoded.refs.fork, commit);
			assert.strictEqual(decoded.artifacts.length, 2);
		})
	);

	it.effect('rejects a persisted manifest that disagrees with its receipt', () =>
		Effect.gen(function* () {
			const invalid = yield* validateShareInstallationRecord({
				...record(),
				manifest: {
					formatVersion: 1,
					id: 'dev.flect.another-share',
					name: 'Another share',
					version: '1.0.0',
					repository: { _tag: 'git', commit },
					artifacts: [],
					compatibility: {
						flect: '>=0.2.0 <1.0.0',
						platforms: ['browser']
					},
					provenance: {
						publisher: 'example',
						source: 'https://example.test/share',
						revision: commit,
						builder: 'test'
					},
					signatures: [],
					migrations: []
				}
			}).pipe(Effect.flip);

			assert.strictEqual(invalid._tag, 'ShareInstallationFailure');
		})
	);

	it.effect('rejects duplicate artifacts, impossible refs, and private authority', () =>
		Effect.gen(function* () {
			const base = record();
			const cases: ReadonlyArray<unknown> = [
				{ ...base, artifacts: [base.artifacts[0], base.artifacts[0]] },
				{ ...base, installedArtifactIds: ['dev.flect.missing'] },
				{
					...base,
					refs: { ...base.refs, candidate: base.refs.fork }
				},
				{ ...base, updatedAt: 0 },
				{ ...base, grants: ['product:admin'] },
				{ ...base, credentials: { token: 'private-token' } }
			];
			for (const input of cases) {
				const failure = yield* validateShareInstallationRecord(input).pipe(Effect.flip);
				assert.strictEqual(failure._tag, 'ShareInstallationFailure');
				assert.notInclude(JSON.stringify(failure), 'private-token');
			}
		})
	);
});
