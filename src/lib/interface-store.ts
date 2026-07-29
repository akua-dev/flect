import { Context, Effect, Layer, Schema } from "effect";
import {
  decodeInterfaceDocument,
  defaultInterfaceDocument,
  type InterfaceDocument,
} from "../../shared/interface-document";

const INTERFACE_DOCUMENT_KEY = "flect.interface.v1";

export class InterfaceStorageError extends Schema.TaggedErrorClass<InterfaceStorageError>()(
  "InterfaceStorageError",
  {
    message: Schema.Literal("Interface storage is unavailable."),
  },
) {}

export interface InterfaceStorageShape {
  readonly read: (
    key: string,
  ) => Effect.Effect<string | null, InterfaceStorageError>;
}

export class InterfaceStorage extends Context.Service<
  InterfaceStorage,
  InterfaceStorageShape
>()("flect/browser/InterfaceStorage") {}

const storageError = () =>
  new InterfaceStorageError({
    message: "Interface storage is unavailable.",
  });

export const makeInterfaceStorageLayer = (storage: Pick<Storage, "getItem">) =>
  Layer.succeed(InterfaceStorage)({
    read: Effect.fn("Flect.InterfaceStorage.read")((key: string) =>
      Effect.try({
        try: () => storage.getItem(key),
        catch: storageError,
      }),
    ),
  });

export const InterfaceStorageLive = Layer.effect(
  InterfaceStorage,
  Effect.sync(() => ({
    read: Effect.fn("Flect.InterfaceStorage.read")((key: string) =>
      Effect.try({
        try: () => globalThis.localStorage.getItem(key),
        catch: storageError,
      }),
    ),
  })),
);

export const loadInterfaceDocument = Effect.fn("Flect.InterfaceDocument.load")(
  function* ({
    safeMode,
  }: {
    readonly safeMode: boolean;
  }): Effect.fn.Return<InterfaceDocument, never, InterfaceStorage> {
    if (safeMode) {
      return defaultInterfaceDocument;
    }

    const storage = yield* InterfaceStorage;
    const raw = yield* storage
      .read(INTERFACE_DOCUMENT_KEY)
      .pipe(Effect.orElseSucceed(() => null));

    return yield* decodeInterfaceDocument(raw);
  },
);
