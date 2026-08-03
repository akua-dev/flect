import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Effect, Schema } from "effect";
import { encodeCapsule } from "../../../packages/product/src/capsule";
import {
  hashShareArtifactSource,
  ShareArtifactDescriptor,
  type ShareArtifactKind,
  ShareGitRepository,
  ShareManifest,
} from "../../../packages/product/src/share";
import {
  makeRepositoryTar,
  type RepositoryArchiveEntry,
} from "../../../src/git/repository-tar";
import { encodeShareArchive } from "../../../src/sharing/share-archive";
import { portableExtensionCapsule } from "../portable-extensions/capsules";

export class SharingFixtureFailure extends Schema.TaggedErrorClass<SharingFixtureFailure>()(
  "SharingFixtureFailure",
  { message: Schema.String },
) {}

export interface SharingFixture {
  readonly fileName: string;
  readonly commit: string;
  readonly descriptorCommit: string;
  readonly parentCommit?: string;
  readonly archive: Uint8Array;
}

export interface SharingFixtureSet {
  readonly initial: SharingFixture;
  readonly compatibleUpdate: SharingFixture;
  readonly conflictingUpdate: SharingFixture;
  readonly allArtifacts: SharingFixture;
  readonly malicious: SharingFixture;
  readonly privateAdapter: {
    readonly adapterId: string;
    readonly reference: string;
    readonly secretSentinel: string;
    readonly fixture: SharingFixture;
  };
  readonly publicGit: {
    readonly descriptorCommit: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>;
  };
}

interface FixtureFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

interface ArtifactSource {
  readonly id: string;
  readonly kind: ShareArtifactKind;
  readonly version: string;
  readonly sourceRoot: string;
  readonly files: ReadonlyArray<FixtureFile>;
  readonly capsule?: {
    readonly path: string;
    readonly contents: Uint8Array;
  };
}

const encoder = new TextEncoder();

const failure = () =>
  SharingFixtureFailure.make({
    message: "The deterministic sharing fixture could not be generated.",
  });

const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: failure });

const sha256 = Effect.fn("Flect.TestFixture.sha256")((value: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(value),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    catch: failure,
  }),
);

