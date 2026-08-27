import { Effect, type ManagedRuntime } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShellPreferencesValue } from '../../shared/shell-preferences';
import { browserRuntime } from '../lib/runtime';
import { defaultShellPreferences, ShellPreferences } from '../lib/shell-preferences';

export interface ShellPreferencesController {
	readonly value: ShellPreferencesValue;
	readonly setRailWidth: (width: number) => Promise<void>;
	readonly setRailCollapsed: (collapsed: boolean) => Promise<void>;
	readonly toggleModelFavorite: (modelKey: string) => Promise<void>;
}

type PreferencesRuntime = ManagedRuntime.ManagedRuntime<ShellPreferences, unknown>;

export function useShellPreferences(
	runtime: PreferencesRuntime = browserRuntime
): ShellPreferencesController {
	const [value, setValue] = useState(defaultShellPreferences);
	const valueRef = useRef(defaultShellPreferences);

	useEffect(() => {
		let active = true;
		void runtime
			.runPromise(
				Effect.gen(function* () {
					return yield* (yield* ShellPreferences).load;
				})
			)
			.then((loaded) => {
				if (active) {
					valueRef.current = loaded;
					setValue(loaded);
				}
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [runtime]);

	const persist = useCallback(
		async (update: (current: ShellPreferencesValue) => ShellPreferencesValue) => {
			const previous = valueRef.current;
			const next = update(previous);
			valueRef.current = next;
			setValue(next);
			try {
				await runtime.runPromise(
					Effect.gen(function* () {
						yield* (yield* ShellPreferences).save(next);
					})
				);
			} catch {
				if (valueRef.current === next) {
					valueRef.current = previous;
					setValue(previous);
				}
			}
		},
		[runtime]
	);

	const setRailWidth = useCallback(
		(width: number) =>
			persist((current) =>
				ShellPreferencesValue.make({
					...current,
					railWidth: Math.max(340, Math.min(520, Math.round(width)))
				})
			),
		[persist]
	);

	const setRailCollapsed = useCallback(
		(collapsed: boolean) =>
			persist((current) =>
				ShellPreferencesValue.make({
					...current,
					railCollapsed: collapsed
				})
			),
		[persist]
	);

	const toggleModelFavorite = useCallback(
		(modelKey: string) =>
			persist((current) => {
				const exists = current.modelFavorites.includes(modelKey);
				return ShellPreferencesValue.make({
					...current,
					modelFavorites: exists
						? current.modelFavorites.filter((candidate) => candidate !== modelKey)
						: [...current.modelFavorites, modelKey].slice(0, 24)
				});
			}),
		[persist]
	);

	return {
		value,
		setRailWidth,
		setRailCollapsed,
		toggleModelFavorite
	};
}
