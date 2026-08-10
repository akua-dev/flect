import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, type Path, Result } from "effect";
import { makeShellLinkLayer, ShellLink } from "./shell-link";

const PlatformLive = Layer.merge(BunFileSystem.layer, BunPath.layer);

const withFixture = <A, E>(
  use: (
    home: string,
    executable: string,
  ) => Effect.Effect<A, E, ShellLink | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "flect-shell-link-",
      });
      const home = `${root}/home`;
      const executable = `${root}/Applications/Flect.app/Contents/MacOS/flect`;
      yield* fs.makeDirectory(`${root}/Applications/Flect.app/Contents/MacOS`, {
        recursive: true,
      });
      yield* fs.writeFileString(executable, "fixture");
      return yield* use(home, executable).pipe(
        Effect.provide(makeShellLinkLayer({ home, executable })),
      );
    }),
  ).pipe(Effect.provide(PlatformLive));

describe("ShellLink", () => {
  it.effect("installs, repairs, and removes only the fixed Flect link", () =>
    withFixture((home, executable) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const links = yield* ShellLink;
        const path = `${home}/.local/bin/flect`;

        assert.strictEqual((yield* links.status).state, "absent");
        assert.isTrue((yield* links.install).changed);
        assert.isFalse((yield* links.install).changed);
        assert.strictEqual(yield* fs.readLink(path), executable);

        yield* fs.remove(path);
        yield* fs.symlink(`${home}/old/Flect.app/Contents/MacOS/flect`, path);
        assert.strictEqual((yield* links.status).state, "stale");
        yield* links.install;
        assert.strictEqual(yield* fs.readLink(path), executable);

        assert.isTrue((yield* links.remove).changed);
        assert.isFalse((yield* links.remove).changed);
      }),
    ),
  );

  it.effect("preserves a foreign link as a typed conflict", () =>
    withFixture((home) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const links = yield* ShellLink;
        const path = `${home}/.local/bin/flect`;
        yield* fs.makeDirectory(`${home}/.local/bin`, { recursive: true });
        yield* fs.symlink("/usr/local/bin/flect", path);

        assert.strictEqual((yield* links.status).state, "conflict");
        const install = yield* Effect.result(links.install);
        const remove = yield* Effect.result(links.remove);
        assert.isTrue(Result.isFailure(install));
        assert.isTrue(Result.isFailure(remove));
        assert.strictEqual(yield* fs.readLink(path), "/usr/local/bin/flect");
      }),
    ),
  );
});
