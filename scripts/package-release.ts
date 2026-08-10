import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { compareReleaseBuilds } from "./compare-release-builds";
import {
  type UpdaterEvidence,
  validateUpdaterArchiveEntries,
  validateUpdaterEvidence,
  writeStaticUpdateManifest,
} from "./release-update";

const expectedVersion = "0.2.0";
const obsoleteCompanions = ["flect" + "ctl", "flect-" + "mcp"] as const;
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
    "src-tauri/target/release/bundle/dmg/Flect_0.2.0_aarch64.dmg",
  ),
  releaseDmg: resolve(distRelease, "Flect_0.2.0_aarch64.dmg"),
  checksum: resolve(distRelease, "Flect_0.2.0_aarch64.dmg.sha256"),
  manifest: resolve(distRelease, "Flect_0.2.0_aarch64.release.json"),
  builtUpdaterArchive: resolve(
    root,
    "src-tauri/target/release/bundle/macos/Flect.app.tar.gz",
  ),
  builtUpdaterSignature: resolve(
    root,
    "src-tauri/target/release/bundle/macos/Flect.app.tar.gz.sig",
  ),
  updaterArchive: resolve(distRelease, "Flect.app.tar.gz"),
  updaterSignature: resolve(distRelease, "Flect.app.tar.gz.sig"),
  updaterManifest: resolve(distRelease, "latest.json"),
  demoSource: resolve(root, "assets/demo/flect-v0.2-demo.webm"),
  demoMp4: resolve(distRelease, "flect-v0.2.0-demo.mp4"),
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

export interface ReleaseTrustEvidence {
  readonly mode: "development" | "public";
  readonly reproducibilityVerified: boolean;
  readonly source: {
    readonly dirty: boolean;
    readonly tag: string | undefined;
  };
  readonly architectures: {
    readonly publicExecutable: string;
    readonly privateRuntime: string;
  };
  readonly signing: {
    readonly kind: "adhoc" | "apple-development" | "developer-id" | "unknown";
    readonly teamIdentifier: string | undefined;
    readonly hardenedRuntime: boolean;
    readonly gatekeeperAccepted: boolean;
    readonly stapled: boolean;
  };
}

type ReleaseTrustMode = ReleaseTrustEvidence["mode"];

export const desktopBuildCommand = (
  mode: ReleaseTrustMode,
): ReadonlyArray<string> =>
  mode === "development"
    ? [process.execPath, "run", "build:desktop"]
    : [process.execPath, "run", "build:desktop:public"];

export class ReleasePackagingError extends Schema.TaggedErrorClass<ReleasePackagingError>()(
  "ReleasePackagingError",
  {
    message: Schema.String,
  },
) {}

const packagingError = (message: string) =>
  ReleasePackagingError.make({ message });

export const validateReleaseTrustEvidence = Effect.fn(
  "Flect.Release.validateTrustEvidence",
)(function* (evidence: ReleaseTrustEvidence) {
  if (
    evidence.architectures.publicExecutable !== "arm64" ||
    evidence.architectures.privateRuntime !== "arm64"
  ) {
    return yield* Effect.fail(
      packagingError("Every shipped Flect executable must be arm64 only."),
    );
  }
  if (!evidence.signing.hardenedRuntime) {
    return yield* Effect.fail(
      packagingError("Every Flect macOS artifact requires hardened runtime."),
    );
  }
  if (evidence.mode === "development") {
    return;
  }
  if (!evidence.reproducibilityVerified) {
    return yield* Effect.fail(
      packagingError(
        "A public Flect release requires independently verified reproducible content.",
      ),
    );
  }
  if (evidence.source.dirty || evidence.source.tag !== "v0.2.0") {
    return yield* Effect.fail(
      packagingError(
        "A public Flect release requires a clean worktree at tag v0.2.0.",
      ),
    );
  }
  if (evidence.signing.kind !== "developer-id") {
    return yield* Effect.fail(
      packagingError(
        "A public Flect release requires Developer ID Application signing.",
      ),
    );
  }
  if (evidence.signing.teamIdentifier === undefined) {
    return yield* Effect.fail(
      packagingError("A public Flect release requires a signing Team ID."),
    );
  }
  if (!evidence.signing.gatekeeperAccepted) {
    return yield* Effect.fail(
      packagingError("Gatekeeper must accept a public Flect release."),
    );
  }
  if (!evidence.signing.stapled) {
    return yield* Effect.fail(
      packagingError(
        "A public Flect release requires a stapled notarization ticket.",
      ),
    );
  }
});

