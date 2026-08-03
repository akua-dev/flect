import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { Effect, Ref, Result, Schema } from "effect";
import {
  NativeUpdateCandidate,
  NativeUpdateError,
  NativeUpdateProgress,
  NativeUpdateSnapshot,
} from "../shared/native-update";
import {
  makeGuardedNativeUpdateLayer,
  NativeUpdate,
  type NativeUpdateAdapterShape,
} from "../src/lib/native-update";
import {
  validateUpdaterArchiveEntries,
  validateUpdaterEvidence,
} from "./release-update";

class NativeUpdateFixtureError extends Schema.TaggedErrorClass<NativeUpdateFixtureError>()(
  "NativeUpdateFixtureError",
  {
    reason: Schema.Literals([
      "filesystem",
      "transport",
      "manifest",
      "signature",
      "install",
      "relaunch",
    ]),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300),
    ),
  },
) {}

class FixtureManifest extends Schema.Class<FixtureManifest>("FixtureManifest")({
  version: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(40),
    Schema.isPattern(/^\d+\.\d+\.\d+$/),
  ),
  archiveUrl: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(300),
  ),
  signature: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16_384),
  ),
  contentLength: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  ),
}) {}

class FixtureLaunch extends Schema.Class<FixtureLaunch>("FixtureLaunch")({
  version: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(40),
    Schema.isPattern(/^\d+\.\d+\.\d+$/),
  ),
}) {}

export class NativeUpdateFixtureDogfoodReport extends Schema.Class<NativeUpdateFixtureDogfoodReport>(
  "NativeUpdateFixtureDogfoodReport",
)({
  transport: Schema.Literal("loopback"),
  installedVersion: Schema.Literal("0.2.0"),
  relaunchedVersion: Schema.Literal("0.2.0"),
  preserved: Schema.Array(
    Schema.Literals(["workspace", "settings", "grants", "extensions"]),
  ),
  corruptSignature: Schema.Literal("rejected"),
  bundleAfterRejection: Schema.Literal("unchanged"),
  stateAfterRejection: Schema.Literal("unchanged"),
}) {}

const fixtureError = (
  reason: NativeUpdateFixtureError["reason"],
  message: string,
) => NativeUpdateFixtureError.make({ reason, message });

const execFilePromise = promisify(execFile);

const temporaryRoot = Effect.acquireRelease(
  Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "flect-native-update-dogfood-")),
    catch: () =>
      fixtureError("filesystem", "The fixture root could not be created."),
  }),
  (path) =>
    Effect.tryPromise({
      try: () => rm(path, { recursive: true, force: true }),
      catch: () => undefined,
    }).pipe(Effect.ignore),
);

const writeFixtureFile = Effect.fn("Flect.FixtureUpdate.writeFile")(
  (path: string, contents: string | Uint8Array) =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, contents);
      },
      catch: () =>
        fixtureError("filesystem", "A fixture file could not be written."),
    }),
);

const executableSource = (version: string) =>
  `#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)} }));\n`;

const writeFixtureApp = Effect.fn("Flect.FixtureUpdate.writeApp")(function* (
  parent: string,
  version: string,
) {
  const executable = join(parent, "Flect.app", "Contents", "MacOS", "flect");
  const runtime = join(
    parent,
    "Flect.app",
    "Contents",
    "MacOS",
    "flect-runtime",
  );
  yield* writeFixtureFile(executable, executableSource(version));
  yield* writeFixtureFile(runtime, `fixture-runtime:${version}\n`);
  yield* Effect.tryPromise({
    try: () => Promise.all([chmod(executable, 0o755), chmod(runtime, 0o755)]),
    catch: () =>
      fixtureError(
        "filesystem",
        "The fixture executables could not be made runnable.",
      ),
  });
});

const runCommand = Effect.fn("Flect.FixtureUpdate.runCommand")(
  (
    command: ReadonlyArray<string>,
    reason: NativeUpdateFixtureError["reason"],
  ) =>
    Effect.tryPromise({
      try: async () => {
        const executable = command[0];
        if (executable === undefined) throw new Error("missing executable");
        const { stdout } = await execFilePromise(executable, command.slice(1), {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        });
        return stdout;
      },
      catch: (cause) =>
        fixtureError(
          reason,
          `A fixture command failed: ${String(cause)}`.slice(0, 300),
        ),
    }),
);

