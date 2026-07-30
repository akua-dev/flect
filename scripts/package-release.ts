import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Effect, Schema } from "effect";

const expectedVersion = "0.1.1";
const root = resolve(import.meta.dirname, "..");
const distRelease = resolve(root, "dist-release");

const paths = {
  packageJson: resolve(root, "package.json"),
  cargoManifest: resolve(root, "src-tauri/Cargo.toml"),
  tauriConfig: resolve(root, "src-tauri/tauri.conf.json"),
  sidecar: resolve(
    root,
    "src-tauri/binaries/flect-runtime-aarch64-apple-darwin",
  ),
  app: resolve(root, "src-tauri/target/release/bundle/macos/Flect.app"),
  builtDmg: resolve(
    root,
    "src-tauri/target/release/bundle/dmg/Flect_0.1.1_aarch64.dmg",
  ),
  releaseDmg: resolve(distRelease, "Flect_0.1.1_aarch64.dmg"),
  checksum: resolve(distRelease, "Flect_0.1.1_aarch64.dmg.sha256"),
  demoSource: resolve(root, "assets/demo/flect-v0.1-demo.webm"),
  demoMp4: resolve(distRelease, "flect-v0.1.1-demo.mp4"),
};

const VersionDocument = Schema.Struct({ version: Schema.String });
const CargoDocument = Schema.Struct({
  package: Schema.Struct({ version: Schema.String }),
});

export interface VersionManifest {
  readonly packageVersion: string;
  readonly cargoVersion: string;
  readonly tauriVersion: string;
}

export interface ReleaseLayout {
  readonly sidecar: string;
  readonly app: string;
  readonly dmg: string;
}

export class ReleasePackagingError extends Schema.TaggedErrorClass<ReleasePackagingError>()(
  "ReleasePackagingError",
  {
    message: Schema.String,
  },
) {}

const packagingError = (message: string) =>
  ReleasePackagingError.make({ message });

export const validateVersionManifest = Effect.fn(
  "Flect.Release.validateVersions",
)(function* (manifest: VersionManifest) {
  if (
    manifest.packageVersion !== expectedVersion ||
    manifest.cargoVersion !== expectedVersion ||
    manifest.tauriVersion !== expectedVersion
  ) {
    return yield* Effect.fail(
      packagingError("Every public Flect version must be 0.1.1."),
    );
  }
});

const requireEntry = Effect.fn("Flect.Release.requireEntry")(
  (path: string, kind: "file" | "directory", message: string) =>
    Effect.tryPromise({
      try: () => stat(path),
      catch: () => packagingError(message),
    }).pipe(
      Effect.flatMap((entry) => {
        const valid = kind === "file" ? entry.isFile() : entry.isDirectory();
        return valid ? Effect.void : Effect.fail(packagingError(message));
      }),
    ),
);

export const validateReleaseLayout = Effect.fn("Flect.Release.validateLayout")(
  function* (layout: ReleaseLayout) {
    yield* requireEntry(
      layout.sidecar,
      "file",
      "The compiled Flect sidecar is missing.",
    );
    yield* requireEntry(
      layout.app,
      "directory",
      "The Flect application bundle is missing.",
    );
    yield* requireEntry(layout.dmg, "file", "The Flect DMG is missing.");
  },
);

const readText = Effect.fn("Flect.Release.readText")((path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: () => packagingError("A public version manifest could not be read."),
  }),
);

const parseJson = Effect.fn("Flect.Release.parseJson")((source: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(source),
    catch: () => packagingError("A public version manifest is invalid."),
  }),
);

const decodeVersion = Effect.fn("Flect.Release.decodeVersion")(
  (input: unknown) =>
    Schema.decodeUnknownEffect(VersionDocument)(input).pipe(
      Effect.map((document) => document.version),
      Effect.mapError(() =>
        packagingError("A public version manifest is invalid."),
      ),
    ),
);

const readVersionManifest = Effect.fn("Flect.Release.readVersions")(
  function* () {
    const packageVersion = yield* readText(paths.packageJson).pipe(
      Effect.flatMap(parseJson),
      Effect.flatMap(decodeVersion),
    );
    const tauriVersion = yield* readText(paths.tauriConfig).pipe(
      Effect.flatMap(parseJson),
      Effect.flatMap(decodeVersion),
    );
    const cargoVersion = yield* readText(paths.cargoManifest).pipe(
      Effect.flatMap((source) =>
        Effect.try({
          try: (): unknown => Bun.TOML.parse(source),
          catch: () => packagingError("A public version manifest is invalid."),
        }),
      ),
      Effect.flatMap((input) =>
        Schema.decodeUnknownEffect(CargoDocument)(input).pipe(
          Effect.map((document) => document.package.version),
          Effect.mapError(() =>
            packagingError("A public version manifest is invalid."),
          ),
        ),
      ),
    );

    return {
      packageVersion,
      cargoVersion,
      tauriVersion,
    } satisfies VersionManifest;
  },
);

