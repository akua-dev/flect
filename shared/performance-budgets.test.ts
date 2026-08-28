import { afterEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FlectPerformanceBudgets, platformBrowserPerformanceBudgets } from './performance-budgets';

const withPlatform = <A>(platform: NodeJS.Platform, run: () => A): A => {
	const original = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { configurable: true, value: platform });
	try {
		return run();
	} finally {
		if (original !== undefined) Object.defineProperty(process, 'platform', original);
	}
};

afterEach(() => {
	// withPlatform always restores in its own finally, but guard against a
	// thrown assertion leaving process.platform stubbed for later tests.
	expect(typeof process.platform).toBe('string');
});

describe('platformBrowserPerformanceBudgets', () => {
	it.effect(
		'returns the macOS-calibrated budget unchanged on darwin (and every non-linux platform)',
		() =>
			Effect.sync(() => {
				withPlatform('darwin', () => {
					expect(platformBrowserPerformanceBudgets()).toStrictEqual(
						FlectPerformanceBudgets.browser
					);
				});
				withPlatform('win32', () => {
					expect(platformBrowserPerformanceBudgets()).toStrictEqual(
						FlectPerformanceBudgets.browser
					);
				});
			})
	);

	it.effect(
		'on linux, only overrides coldInteractiveMs/composerP95Ms/interactionLatencyMs, and only loosens them',
		() =>
			Effect.sync(() => {
				const macos = FlectPerformanceBudgets.browser;
				const linux = withPlatform('linux', () => platformBrowserPerformanceBudgets());

				for (const key of Object.keys(macos) as ReadonlyArray<keyof typeof macos>) {
					if (
						key === 'coldInteractiveMs' ||
						key === 'composerP95Ms' ||
						key === 'interactionLatencyMs'
					) {
						expect(linux[key], key).toBeGreaterThan(macos[key]);
					} else {
						expect(linux[key], key).toBe(macos[key]);
					}
				}
			})
	);
});