const createArchive = Effect.fn("Flect.FixtureUpdate.createArchive")(function* (
  sourceRoot: string,
  archivePath: string,
) {
  yield* runCommand(
    ["tar", "-czf", archivePath, "-C", sourceRoot, "Flect.app"],
    "filesystem",
  );
  return yield* Effect.tryPromise({
    try: async () => Uint8Array.from(await readFile(archivePath)),
    catch: () =>
      fixtureError("filesystem", "The fixture archive could not be read."),
  });
});

const signArchive = Effect.fn("Flect.FixtureUpdate.signArchive")(function* (
  archive: Uint8Array,
) {
  return yield* Effect.try({
    try: () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const publicDer = publicKey.export({ format: "der", type: "spki" });
      const publicRaw = publicDer.subarray(publicDer.length - 32);
      const keyId = Buffer.from("1020304050607080", "hex");
      const algorithm = Buffer.from("ED", "ascii");
      const publicRecord = Buffer.concat([algorithm, keyId, publicRaw]);
      const artifactSignature = sign(
        null,
        createHash("blake2b512").update(archive).digest(),
        privateKey,
      );
      const trustedComment = "timestamp:0\tfile:Flect.app.tar.gz\tprehashed";
      const globalSignature = sign(
        null,
        Buffer.concat([artifactSignature, Buffer.from(trustedComment)]),
        privateKey,
      );
      const publicSource = `untrusted comment: fixture updater public key\n${publicRecord.toString("base64")}\n`;
      const signatureSource = `untrusted comment: fixture updater signature\n${Buffer.concat([algorithm, keyId, artifactSignature]).toString("base64")}\ntrusted comment: ${trustedComment}\n${globalSignature.toString("base64")}\n`;
      return {
        publicKey: Buffer.from(publicSource).toString("base64"),
        signature: Buffer.from(signatureSource).toString("base64"),
      };
    },
    catch: () =>
      fixtureError("signature", "The fixture archive could not be signed."),
  });
});

const corruptSignature = Effect.fn("Flect.FixtureUpdate.corruptSignature")(
  function* (signature: string) {
    return yield* Effect.try({
      try: () => {
        const source = Buffer.from(signature, "base64").toString("utf8");
        const lines = source.trim().split(/\r?\n/u);
        const recordSource = lines[1];
        if (recordSource === undefined) {
          throw new Error("missing signature record");
        }
        const record = Buffer.from(recordSource, "base64");
        if (record.length === 0) throw new Error("empty signature record");
        record[record.length - 1] = (record[record.length - 1] ?? 0) ^ 1;
        lines[1] = record.toString("base64");
        return Buffer.from(`${lines.join("\n")}\n`).toString("base64");
      },
      catch: () =>
        fixtureError(
          "signature",
          "The fixture signature could not be corrupted.",
        ),
    });
  },
);

const serveFixture = (
  version: string,
  archive: Uint8Array,
  signature: string,
) =>
  Effect.acquireRelease(
    Effect.callback<Server, NativeUpdateFixtureError>((resume) => {
      const server = createServer((request, response) => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          response.writeHead(503).end("Unavailable");
          return;
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const requestUrl = new URL(request.url ?? "/", baseUrl);
        if (requestUrl.pathname === "/latest.json") {
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              version,
              archiveUrl: `${baseUrl}/Flect.app.tar.gz`,
              signature,
              contentLength: archive.byteLength,
            }),
          );
          return;
        }
        if (requestUrl.pathname === "/Flect.app.tar.gz") {
          response
            .writeHead(200, { "content-type": "application/gzip" })
            .end(Buffer.from(archive));
          return;
        }
        response.writeHead(404).end("Not found");
      });
      const onError = () =>
        resume(
          Effect.fail(
            fixtureError("transport", "The loopback fixture could not start."),
          ),
        );
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resume(Effect.succeed(server));
      });
      return Effect.sync(() => server.close());
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      }),
  );

const serverBaseUrl = Effect.fn("Flect.FixtureUpdate.serverBaseUrl")(function* (
  server: Server,
) {
  const address = server.address();
  if (address === null || typeof address === "string") {
    return yield* Effect.fail(
      fixtureError("transport", "The loopback fixture has no address."),
    );
  }
  return `http://127.0.0.1:${address.port}`;
});

