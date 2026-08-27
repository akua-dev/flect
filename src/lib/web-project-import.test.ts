import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { decodeCapsule } from '../../shared/capsule';
import { importWebProject } from './web-project-import';

const file = (path: string, contents: string) => ({
	path,
	contents: new TextEncoder().encode(contents)
});

describe('plain web project import', () => {
	it('packages a directory-root index and local assets into a verified capsule', async () => {
		const result = await Effect.runPromise(
			importWebProject([
				file('portfolio/index.html', '<link rel="stylesheet" href="styles.css">'),
				file('portfolio/styles.css', 'body{color:navy}'),
				file('portfolio/app.js', "document.body.dataset.ready='true'"),
				file('portfolio/.DS_Store', 'ignored')
			])
		);
		const capsule = await Effect.runPromise(decodeCapsule(result.archive));

		expect(result.report).toEqual({
			version: 1,
			kind: 'static-html',
			name: 'portfolio',
			entrypoint: 'index.html',
			source: 'directory',
			revision: 'unversioned',
			includedFiles: 3,
			ignoredFiles: ['.DS_Store'],
			adaptations: [],
			warnings: []
		});
		expect(capsule.manifest.id).toBe('local.flect.portfolio');
		expect(capsule.manifest.entrypoints).toEqual([{ id: 'plain-web', path: 'index.html' }]);
		expect(capsule.files.map((asset) => asset.path)).toEqual([
			'app.js',
			'index.html',
			'metadata/import-report.json',
			'styles.css'
		]);
	});

	it('fails closed with an actionable report when no unambiguous index exists', async () => {
		const failure = await Effect.runPromise(
			importWebProject([file('one/index.html', 'one'), file('two/index.html', 'two')]).pipe(
				Effect.flip
			)
		);
		expect(failure._tag).toBe('WebProjectImportFailure');
		expect(failure.message).toContain('single project folder');
	});

	it('rejects traversal and dependency directories', async () => {
		const failure = await Effect.runPromise(
			importWebProject([
				file('site/index.html', 'ok'),
				file('site/../escape.js', 'bad'),
				file('site/node_modules/package/index.js', 'ignored')
			]).pipe(Effect.flip)
		);
		expect(failure._tag).toBe('WebProjectImportFailure');
		expect(failure.message).toContain('unsafe path');
	});

	it('does not read secret-shaped files and reports unsupported web assumptions', async () => {
		const result = await Effect.runPromise(
			importWebProject([
				file(
					'site/index.html',
					'<form action="https://api.example.test"><script type="module" src="app.js"></script>'
				),
				file('site/app.js', "localStorage.setItem('token', 'no')"),
				file('site/.env.production', 'API_TOKEN=secret'),
				file('site/id_rsa', 'private')
			])
		);
		const capsule = await Effect.runPromise(decodeCapsule(result.archive));

		expect(result.report.ignoredFiles).toEqual(['.env.production', 'id_rsa']);
		expect(result.report.warnings).toEqual([
			'Forms are contained and cannot submit from the isolated preview.',
			'Remote URLs require an explicit product network capability.',
			'Web storage is unavailable to opaque compiled capsules.'
		]);
		expect(capsule.manifest.capabilities).toEqual([
			{ id: 'web:forms', required: false },
			{ id: 'web:remote-network', required: true },
			{ id: 'web:storage', required: true }
		]);
	});

	it('does not mistake ordinary source comments for remote network authority', async () => {
		const result = await Effect.runPromise(
			importWebProject([
				file('site/index.html', '<script type="module" src="app.js"></script>'),
				file('site/app.js', "// local implementation note\ndocument.body.textContent='ready'")
			])
		);
		expect(result.report.warnings).not.toContain(
			'Remote URLs require an explicit product network capability.'
		);
	});

	it('recognizes a standard Vite React entrypoint without executing Vite', async () => {
		const result = await Effect.runPromise(
			importWebProject([
				file(
					'dashboard/index.html',
					'<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>'
				),
				file(
					'dashboard/package.json',
					JSON.stringify({
						name: 'dashboard',
						private: true,
						version: '0.0.0',
						type: 'module',
						scripts: { dev: 'vite', build: 'vite build' },
						dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
						devDependencies: {
							'@vitejs/plugin-react': '6.0.4',
							vite: '8.1.5'
						}
					})
				),
				file(
					'dashboard/vite.config.ts',
					'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({plugins:[react()]});'
				),
				file(
					'dashboard/src/main.tsx',
					'import { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<main>Imported</main>);'
				),
				file('dashboard/src/app.css', 'main{color:navy}'),
				file('dashboard/.env.local', 'VITE_SECRET=never-read'),
				file('dashboard/node_modules/react/index.js', 'never-read')
			])
		);
		const capsule = await Effect.runPromise(decodeCapsule(result.archive));

		expect(result.report.kind).toBe('vite-react');
		expect(result.report.entrypoint).toBe('src/main.tsx');
		expect(result.report.ignoredFiles).toEqual(['.env.local', 'node_modules/react/index.js']);
		expect(result.report.adaptations).toEqual([
			'Flect uses its restricted browser compiler instead of executing Vite config or package scripts.',
			'Development dependencies are preserved in source but excluded from the portable acceptance build.'
		]);
		expect(capsule.manifest.entrypoints).toContainEqual({
			id: 'browser-source',
			path: 'src/main.tsx'
		});
		expect(capsule.files.map((asset) => asset.path)).toContain('metadata/import-report.json');
	});

	it.each([
		{
			framework: 'Vue',
			dependency: 'vue',
			plugin: '@vitejs/plugin-vue',
			component: 'App.vue',
			kind: 'vite-vue' as const
		},
		{
			framework: 'Svelte',
			dependency: 'svelte',
			plugin: '@sveltejs/vite-plugin-svelte',
			component: 'App.svelte',
			kind: 'vite-svelte' as const
		}
	])(
		'recognizes a standard Vite $framework project without a Flect mode',
		async ({ dependency, plugin, component, kind }) => {
			const result = await Effect.runPromise(
				importWebProject([
					file(
						'app/index.html',
						'<div id="app"></div><script type="module" src="/src/main.ts"></script>'
					),
					file(
						'app/package.json',
						JSON.stringify({
							dependencies: { [dependency]: '1.0.0' },
							devDependencies: { [plugin]: '1.0.0', vite: '8.1.5' }
						})
					),
					file('app/src/main.ts', `import App from "./${component}"; void App;`),
					file(`app/src/${component}`, '<main>Portable component</main>')
				])
			);

			expect(result.report.kind).toBe(kind);
			expect(result.report.entrypoint).toBe('src/main.ts');
			expect(result.report.adaptations).toContain(
				'Flect uses its restricted browser compiler instead of executing Vite config or package scripts.'
			);
		}
	);

	it('rejects unsupported Vite plugins before packaging source', async () => {
		const failure = await Effect.runPromise(
			importWebProject([
				file(
					'dashboard/index.html',
					'<div id="root"></div><script type="module" src="/src/main.tsx"></script>'
				),
				file(
					'dashboard/package.json',
					JSON.stringify({
						dependencies: { react: '19.2.8' },
						devDependencies: { 'vite-plugin-node': '1.0.0' }
					})
				),
				file('dashboard/src/main.tsx', "document.body.textContent='ready'")
			]).pipe(Effect.flip)
		);

		expect(failure.message).toContain('vite-plugin-node');
		expect(failure.message).toContain('portable build');
	});

	it('rejects a source file that collides with Flect import metadata', async () => {
		const failure = await Effect.runPromise(
			importWebProject([
				file('site/index.html', '<main>Ready</main>'),
				file('site/metadata/import-report.json', JSON.stringify({ owner: 'source project' }))
			]).pipe(Effect.flip)
		);

		expect(failure.message).toContain('metadata/import-report.json');
		expect(failure.message).toContain('reserved');
	});

	it('reports capsule file and path limits before packaging', async () => {
		const tooManyFiles = [
			file('site/index.html', '<main>Ready</main>'),
			...Array.from({ length: 255 }, (_, index) => file(`site/assets/${index}.txt`, 'x'))
		];
		const countFailure = await Effect.runPromise(importWebProject(tooManyFiles).pipe(Effect.flip));
		expect(countFailure.message).toContain('255 source files');

		const longPathFailure = await Effect.runPromise(
			importWebProject([
				file('site/index.html', '<main>Ready</main>'),
				file(`site/${'a'.repeat(101)}`, 'x')
			]).pipe(Effect.flip)
		);
		expect(longPathFailure.message).toContain('100 characters');
	});

	it('rejects ignored Vite aliases and Node built-ins with portable alternatives', async () => {
		const aliasFailure = await Effect.runPromise(
			importWebProject([
				file(
					'dashboard/index.html',
					'<div id="root"></div><script type="module" src="/src/main.ts"></script>'
				),
				file('dashboard/vite.config.ts', 'export default { resolve: { alias: { "@": "/src" } } };'),
				file('dashboard/src/main.ts', "document.body.textContent='ready'")
			]).pipe(Effect.flip)
		);
		expect(aliasFailure.message).toContain('resolve.alias');
		expect(aliasFailure.message).toContain('relative imports');

		const nodeFailure = await Effect.runPromise(
			importWebProject([
				file(
					'dashboard/index.html',
					'<div id="root"></div><script type="module" src="/src/main.ts"></script>'
				),
				file('dashboard/src/main.ts', 'import { readFile } from "node:fs";\nvoid readFile;')
			]).pipe(Effect.flip)
		);
		expect(nodeFailure.message).toContain('node:fs');
		expect(nodeFailure.message).toContain('browser API');
		expect(nodeFailure.message).toContain('typed product capability');
	});
});
