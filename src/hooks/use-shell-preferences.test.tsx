// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from '@effect/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { ShellPreferencesValue } from '../../shared/shell-preferences';
import { InterfaceStorageError } from '../lib/interface-store';
import { ShellPreferences, type ShellPreferencesShape } from '../lib/shell-preferences';
import { useShellPreferences } from './use-shell-preferences';

const initial = ShellPreferencesValue.make({
	version: 1,
	railWidth: 420,
	railCollapsed: false,
	modelFavorites: []
});

const makeRuntime = (save: ShellPreferencesShape['save']) =>
	ManagedRuntime.make(
		Layer.succeed(ShellPreferences)({
			load: Effect.succeed(initial),
			save
		})
	);

describe('useShellPreferences', () => {
	it('loads and persists validated layout and model preferences', async () => {
		const save = vi.fn(() => Effect.void);
		const runtime = makeRuntime(save);
		const { result, unmount } = renderHook(() => useShellPreferences(runtime));

		await waitFor(() => expect(result.current.value.railWidth).toBe(420));
		await act(async () => {
			await result.current.setRailWidth(480);
			await result.current.setRailCollapsed(true);
			await result.current.toggleModelFavorite('provider/model');
		});

		expect(result.current.value).toEqual(
			ShellPreferencesValue.make({
				version: 1,
				railWidth: 480,
				railCollapsed: true,
				modelFavorites: ['provider/model']
			})
		);
		expect(save).toHaveBeenCalledTimes(3);

		unmount();
		await runtime.dispose();
	});

	it('restores the previous value when persistence fails', async () => {
		const runtime = makeRuntime(() =>
			Effect.fail(
				InterfaceStorageError.make({
					message: 'Interface storage is unavailable.'
				})
			)
		);
		const { result, unmount } = renderHook(() => useShellPreferences(runtime));

		await waitFor(() => expect(result.current.value.railWidth).toBe(420));
		await act(async () => {
			await result.current.setRailWidth(500);
		});

		expect(result.current.value.railWidth).toBe(420);

		unmount();
		await runtime.dispose();
	});
});