const manifestFrom = Effect.fn("Flect.FixtureUpdate.fetchManifest")(function* (
  baseUrl: string,
) {
  const source = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(new URL("/latest.json", baseUrl));
      if (!response.ok) throw new Error("manifest response failed");
      return await response.text();
    },
    catch: () =>
      fixtureError("transport", "The fixture manifest could not be read."),
  });
  const manifest = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(FixtureManifest),
    { errors: "all", onExcessProperty: "error" },
  )(source).pipe(
    Effect.mapError(() =>
      fixtureError("manifest", "The fixture manifest is invalid."),
    ),
  );
  const archiveUrl = yield* Effect.try({
    try: () => new URL(manifest.archiveUrl),
    catch: () =>
      fixtureError("manifest", "The fixture archive URL is invalid."),
  });
  if (archiveUrl.protocol !== "http:" || archiveUrl.hostname !== "127.0.0.1") {
    return yield* Effect.fail(
      fixtureError("transport", "Fixture updates are restricted to loopback."),
    );
  }
  return manifest;
});

const fetchArchive = Effect.fn("Flect.FixtureUpdate.fetchArchive")(
  (url: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("archive response failed");
        return new Uint8Array(await response.arrayBuffer());
      },
      catch: () =>
        fixtureError("transport", "The fixture archive could not be read."),
    }),
);

const move = Effect.fn("Flect.FixtureUpdate.move")((from: string, to: string) =>
  Effect.tryPromise({
    try: () => rename(from, to),
    catch: () =>
      fixtureError("install", "The fixture application could not be moved."),
  }),
);

const remove = Effect.fn("Flect.FixtureUpdate.remove")((path: string) =>
  Effect.tryPromise({
    try: () => rm(path, { recursive: true, force: true }),
    catch: () =>
      fixtureError("filesystem", "A fixture path could not be removed."),
  }),
);

const installFixture = Effect.fn("Flect.FixtureUpdate.install")(function* (
  root: string,
  installedApp: string,
  publicKey: string,
  manifest: FixtureManifest,
) {
  const archive = yield* fetchArchive(manifest.archiveUrl);
  const downloadRoot = join(root, `download-${manifest.version}`);
  const archivePath = join(downloadRoot, "Flect.app.tar.gz");
  const signaturePath = `${archivePath}.sig`;
  yield* writeFixtureFile(archivePath, archive);
  yield* writeFixtureFile(signaturePath, `${manifest.signature}\n`);
  yield* validateUpdaterEvidence({
    mode: "public",
    version: manifest.version,
    target: "darwin-aarch64",
    publicKey,
    privateKeyConfigured: true,
    archivePath,
    signaturePath,
    artifactUrl: `https://github.com/akua-dev/flect/releases/download/v${manifest.version}/Flect.app.tar.gz`,
  }).pipe(
    Effect.mapError(() =>
      fixtureError("signature", "The fixture updater signature is invalid."),
    ),
  );
  const inventory = yield* runCommand(["tar", "-tzf", archivePath], "install");
  yield* validateUpdaterArchiveEntries(inventory).pipe(
    Effect.mapError(() =>
      fixtureError("install", "The fixture updater inventory is invalid."),
    ),
  );
  const extractedRoot = join(downloadRoot, "extracted");
  yield* Effect.tryPromise({
    try: () => mkdir(extractedRoot, { recursive: true }),
    catch: () =>
      fixtureError("filesystem", "The fixture stage could not be created."),
  });
  yield* runCommand(
    ["tar", "-xzf", archivePath, "-C", extractedRoot],
    "install",
  );
  const backupApp = join(downloadRoot, "Flect.previous.app");
  yield* move(installedApp, backupApp);
  yield* move(join(extractedRoot, "Flect.app"), installedApp).pipe(
    Effect.onError(() => move(backupApp, installedApp).pipe(Effect.orDie)),
  );
  yield* remove(backupApp);
});

const toNativeUpdateError = (error: NativeUpdateFixtureError) =>
  NativeUpdateError.make({
    reason:
      error.reason === "signature" ? "invalid-signature" : "install-failed",
    message:
      error.reason === "signature"
        ? "The fixture update signature is invalid."
        : "The fixture update could not be installed.",
  });

const launchVersion = Effect.fn("Flect.FixtureUpdate.relaunch")(function* (
  installedApp: string,
) {
  const source = yield* runCommand(
    [join(installedApp, "Contents", "MacOS", "flect")],
    "relaunch",
  );
  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(FixtureLaunch),
    { errors: "all", onExcessProperty: "error" },
  )(source).pipe(
    Effect.mapError(() =>
      fixtureError("relaunch", "The relaunched fixture output is invalid."),
    ),
  );
});

