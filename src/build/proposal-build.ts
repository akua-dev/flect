import { Context, Effect, Layer } from "effect";
import {
  type BrowserBuildArtifact,
  BrowserBuildRequest,
  ProposalBuildFailure,
  type ProposalBuildRequest,
} from "../../shared/browser-build";
import { BrowserPackageRequest } from "../../shared/browser-package";
import { GitWorkspace } from "../git/git-workspace";
import { BrowserBuild } from "./browser-build";
import { BrowserPackageResolver } from "./browser-package-resolver";
import { portablePackageManifest } from "./portable-package-manifest";

const PROJECT_ROOT = "project/";

export interface ProposalBuildShape {
  readonly resolvePackageLock: (request: ProposalBuildRequest) => Effect.Effect<
    | {
        readonly contents: Uint8Array;
        readonly needsCheckpoint: boolean;
      }
    | undefined,
    ProposalBuildFailure
  >;
  readonly compile: (
    request: ProposalBuildRequest,
  ) => Effect.Effect<BrowserBuildArtifact, ProposalBuildFailure>;
}

export class ProposalBuild extends Context.Service<
  ProposalBuild,
  ProposalBuildShape
>()("flect/ProposalBuild") {}

const failure = (reason: ProposalBuildFailure["reason"], message: string) =>
  ProposalBuildFailure.make({ reason, message });

const canonicalProjectPath = (path: string) => {
  const parts = path.split("/");
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    parts[0] !== ".git" &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
};

export const ProposalBuildLive = Layer.effect(
  ProposalBuild,
  Effect.gen(function* () {
    const git = yield* GitWorkspace;
    const compiler = yield* BrowserBuild;
    const packages = yield* BrowserPackageResolver;

    const sourceAt = Effect.fn("Flect.ProposalBuild.sourceAt")(
      (request: ProposalBuildRequest) =>
        git
          .snapshotRef({
            branch: request.proposalBranch,
            expectedCommit: request.proposalCommit,
            guards: [
              {
                branch: "flect/accepted",
                commit: request.acceptedCommit,
              },
              {
                branch: "flect/last-known-good",
                commit: request.lastKnownGoodCommit,
              },
            ],
          })
          .pipe(
            Effect.map((snapshot) =>
              snapshot.files
                .filter((file) => file.path.startsWith(PROJECT_ROOT))
                .map((file) => ({
                  path: file.path.slice(PROJECT_ROOT.length),
                  contents: file.contents,
                }))
                .filter((file) => canonicalProjectPath(file.path))
                .toSorted((left, right) => left.path.localeCompare(right.path)),
            ),
            Effect.mapError(() =>
              failure(
                "snapshot",
                "The exact guarded proposal could not be read for its acceptance build.",
              ),
            ),
          ),
    );

    const dependenciesFor = Effect.fn("Flect.ProposalBuild.dependenciesFor")(
      (sourceFiles: ReadonlyArray<{ path: string; contents: Uint8Array }>) =>
        Effect.gen(function* () {
          const packageJson = sourceFiles.find(
            (file) => file.path === "package.json",
          );
          if (packageJson === undefined) return undefined;
          const portableManifest = yield* portablePackageManifest(
            packageJson.contents,
          ).pipe(
            Effect.mapError(() =>
              failure(
                "package",
                "The proposal package manifest is not portable.",
              ),
            ),
          );
          const packageLock = sourceFiles.find(
            (file) => file.path === "package-lock.json",
          );
          return yield* packages
            .resolve(
              BrowserPackageRequest.make({
                version: 1,
                packageJson: portableManifest,
                ...(packageLock === undefined
                  ? {}
                  : { packageLock: packageLock.contents }),
              }),
            )
            .pipe(
              Effect.mapError(() =>
                failure(
                  "package",
                  "The proposal's browser dependencies could not be resolved safely.",
                ),
              ),
            );
        }),
    );

    const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
      left.byteLength === right.byteLength &&
      left.every((value, index) => value === right[index]);

    return {
      resolvePackageLock: Effect.fn("Flect.ProposalBuild.resolvePackageLock")(
        (request: ProposalBuildRequest) =>
          Effect.gen(function* () {
            const sourceFiles = yield* sourceAt(request);
            const dependencies = yield* dependenciesFor(sourceFiles);
            if (dependencies === undefined) return undefined;
            const existing = sourceFiles.find(
              (file) => file.path === "package-lock.json",
            );
            return {
              contents: dependencies.lockfile,
              needsCheckpoint:
                existing === undefined ||
                !bytesEqual(existing.contents, dependencies.lockfile),
            };
          }),
      ),
      compile: Effect.fn("Flect.ProposalBuild.compile")(
        (request: ProposalBuildRequest) =>
          Effect.gen(function* () {
            const sourceFiles = yield* sourceAt(request);
            if (
              !canonicalProjectPath(request.entrypoint) ||
              !sourceFiles.some((file) => file.path === request.entrypoint)
            ) {
              return yield* Effect.fail(
                failure(
                  "source",
                  "The proposal does not contain its declared project entrypoint.",
                ),
              );
            }
            const dependencies = yield* dependenciesFor(sourceFiles);
            const files =
              dependencies === undefined
                ? sourceFiles
                : [
                    ...sourceFiles.filter(
                      (file) =>
                        file.path !== "package-lock.json" &&
                        !file.path.startsWith("node_modules/"),
                    ),
                    {
                      path: "package-lock.json",
                      contents: dependencies.lockfile,
                    },
                    ...dependencies.files,
                  ].toSorted((left, right) =>
                    left.path.localeCompare(right.path),
                  );
            return yield* compiler
              .compile(
                BrowserBuildRequest.make({
                  version: 1,
                  buildId: `build-${request.proposalCommit.slice(0, 16)}`,
                  sourceRevision: request.proposalCommit,
                  ...(dependencies === undefined
                    ? {}
                    : { dependencyGraphDigest: dependencies.graphDigest }),
                  entrypoint: request.entrypoint,
                  files,
                }),
              )
              .pipe(
                Effect.mapError((error) => failure("build", error.message)),
              );
          }),
      ),
    } satisfies ProposalBuildShape;
  }),
);
