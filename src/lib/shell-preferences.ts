import { Context, Effect, Layer, Schema, type SchemaAST } from 'effect';
import { ShellPreferencesValue } from '../../shared/shell-preferences';
import { InterfaceStorage, type InterfaceStorageError } from './interface-store';

const SHELL_PREFERENCES_KEY = 'flect.shell.preferences.v1';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export const defaultShellPreferences = ShellPreferencesValue.make({
	version: 1,
	railWidth: 400,
	railCollapsed: false,
	modelFavorites: []
});

const normalize = (value: ShellPreferencesValue) =>
	ShellPreferencesValue.make({
		...value,
		modelFavorites: [...new Set(value.modelFavorites)]
	});

const decodeStoredPreferences = Effect.fn('ShellPreferences.decodeStored')(function* (raw: string) {
	const input = yield* Effect.try({
		try: (): unknown => JSON.parse(raw),
		catch: () => undefined
	});
	return normalize(yield* Schema.decodeUnknownEffect(ShellPreferencesValue, strictOptions)(input));
});

export interface ShellPreferencesShape {
	readonly load: Effect.Effect<ShellPreferencesValue>;
	readonly save: (value: ShellPreferencesValue) => Effect.Effect<void, InterfaceStorageError>;
}

export class ShellPreferences extends Context.Service<ShellPreferences, ShellPreferencesShape>()(
	'flect/ShellPreferences'
) {}

export const makeShellPreferencesLayer = Layer.effect(
	ShellPreferences,
	Effect.gen(function* () {
		const storage = yield* InterfaceStorage;

		const load = Effect.fn('ShellPreferences.load')(() =>
			storage.read(SHELL_PREFERENCES_KEY).pipe(
				Effect.flatMap((raw) =>
					raw === null ? Effect.succeed(defaultShellPreferences) : decodeStoredPreferences(raw)
				),
				Effect.orElseSucceed(() => defaultShellPreferences)
			)
		);

		const save = Effect.fn('ShellPreferences.save')((value: ShellPreferencesValue) =>
			storage.write(SHELL_PREFERENCES_KEY, JSON.stringify(normalize(value)))
		);

		return {
			load: load(),
			save
		};
	})
);