export const validateVersionManifest = Effect.fn(
  "Flect.Release.validateVersions",
)(function* (manifest: VersionManifest) {
  if (
    manifest.packageVersion !== expectedVersion ||
    manifest.cargoVersion !== expectedVersion ||
    manifest.tauriVersion !== expectedVersion
  ) {
    return yield* Effect.fail(
      packagingError("Every public Flect version must be 0.2.0."),
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

const forbidEntry = Effect.fn("Flect.Release.forbidEntry")(
  (path: string, message: string) =>
    Effect.tryPromise({
      try: () => stat(path),
      catch: () => packagingError(message),
    }).pipe(
      Effect.option,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: () => Effect.fail(packagingError(message)),
        }),
      ),
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
    yield* requireEntry(
      join(layout.app, "Contents", "MacOS", "flect"),
      "file",
      "The Flect app does not contain its public executable.",
    );
    yield* requireEntry(
      join(layout.app, "Contents", "MacOS", "flect-runtime"),
      "file",
      "The Flect app does not contain its private runtime.",
    );
    for (const companion of obsoleteCompanions) {
      yield* forbidEntry(
        join(layout.app, "Contents", "MacOS", companion),
        "The Flect app still contains an obsolete companion executable.",
      );
    }
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

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const captureCommand = async (
  command: ReadonlyArray<string>,
): Promise<CommandResult> => {
  const child = Bun.spawn([...command], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Effect.runPromise(
    Effect.all(
      [
        Effect.promise(() => child.exited),
        Effect.promise(() => new Response(child.stdout).text()),
        Effect.promise(() => new Response(child.stderr).text()),
      ],
      { concurrency: "unbounded" },
    ),
  );
  return { exitCode, stderr, stdout };
};

const capture = Effect.fn("Flect.Release.capture")(
  (command: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: async () => {
        const result = await captureCommand(command);
        if (result.exitCode !== 0) {
          throw new Error(`Command exited with status ${result.exitCode}.`);
        }
        return `${result.stdout}${result.stderr}`.trim();
      },
      catch: () =>
        packagingError(`Release command failed: ${commandText(command)}`),
    }),
);

const observe = Effect.fn("Flect.Release.observe")(
  (command: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () => captureCommand(command),
      catch: () =>
        packagingError(`Release command failed: ${commandText(command)}`),
    }),
);

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

const validatePublicUpdaterConfiguration = Effect.fn(
  "Flect.Release.validatePublicUpdaterConfiguration",
)(function* (mode: ReleaseTrustMode) {
  if (mode === "development") return;
  if (
    typeof process.env.FLECT_UPDATE_PUBLIC_KEY !== "string" ||
    process.env.FLECT_UPDATE_PUBLIC_KEY.trim().length === 0
  ) {
    return yield* Effect.fail(
      packagingError("A public release requires FLECT_UPDATE_PUBLIC_KEY."),
    );
  }
  if (
    typeof process.env.TAURI_SIGNING_PRIVATE_KEY !== "string" ||
    process.env.TAURI_SIGNING_PRIVATE_KEY.length === 0
  ) {
    return yield* Effect.fail(
      packagingError("A public release requires TAURI_SIGNING_PRIVATE_KEY."),
    );
  }
});

const copyReleaseAssets = Effect.fn("Flect.Release.copyAssets")(function* (
  mode: ReleaseTrustMode,
) {
  yield* Effect.tryPromise({
    try: () => copyFile(paths.builtDmg, paths.releaseDmg),
    catch: () => packagingError("The Flect DMG could not be staged."),
  });
  if (mode === "public") {
    yield* Effect.tryPromise({
      try: () => copyFile(paths.builtUpdaterArchive, paths.updaterArchive),
      catch: () =>
        packagingError("The signed Flect updater archive could not be staged."),
    });
    yield* Effect.tryPromise({
      try: () => copyFile(paths.builtUpdaterSignature, paths.updaterSignature),
      catch: () =>
        packagingError("The Flect updater signature could not be staged."),
    });
  }
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
  const checksumSource = yield* readText(paths.checksum);
  const [recordedDigest, recordedName] = checksumSource.trim().split(/\s+/u);
  if (
    recordedDigest !== digest ||
    recordedName !== basename(paths.releaseDmg)
  ) {
    return yield* Effect.fail(
      packagingError("The Flect DMG checksum does not match the staged DMG."),
    );
  }
});

const stageUpdaterEvidence = Effect.fn("Flect.Release.stageUpdaterEvidence")(
  function* (mode: ReleaseTrustMode) {
    if (mode === "development") {
      return yield* validateUpdaterEvidence({
        mode,
        version: expectedVersion,
      });
    }
    const updater = yield* validateUpdaterEvidence({
      mode,
      version: expectedVersion,
      target: "darwin-aarch64",
      publicKey: process.env.FLECT_UPDATE_PUBLIC_KEY,
      privateKeyConfigured:
        typeof process.env.TAURI_SIGNING_PRIVATE_KEY === "string" &&
        process.env.TAURI_SIGNING_PRIVATE_KEY.length > 0,
      archivePath: paths.updaterArchive,
      signaturePath: paths.updaterSignature,
      artifactUrl:
        "https://github.com/akua-dev/flect/releases/download/v0.2.0/Flect.app.tar.gz",
    });
    if (!updater.available) {
      return updater;
    }
    const archiveEntries = yield* capture([
      "tar",
      "-tzf",
      paths.updaterArchive,
    ]);
    yield* validateUpdaterArchiveEntries(archiveEntries);
    yield* writeStaticUpdateManifest({
      path: paths.updaterManifest,
      version: expectedVersion,
      notes: "Flect 0.2.0 — the first adoptable adaptive interface shell.",
      url: updater.artifactUrl,
      signature: updater.signature,
    });
    return updater;
  },
  Effect.mapError((error) => packagingError(error.message)),
);

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const treeDigest = async (directory: string): Promise<string> => {
  const lines: Array<string> = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current);
    entries.sort();
    for (const name of entries) {
      const path = join(current, name);
      const entry = await lstat(path);
      const relativePath = relative(directory, path);
      const mode = (entry.mode & 0o777).toString(8).padStart(3, "0");
      if (entry.isDirectory()) {
        lines.push(`directory\0${relativePath}\0${mode}`);
        await walk(path);
      } else if (entry.isSymbolicLink()) {
        lines.push(
          `symlink\0${relativePath}\0${mode}\0${await readlink(path)}`,
        );
      } else if (entry.isFile()) {
        lines.push(`file\0${relativePath}\0${mode}\0${await sha256File(path)}`);
      }
    }
  };
  await walk(directory);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
};

