import { Context, Effect, Layer, Schema } from "effect";
import semver from "semver";
import {
  BrowserPackageFailure,
  BrowserPackageFile,
  type BrowserPackageRequest,
  BrowserPackageResolution,
} from "../../shared/browser-package";
import { BunPackageMutation } from "../execution/bun-package-mutation";
import { digestBuildBytes, digestBuildEntries } from "./browser-build-digest";
import { BrowserPackageCache } from "./browser-package-cache";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 2_048;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface BrowserPackageResolverShape {
  readonly resolve: (
    request: BrowserPackageRequest,
  ) => Effect.Effect<BrowserPackageResolution, BrowserPackageFailure>;
}

export class BrowserPackageResolver extends Context.Service<
  BrowserPackageResolver,
  BrowserPackageResolverShape
>()("flect/BrowserPackageResolver") {}

const failure = (
  inputDigest: string,
  reason: BrowserPackageFailure["reason"],
  message: string,
) => BrowserPackageFailure.make({ inputDigest, reason, message });

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateLockfile = (
  lockfile: Uint8Array,
  registryOrigin: string,
  inputDigest: string,
) => {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(lockfile));
  } catch {
    throw failure(
      inputDigest,
      "invalid-lock",
      "The resolved browser package lock is invalid.",
    );
  }
  if (
    !record(value) ||
    value.lockfileVersion !== 3 ||
    !record(value.packages)
  ) {
    throw failure(
      inputDigest,
      "invalid-lock",
      "The resolved browser package lock is invalid.",
    );
  }
  let packageCount = 0;
  for (const [path, entry] of Object.entries(value.packages)) {
    if (path === "") {
      continue;
    }
    if (
      !path.startsWith("node_modules/") ||
      !record(entry) ||
      typeof entry.version !== "string" ||
      semver.valid(entry.version) === null ||
      typeof entry.resolved !== "string" ||
      typeof entry.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
    ) {
      throw failure(
        inputDigest,
        "invalid-lock",
        "The resolved browser package lock contains an unsupported entry.",
      );
    }
    let resolved: URL;
    try {
      resolved = new URL(entry.resolved);
    } catch {
      throw failure(
        inputDigest,
        "invalid-lock",
        "The resolved browser package lock contains an invalid source.",
      );
    }
    if (resolved.origin !== registryOrigin || resolved.protocol !== "https:") {
      throw failure(
        inputDigest,
        "invalid-lock",
        "The resolved browser package lock names an unapproved source.",
      );
    }
    packageCount += 1;
  }
  return packageCount;
};

export const makeBrowserPackageResolverLayer = (options?: {
  readonly registryOrigin?: string;
}) =>
  Layer.effect(
    BrowserPackageResolver,
    Effect.gen(function* () {
      const packages = yield* BunPackageMutation;
      const cache = yield* BrowserPackageCache;
      const registryOrigin =
        options?.registryOrigin ?? "https://registry.npmjs.org";

      return {
        resolve: Effect.fn("Flect.BrowserPackageResolver.resolve")(
          (request: BrowserPackageRequest) =>
            Effect.gen(function* () {
              const inputEntries = [
                { path: "package.json", contents: request.packageJson },
                ...(request.packageLock === undefined
                  ? []
                  : [
                      {
                        path: "package-lock.json",
                        contents: request.packageLock,
                      },
                    ]),
              ];
              const inputDigest = yield* Effect.promise(() =>
                digestBuildEntries(inputEntries),
              );
              if (
                request.packageJson.byteLength === 0 ||
                request.packageJson.byteLength > MAX_MANIFEST_BYTES ||
                (request.packageLock?.byteLength ?? 0) > MAX_LOCK_BYTES
              ) {
                return yield* Effect.fail(
                  failure(
                    inputDigest,
                    "invalid-input",
                    "The browser package request exceeds its manifest or lock limits.",
                  ),
                );
              }
              const cached = yield* cache
                .load(inputDigest)
                .pipe(
                  Effect.mapError(() =>
                    failure(
                      inputDigest,
                      "storage",
                      "The browser package cache could not be read safely.",
                    ),
                  ),
                );
              if (cached !== undefined) {
                return cached;
              }

              const output = yield* packages
                .install({
                  cwd: "/workspace",
                  workspace: {
                    files: {
                      "/workspace/package.json": request.packageJson,
                      ...(request.packageLock === undefined
                        ? {}
                        : {
                            "/workspace/package-lock.json": request.packageLock,
                          }),
                    },
                  },
                })
                .pipe(
                  Effect.mapError(() =>
                    failure(
                      inputDigest,
                      "resolution",
                      "Browser package resolution failed safely.",
                    ),
                  ),
                );

              let lockfile = request.packageLock;
              const files: Array<BrowserPackageFile> = [];
              let totalBytes = 0;
              for (const change of output.delta.files) {
                if (change.operation !== "write") {
                  return yield* Effect.fail(
                    failure(
                      inputDigest,
                      "resolution",
                      "Browser package resolution returned an unsupported removal.",
                    ),
                  );
                }
                if (change.path === "/workspace/package-lock.json") {
                  lockfile = change.content;
                  continue;
                }
                if (!change.path.startsWith("/workspace/node_modules/")) {
                  continue;
                }
                const path = change.path.slice("/workspace/".length);
                totalBytes += change.content.byteLength;
                files.push(
                  BrowserPackageFile.make({ path, contents: change.content }),
                );
              }
              if (
                lockfile === undefined ||
                lockfile.byteLength > MAX_LOCK_BYTES ||
                files.length > MAX_FILES ||
                totalBytes + lockfile.byteLength > MAX_GRAPH_BYTES
              ) {
                return yield* Effect.fail(
                  failure(
                    inputDigest,
                    "oversized",
                    "The resolved browser package graph exceeds its limits.",
                  ),
                );
              }
              const lockedPackageCount = yield* Effect.try({
                try: () =>
                  validateLockfile(lockfile, registryOrigin, inputDigest),
                catch: (error) =>
                  Schema.is(BrowserPackageFailure)(error)
                    ? error
                    : failure(
                        inputDigest,
                        "invalid-lock",
                        "The resolved browser package lock is invalid.",
                      ),
              });
              if (lockedPackageCount !== output.packageCount) {
                return yield* Effect.fail(
                  failure(
                    inputDigest,
                    "invalid-lock",
                    "The resolved browser package count does not match its lock.",
                  ),
                );
              }
              const sortedFiles = files.toSorted((left, right) =>
                left.path.localeCompare(right.path),
              );
              const lockDigest = yield* Effect.promise(() =>
                digestBuildBytes(lockfile),
              );
              const graphDigest = yield* Effect.promise(() =>
                digestBuildEntries([
                  { path: "package-lock.json", contents: lockfile },
                  ...sortedFiles,
                ]),
              );
              const resolution = BrowserPackageResolution.make({
                version: 1,
                inputDigest,
                lockDigest,
                graphDigest,
                packageCount: output.packageCount,
                lockfile,
                files: sortedFiles,
                cacheHit: false,
              });
              yield* cache
                .save(resolution)
                .pipe(
                  Effect.mapError(() =>
                    failure(
                      inputDigest,
                      "storage",
                      "The resolved browser package graph could not be cached safely.",
                    ),
                  ),
                );
              return resolution;
            }),
        ),
      } satisfies BrowserPackageResolverShape;
    }),
  );

export const BrowserPackageResolverLive = makeBrowserPackageResolverLayer();
