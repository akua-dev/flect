import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	ShareArtifactDescriptor,
	ShareEmbeddedRepository,
	type ShareManifest
} from '../../packages/product/src/share';
import { ShareGitInstallationSource } from '../../shared/share-installation';
import { buildShareReview } from './share-review';
import { ShareSignatureAssessment } from './share-signature-verifier';

const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const artifact = (kind: ShareArtifactDescriptor['kind'], root: string) =>
	ShareArtifactDescriptor.make({
		id: `dev.flect.suite.${kind}`,
		kind,
		version: '1.0.0',
		sourceRoot: root,
		contentSha256: hash,
		...(kind === 'experience' || kind === 'extension'
			? { capsule: { path: `artifacts/${kind}.flect`, sha256: hash } }
			: {})
	});

const manifest = (): ShareManifest => ({
	formatVersion: 1,
	id: 'dev.flect.shared-suite',
	name: 'Shared suite',
	version: '1.1.0',
	repository: ShareEmbeddedRepository.make({
		_tag: 'embedded',
		archivePath: 'repository.tar',
		sha256: hash,
		commit
	}),
	artifacts: [
		artifact('experience', 'experiences/app'),
		artifact('component', 'components/card'),
		artifact('theme', 'themes/calm'),
		artifact('workflow', 'workflows/triage'),
		artifact('extension', 'extensions/guide')
	],
	compatibility: {
		flect: '>=0.2.0 <1.0.0',
		platforms: ['browser', 'macos']
	},
	provenance: {
		publisher: 'akua-dev',
		source: 'https://example.test/shared-suite',
		revision: 'descriptor-v2',
		builder: '@flect/product'
	},
	signatures: [],
	migrations: []
});

const origin = ShareGitInstallationSource.make({
	_tag: 'git',
	url: 'https://example.test/shared-suite.git',
	descriptorCommit: 'c'.repeat(40),
	archiveSha256: hash
});

const signature = (status: ShareSignatureAssessment['status']) =>
	ShareSignatureAssessment.make({
		status,
		keyIds: status === 'unsigned' ? [] : ['akua:key'],
		authoritative: false
	});

describe('share review', () => {
	it.effect('projects all artifact kinds and ordered agent-facing changes', () =>
		Effect.gen(function* () {
			const review = yield* buildShareReview({
				lineage: 'update',
				origin,
				manifest: manifest(),
				previousManifest: {
					...manifest(),
					version: '1.0.0',
					artifacts: manifest().artifacts.slice(0, 4)
				},
				files: [
					{ path: 'AGENTS.md', contents: new TextEncoder().encode('new') },
					{
						path: 'package-lock.json',
						contents: new TextEncoder().encode('new')
					},
					{
						path: 'ui/flect.json',
						contents: new TextEncoder().encode('new')
					},
					{
						path: 'extensions/guide/index.ts',
						contents: new TextEncoder().encode('new')
					}
				],
				previousFiles: [
					{ path: 'AGENTS.md', contents: new TextEncoder().encode('old') },
					{
						path: 'package-lock.json',
						contents: new TextEncoder().encode('old')
					},
					{ path: 'removed.ts', contents: new TextEncoder().encode('old') }
				],
				conflictPaths: [],
				flectVersion: '0.2.0',
				platform: 'browser',
				signature: signature('present-unverified')
			});

			assert.deepStrictEqual(
				review.artifacts.map((entry) => entry.kind),
				['component', 'experience', 'extension', 'theme', 'workflow']
			);
			assert.deepStrictEqual(
				review.changes.map((change) => [change.category, change.kind, change.path]),
				[
					['instructions', 'modified', 'AGENTS.md'],
					['extension', 'added', 'extensions/guide/index.ts'],
					['dependency', 'modified', 'package-lock.json'],
					['source', 'removed', 'removed.ts'],
					['interface', 'added', 'ui/flect.json']
				]
			);
			assert.include(review.blockers, 'extension-test-required');
			assert.include(review.blockers, 'grant-review-required');
			assert.deepStrictEqual(review.actions, ['merge-update', 'reject']);
			assert.isTrue(review.inactive);
		})
	);

	it.effect('maps new, replacement, and conflict lineage to safe actions', () =>
		Effect.gen(function* () {
			const cases = [
				['new', ['install', 'fork', 'reject']],
				['replacement', ['keep-replacement', 'reject']],
				['conflict', ['continue-fork', 'shape-conflict', 'reject']]
			] as const;
			for (const [lineage, actions] of cases) {
				const review = yield* buildShareReview({
					lineage,
					origin,
					manifest: manifest(),
					files: [],
					previousFiles: [],
					conflictPaths: lineage === 'conflict' ? ['ui/flect.json'] : [],
					flectVersion: '0.2.0',
					platform: 'browser',
					signature: signature('unsigned')
				});
				assert.deepStrictEqual(review.actions, actions);
			}
		})
	);

	it.effect('blocks invalid signatures while verification never grants authority', () =>
		Effect.gen(function* () {
			const invalid = yield* buildShareReview({
				lineage: 'new',
				origin,
				manifest: manifest(),
				files: [],
				previousFiles: [],
				conflictPaths: [],
				flectVersion: '0.2.0',
				platform: 'browser',
				signature: signature('invalid')
			});
			const verified = yield* buildShareReview({
				lineage: 'new',
				origin,
				manifest: manifest(),
				files: [],
				previousFiles: [],
				conflictPaths: [],
				flectVersion: '0.2.0',
				platform: 'browser',
				signature: signature('verified')
			});
			assert.include(invalid.blockers, 'invalid-signature');
			assert.isFalse(verified.signature.authoritative);
			assert.notInclude(verified.blockers, 'invalid-signature');
		})
	);
});
