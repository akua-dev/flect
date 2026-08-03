import { Cause, Context, Effect, Layer, Schema, type Scope } from "effect";
import { decodeCapsule } from "../../packages/product/src/capsule";
import {
  hashShareArtifactSource,
  ShareEmbeddedRepository,
  type ShareManifest,
  validateShareManifest,
} from "../../packages/product/src/share";
import type { GitRefFile } from "../../shared/git-workspace";
import { type GitWorkspaceShape, makeGitWorkspace } from "../git/git-workspace";
import { decodeRepositoryTar } from "../git/repository-tar";
import { decodeShareArchive } from "./share-archive";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class ShareQuarantineFailure extends Schema.TaggedErrorClass<ShareQuarantineFailure>()(
  "ShareQuarantineFailure",
  {
    reason: Schema.Literals([
      "archive",
      "repository",
      "manifest",
      "integrity",
      "unavailable",
    ]),
    message: Schema.String,
  },
) {}

const failure = (reason: ShareQuarantineFailure["reason"]) =>
  ShareQuarantineFailure.make({
    reason,
    message: "The shared candidate could not be inspected safely.",
  });

export interface ShareCandidateMaterial {
  readonly manifest: ShareManifest;
  readonly repository: Uint8Array;
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>;
  readonly files: ReadonlyArray<GitRefFile>;
  readonly archiveSha256: string;
}

export interface ShareQuarantineShape {
  readonly inspect: (
    sourceBytes: Uint8Array,
  ) => Effect.Effect<ShareCandidateMaterial, ShareQuarantineFailure>;
  readonly inspectGit: (
    url: string,
    commit: string,
  ) => Effect.Effect<ShareCandidateMaterial, ShareQuarantineFailure>;
}

export class ShareQuarantine extends Context.Service<
  ShareQuarantine,
  ShareQuarantineShape
>()("flect/ShareQuarantine") {}

const sha256 = Effect.fn("Flect.ShareQuarantine.sha256")(
  (contents: Uint8Array) =>
    Effect.tryPromise({
      try: async () => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          Uint8Array.from(contents),
        );
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      },
      catch: () => failure("unavailable"),
    }),
);

const parseGitManifest = Effect.fn("Flect.ShareQuarantine.parseManifest")(
  function* (contents: Uint8Array) {
    const input = yield* Effect.try({
      try: (): unknown => JSON.parse(decoder.decode(contents)),
      catch: () => failure("manifest"),
    });
    const manifest = yield* validateShareManifest(input).pipe(
      Effect.mapError(() => failure("manifest")),
    );
    if (manifest.repository._tag !== "git") {
      return yield* Effect.fail(failure("manifest"));
    }
    return manifest;
  },
);

const runWorkspace = <A, E>(
  effect: Effect.Effect<A, E>,
  reason: ShareQuarantineFailure["reason"],
) =>
  effect.pipe(
    Effect.mapError(() => failure(reason)),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.fail(failure(reason)),
    ),
  );

const verifyArtifacts = Effect.fn("Flect.ShareQuarantine.verifyArtifacts")(
  function* (
    manifest: ShareManifest,
    files: ReadonlyArray<GitRefFile>,
    artifacts: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>,
  ) {
    const filesByPath = new Map(
      files.map((file) => [file.path, file.contents]),
    );
    const artifactsByPath = new Map(
      artifacts.map((artifact) => [artifact.path, artifact.contents]),
    );
    for (const descriptor of manifest.artifacts) {
      const sourceFiles = files.filter((file) =>
        file.path.startsWith(`${descriptor.sourceRoot}/`),
      );
      const sourceDigest = yield* hashShareArtifactSource(
        descriptor.sourceRoot,
        sourceFiles,
      ).pipe(Effect.mapError(() => failure("integrity")));
      if (sourceDigest !== descriptor.contentSha256) {
        return yield* Effect.fail(failure("integrity"));
      }
      if (descriptor.capsule === undefined) {
        continue;
      }
      const repositoryContents = filesByPath.get(descriptor.capsule.path);
      const artifactContents = artifactsByPath.get(descriptor.capsule.path);
      const contents = artifactContents ?? repositoryContents;
      if (
        contents === undefined ||
        repositoryContents === undefined ||
        (yield* sha256(contents)) !== descriptor.capsule.sha256 ||
        (yield* sha256(repositoryContents)) !== descriptor.capsule.sha256
      ) {
        return yield* Effect.fail(failure("integrity"));
      }
      yield* decodeCapsule(contents).pipe(
        Effect.mapError(() => failure("integrity")),
      );
    }
  },
);

