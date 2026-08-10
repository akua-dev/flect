import { Context, Effect, FileSystem, Layer, Path, Result } from "effect";
import {
  ShellLinkError,
  type ShellLinkState as ShellLinkStateType,
  ShellLinkStatus,
} from "../../shared/setup";

export {
  ShellLinkError,
  ShellLinkState,
  ShellLinkStatus,
} from "../../shared/setup";

export interface ShellLinkShape {
  readonly status: Effect.Effect<ShellLinkStatus, ShellLinkError>;
  readonly install: Effect.Effect<ShellLinkStatus, ShellLinkError>;
  readonly remove: Effect.Effect<ShellLinkStatus, ShellLinkError>;
}

export class ShellLink extends Context.Service<ShellLink, ShellLinkShape>()(
  "flect/ShellLink",
) {}

export interface ShellLinkOptions {
  readonly home: string;
  readonly executable: string;
}

const ioError = (message: string) =>
  ShellLinkError.make({ reason: "io", message });

const conflict = () =>
  ShellLinkError.make({
    reason: "conflict",
    message:
      "~/.local/bin/flect is owned by another file or command-line link.",
  });

export const makeShellLinkLayer = (options: ShellLinkOptions) =>
  Layer.effect(
    ShellLink,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const link = path.join(options.home, ".local", "bin", "flect");

      const isFlectOwned = (target: string) => {
        const parts = path.normalize(target).split(path.sep);
        const expected = ["Flect.app", "Contents", "MacOS", "flect"];
        return (
          parts.length >= expected.length &&
          expected.every(
            (part, index) =>
              parts[parts.length - expected.length + index] === part,
          )
        );
      };

      const status = Effect.fn("Flect.ShellLink.status")(function* () {
        const target = yield* Effect.result(fs.readLink(link));
        let state: ShellLinkStateType;
        if (Result.isSuccess(target)) {
          state =
            target.success === options.executable
              ? "installed"
              : isFlectOwned(target.success)
                ? "stale"
                : "conflict";
        } else {
          const exists = yield* fs
            .exists(link)
            .pipe(
              Effect.mapError(() =>
                ioError("Flect could not inspect the command-line link."),
              ),
            );
          state = exists ? "conflict" : "absent";
        }
        return ShellLinkStatus.make({ state, path: link, changed: false });
      });

      const install = Effect.fn("Flect.ShellLink.install")(function* () {
        const before = yield* status();
        if (before.state === "installed") {
          return before;
        }
        if (before.state === "conflict") {
          return yield* Effect.fail(conflict());
        }
        const parent = path.dirname(link);
        const temporary = path.join(
          parent,
          `.flect-link-${crypto.randomUUID()}.tmp`,
        );
        const cleanup = fs
          .remove(temporary, { force: true })
          .pipe(Effect.catch(() => Effect.void));
        yield* fs.makeDirectory(parent, { recursive: true, mode: 0o700 }).pipe(
          Effect.andThen(fs.symlink(options.executable, temporary)),
          Effect.andThen(fs.rename(temporary, link)),
          Effect.ensuring(cleanup),
          Effect.mapError(() =>
            ioError("Flect could not install the command-line link."),
          ),
        );
        return ShellLinkStatus.make({
          state: "installed",
          path: link,
          changed: true,
        });
      });

      const remove = Effect.fn("Flect.ShellLink.remove")(function* () {
        const before = yield* status();
        if (before.state === "absent") {
          return before;
        }
        if (before.state === "conflict") {
          return yield* Effect.fail(conflict());
        }
        yield* fs
          .remove(link)
          .pipe(
            Effect.mapError(() =>
              ioError("Flect could not remove the command-line link."),
            ),
          );
        return ShellLinkStatus.make({
          state: "absent",
          path: link,
          changed: true,
        });
      });

      return { status: status(), install: install(), remove: remove() };
    }),
  );