const makeFixtureAdapter = Effect.fn("Flect.FixtureUpdate.makeAdapter")(
  function* (
    root: string,
    baseUrl: string,
    installedApp: string,
    installedVersion: string,
    publicKey: string,
  ) {
    const reviewed = yield* Ref.make<FixtureManifest | undefined>(undefined);
    const relaunched = yield* Ref.make<string | undefined>(undefined);
    const token = `fixture_candidate_${installedVersion.replaceAll(".", "_")}`;
    const candidateFrom = (manifest: FixtureManifest) =>
      NativeUpdateCandidate.make({
        version: manifest.version,
        token,
        notes: "Signed fixture update.",
        target: "darwin-aarch64",
        contentLength: manifest.contentLength,
      });
    const check = manifestFrom(baseUrl).pipe(
      Effect.tap((manifest) => Ref.set(reviewed, manifest)),
      Effect.map((manifest) =>
        NativeUpdateSnapshot.make({
          version: 1,
          state: "available",
          installedVersion,
          candidate: candidateFrom(manifest),
        }),
      ),
      Effect.mapError(toNativeUpdateError),
    );
    const adapter: NativeUpdateAdapterShape = {
      status: Effect.succeed(
        NativeUpdateSnapshot.make({
          version: 1,
          state: "current",
          installedVersion,
          checkedAtMillis: 0,
        }),
      ),
      check,
      install: (claimedToken) =>
        Effect.gen(function* () {
          const manifest = yield* Ref.get(reviewed);
          if (manifest === undefined || claimedToken !== token) {
            return yield* Effect.fail(
              NativeUpdateError.make({
                reason: "stale",
                message: "The fixture candidate is stale.",
              }),
            );
          }
          yield* installFixture(root, installedApp, publicKey, manifest).pipe(
            Effect.mapError(toNativeUpdateError),
          );
          return NativeUpdateSnapshot.make({
            version: 1,
            state: "ready-to-relaunch",
            installedVersion,
            candidate: candidateFrom(manifest),
            progress: NativeUpdateProgress.make({
              downloadedBytes: manifest.contentLength,
              totalBytes: manifest.contentLength,
            }),
          });
        }),
      relaunch: launchVersion(installedApp).pipe(
        Effect.tap((launch) => Ref.set(relaunched, launch.version)),
        Effect.asVoid,
        Effect.mapError(toNativeUpdateError),
      ),
    };
    return { adapter, relaunched };
  },
);

const executeFixtureUpdate = Effect.fn("Flect.FixtureUpdate.execute")(
  function* (
    root: string,
    baseUrl: string,
    installedApp: string,
    installedVersion: string,
    publicKey: string,
  ) {
    const fixture = yield* makeFixtureAdapter(
      root,
      baseUrl,
      installedApp,
      installedVersion,
      publicKey,
    );
    const outcome = yield* Effect.gen(function* () {
      const updates = yield* NativeUpdate;
      const checked = yield* updates.check;
      if (checked.state !== "available") {
        return yield* Effect.fail(
          NativeUpdateError.make({
            reason: "invalid-manifest",
            message: "The fixture update candidate is unavailable.",
          }),
        );
      }
      yield* updates.install(checked.candidate.token);
      yield* updates.relaunch;
      return checked.candidate.version;
    }).pipe(Effect.provide(makeGuardedNativeUpdateLayer(fixture.adapter)));
    return {
      installedVersion: outcome,
      relaunchedVersion: yield* Ref.get(fixture.relaunched),
    };
  },
);

const fileDigest = Effect.fn("Flect.FixtureUpdate.fileDigest")((path: string) =>
  Effect.tryPromise({
    try: async () =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    catch: () =>
      fixtureError("filesystem", "A fixture file could not be hashed."),
  }),
);

const treeDigest = Effect.fn("Flect.FixtureUpdate.treeDigest")(function* (
  root: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const hash = createHash("sha256");
      const visit = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            await visit(path);
            continue;
          }
          const metadata = await stat(path);
          hash.update(relative(root, path));
          hash.update("\0");
          hash.update(String(metadata.mode & 0o777));
          hash.update("\0");
          hash.update(await readFile(path));
          hash.update("\0");
        }
      };
      await visit(root);
      return hash.digest("hex");
    },
    catch: () =>
      fixtureError("filesystem", "The fixture tree could not be hashed."),
  });
});

const canaryNames = ["workspace", "settings", "grants", "extensions"];

const canaryDigests = Effect.fn("Flect.FixtureUpdate.canaryDigests")(function* (
  paths: ReadonlyMap<string, string>,
) {
  const digests = new Map<string, string>();
  for (const [name, path] of paths) {
    digests.set(name, yield* fileDigest(path));
  }
  return digests;
});