const embeddedManifest = Effect.fn("Flect.ShareQuarantine.embedManifest")(
  function* (manifest: ShareManifest, repository: Uint8Array) {
    if (manifest.repository._tag !== "git") {
      return yield* Effect.fail(failure("manifest"));
    }
    return yield* validateShareManifest({
      ...manifest,
      repository: ShareEmbeddedRepository.make({
        _tag: "embedded",
        archivePath: "repository.tar",
        sha256: yield* sha256(repository),
        commit: manifest.repository.commit,
      }),
    }).pipe(Effect.mapError(() => failure("manifest")));
  },
);

export const makeShareQuarantineLayer = (options?: {
  readonly createWorkspace?: Effect.Effect<
    GitWorkspaceShape,
    never,
    Scope.Scope
  >;
  readonly workspaceId?: () => string;
}) => {
  const withWorkspace = <A>(
    use: (
      workspace: GitWorkspaceShape,
    ) => Effect.Effect<A, ShareQuarantineFailure>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* options?.createWorkspace ?? makeGitWorkspace();
        const workspaceId =
          options?.workspaceId?.() ??
          `share-${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`;
        yield* Effect.acquireRelease(
          runWorkspace(
            workspace.open({ workspaceId, reset: true }),
            "unavailable",
          ),
          () =>
            workspace.remove.pipe(
              Effect.catchCause(() => Effect.void),
              Effect.asVoid,
            ),
        );
        return yield* use(workspace);
      }),
    );

  const inspect = Effect.fn("Flect.ShareQuarantine.inspect")(
    (sourceBytes: Uint8Array) =>
      withWorkspace((workspace) =>
        Effect.gen(function* () {
          const decoded = yield* decodeShareArchive(sourceBytes).pipe(
            Effect.mapError(() => failure("archive")),
          );
          yield* decodeRepositoryTar(decoded.repository).pipe(
            Effect.mapError(() => failure("repository")),
          );
          yield* runWorkspace(
            workspace.importRepository({
              archive: decoded.repository,
              commit: decoded.manifest.repository.commit,
            }),
            "repository",
          );
          const inspected = yield* runWorkspace(
            workspace.inspectShare({
              commit: decoded.manifest.repository.commit,
              manifestRequired: false,
            }),
            "repository",
          );
          if (inspected.commit !== decoded.manifest.repository.commit) {
            return yield* Effect.fail(failure("integrity"));
          }
          yield* verifyArtifacts(
            decoded.manifest,
            inspected.files,
            decoded.artifacts,
          );
          return {
            manifest: decoded.manifest,
            repository: decoded.repository,
            artifacts: decoded.artifacts,
            files: inspected.files,
            archiveSha256: yield* sha256(sourceBytes),
          } satisfies ShareCandidateMaterial;
        }),
      ),
  );

  const inspectGit = Effect.fn("Flect.ShareQuarantine.inspectGit")(
    (url: string, commit: string) =>
      withWorkspace((workspace) =>
        Effect.gen(function* () {
          const descriptor = yield* runWorkspace(
            workspace.inspectShare({
              url,
              commit,
              manifestRequired: true,
            }),
            "repository",
          );
          if (descriptor.manifest === undefined) {
            return yield* Effect.fail(failure("manifest"));
          }
          if (descriptor.commit !== commit) {
            return yield* Effect.fail(failure("integrity"));
          }
          const manifest = yield* parseGitManifest(descriptor.manifest);
          const inspected = yield* runWorkspace(
            workspace.inspectShare({
              commit: manifest.repository.commit,
              manifestRequired: false,
            }),
            "repository",
          );
          if (inspected.commit !== manifest.repository.commit) {
            return yield* Effect.fail(failure("integrity"));
          }
          yield* decodeRepositoryTar(inspected.repository).pipe(
            Effect.mapError(() => failure("repository")),
          );
          const artifactPaths = new Set(
            manifest.artifacts.flatMap((artifact) =>
              artifact.capsule === undefined ? [] : [artifact.capsule.path],
            ),
          );
          const artifacts = inspected.files
            .filter((file) => artifactPaths.has(file.path))
            .map((file) => ({ path: file.path, contents: file.contents }));
          yield* verifyArtifacts(manifest, inspected.files, artifacts);
          return {
            manifest: yield* embeddedManifest(manifest, inspected.repository),
            repository: inspected.repository,
            artifacts,
            files: inspected.files,
            archiveSha256: yield* sha256(inspected.repository),
          } satisfies ShareCandidateMaterial;
        }),
      ),
  );

  return Layer.succeed(ShareQuarantine)({ inspect, inspectGit });
};

export const ShareQuarantineLive = makeShareQuarantineLayer();
