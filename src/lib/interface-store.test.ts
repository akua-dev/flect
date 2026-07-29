import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import {
  InterfaceStorage,
  InterfaceStorageError,
  type InterfaceStorageShape,
  loadInterfaceDocument,
} from "./interface-store";

const withStorage = <A, E>(
  read: InterfaceStorageShape["read"],
  effect: Effect.Effect<A, E, InterfaceStorage>,
) =>
  effect.pipe(
    Effect.provide(
      Layer.succeed(InterfaceStorage)({
        read,
      }),
    ),
  );

describe("loadInterfaceDocument", () => {
  it.effect("does not read user state in safe mode", () => {
    const read = vi.fn(() => Effect.succeed("must not be read"));
    return withStorage(
      read,
      Effect.gen(function* () {
        const document = yield* loadInterfaceDocument({ safeMode: true });

        expect(document).toBe(defaultInterfaceDocument);
        expect(read).not.toHaveBeenCalled();
      }),
    );
  });

  it.effect("falls back when stored state is malformed", () => {
    const read = vi.fn(() => Effect.succeed("{bad json"));
    return withStorage(
      read,
      Effect.gen(function* () {
        const document = yield* loadInterfaceDocument({ safeMode: false });
        expect(document).toBe(defaultInterfaceDocument);
      }),
    );
  });

  it.effect("loads valid version-one state from the only supported key", () => {
    const read = vi.fn(() =>
      Effect.succeed(
        JSON.stringify({
          version: 1,
          headline: "Where should we begin?",
          placeholder: "Describe an interface",
          secondaryActions: ["open"],
        }),
      ),
    );
    return withStorage(
      read,
      Effect.gen(function* () {
        const document = yield* loadInterfaceDocument({ safeMode: false });

        expect(document).toEqual(
          new InterfaceDocument({
            version: 1,
            headline: "Where should we begin?",
            placeholder: "Describe an interface",
            secondaryActions: ["open"],
          }),
        );
        expect(read).toHaveBeenCalledWith("flect.interface.v1");
      }),
    );
  });

  it.effect("falls back when storage access itself fails", () => {
    const read = vi.fn(() =>
      Effect.fail(
        new InterfaceStorageError({
          message: "Interface storage is unavailable.",
        }),
      ),
    );
    return withStorage(
      read,
      Effect.gen(function* () {
        const document = yield* loadInterfaceDocument({ safeMode: false });
        expect(document).toBe(defaultInterfaceDocument);
      }),
    );
  });
});
