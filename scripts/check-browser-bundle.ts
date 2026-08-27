import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from 'acorn';
import { FlectPerformanceBudgets } from '../shared/performance-budgets';

const DIST = join(import.meta.dir, '..', 'dist');
const ASSETS = join(DIST, 'assets');
const KIB = 1_024;
const WORKSPACE_CSS_GZIP_BUDGET = 20 * KIB;
const WORKSPACE_CSS_DECODED_BUDGET = 112 * KIB;
const WORKSPACE_GZIP_BUDGET = FlectPerformanceBudgets.browser.initialShellGzipBytes;
const WORKSPACE_DECODED_BUDGET = FlectPerformanceBudgets.browser.initialShellDecodedBytes;

const fail = (message: string): never => {
	throw new Error(`Browser bundle gate failed: ${message}`);
};

const required = (value: string | undefined, message: string): string => value ?? fail(message);

const gzipSize = async (path: string) => Bun.gzipSync(await Bun.file(path).bytes()).byteLength;

const size = async (path: string) => ({
	decoded: Bun.file(path).size,
	gzip: await gzipSize(path)
});

const assetPath = (reference: string) => {
	const path = resolve(DIST, reference.replace(/^\//, ''));
	if (!path.startsWith(`${resolve(ASSETS)}/`)) {
		fail(`asset reference escapes the production asset directory: ${reference}`);
	}
	return path;
};

const staticGraph = async (entries: ReadonlyArray<string>) => {
	const paths = new Set<string>();
	const visit = async (path: string): Promise<void> => {
		if (paths.has(path)) return;
		paths.add(path);
		const source = await Bun.file(path).text();
		const program = parse(source, {
			ecmaVersion: 'latest',
			sourceType: 'module'
		});
		for (const node of program.body) {
			if (
				node.type === 'ImportDeclaration' &&
				typeof node.source.value === 'string' &&
				node.source.value.startsWith('.')
			) {
				await visit(resolve(dirname(path), node.source.value));
			}
		}
	};
	for (const entry of entries) await visit(entry);
	return paths;
};

const graphSize = async (paths: ReadonlySet<string>) => {
	let decoded = 0;
	let gzip = 0;
	for (const path of paths) {
		const current = await size(path);
		decoded += current.decoded;
		gzip += current.gzip;
	}
	return { decoded, gzip };
};

const graphDependencies = async (paths: ReadonlySet<string>) => {
	const dependencies: Array<{
		readonly asset: string;
		readonly decoded: number;
		readonly gzip: number;
	}> = [];
	for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
		dependencies.push({
			asset: relative(DIST, path),
			...(await size(path))
		});
	}
	return dependencies;
};

const htmlPath = join(DIST, 'index.html');
const html = await Bun.file(htmlPath).text();
const initialReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
	(match) => match[1] as string
);
const initialNames = initialReferences.map((reference) =>
	basename(reference.split('?')[0] as string)
);
const initialScriptPaths = initialReferences
	.filter((reference) => reference.startsWith('/assets/') && reference.endsWith('.js'))
	.map(assetPath);
const activationCssReference = required(
	initialReferences.find(
		(reference) => reference.startsWith('/assets/') && reference.endsWith('.css')
	),
	'static Astro document has no activation-shell stylesheet'
);
const componentReference = required(
	html.match(/component-url="([^"]+)"/)?.[1],
	'static Astro document has no Flect island component'
);
const rendererReference = required(
	html.match(/renderer-url="([^"]+)"/)?.[1],
	'static Astro document has no Flect island renderer'
);

const forbiddenInitial = [
	'workspace-entry',
	'agent-rail',
	'sandbox',
	'worker',
	'wasm',
	'rifty',
	'quickjs',
	'esbuild',
	'package-resolver',
	'proposal-build',
	'git-workspace'
];
for (const name of initialNames) {
	if (forbiddenInitial.some((token) => name.includes(token))) {
		fail(`view-only HTML references ${name}`);
	}
}
if (initialNames.some((name) => name.startsWith('workspace-entry') && name.endsWith('.css'))) {
	fail('view-only HTML eagerly references workspace CSS');
}

