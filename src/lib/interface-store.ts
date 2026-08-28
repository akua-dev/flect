import { Context, Effect, Layer, Schema } from 'effect';
import {
	decodeInterfaceDocument,
	defaultInterfaceDocument,
	type InterfaceDocument
} from '../../shared/interface-document';

const INTERFACE_DOCUMENT_KEY = 'flect.interface.v1';
const INTERFACE_DOCUMENT_MIGRATED_KEY = 'flect.interface.v1.migrated';
const INTERFACE_DOCUMENT_MIGRATED_VALUE = '1';

export class InterfaceStorageError extends Schema.TaggedErrorClass<InterfaceStorageError>()(
	'InterfaceStorageError',
	{
		message: Schema.Literal('Interface storage is unavailable.')
	}
) {}

export interface InterfaceStorageShape {
	readonly read: (key: string) => Effect.Effect<string | null, InterfaceStorageError>;
	readonly write: (key: string, value: string) => Effect.Effect<void, InterfaceStorageError>;
	readonly remove: (key: string) => Effect.Effect<void, InterfaceStorageError>;
}

export class InterfaceStorage extends Context.Service<InterfaceStorage, InterfaceStorageShape>()(
	'flect/browser/InterfaceStorage'
) {}

const storageError = () =>
	new InterfaceStorageError({
		message: 'Interface storage is unavailable.'
	});

export const makeInterfaceStorageLayer = (storage: Pick<Storage, 'getItem'>) =>
	Layer.succeed(InterfaceStorage)({
		read: Effect.fn('InterfaceStorage.read')((key: string) =>
			Effect.try({
				try: () => storage.getItem(key),
				catch: storageError
			})
		),
		write: () => Effect.fail(storageError()),
		remove: () => Effect.fail(storageError())
	});

export const InterfaceStorageLive = Layer.effect(
	InterfaceStorage,
	Effect.sync(() => ({
		read: Effect.fn('InterfaceStorage.read')((key: string) =>
			Effect.try({
				try: () => globalThis.localStorage.getItem(key),
				catch: storageError
			})
		),
		write: Effect.fn('InterfaceStorage.write')((key: string, value: string) =>
			Effect.try({
				try: () => globalThis.localStorage.setItem(key, value),
				catch: storageError
			})
		),
		remove: Effect.fn('InterfaceStorage.remove')((key: string) =>
			Effect.try({
				try: () => globalThis.localStorage.removeItem(key),
				catch: storageError
			})
		)
	}))
);

export const consumeLegacyInterfaceDocument = Effect.fn('InterfaceDocument.consumeLegacy')(
	function* () {
		const storage = yield* InterfaceStorage;
		yield* storage.write(INTERFACE_DOCUMENT_MIGRATED_KEY, INTERFACE_DOCUMENT_MIGRATED_VALUE);
		yield* storage.remove(INTERFACE_DOCUMENT_KEY).pipe(Effect.catch(() => Effect.void));
	}
);

export const loadInterfaceDocument = Effect.fn('InterfaceDocument.load')(function* ({
	safeMode
}: {
	readonly safeMode: boolean;
}): Effect.fn.Return<InterfaceDocument, never, InterfaceStorage> {
	if (safeMode) {
		return defaultInterfaceDocument;
	}

	const storage = yield* InterfaceStorage;
	const migrationMarker = yield* storage
		.read(INTERFACE_DOCUMENT_MIGRATED_KEY)
		.pipe(Effect.orElseSucceed(() => undefined));
	if (migrationMarker === undefined || migrationMarker === INTERFACE_DOCUMENT_MIGRATED_VALUE) {
		return defaultInterfaceDocument;
	}

	const raw = yield* storage.read(INTERFACE_DOCUMENT_KEY).pipe(Effect.orElseSucceed(() => null));

	return yield* decodeInterfaceDocument(raw);
});
