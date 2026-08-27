// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { fireEvent } from '@testing-library/react';
import {
	installFlectActivation,
	isFlectDesktop,
	shouldActivateFlectImmediately
} from './activate-flect';

afterEach(() => {
	document.body.innerHTML = '';
	document.documentElement.removeAttribute('data-flect-state');
	Reflect.deleteProperty(globalThis, 'isTauri');
});

const shell = () => {
	document.body.innerHTML = `
    <main id="flect-static-shell">
      <form data-flect-starter>
        <textarea data-flect-activate name="prompt"></textarea>
        <button data-flect-activate>Send to Flect</button>
      </form>
      <p id="flect-activation-status">Ready</p>
    </main>
    <div id="root" hidden></div>
  `;
};

describe('Flect activation boundary', () => {
	it('recognizes the native host marker exposed by Tauri isolation', () => {
		Reflect.set(globalThis, 'isTauri', true);

		expect(isFlectDesktop({ hostname: '127.0.0.1', protocol: 'http:' })).toBe(true);
	});

	it('keeps an ordinary browser view static until the user activates it', async () => {
		shell();
		const mountFlect = vi.fn(() => Promise.resolve());
		const load = vi.fn(() => Promise.resolve({ mountFlect }));
		const activation = installFlectActivation({
			document,
			location: {
				href: 'https://flect.local/?view=1',
				hostname: 'flect.local',
				protocol: 'https:'
			},
			testMode: true,
			desktop: false,
			load
		});

		expect(activation.immediate).toBe(false);
		expect(load).not.toHaveBeenCalled();
		const activationTarget = document.querySelector('[data-flect-activate]');
		expect(activationTarget).not.toBeNull();
		if (activationTarget === null) return;
		fireEvent.focusIn(activationTarget);
		await activation.activate();

		expect(load).toHaveBeenCalledOnce();
		expect(mountFlect).toHaveBeenCalledWith(document.getElementById('root'));
		expect(document.getElementById('root')).toHaveAttribute('hidden');
		expect(document.getElementById('flect-static-shell')).not.toHaveAttribute('hidden');
	});

	it('hands a starter prompt to the activated client without navigation', async () => {
		shell();
		const mountFlect = vi.fn(() => Promise.resolve());
		const load = vi.fn(() => Promise.resolve({ mountFlect }));
		installFlectActivation({
			document,
			location: {
				href: 'https://flect.local/?view=1',
				hostname: 'flect.local',
				protocol: 'https:'
			},
			testMode: false,
			desktop: false,
			load
		});
		const prompt = document.querySelector('textarea');
		const form = document.querySelector('form');
		expect(prompt).not.toBeNull();
		expect(form).not.toBeNull();
		if (prompt === null || form === null) return;
		fireEvent.change(prompt, { target: { value: 'Make a calm notes app' } });
		const submitted = new Promise<string>((resolve) => {
			document.addEventListener(
				'flect:starter-submit',
				(event) => {
					if (!(event instanceof CustomEvent)) return;
					const detail: unknown = event.detail;
					const prompt =
						typeof detail === 'object' && detail !== null && 'prompt' in detail
							? Reflect.get(detail, 'prompt')
							: undefined;
					resolve(String(prompt));
				},
				{ once: true }
			);
		});
		fireEvent.submit(form);
		expect(await submitted).toBe('Make a calm notes app');
	});

	it('fills a starter idea before the user decides to submit it', () => {
		shell();
		const load = vi.fn(() => Promise.resolve({ mountFlect: vi.fn(() => Promise.resolve()) }));
		installFlectActivation({
			document,
			location: {
				href: 'https://flect.local/?view=1',
				hostname: 'flect.local',
				protocol: 'https:'
			},
			testMode: false,
			desktop: false,
			load
		});
		const form = document.querySelector('form');
		const prompt = document.querySelector('textarea');
		expect(form).not.toBeNull();
		expect(prompt).not.toBeNull();
		if (form === null || prompt === null) return;

		const example = document.createElement('button');
		example.dataset.flectExample = 'A calm project planner for this week';
		form.append(example);
		fireEvent.click(example);

		expect(prompt).toHaveValue('A calm project planner for this week');
		expect(load).not.toHaveBeenCalled();
	});

	it.each([
		['test', { href: 'https://flect.local/', testMode: true, desktop: false }],
		['desktop', { href: 'tauri://localhost/', testMode: false, desktop: true }],
		['safe mode', { href: 'https://flect.local/?safe=1', testMode: false, desktop: false }],
		[
			'diagnostic',
			{
				href: 'https://flect.local/?git-diagnostic=1',
				testMode: false,
				desktop: false
			}
		]
	] as const)('activates immediately for %s', (_label, input) => {
		expect(shouldActivateFlectImmediately(input)).toBe(true);
	});
});