const commandText = (command: ReadonlyArray<string>) => command.join(" ");

const run = Effect.fn("Flect.Release.run")((command: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      console.log(`$ ${commandText(command)}`);
      const child = Bun.spawn([...command], {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await child.exited;
      if (exitCode !== 0) {
        throw new Error(`Command exited with status ${exitCode}.`);
      }
    },
    catch: () =>
      packagingError(`Release command failed: ${commandText(command)}`),
  }),
);

const prepareOutput = Effect.fn("Flect.Release.prepareOutput")(function* () {
  if (
    dirname(distRelease) !== root ||
    basename(distRelease) !== "dist-release"
  ) {
    return yield* Effect.fail(
      packagingError("The release output directory is not repository-local."),
    );
  }
  yield* Effect.tryPromise({
    try: () => rm(distRelease, { recursive: true, force: true }),
    catch: () => packagingError("The release output could not be cleared."),
  });
  yield* Effect.tryPromise({
    try: () => mkdir(distRelease, { recursive: true }),
    catch: () => packagingError("The release output could not be created."),
  });
});

const copyReleaseAssets = Effect.fn("Flect.Release.copyAssets")(function* () {
  yield* Effect.tryPromise({
    try: () => copyFile(paths.builtDmg, paths.releaseDmg),
    catch: () => packagingError("The Flect DMG could not be staged."),
  });
  yield* run([
    "ffmpeg",
    "-y",
    "-i",
    paths.demoSource,
    "-vf",
    "scale=1280:-2:flags=lanczos",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    paths.demoMp4,
  ]);

  const dmg = yield* Effect.tryPromise({
    try: () => readFile(paths.releaseDmg),
    catch: () => packagingError("The staged Flect DMG could not be read."),
  });
  const digest = createHash("sha256").update(dmg).digest("hex");
  yield* Effect.tryPromise({
    try: () =>
      writeFile(
        paths.checksum,
        `${digest}  ${basename(paths.releaseDmg)}\n`,
        "utf8",
      ),
    catch: () => packagingError("The Flect DMG checksum could not be written."),
  });
});

const verifyMountedDmg = Effect.fn("Flect.Release.verifyMountedDmg")(
  function* () {
    yield* run(["hdiutil", "verify", paths.releaseDmg]);
    yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        const mountPoint = yield* Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), "flect-release-mount-")),
          catch: () =>
            packagingError("A DMG verification mount could not be created."),
        });
        return yield* run([
          "hdiutil",
          "attach",
          "-nobrowse",
          "-readonly",
          "-mountpoint",
          mountPoint,
          paths.releaseDmg,
        ]).pipe(
          Effect.as(mountPoint),
          Effect.tapError(() =>
            Effect.promise(() =>
              rm(mountPoint, { recursive: true, force: true }),
            ),
          ),
        );
      }),
      (mountPoint) =>
        Effect.gen(function* () {
          const mountedApp = resolve(mountPoint, "Flect.app");
          yield* requireEntry(
            mountedApp,
            "directory",
            "The mounted DMG does not contain Flect.app.",
          );
          yield* run([
            "codesign",
            "--verify",
            "--deep",
            "--strict",
            "--verbose=2",
            mountedApp,
          ]);
        }),
      (mountPoint) =>
        run(["hdiutil", "detach", mountPoint]).pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(
            Effect.promise(() =>
              rm(mountPoint, { recursive: true, force: true }),
            ),
          ),
        ),
    );
  },
);

export const packageRelease = Effect.gen(function* () {
  const versions = yield* readVersionManifest();
  yield* validateVersionManifest(versions);
  yield* prepareOutput();
  yield* run([process.execPath, "run", "build:desktop"]);
  yield* validateReleaseLayout({
    sidecar: paths.sidecar,
    app: paths.app,
    dmg: paths.builtDmg,
  });
  yield* copyReleaseAssets();
  yield* verifyMountedDmg();
  yield* requireEntry(
    paths.demoMp4,
    "file",
    "The Flect release demo is missing.",
  );
  yield* requireEntry(
    paths.checksum,
    "file",
    "The Flect DMG checksum is missing.",
  );
  console.log(`Packaged Flect ${expectedVersion} in ${distRelease}`);
});

if (import.meta.main) {
  Effect.runPromise(packageRelease).catch((error: unknown) => {
    if (error instanceof ReleasePackagingError) {
      console.error(error.message);
    } else {
      console.error("Flect release packaging failed unexpectedly.");
    }
    process.exitCode = 1;
  });
}
