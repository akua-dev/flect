import { isNativeHost } from '../lib/native-host';

export interface FlectClientModule {
	readonly mountFlect: (root: HTMLElement) => Promise<void>;
}

export interface FlectActivationOptions {
	readonly document?: Document;
	readonly location?: Pick<Location, 'href' | 'hostname' | 'protocol'>;
	readonly testMode?: boolean;
	readonly desktop?: boolean;
	readonly load?: () => Promise<FlectClientModule>;
}

const diagnosticParameters = [
	'bun-diagnostic',
	'execution-diagnostic',
	'git-diagnostic',
	'git-transaction-diagnostic',
	'git-share-import-diagnostic',
	'git-share-lifecycle-diagnostic',
	'storage-reset-diagnostic',
	'capsule-diagnostic',
	'capsule-trust-diagnostic',
	'build-diagnostic',
	'package-diagnostic',
	'product-capability-diagnostic',
	'reference-product-diagnostic',
	'product-adoption-diagnostic'
] as const;

export const isFlectDesktop = isNativeHost;

if (import.meta.hot && isFlectDesktop()) {
	const reloadNativeWorkspace = () => globalThis.location.reload();
	import.meta.hot.on('vite:beforeUpdate', reloadNativeWorkspace);
	import.meta.hot.dispose(() => import.meta.hot?.off('vite:beforeUpdate', reloadNativeWorkspace));
}

export const shouldActivateFlectImmediately = ({
	href,
	testMode,
	desktop
}: {
	readonly href: string;
	readonly testMode: boolean;
	readonly desktop: boolean;
}) => {
	const url = new URL(href);
	if (url.searchParams.get('view') === '1') return false;
	if (desktop || url.searchParams.get('safe') === '1') return true;
	if (testMode) return true;
	return diagnosticParameters.some((parameter) => url.searchParams.get(parameter) === '1');
};

const platformName = () => {
	const platform = globalThis.navigator?.platform.toLowerCase() ?? '';
	if (platform.includes('mac')) return 'macos';
	if (platform.includes('win')) return 'windows';
	if (platform.includes('linux')) return 'linux';
	return 'browser';
};

export const installFlectActivation = (options: FlectActivationOptions = {}) => {
	const document = options.document ?? globalThis.document;
	const location = options.location ?? globalThis.location;
	const root = document.getElementById('root');
	const shell = document.getElementById('flect-static-shell');
	const status = document.getElementById('flect-activation-status');
	if (root === null || shell === null) {
		throw new Error('Flect could not find its activation shell.');
	}

	document.documentElement.dataset.platform = platformName();
	const immediate = shouldActivateFlectImmediately({
		href: location.href,
		testMode: options.testMode ?? import.meta.env.VITE_FLECT_TEST_MODE === '1',
		desktop: options.desktop ?? isFlectDesktop(location)
	});
	const load = options.load;
	let coordinator: Promise<void> | undefined;
	let workspace: Promise<void> | undefined;

	const openWorkspace = (initialPrompt?: string) => {
		if (initialPrompt !== undefined) {
			root.dataset.flectInitialPrompt = initialPrompt;
		}
		if (workspace !== undefined) return workspace;
		shell.setAttribute('aria-busy', 'true');
		if (status !== null) status.textContent = 'Opening Flect…';
		workspace = import('./workspace-activation-runtime').then(({ activateWorkspace }) =>
			activateWorkspace({
				document,
				root,
				...(load === undefined ? {} : { load }),
				onReady: () => {
					if (load === undefined) root.hidden = false;
					if (!root.hidden) shell.hidden = true;
					shell.removeAttribute('aria-busy');
					document.documentElement.dataset.flectState = 'active';
				},
				onError: () => {
					workspace = undefined;
					root.hidden = true;
					shell.hidden = false;
					shell.removeAttribute('aria-busy');
					delete document.documentElement.dataset.flectOpenRequested;
					document.documentElement.dataset.flectState = 'error';
					if (status !== null) {
						status.textContent =
							'Flect could not open. Your current view is still safe; try again.';
						status.setAttribute('role', 'alert');
					}
				}
			})
		);
		return workspace;
	};

	const armCoordinator = async () => {
		shell.removeAttribute('aria-busy');
		if (status !== null) status.textContent = 'Flect is ready.';
	};

	const activate = () => {
		if (options.load !== undefined || immediate) return openWorkspace();
		if (coordinator !== undefined) return coordinator;
		coordinator = armCoordinator();
		return coordinator;
	};

	const activateSafely = () => {
		void activate().catch(() => undefined);
	};
	const activateFromTarget = (target: EventTarget | null) => {
		if (target instanceof Element && target.closest('[data-flect-activate]') !== null) {
			activateSafely();
		}
	};
	document.addEventListener('focusin', (event) => activateFromTarget(event.target));
	document.addEventListener('pointerdown', (event) => activateFromTarget(event.target));
	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const example = target.closest<HTMLElement>('[data-flect-example]');
		const prompt = example?.dataset.flectExample;
		if (prompt === undefined || prompt.length === 0) return;
		const input = shell.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
		if (input === null) return;
		input.value = prompt;
		input.focus();
		if (status !== null) {
			status.textContent = 'Edit this idea or describe the outcome you need.';
		}
	});
	document.addEventListener('submit', (event) => {
		const form = event.target;
		if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-flect-starter')) {
			return;
		}
		event.preventDefault();
		const data = new FormData(form);
		const prompt = data.get('prompt');
		if (typeof prompt !== 'string' || prompt.trim().length === 0) return;
		void openWorkspace(prompt.trim())
			.then(() => {
				document.dispatchEvent(
					new CustomEvent('flect:starter-submit', {
						detail: { prompt: prompt.trim() }
					})
				);
			})
			.catch(() => undefined);
	});
	document.addEventListener('keydown', (event) => {
		const shortcut =
			((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') ||
			(event.key === '/' &&
				!(event.target instanceof HTMLInputElement) &&
				!(event.target instanceof HTMLTextAreaElement));
		if (!shortcut) return;
		event.preventDefault();
		void openWorkspace().catch(() => undefined);
	});
	document.addEventListener('flect:activate', () => {
		void openWorkspace().catch(() => undefined);
	});

	if (immediate) queueMicrotask(() => void openWorkspace().catch(() => undefined));

	return { activate, immediate };
};
