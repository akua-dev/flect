import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema, type SchemaAST } from 'effect';
import {
	hashShareArtifactSource,
	ShareArtifactDescriptor,
	ShareEmbeddedRepository,
	ShareGitRepository,
	ShareGitSource,
	ShareLocalSource,
	type ShareManifest,
	SharePrivateSource,
	ShareSource,
	ShareUrlSource,
	validateShareManifest
} from './share.js';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);

const artifact = (
	kind: ShareArtifactDescriptor['kind'],
	sourceRoot: string,
	capsulePath?: string
) =>
	ShareArtifactDescriptor.make({
		id: `dev.flect.${kind}`,
		kind,
		version: '1.0.0',
		sourceRoot,
		contentSha256: hash,
		...(capsulePath === undefined
			? {}
			: {
					capsule: {
						path: capsulePath,
						sha256: hash
					}
				})
	});

const manifest = (repository: ShareManifest['repository']) => ({
	formatVersion: 1 as const,
	id: 'dev.flect.shared-workbench',
	name: 'Shared workbench',
	version: '1.0.0',
	repository,
	artifacts: [
		artifact('experience', 'experiences/workbench', 'artifacts/app.flect'),
		artifact('component', 'components/project-card'),
		artifact('theme', 'themes/calm'),
		artifact('workflow', 'workflows/triage'),
		artifact('extension', 'extensions/guide', 'artifacts/guide.flect')
	],
	compatibility: {
		flect: '>=0.2.0 <1.0.0',
		platforms: ['browser' as const, 'macos' as const]
	},
	provenance: {
		publisher: 'akua-dev',
		source: 'https://github.com/akua-dev/flect-share-fixture',
		revision: commit,
		builder: '@flect/product'
	},
	signatures: [],
	migrations: []
});

