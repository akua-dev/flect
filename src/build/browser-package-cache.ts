import type { Vfs } from "@riftydev/vfs";
import { Context, Effect, Layer, Schema, type SchemaAST } from "effect";
import {
  BrowserPackageFile,
  BrowserPackageResolution,
} from "../../shared/browser-package";
import { browserPersistentStorage } from "../lib/browser-persistent-vfs";
import { digestBuildBytes, digestBuildEntries } from "./browser-build-digest";

const MAX_FILES = 2_048;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_BINDINGS = 128;
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const PackagePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
);
const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

class CachedPackageFile extends Schema.Class<CachedPackageFile>(
  "CachedPackageFile",
)({
  path: PackagePath,
  bytes: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_FILE_BYTES }),
  ),
  digest: Digest,
}) {}

class CachedPackageGraph extends Schema.Class<CachedPackageGraph>(
  "CachedPackageGraph",
)({
  version: Schema.Literal(1),
  inputDigest: Digest,
  lockDigest: Digest,
  graphDigest: Digest,
  packageCount: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 2_048 }),
  ),
  lockBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_FILE_BYTES }),
  ),
  files: Schema.Array(CachedPackageFile).check(Schema.isMaxLength(MAX_FILES)),
}) {}

class PackageCacheBindings extends Schema.Class<PackageCacheBindings>(
  "PackageCacheBindings",
)({
  version: Schema.Literal(1),
  entries: Schema.Record(Digest, Digest).check(
    Schema.isMaxProperties(MAX_BINDINGS),
  ),
}) {}

export class BrowserPackageCacheError extends Schema.TaggedErrorClass<BrowserPackageCacheError>()(
  "BrowserPackageCacheError",
  { message: Schema.Literal("Browser package cache is unavailable.") },
) {}

export interface BrowserPackageCacheShape {
  readonly load: (
    inputDigest: string,
  ) => Effect.Effect<
    BrowserPackageResolution | undefined,
    BrowserPackageCacheError
  >;
  readonly save: (
    resolution: BrowserPackageResolution,
  ) => Effect.Effect<void, BrowserPackageCacheError>;
}

export class BrowserPackageCache extends Context.Service<
  BrowserPackageCache,
  BrowserPackageCacheShape
>()("flect/BrowserPackageCache") {}

const failure = () =>
  BrowserPackageCacheError.make({
    message: "Browser package cache is unavailable.",
  });

