import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { BrowserBuildArtifact } from '../../shared/browser-build';
import { decodeCapsule, encodeCapsule } from '../../shared/capsule';
import { buildFrameworkCapsule } from './framework-capsule';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('framework capsule', () => {
	it('packages only a verified build and portable document shell', async () => {
		const sourceArchive = await Effect.runPromise(
			encodeCapsule({
				manifest: {
					formatVersion: 1,
					id: 'local.flect.react-project',
					name: 'React project',
					version: '1.0.0',
					entrypoints: [
						{ id: 'browser-source', path: 'src/main.tsx' },
						{ id: 'source-html', path: 'index.html' }
					],
					capabilities: [],
					compatibility: {
						flect: '>=0.2.0 <1.0.0',
						schemaVersion: 1,
						platforms: ['browser', 'macos']
					},
					provenance: {
						publisher: 'local-user',
						source: 'local-directory-import',
						revision: 'unversioned',
						builder: 'flect@0.2.0'
					},
					signatures: []
				},
				files: [
					{
						path: 'index.html',
						contents: encoder.encode(
							'<!doctype html><html><head><title>Kept title</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
						)
					},
					{
						path: 'src/main.tsx',
						contents: encoder.encode('source must not ship')
					},
					{
						path: 'metadata/import-report.json',
						contents: encoder.encode('{"version":1,"kind":"vite-react"}')
					}
				]
			})
		);
		const artifact = BrowserBuildArtifact.make({
			version: 1,
			buildId: 'build-cccccccccccccccc',
			sourceRevision: 'c'.repeat(40),
			dependencyGraphDigest: 'd'.repeat(64),
			inputDigest: 'e'.repeat(64),
			artifactDigest: 'f'.repeat(64),
			outputs: [
				{
					path: 'app.js',
					kind: 'chunk',
					contents: encoder.encode("document.body.dataset.ready='true'")
				},
				{
					path: 'app.css',
					kind: 'asset',
					contents: encoder.encode('body{color:navy}')
				}
			]
		});

		const archive = await Effect.runPromise(buildFrameworkCapsule({ sourceArchive, artifact }));
		const capsule = await Effect.runPromise(decodeCapsule(archive));
		const html = decoder.decode(capsule.files.find((file) => file.path === 'index.html')?.contents);

		expect(capsule.manifest.entrypoints).toEqual([{ id: 'compiled-web', path: 'index.html' }]);
		expect(capsule.manifest.provenance.revision).toBe('c'.repeat(40));
		expect(capsule.manifest.build).toEqual({
			sourceRevision: 'c'.repeat(40),
			inputDigest: 'e'.repeat(64),
			artifactDigest: 'f'.repeat(64),
			dependencyGraphDigest: 'd'.repeat(64)
		});
		expect(capsule.files.map((file) => file.path)).toEqual([
			'app.css',
			'app.js',
			'index.html',
			'metadata/import-report.json'
		]);
		expect(html).toContain('Kept title');
		expect(html).toContain('<div id="root"></div>');
		expect(html).toContain('src="./app.js"');
		expect(html).toContain('href="./app.css"');
		expect(html).not.toContain('src/main.tsx');
	});
});
