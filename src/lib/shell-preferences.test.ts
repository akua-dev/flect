import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ShellPreferencesValue } from "../../shared/shell-preferences";
import {
  InterfaceStorage,
  InterfaceStorageError,
  type InterfaceStorageShape,
} from "./interface-store";
import {
  defaultShellPreferences,
  makeShellPreferencesLayer,
  ShellPreferences,
} from "./shell-preferences";

const withStorage = <A, E>(
  storage: InterfaceStorageShape,
  effect: Effect.Effect<A, E, ShellPreferences>,
) =>
  effect.pipe(
    Effect.provide(
      makeShellPreferencesLayer.pipe(
        Layer.provide(Layer.succeed(InterfaceStorage)(storage)),
      ),
    ),
  );

const memoryStorage = (initial: string | null = null) => {
  let value = initial;
  const storage: InterfaceStorageShape = {
    read: vi.fn(() => Effect.succeed(value)),
    write: vi.fn((_key, next) =>
      Effect.sync(() => {
        value = next;
      }),
    ),
    remove: () => Effect.void,
  };
  return { storage, value: () => value };
};

describe("ShellPreferences", () => {
  it.effect("round-trips normalized preferences through the owned key", () => {
    const memory = memoryStorage();
    return withStorage(
      memory.storage,
      Effect.gen(function* () {
        const preferences = yield* ShellPreferences;
        yield* preferences.save(
          ShellPreferencesValue.make({
            version: 1,
            railWidth: 480,
            railCollapsed: true,
            modelFavorites: ["provider/model", "provider/model", "other/model"],
          }),
        );
        const loaded = yield* preferences.load;

        expect(loaded).toEqual(
          ShellPreferencesValue.make({
            version: 1,
            railWidth: 480,
            railCollapsed: true,
            modelFavorites: ["provider/model", "other/model"],
          }),
        );
        expect(memory.storage.write).toHaveBeenCalledWith(
          "flect.shell.preferences.v1",
          memory.value(),
        );
      }),
    );
  });

  it.effect(
    "falls back for malformed, excess, invalid, and unreadable values",
    () =>
      Effect.gen(function* () {
        const invalidValues = [
          "{bad json",
          JSON.stringify({
            version: 1,
            railWidth: 320,
            railCollapsed: false,
            modelFavorites: [],
          }),
          JSON.stringify({
            version: 1,
            railWidth: 400,
            railCollapsed: false,
            modelFavorites: [],
            token: "not-a-real-secret",
          }),
        ];

        for (const raw of invalidValues) {
          const loaded = yield* withStorage(
            memoryStorage(raw).storage,
            Effect.gen(function* () {
              return yield* (yield* ShellPreferences).load;
            }),
          );
          expect(loaded).toEqual(defaultShellPreferences);
        }

        const unreadable = yield* withStorage(
          {
            read: () =>
              Effect.fail(
                InterfaceStorageError.make({
                  message: "Interface storage is unavailable.",
                }),
              ),
            write: () => Effect.void,
            remove: () => Effect.void,
          },
          Effect.gen(function* () {
            return yield* (yield* ShellPreferences).load;
          }),
        );
        expect(unreadable).toEqual(defaultShellPreferences);
      }),
  );

  it.effect("keeps storage write failures typed", () =>
    withStorage(
      {
        read: () => Effect.succeed(null),
        write: () =>
          Effect.fail(
            InterfaceStorageError.make({
              message: "Interface storage is unavailable.",
            }),
          ),
        remove: () => Effect.void,
      },
      Effect.gen(function* () {
        const preferences = yield* ShellPreferences;
        const error = yield* preferences
          .save(defaultShellPreferences)
          .pipe(Effect.flip);

        expect(error).toEqual(
          InterfaceStorageError.make({
            message: "Interface storage is unavailable.",
          }),
        );
      }),
    ),
  );
});