const unsignedApplicationDigest = Effect.fn(
  "Flect.Release.unsignedApplicationDigest",
)(() =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "flect-unsigned-content-")),
      catch: () =>
        packagingError("The unsigned-content workspace could not be created."),
    }),
    (temporary) =>
      Effect.tryPromise({
        try: async () => {
          const copiedApp = join(temporary, "Flect.app");
          await cp(paths.app, copiedApp, {
            recursive: true,
            preserveTimestamps: true,
          });
          const copiedRuntime = join(
            copiedApp,
            "Contents",
            "MacOS",
            "flect-runtime",
          );
          for (const signedPath of [copiedRuntime, copiedApp]) {
            const result = await captureCommand([
              "codesign",
              "--remove-signature",
              signedPath,
            ]);
            if (result.exitCode !== 0) {
              throw new Error(
                "A copied release signature could not be removed.",
              );
            }
          }
          await rm(join(copiedApp, "Contents", "_CodeSignature"), {
            recursive: true,
            force: true,
          });
          return await treeDigest(copiedApp);
        },
        catch: () =>
          packagingError(
            "The normalized unsigned application digest could not be created.",
          ),
      }),
    (temporary) =>
      Effect.promise(() => rm(temporary, { recursive: true, force: true })),
  ),
);

const firstLine = (value: string): string => value.split(/\r?\n/u)[0] ?? "";