const git = Effect.fn("Flect.TestFixture.git")(function* (
  directory: string,
  args: ReadonlyArray<string>,
) {
  const [exitCode, stdout] = yield* io(
    () =>
      new Promise<readonly [number, string]>((resolve, reject) => {
        const child = spawn("git", [...args], {
          cwd: directory,
          env: {
            PATH: globalThis.process.env.PATH ?? "",
            GIT_AUTHOR_DATE: "2026-08-04T08:00:00Z",
            GIT_COMMITTER_DATE: "2026-08-04T08:00:00Z",
            LANG: "C",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const output: Array<Buffer> = [];
        child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
        child.once("error", reject);
        child.once("close", (code) =>
          resolve([code ?? 1, Buffer.concat(output).toString("utf8")]),
        );
      }),
  );
  if (exitCode !== 0) return yield* Effect.fail(failure());
  return stdout.trim();
});

const collectEntries = Effect.fn("Flect.TestFixture.collectEntries")(function* (
  root: string,
  target: string,
) {
  const entries: Array<RepositoryArchiveEntry> = [];
  const visit = Effect.fn("Flect.TestFixture.visit")(function* (
    absolute: string,
  ): Effect.fn.Return<void, SharingFixtureFailure> {
    const children = yield* io(() =>
      readdir(absolute, { withFileTypes: true }),
    );
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (path.length > 0) {
      entries.push({ path: `${path}/`, kind: "directory" });
    }
    for (const child of children.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const childPath = join(absolute, child.name);
      if (child.isDirectory()) {
        yield* visit(childPath);
      } else if (child.isFile()) {
        entries.push({
          path: relative(root, childPath).replaceAll("\\", "/"),
          kind: "file",
          contents: new Uint8Array(yield* io(() => readFile(childPath))),
        });
      } else {
        return yield* Effect.fail(failure());
      }
    }
  });
  yield* visit(join(root, target));
  return entries;
});

const collectRepository = Effect.fn("Flect.TestFixture.collectRepository")(
  function* (directory: string) {
    const topLevel = yield* io(() =>
      readdir(directory, { withFileTypes: true }),
    );
    const worktreeDirectories = topLevel
      .filter((entry) => entry.isDirectory() && entry.name !== ".git")
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
    const entries = yield* Effect.forEach(
      [".git/objects", ...worktreeDirectories],
      (target) => collectEntries(directory, target),
    );
    return makeRepositoryTar(entries.flat());
  },
);

const collectPublicGitRemote = Effect.fn(
  "Flect.TestFixture.collectPublicGitRemote",
)(function* (
  directory: string,
  refs: ReadonlyArray<{
    readonly name: string;
    readonly commit: string;
  }>,
) {
  for (const ref of refs) {
    yield* git(directory, ["branch", "-f", `fixture/${ref.name}`, ref.commit]);
  }
  const remote = join(directory, ".fixture-remote", "weather.git");
  yield* io(() => mkdir(dirname(remote), { recursive: true }));
  yield* git(directory, ["clone", "--bare", ".", remote]);
  yield* git(remote, ["config", "--remove-section", "remote.origin"]);
  yield* git(remote, ["update-server-info"]);
  const files: Array<{ readonly path: string; readonly contents: Uint8Array }> =
    [];
  const visit = Effect.fn("Flect.TestFixture.visitPublicGit")(function* (
    absolute: string,
  ): Effect.fn.Return<void, SharingFixtureFailure> {
    const entries = yield* io(() => readdir(absolute, { withFileTypes: true }));
    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(absolute, entry.name);
      const portablePath = relative(remote, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (portablePath !== "hooks") yield* visit(path);
      } else if (entry.isFile()) {
        files.push({
          path: portablePath,
          contents: new Uint8Array(yield* io(() => readFile(path))),
        });
      } else {
        return yield* Effect.fail(failure());
      }
    }
  });
  yield* visit(remote);
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
});

const writeFiles = Effect.fn("Flect.TestFixture.writeFiles")(function* (
  directory: string,
  files: ReadonlyArray<FixtureFile>,
) {
  for (const file of files) {
    yield* io(() =>
      mkdir(dirname(join(directory, file.path)), { recursive: true }),
    );
    yield* io(() => writeFile(join(directory, file.path), file.contents));
  }
});

const descriptorsFor = Effect.fn("Flect.TestFixture.descriptorsFor")(function* (
  sources: ReadonlyArray<ArtifactSource>,
) {
  return yield* Effect.forEach(sources, (source) =>
    Effect.gen(function* () {
      const contentSha256 = yield* hashShareArtifactSource(
        source.sourceRoot,
        source.files,
      ).pipe(Effect.mapError(failure));
      const capsule =
        source.capsule === undefined
          ? undefined
          : {
              path: source.capsule.path,
              sha256: yield* sha256(source.capsule.contents),
            };
      return ShareArtifactDescriptor.make({
        id: source.id,
        kind: source.kind,
        version: source.version,
        sourceRoot: source.sourceRoot,
        contentSha256,
        ...(capsule === undefined ? {} : { capsule }),
      });
    }),
  );
});

const makeManifest = Effect.fn("Flect.TestFixture.makeManifest")(
  function* (input: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly commit: string;
    readonly sources: ReadonlyArray<ArtifactSource>;
  }) {
    return ShareManifest.make({
      formatVersion: 1,
      id: input.id,
      name: input.name,
      version: input.version,
      repository: ShareGitRepository.make({
        _tag: "git",
        commit: input.commit,
      }),
      artifacts: yield* descriptorsFor(input.sources),
      compatibility: {
        flect: ">=0.2.0 <1.0.0",
        platforms: ["browser", "macos"],
      },
      provenance: {
        publisher: "akua-dev",
        source: "https://github.com/akua-dev/flect",
        revision: input.commit,
        builder: "@flect/product",
      },
      signatures: [],
      migrations: [],
    });
  },
);

const commitPayload = Effect.fn("Flect.TestFixture.commitPayload")(function* (
  directory: string,
  message: string,
  files: ReadonlyArray<FixtureFile>,
) {
  yield* writeFiles(directory, files);
  yield* git(directory, ["add", ...files.map((file) => file.path)]);
  yield* git(directory, ["commit", "-m", message]);
  return yield* git(directory, ["rev-parse", "HEAD"]);
});

const packageFixture = Effect.fn("Flect.TestFixture.package")(function* (
  directory: string,
  input: {
    readonly fileName: string;
    readonly manifest: ShareManifest;
    readonly parentCommit?: string;
    readonly sources: ReadonlyArray<ArtifactSource>;
  },
) {
  const descriptorPath = ".flect/share.json";
  yield* writeFiles(directory, [
    {
      path: descriptorPath,
      contents: encoder.encode(JSON.stringify(input.manifest)),
    },
  ]);
  yield* git(directory, ["add", descriptorPath]);
  yield* git(directory, ["commit", "-m", `Describe ${input.manifest.id}`]);
  const descriptorCommit = yield* git(directory, ["rev-parse", "HEAD"]);
  const repository = yield* collectRepository(directory);
  const artifacts = input.sources.flatMap((source) =>
    source.capsule === undefined
      ? []
      : [
          {
            path: source.capsule.path,
            contents: source.capsule.contents,
          },
        ],
  );
  const archive = yield* encodeShareArchive({
    manifest: input.manifest,
    repository,
    artifacts,
  }).pipe(Effect.mapError(failure));
  return {
    fileName: input.fileName,
    commit: input.manifest.repository.commit,
    descriptorCommit,
    ...(input.parentCommit === undefined
      ? {}
      : { parentCommit: input.parentCommit }),
    archive,
  } satisfies SharingFixture;
});

const weatherSource = (
  version: string,
  source: string,
): ReadonlyArray<ArtifactSource> => {
  const path = "components/weather/index.ts";
  return [
    {
      id: "dev.flect.weather.component",
      kind: "component",
      version,
      sourceRoot: "components/weather",
      files: [{ path, contents: encoder.encode(source) }],
    },
  ];
};

const makeAllArtifactSources = Effect.fn(
  "Flect.TestFixture.makeAllArtifactSources",
)(function* () {
  const experienceCapsule = yield* encodeCapsule({
    manifest: {
      formatVersion: 1,
      id: "dev.flect.weather-experience",
      name: "Weather experience",
      version: "1.0.0",
      entrypoints: [{ id: "main", path: "ui/index.html" }],
      capabilities: [],
      compatibility: {
        flect: ">=0.2.0 <1.0.0",
        schemaVersion: 1,
        platforms: ["browser", "macos"],
      },
      provenance: {
        publisher: "akua-dev",
        source: "https://github.com/akua-dev/flect",
        revision: "fixture-experience-v1",
        builder: "flect-test",
      },
      signatures: [],
    },
    files: [
      {
        path: "ui/index.html",
        contents: encoder.encode(
          '<!doctype html><html lang="en"><title>Weather</title><main><h1>Weather</h1><p>Clear, 21 degrees.</p></main></html>',
        ),
      },
    ],
  }).pipe(Effect.mapError(failure));
  const extensionCapsule = yield* Effect.tryPromise({
    try: () =>
      portableExtensionCapsule({
        capsuleVersion: "1.0.0",
        extensionVersion: "1.0.0",
        extensionId: "forecast-guide",
        requiredCapabilities: [],
        optionalCapabilities: [],
      }),
    catch: failure,
  });
  const sources: ReadonlyArray<ArtifactSource> = [
    {
      id: "dev.flect.showcase.experience",
      kind: "experience",
      version: "1.0.0",
      sourceRoot: "experiences/weather",
      files: [
        {
          path: "experiences/weather/README.md",
          contents: encoder.encode("# Weather experience\n"),
        },
      ],
      capsule: {
        path: "artifacts/weather-experience.flect",
        contents: experienceCapsule,
      },
    },
    {
      id: "dev.flect.showcase.component",
      kind: "component",
      version: "1.0.0",
      sourceRoot: "components/weather",
      files: [
        {
          path: "components/weather/index.ts",
          contents: encoder.encode(
            'export const weather = { label: "Clear", temperature: 21 };\n',
          ),
        },
      ],
    },
    {
      id: "dev.flect.showcase.theme",
      kind: "theme",
      version: "1.0.0",
      sourceRoot: "themes/mist",
      files: [
        {
          path: "themes/mist/theme.json",
          contents: encoder.encode(
            '{"accent":"#46666f","surface":"#f5f7f7"}\n',
          ),
        },
      ],
    },
    {
      id: "dev.flect.showcase.workflow",
      kind: "workflow",
      version: "1.0.0",
      sourceRoot: "workflows/forecast",
      files: [
        {
          path: "workflows/forecast/workflow.json",
          contents: encoder.encode(
            '{"steps":[{"id":"refresh","action":"weather.refresh"}]}\n',
          ),
        },
      ],
    },
    {
      id: "dev.flect.showcase.extension",
      kind: "extension",
      version: "1.0.0",
      sourceRoot: "extensions/forecast-guide",
      files: [
        {
          path: "extensions/forecast-guide/README.md",
          contents: encoder.encode("# Forecast guide\n"),
        },
      ],
      capsule: {
        path: "artifacts/forecast-extension.flect",
        contents: extensionCapsule,
      },
    },
  ];
  return sources;
});

export const makeSharingFixtureSet = Effect.fn(
  "Flect.TestFixture.makeSharingFixtureSet",
)(function* () {
  return yield* Effect.acquireUseRelease(
    io(() => mkdtemp(join(tmpdir(), "flect-sharing-fixture-"))),
    (directory) =>
      Effect.gen(function* () {
        yield* git(directory, ["init", "--initial-branch=main"]);
        yield* git(directory, ["config", "user.name", "Flect Fixture"]);
        yield* git(directory, ["config", "user.email", "fixture@flect.dev"]);
        yield* git(directory, ["config", "commit.gpgsign", "false"]);

        const initialSources = weatherSource(
          "1.0.0",
          'export const weather = { label: "Clear", temperature: 21 };\n',
        );
        const initialCommit = yield* commitPayload(
          directory,
          "Add weather component",
          initialSources.flatMap((source) => source.files),
        );
        const initialManifest = yield* makeManifest({
          id: "dev.flect.weather",
          name: "Weather workspace",
          version: "1.0.0",
          commit: initialCommit,
          sources: initialSources,
        });
        const initial = yield* packageFixture(directory, {
          fileName: "weather-workspace.flect-share",
          manifest: initialManifest,
          sources: initialSources,
        });

        yield* git(directory, ["checkout", "--detach", initialCommit]);
        const compatibleSources = weatherSource(
          "1.1.0",
          'export const weather = { label: "Clear", temperature: 22, refreshed: true };\n',
        );
        const compatibleCommit = yield* commitPayload(
          directory,
          "Refresh weather component",
          compatibleSources.flatMap((source) => source.files),
        );
        const compatibleManifest = yield* makeManifest({
          id: "dev.flect.weather",
          name: "Weather workspace",
          version: "1.1.0",
          commit: compatibleCommit,
          sources: compatibleSources,
        });
        const compatibleUpdate = yield* packageFixture(directory, {
          fileName: "weather-workspace-1.1.0.flect-share",
          manifest: compatibleManifest,
          parentCommit: initialCommit,
          sources: compatibleSources,
        });

        yield* git(directory, ["checkout", "--detach", initialCommit]);
        const conflictingSources = weatherSource(
          "2.0.0-conflict",
          'export const weather = { label: "Storm", temperature: 16, warning: true };\n',
        );
        const conflictingCommit = yield* commitPayload(
          directory,
          "Change weather component on a divergent branch",
          conflictingSources.flatMap((source) => source.files),
        );
        const conflictingManifest = yield* makeManifest({
          id: "dev.flect.weather",
          name: "Weather workspace",
          version: "2.0.0-conflict",
          commit: conflictingCommit,
          sources: conflictingSources,
        });
        const conflictingUpdate = yield* packageFixture(directory, {
          fileName: "weather-workspace-conflict.flect-share",
          manifest: conflictingManifest,
          parentCommit: initialCommit,
          sources: conflictingSources,
        });

        yield* git(directory, ["checkout", "--detach", initialCommit]);
        const allSources = yield* makeAllArtifactSources();
        const allFiles = allSources.flatMap((source) => [
          ...source.files,
          ...(source.capsule === undefined
            ? []
            : [
                {
                  path: source.capsule.path,
                  contents: source.capsule.contents,
                },
              ]),
        ]);
        const allArtifactsCommit = yield* commitPayload(
          directory,
          "Add every portable artifact kind",
          allFiles,
        );
        const allArtifactsManifest = yield* makeManifest({
          id: "dev.flect.showcase",
          name: "Portable artifact showcase",
          version: "1.0.0",
          commit: allArtifactsCommit,
          sources: allSources,
        });
        const allArtifacts = yield* packageFixture(directory, {
          fileName: "portable-artifact-showcase.flect-share",
          manifest: allArtifactsManifest,
          parentCommit: initialCommit,
          sources: allSources,
        });

        const maliciousArchive = new Uint8Array(initial.archive.byteLength + 1);
        maliciousArchive.set(initial.archive);
        maliciousArchive[maliciousArchive.byteLength - 1] = 1;
        const malicious: SharingFixture = {
          ...initial,
          fileName: "weather-workspace-malicious.flect-share",
          archive: maliciousArchive,
        };
        const publicGitFiles = yield* collectPublicGitRemote(directory, [
          { name: "initial", commit: initial.descriptorCommit },
          {
            name: "compatible",
            commit: compatibleUpdate.descriptorCommit,
          },
          {
            name: "conflicting",
            commit: conflictingUpdate.descriptorCommit,
          },
          { name: "showcase", commit: allArtifacts.descriptorCommit },
        ]);

        return {
          initial,
          compatibleUpdate,
          conflictingUpdate,
          allArtifacts,
          malicious,
          privateAdapter: {
            adapterId: "fixture-vault",
            reference: "weather/team-alpha",
            secretSentinel: "FLECT_PRIVATE_FIXTURE_SECRET_DO_NOT_EXPOSE",
            fixture: initial,
          },
          publicGit: {
            descriptorCommit: initial.descriptorCommit,
            files: publicGitFiles,
          },
        } satisfies SharingFixtureSet;
      }),
    (directory) => io(() => rm(directory, { force: true, recursive: true })),
  );
});

export const makeInitialSharingFixture = Effect.fn(
  "Flect.TestFixture.makeInitialSharingFixture",
)(function* () {
  return (yield* makeSharingFixtureSet()).initial;
});