const requireMatchingDigests = Effect.fn(
  "Flect.FixtureUpdate.requireMatchingDigests",
)(function* (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
) {
  for (const name of canaryNames) {
    if (before.get(name) !== after.get(name)) {
      return yield* Effect.fail(
        fixtureError("install", "A durable fixture canary changed."),
      );
    }
  }
});

export const runNativeUpdateFixtureDogfood = Effect.fn(
  "Flect.FixtureUpdate.runDogfood",
)(function* () {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryRoot;
      const applications = join(root, "Applications");
      const installedApp = join(applications, "Flect.app");
      yield* writeFixtureApp(applications, "0.1.0");

      const durableRoot = join(root, "durable");
      const canaries = new Map<string, string>([
        ["workspace", join(durableRoot, "workspace", "current.json")],
        ["settings", join(durableRoot, "settings.json")],
        ["grants", join(durableRoot, "grants.json")],
        ["extensions", join(durableRoot, "extensions", "active.json")],
      ]);
      for (const [name, path] of canaries) {
        yield* writeFixtureFile(path, `${name}:durable\n`);
      }
      const originalCanaries = yield* canaryDigests(canaries);

      const validSource = join(root, "valid-source");
      const validArchivePath = join(root, "valid", "Flect.app.tar.gz");
      yield* writeFixtureApp(validSource, "0.2.0");
      yield* Effect.tryPromise({
        try: () => mkdir(join(root, "valid"), { recursive: true }),
        catch: () =>
          fixtureError("filesystem", "The fixture archive root failed."),
      });
      const validArchive = yield* createArchive(validSource, validArchivePath);
      const validSignature = yield* signArchive(validArchive);
      const validServer = yield* serveFixture(
        "0.2.0",
        validArchive,
        validSignature.signature,
      );
      const validBaseUrl = yield* serverBaseUrl(validServer);
      const valid = yield* executeFixtureUpdate(
        root,
        validBaseUrl,
        installedApp,
        "0.1.0",
        validSignature.publicKey,
      );
      yield* requireMatchingDigests(
        originalCanaries,
        yield* canaryDigests(canaries),
      );

      const bundleBeforeRejection = yield* treeDigest(installedApp);
      const canariesBeforeRejection = yield* canaryDigests(canaries);
      const corruptSource = join(root, "corrupt-source");
      const corruptArchivePath = join(root, "corrupt", "Flect.app.tar.gz");
      yield* writeFixtureApp(corruptSource, "0.3.0");
      yield* Effect.tryPromise({
        try: () => mkdir(join(root, "corrupt"), { recursive: true }),
        catch: () =>
          fixtureError("filesystem", "The corrupt archive root failed."),
      });
      const corruptArchive = yield* createArchive(
        corruptSource,
        corruptArchivePath,
      );
      const corruptSigned = yield* signArchive(corruptArchive);
      const corruptServer = yield* serveFixture(
        "0.3.0",
        corruptArchive,
        yield* corruptSignature(corruptSigned.signature),
      );
      const corruptBaseUrl = yield* serverBaseUrl(corruptServer);
      const corruptResult = yield* Effect.result(
        executeFixtureUpdate(
          root,
          corruptBaseUrl,
          installedApp,
          "0.2.0",
          corruptSigned.publicKey,
        ),
      );
      if (
        Result.isSuccess(corruptResult) ||
        corruptResult.failure.reason !== "invalid-signature"
      ) {
        return yield* Effect.fail(
          fixtureError(
            "signature",
            "The corrupt fixture signature did not fail closed.",
          ),
        );
      }
      const bundleAfterRejection = yield* treeDigest(installedApp);
      if (bundleAfterRejection !== bundleBeforeRejection) {
        return yield* Effect.fail(
          fixtureError(
            "install",
            "The installed fixture changed after signature rejection.",
          ),
        );
      }
      yield* requireMatchingDigests(
        canariesBeforeRejection,
        yield* canaryDigests(canaries),
      );

      if (
        valid.installedVersion !== "0.2.0" ||
        valid.relaunchedVersion !== "0.2.0"
      ) {
        return yield* Effect.fail(
          fixtureError("relaunch", "The signed fixture was not relaunched."),
        );
      }
      const preserved: Array<
        "workspace" | "settings" | "grants" | "extensions"
      > = ["workspace", "settings", "grants", "extensions"];
      return NativeUpdateFixtureDogfoodReport.make({
        transport: "loopback",
        installedVersion: "0.2.0",
        relaunchedVersion: "0.2.0",
        preserved,
        corruptSignature: "rejected",
        bundleAfterRejection: "unchanged",
        stateAfterRejection: "unchanged",
      });
    }),
  );
});