const parseSigningKind = (
  details: string,
): ReleaseTrustEvidence["signing"]["kind"] =>
  details.includes("Authority=Developer ID Application:")
    ? "developer-id"
    : details.includes("Authority=Apple Development:")
      ? "apple-development"
      : details.includes("Signature=adhoc")
        ? "adhoc"
        : "unknown";

const observeReproducibility = Effect.fn(
  "Flect.Release.observeReproducibility",
)(function* () {
  const reference = process.env.FLECT_REPRODUCIBILITY_REFERENCE_APP;
  if (
    reference === undefined ||
    resolve(reference) === paths.app ||
    !reference.endsWith("/Flect.app")
  ) {
    return undefined;
  }
  return yield* compareReleaseBuilds(paths.app, resolve(reference)).pipe(
    Effect.mapError((error) => packagingError(error.message)),
  );
});

const writeReleaseEvidence = Effect.fn("Flect.Release.writeEvidence")(
  function* (updater: UpdaterEvidence) {
    const publicExecutable = join(paths.app, "Contents", "MacOS", "flect");
    const privateRuntime = join(
      paths.app,
      "Contents",
      "MacOS",
      "flect-runtime",
    );
    const [
      commit,
      status,
      tagObservation,
      publicArchitecture,
      privateArchitecture,
      signingObservation,
      gatekeeperObservation,
      staplingObservation,
      rustc,
      cargo,
      tauri,
      xcode,
      ffmpeg,
    ] = yield* Effect.all(
      [
        capture(["git", "rev-parse", "HEAD"]),
        capture(["git", "status", "--porcelain", "--untracked-files=all"]),
        observe(["git", "describe", "--exact-match", "--tags", "HEAD"]),
        capture(["lipo", "-archs", publicExecutable]),
        capture(["lipo", "-archs", privateRuntime]),
        observe(["codesign", "-dv", "--verbose=4", paths.app]),
        observe([
          "spctl",
          "--assess",
          "--type",
          "execute",
          "--verbose=4",
          paths.app,
        ]),
        observe(["xcrun", "stapler", "validate", paths.app]),
        capture(["rustc", "--version"]),
        capture(["cargo", "--version"]),
        capture([resolve(root, "node_modules", ".bin", "tauri"), "--version"]),
        capture(["xcodebuild", "-version"]),
        capture(["ffmpeg", "-version"]),
      ],
      { concurrency: "unbounded" },
    );

    const signingDetails = `${signingObservation.stdout}${signingObservation.stderr}`;
    const teamMatch = signingDetails.match(/^TeamIdentifier=(.+)$/mu)?.[1];
    const teamIdentifier =
      teamMatch === undefined || teamMatch === "not set"
        ? undefined
        : teamMatch;
    const reproducibility = yield* observeReproducibility();
    const evidence: ReleaseTrustEvidence = {
      mode: process.env.FLECT_PUBLIC_RELEASE === "1" ? "public" : "development",
      reproducibilityVerified: reproducibility?.verified === true,
      source: {
        dirty: status.length > 0,
        tag:
          tagObservation.exitCode === 0
            ? tagObservation.stdout.trim()
            : undefined,
      },
      architectures: {
        publicExecutable: publicArchitecture,
        privateRuntime: privateArchitecture,
      },
      signing: {
        kind: parseSigningKind(signingDetails),
        teamIdentifier,
        hardenedRuntime: /flags=.*\bruntime\b/u.test(signingDetails),
        gatekeeperAccepted: gatekeeperObservation.exitCode === 0,
        stapled: staplingObservation.exitCode === 0,
      },
    };
    yield* validateReleaseTrustEvidence(evidence);

    const inputPaths = [
      "package.json",
      "bun.lock",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/tauri.conf.json",
    ] as const;
    const inputDigests = yield* Effect.tryPromise({
      try: async () =>
        Object.fromEntries(
          await Effect.runPromise(
            Effect.forEach(
              inputPaths,
              (path) =>
                Effect.promise(
                  async () =>
                    [path, await sha256File(join(root, path))] as const,
                ),
              { concurrency: "unbounded" },
            ),
          ),
        ),
      catch: () => packagingError("Release inputs could not be hashed."),
    });
    const unsignedContentSha256 = yield* unsignedApplicationDigest();
    const artifacts = yield* Effect.tryPromise({
      try: async () => {
        const values = await Effect.runPromise(
          Effect.forEach(
            [
              paths.releaseDmg,
              paths.checksum,
              paths.demoMp4,
              ...(updater.available
                ? [
                    paths.updaterArchive,
                    paths.updaterSignature,
                    paths.updaterManifest,
                  ]
                : []),
            ],
            (path) =>
              Effect.promise(async () => {
                const entry = await stat(path);
                return [
                  basename(path),
                  { bytes: entry.size, sha256: await sha256File(path) },
                ] as const;
              }),
            { concurrency: "unbounded" },
          ),
        );
        return Object.fromEntries(values);
      },
      catch: () => packagingError("Release artifacts could not be hashed."),
    });

    const manifest = {
      schemaVersion: 1,
      product: "Flect",
      version: expectedVersion,
      target: "aarch64-apple-darwin",
      minimumMacOS: "12.0",
      trustMode: evidence.mode,
      source: {
        commit,
        dirty: evidence.source.dirty,
        tag: evidence.source.tag ?? null,
      },
      toolchain: {
        bun: Bun.version,
        cargo: firstLine(cargo),
        ffmpeg: firstLine(ffmpeg),
        rustc: firstLine(rustc),
        tauri: firstLine(tauri),
        xcode: xcode.replaceAll("\n", "; "),
      },
      inputs: inputDigests,
      artifacts,
      bundle: {
        identifier: "dev.akua.flect",
        executables: {
          flect: evidence.architectures.publicExecutable,
          "flect-runtime": evidence.architectures.privateRuntime,
        },
        signing: {
          kind: evidence.signing.kind,
          teamIdentifier: evidence.signing.teamIdentifier ?? null,
          hardenedRuntime: evidence.signing.hardenedRuntime,
          gatekeeperAccepted: evidence.signing.gatekeeperAccepted,
          stapled: evidence.signing.stapled,
        },
        unsignedContentSha256,
      },
      reproducibility: {
        verified: evidence.reproducibilityVerified,
        blocker:
          reproducibility === undefined
            ? "independent-build-reference-missing"
            : reproducibility.verified
              ? null
              : "tauri-isolation-per-build-randomness",
        comparison:
          reproducibility === undefined
            ? null
            : {
                firstTreeSha256: reproducibility.firstTreeSha256,
                secondTreeSha256: reproducibility.secondTreeSha256,
                changedPaths: reproducibility.changedPaths,
                binaryOffsets: reproducibility.binaryOffsets,
              },
      },
      updater: updater.available
        ? {
            available: true,
            target: updater.target,
            artifactUrl: updater.artifactUrl,
            archiveSha256: updater.archiveSha256,
            publicKeySha256: updater.publicKeySha256,
          }
        : updater,
    } as const;
    yield* Effect.tryPromise({
      try: () =>
        writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`),
      catch: () =>
        packagingError("The release evidence manifest could not be written."),
    });
  },
);

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
  const mode: ReleaseTrustMode =
    process.env.FLECT_PUBLIC_RELEASE === "1" ? "public" : "development";
  const versions = yield* readVersionManifest();
  yield* validateVersionManifest(versions);
  yield* validatePublicUpdaterConfiguration(mode);
  yield* prepareOutput();
  yield* run(desktopBuildCommand(mode));
  yield* validateReleaseLayout({
    sidecar: paths.sidecar,
    app: paths.app,
    dmg: paths.builtDmg,
  });
  yield* copyReleaseAssets(mode);
  const updater = yield* stageUpdaterEvidence(mode);
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
  yield* writeReleaseEvidence(updater);
  yield* requireEntry(
    paths.manifest,
    "file",
    "The Flect release evidence manifest is missing.",
  );
  console.log(`Packaged Flect ${expectedVersion} in ${distRelease}`);
});

if (import.meta.main) {
  Effect.runPromise(packageRelease).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      error._tag === "ReleasePackagingError" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      console.error(error.message);
    } else {
      console.error("Flect release packaging failed unexpectedly.");
    }
    process.exitCode = 1;
  });
}