const validPackagePath = (path: string) => {
  const parts = path.split("/");
  return (
    path.startsWith("node_modules/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
};

const validRoot = (root: string) => {
  if (!/^\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(root)) {
    throw failure();
  }
  return root;
};

const decodeBindings = Schema.decodeUnknownPromise(
  PackageCacheBindings,
  strictOptions,
);
const decodeGraph = Schema.decodeUnknownPromise(
  CachedPackageGraph,
  strictOptions,
);

const makeCache = (
  vfs: Vfs,
  requestedRoot: string,
): BrowserPackageCacheShape => {
  const root = validRoot(requestedRoot);
  const objects = `${root}/objects`;
  const bindingsPath = `${root}/bindings.json`;

  const readBindings = async () => {
    if (!(await vfs.exists(bindingsPath))) {
      return PackageCacheBindings.make({ version: 1, entries: {} });
    }
    return decodeBindings(JSON.parse(await vfs.readFileText(bindingsPath)));
  };

  const load = (inputDigest: string) =>
    Effect.tryPromise({
      try: async () => {
        if (!/^[0-9a-f]{64}$/.test(inputDigest)) {
          throw failure();
        }
        const bindings = await readBindings();
        const graphDigest = bindings.entries[inputDigest];
        if (graphDigest === undefined) {
          return undefined;
        }
        const objectRoot = `${objects}/${graphDigest}`;
        const manifest = await decodeGraph(
          JSON.parse(await vfs.readFileText(`${objectRoot}/manifest.json`)),
        );
        if (
          manifest.inputDigest !== inputDigest ||
          manifest.graphDigest !== graphDigest
        ) {
          throw failure();
        }
        const lockfile = await vfs.readFile(`${objectRoot}/package-lock.json`);
        if (
          lockfile.byteLength !== manifest.lockBytes ||
          (await digestBuildBytes(lockfile)) !== manifest.lockDigest
        ) {
          throw failure();
        }
        const paths = new Set<string>();
        let totalBytes = lockfile.byteLength;
        const files: Array<BrowserPackageFile> = [];
        for (const [index, file] of manifest.files.entries()) {
          if (!validPackagePath(file.path) || paths.has(file.path)) {
            throw failure();
          }
          paths.add(file.path);
          const contents = await vfs.readFile(
            `${objectRoot}/files/${index}.bin`,
          );
          totalBytes += contents.byteLength;
          if (
            contents.byteLength !== file.bytes ||
            totalBytes > MAX_GRAPH_BYTES ||
            (await digestBuildBytes(contents)) !== file.digest
          ) {
            throw failure();
          }
          files.push(BrowserPackageFile.make({ path: file.path, contents }));
        }
        if (
          (await digestBuildEntries([
            { path: "package-lock.json", contents: lockfile },
            ...files,
          ])) !== manifest.graphDigest
        ) {
          throw failure();
        }
        return BrowserPackageResolution.make({
          version: 1,
          inputDigest,
          lockDigest: manifest.lockDigest,
          graphDigest: manifest.graphDigest,
          packageCount: manifest.packageCount,
          lockfile,
          files,
          cacheHit: true,
        });
      },
      catch: failure,
    });

  const save = (resolution: BrowserPackageResolution) =>
    Effect.tryPromise({
      try: async () => {
        if (
          resolution.files.length > MAX_FILES ||
          (await digestBuildBytes(resolution.lockfile)) !==
            resolution.lockDigest ||
          (await digestBuildEntries([
            { path: "package-lock.json", contents: resolution.lockfile },
            ...resolution.files,
          ])) !== resolution.graphDigest
        ) {
          throw failure();
        }
        const paths = new Set<string>();
        let totalBytes = resolution.lockfile.byteLength;
        const storedFiles: Array<CachedPackageFile> = [];
        for (const file of resolution.files) {
          totalBytes += file.contents.byteLength;
          if (
            !validPackagePath(file.path) ||
            paths.has(file.path) ||
            file.contents.byteLength > MAX_FILE_BYTES ||
            totalBytes > MAX_GRAPH_BYTES
          ) {
            throw failure();
          }
          paths.add(file.path);
          storedFiles.push(
            CachedPackageFile.make({
              path: file.path,
              bytes: file.contents.byteLength,
              digest: await digestBuildBytes(file.contents),
            }),
          );
        }
        const objectRoot = `${objects}/${resolution.graphDigest}`;
        await vfs.mkdir(`${objectRoot}/files`, { recursive: true });
        await vfs.writeFile(
          `${objectRoot}/package-lock.json`,
          resolution.lockfile,
        );
        for (const [index, file] of resolution.files.entries()) {
          await vfs.writeFile(
            `${objectRoot}/files/${index}.bin`,
            file.contents,
          );
        }
        await vfs.writeFile(
          `${objectRoot}/manifest.json`,
          JSON.stringify(
            CachedPackageGraph.make({
              version: 1,
              inputDigest: resolution.inputDigest,
              lockDigest: resolution.lockDigest,
              graphDigest: resolution.graphDigest,
              packageCount: resolution.packageCount,
              lockBytes: resolution.lockfile.byteLength,
              files: storedFiles,
            }),
          ),
        );

        const current = await readBindings();
        const entries = {
          ...current.entries,
          [resolution.inputDigest]: resolution.graphDigest,
        };
        const keys = Object.keys(entries).toSorted();
        while (Object.keys(entries).length > MAX_BINDINGS) {
          const index = keys.findIndex(
            (key) => key !== resolution.inputDigest && key in entries,
          );
          if (index < 0) {
            throw failure();
          }
          const [key] = keys.splice(index, 1);
          if (key !== undefined) {
            delete entries[key];
          }
        }
        await vfs.mkdir(root, { recursive: true });
        await vfs.writeFile(
          bindingsPath,
          JSON.stringify(PackageCacheBindings.make({ version: 1, entries })),
        );
      },
      catch: failure,
    });

  return { load, save };
};

export const makeBrowserPackageCacheLayer = (
  vfs: Vfs,
  root = "/flect-packages/default",
) => Layer.succeed(BrowserPackageCache)(makeCache(vfs, root));

export const BrowserPackageCacheLive = Layer.effect(
  BrowserPackageCache,
  Effect.promise(() =>
    browserPersistentStorage().then(({ vfs }) =>
      makeCache(vfs, "/flect-packages/default"),
    ),
  ),
);