describe('@flect/product share contracts', () => {
	it.effect('decodes all five artifact kinds and both repository forms', () =>
		Effect.gen(function* () {
			const embedded = yield* validateShareManifest(
				manifest(
					ShareEmbeddedRepository.make({
						_tag: 'embedded',
						archivePath: 'repository.tar',
						sha256: hash,
						commit
					})
				)
			);
			const git = yield* validateShareManifest(
				manifest(ShareGitRepository.make({ _tag: 'git', commit }))
			);

			assert.deepStrictEqual(
				embedded.artifacts.map((entry) => entry.kind),
				['experience', 'component', 'theme', 'workflow', 'extension']
			);
			assert.strictEqual(embedded.repository._tag, 'embedded');
			assert.strictEqual(git.repository._tag, 'git');
		})
	);

	it.effect('rejects duplicate IDs, wrong roots, ambiguous capsules, and private state', () =>
		Effect.gen(function* () {
			const base = manifest(
				ShareEmbeddedRepository.make({
					_tag: 'embedded',
					archivePath: 'repository.tar',
					sha256: hash,
					commit
				})
			);
			const cases: ReadonlyArray<unknown> = [
				{ ...base, artifacts: [base.artifacts[0], base.artifacts[0]] },
				{
					...base,
					artifacts: [artifact('component', 'themes/not-a-component')]
				},
				{
					...base,
					artifacts: [artifact('component', 'components/card', 'artifacts/card.flect')]
				},
				{
					...base,
					credentials: { token: 'private-share-secret' }
				}
			];

			for (const input of cases) {
				const failure = yield* validateShareManifest(input).pipe(Effect.flip);
				assert.strictEqual(failure._tag, 'ShareContractFailure');
				assert.notInclude(JSON.stringify(failure), 'private-share-secret');
			}
		})
	);

	it.effect('strictly decodes local, URL, Git, and private sources without credentials', () =>
		Effect.gen(function* () {
			const sources = [
				ShareLocalSource.make({
					_tag: 'local',
					name: 'workbench.flect-share',
					bytes: new Uint8Array([1, 2, 3])
				}),
				ShareUrlSource.make({
					_tag: 'url',
					url: 'https://example.test/workbench.flect-share'
				}),
				ShareGitSource.make({
					_tag: 'git',
					url: 'https://github.com/akua-dev/workbench.git',
					commit
				}),
				SharePrivateSource.make({
					_tag: 'private',
					adapterId: 'company-share',
					reference: 'workbench/1.0.0'
				})
			];

			for (const source of sources) {
				yield* Schema.decodeUnknownEffect(
					source._tag === 'local'
						? ShareLocalSource
						: source._tag === 'url'
							? ShareUrlSource
							: source._tag === 'git'
								? ShareGitSource
								: SharePrivateSource,
					strict
				)(source);
			}

			const failure = yield* Schema.decodeUnknownEffect(
				ShareUrlSource,
				strict
			)({
				_tag: 'url',
				url: 'https://example.test/workbench.flect-share',
				authorization: 'private-share-secret'
			}).pipe(Effect.flip);
			assert.strictEqual(failure._tag, 'SchemaError');
		})
	);

	it.effect('rejects malformed identities, receipts, bounds, and migrations', () =>
		Effect.gen(function* () {
			const base = manifest(
				ShareEmbeddedRepository.make({
					_tag: 'embedded',
					archivePath: 'repository.tar',
					sha256: hash,
					commit
				})
			);
			const cases: ReadonlyArray<unknown> = [
				{ ...base, id: 'Not Portable' },
				{
					...base,
					repository: {
						_tag: 'embedded',
						archivePath: 'repository.tar',
						sha256: 'bad-digest',
						commit
					}
				},
				{ ...base, repository: { _tag: 'git', commit: 'main' } },
				{
					...base,
					artifacts: Array.from({ length: 65 }, (_, index) =>
						artifact('component', `components/card-${index}`)
					)
				},
				{
					...base,
					migrations: [
						{
							fromVersion: '1.0.0',
							toVersion: '2.0.0',
							artifactIds: ['dev.flect.experience'],
							instruction: 'Migrate once'
						},
						{
							fromVersion: '1.0.0',
							toVersion: '2.0.0',
							artifactIds: ['dev.flect.experience'],
							instruction: 'Ambiguous duplicate'
						}
					]
				}
			];
			for (const input of cases) {
				assert.strictEqual(
					(yield* validateShareManifest(input).pipe(Effect.result))._tag,
					'Failure'
				);
			}
		})
	);

	it.effect('rejects unsafe source variants before resolution', () =>
		Effect.gen(function* () {
			const cases: ReadonlyArray<unknown> = [
				{ _tag: 'url', url: 'http://example.test/share' },
				{ _tag: 'url', url: 'https://token@example.test/share' },
				{
					_tag: 'git',
					url: 'https://example.test/share.git',
					commit: 'main'
				},
				{ _tag: 'private', adapterId: 'Invalid Adapter', reference: 'x' }
			];
			for (const input of cases) {
				assert.strictEqual(
					(yield* Schema.decodeUnknownEffect(ShareSource, strict)(input).pipe(Effect.result))._tag,
					'Failure'
				);
			}
		})
	);

	it.effect('hashes source roots deterministically and rejects escaped files', () =>
		Effect.gen(function* () {
			const indexFile = {
				path: 'components/card/index.ts',
				contents: new TextEncoder().encode('export const card = true;\n')
			};
			const files = [
				indexFile,
				{
					path: 'components/card/style.css',
					contents: new TextEncoder().encode('.card {}\n')
				}
			];
			const first = yield* hashShareArtifactSource('components/card', files);
			const second = yield* hashShareArtifactSource('components/card', files.toReversed());
			const changed = yield* hashShareArtifactSource('components/card', [
				indexFile,
				{
					path: 'components/card/style.css',
					contents: new TextEncoder().encode('.card { color: red; }\n')
				}
			]);
			assert.strictEqual(first, second);
			assert.notStrictEqual(first, changed);
			assert.strictEqual(first.length, 64);

			const escaped = yield* hashShareArtifactSource('components/card', [
				{
					path: 'themes/private/index.css',
					contents: new Uint8Array()
				}
			]).pipe(Effect.result);
			assert.strictEqual(escaped._tag, 'Failure');
		})
	);
});