const activationGraph = await staticGraph(initialScriptPaths);
const activationJs = await graphSize(activationGraph);
const activationCss = await size(assetPath(activationCssReference));
if (activationJs.gzip > 10 * KIB) {
	fail(`activation bootstrap is ${activationJs.gzip} bytes gzip (limit 10240)`);
}
if (activationCss.gzip > 25 * KIB) {
	fail(`initial CSS is ${activationCss.gzip} bytes gzip (limit 25600)`);
}

let activationSource = '';
for (const path of initialScriptPaths) {
	activationSource += `${await Bun.file(path).text()}\n`;
}
const workspaceActivationReference = required(
	activationSource.match(/assets\/(workspace-activation\.[A-Za-z0-9_-]+\.js)/)?.[1],
	'Astro activation bootstrap has no deferred workspace coordinator'
);
const workspaceActivationGraph = await staticGraph([
	assetPath(`/assets/${workspaceActivationReference}`)
]);
let workspaceActivationSource = '';
for (const path of workspaceActivationGraph) {
	workspaceActivationSource += `${await Bun.file(path).text()}\n`;
}
if (!workspaceActivationSource.includes('flect:workspace-open')) {
	fail('Astro workspace coordinator does not request the Flect island');
}

const workspaceGraph = await staticGraph([
	assetPath(componentReference),
	assetPath(rendererReference)
]);
for (const path of workspaceActivationGraph) workspaceGraph.add(path);
let workspaceSource = '';
for (const path of workspaceGraph) {
	workspaceSource += `${await Bun.file(path).text()}\n`;
}
const workspaceCssReference = required(
	workspaceSource.match(/\/assets\/([A-Za-z0-9_.-]+\.css)/)?.[1],
	'protected workspace graph has no deferred stylesheet'
);
if (initialNames.includes(workspaceCssReference)) {
	fail('view-only HTML eagerly references workspace CSS');
}
const workspaceCss = await size(assetPath(`/assets/${workspaceCssReference}`));
if (
	workspaceCss.gzip > WORKSPACE_CSS_GZIP_BUDGET ||
	workspaceCss.decoded > WORKSPACE_CSS_DECODED_BUDGET
) {
	fail(
		`deferred workspace CSS is ${workspaceCss.gzip} bytes gzip / ${workspaceCss.decoded} decoded (limits ${WORKSPACE_CSS_GZIP_BUDGET} / ${WORKSPACE_CSS_DECODED_BUDGET})`
	);
}
const workspace = await graphSize(workspaceGraph);
if (workspace.gzip > WORKSPACE_GZIP_BUDGET || workspace.decoded > WORKSPACE_DECODED_BUDGET) {
	fail(
		`protected workspace is ${workspace.gzip} bytes gzip / ${workspace.decoded} decoded (limits ${WORKSPACE_GZIP_BUDGET} / ${WORKSPACE_DECODED_BUDGET})`
	);
}

const forbiddenWorkspaceModules = [
	'sandboxed-shell',
	'live-sandboxed-shell',
	'live-proposal-build',
	'browser-package-resolver',
	'browser-build-worker',
	'extension-worker',
	'rifty-js-runtime',
	'rifty-wasi',
	'quickjs',
	'.wasm'
];
for (const path of workspaceGraph) {
	const name = basename(path);
	if (forbiddenWorkspaceModules.some((token) => name.includes(token))) {
		fail(`first workspace graph eagerly references ${name}`);
	}
}

if (!html.includes('client="flect"')) {
	fail('static document does not use the client:flect Astro directive');
}

console.log(
	JSON.stringify(
		{
			viewOnlyRequests: initialNames.length,
			viewOnlyDocument: await size(htmlPath),
			activationBootstrap: activationJs,
			initialCss: activationCss,
			workspaceCss,
			protectedWorkspace: {
				...workspace,
				modules: workspaceGraph.size
			},
			islands: [
				{
					name: 'flect-workspace',
					entryAssets: [
						relative(DIST, assetPath(componentReference)),
						relative(DIST, assetPath(rendererReference)),
						relative(DIST, assetPath(`/assets/${workspaceActivationReference}`))
					].sort((left, right) => left.localeCompare(right)),
					dependencies: await graphDependencies(workspaceGraph)
				}
			],
			onDemandBoundaries: ['shell', 'compiler', 'package', 'worker', 'wasm']
		},
		undefined,
		2
	)
);
