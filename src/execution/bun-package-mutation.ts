import { type Fetcher, install, RegistryClient } from "@riftydev/npm-client";
import { MemoryVfs, type Vfs } from "@riftydev/vfs";
import { Context, Effect, Layer } from "effect";
import {
  BunCommandFailed,
  WorkspaceDelta,
  WorkspaceFileRemove,
  WorkspaceFileWrite,
} from "../../shared/bun-command";

const WORKSPACE_ROOT = "/workspace";
const REGISTRY_BASE_URL = "https://registry.flect.invalid";
const PACKAGE_DEADLINE = "10 seconds";
const FILE_LIMIT = 4_096;
const BYTE_LIMIT = 67_108_864;
const PACKAGE_NAME =
  /^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

const encoder = new TextEncoder();

export interface BunPackageWorkspace {
  readonly files: Readonly<Record<string, string | Uint8Array>>;
}

export interface BunPackageOperation {
  readonly cwd: string;
  readonly args?: ReadonlyArray<string>;
  readonly workspace: BunPackageWorkspace;
}

export interface BunPackageMutationOutput {
  readonly delta: WorkspaceDelta;
  readonly packageCount: number;
}

export interface BunPackageMutationShape {
  readonly install: (
    operation: BunPackageOperation,
  ) => Effect.Effect<BunPackageMutationOutput, BunCommandFailed>;
  readonly add: (
    operation: BunPackageOperation,
  ) => Effect.Effect<BunPackageMutationOutput, BunCommandFailed>;
  readonly remove: (
    operation: BunPackageOperation,
  ) => Effect.Effect<BunPackageMutationOutput, BunCommandFailed>;
}

export class BunPackageMutation extends Context.Service<
  BunPackageMutation,
  BunPackageMutationShape
>()("flect/BunPackageMutation") {}

const packageFailure = () =>
  BunCommandFailed.make({
    reason: "package",
    message: "The Bun-compatible package operation failed safely.",
  });

const workspacePath = (path: string) =>
  path === WORKSPACE_ROOT ||
  (/^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[^/]+)+$/.test(path) &&
    !path.includes("\0"));

const dirname = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
};

const bytesEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

const cloneWorkspace = async (
  workspace: BunPackageWorkspace,
): Promise<MemoryVfs> => {
  const entries = Object.entries(workspace.files);
  if (entries.length > FILE_LIMIT) {
    throw packageFailure();
  }
  const vfs = new MemoryVfs();
  await vfs.mkdir(WORKSPACE_ROOT, { recursive: true });
  for (const [path, content] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const bytes =
      typeof content === "string" ? encoder.encode(content) : content;
    if (!workspacePath(path) || bytes.byteLength > BYTE_LIMIT) {
      throw packageFailure();
    }
    await vfs.mkdir(dirname(path), { recursive: true });
    await vfs.writeFile(path, content);
  }
  return vfs;
};

const snapshotFiles = async (
  vfs: Vfs,
  root = WORKSPACE_ROOT,
): Promise<Record<string, Uint8Array>> => {
  const output: Record<string, Uint8Array> = {};
  const walk = async (path: string): Promise<void> => {
    for (const entry of await vfs.readdir(path)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(child);
      } else if (entry.isFile) {
        output[child] = await vfs.readFile(child);
      }
    }
  };
  await walk(root);
  return output;
};

const makeDelta = (
  source: BunPackageWorkspace,
  staged: Readonly<Record<string, Uint8Array>>,
) => {
  const original = Object.fromEntries(
    Object.entries(source.files).map(([path, content]) => [
      path,
      typeof content === "string" ? encoder.encode(content) : content,
    ]),
  );
  const files: Array<WorkspaceFileWrite | WorkspaceFileRemove> = [];
  let byteLength = 0;
  for (const path of [
    ...new Set([...Object.keys(original), ...Object.keys(staged)]),
  ].sort()) {
    const before = original[path];
    const after = staged[path];
    if (after === undefined) {
      files.push(WorkspaceFileRemove.make({ operation: "remove", path }));
    } else if (before === undefined || !bytesEqual(before, after)) {
      byteLength += after.byteLength;
      files.push(
        WorkspaceFileWrite.make({
          operation: "write",
          path,
          content: after,
        }),
      );
    }
  }
  if (files.length > FILE_LIMIT || byteLength > BYTE_LIMIT) {
    throw packageFailure();
  }
  return WorkspaceDelta.make({ version: 1, files, byteLength });
};

interface PackageManifest {
  readonly [key: string]: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const isUnknownRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  return entries.every(([, entry]) => typeof entry === "string")
    ? Object.fromEntries(entries)
    : undefined;
};

const readManifest = async (vfs: Vfs): Promise<PackageManifest> => {
  const value: unknown = JSON.parse(
    await vfs.readFileText("/workspace/package.json"),
  );
  if (!isUnknownRecord(value)) {
    throw packageFailure();
  }
  if (
    stringRecord(value.dependencies) === undefined ||
    stringRecord(value.devDependencies) === undefined ||
    stringRecord(value.optionalDependencies) === undefined
  ) {
    throw packageFailure();
  }
  return value;
};

const writeManifest = async (vfs: Vfs, manifest: PackageManifest) => {
  await vfs.writeFile(
    "/workspace/package.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

const parsePackageSpec = (
  specifier: string,
): { readonly name: string; readonly version: string } | undefined => {
  const versionAt = specifier.startsWith("@")
    ? specifier.lastIndexOf("@")
    : specifier.indexOf("@");
  const hasVersion = versionAt > 0;
  const name = hasVersion ? specifier.slice(0, versionAt) : specifier;
  const version = hasVersion ? specifier.slice(versionAt + 1) : "latest";
  return PACKAGE_NAME.test(name) && version.length > 0 && version.length <= 100
    ? { name, version }
    : undefined;
};

const mutate = (
  operation: BunPackageOperation,
  kind: "install" | "add" | "remove",
  fetch: Fetcher,
  registryBaseUrl: string,
) =>
  Effect.tryPromise({
    try: async (signal) => {
      if (operation.cwd !== WORKSPACE_ROOT) {
        throw packageFailure();
      }
      const vfs = await cloneWorkspace(operation.workspace);
      const manifest = await readManifest(vfs);
      const args = operation.args ?? [];

      if (kind === "add") {
        if (args.length === 0) {
          throw packageFailure();
        }
        const dependencies = stringRecord(manifest.dependencies) ?? {};
        for (const argument of args) {
          const specifier = parsePackageSpec(argument);
          if (specifier === undefined) {
            throw packageFailure();
          }
          dependencies[specifier.name] = specifier.version;
        }
        await writeManifest(vfs, { ...manifest, dependencies });
      } else if (kind === "remove") {
        if (
          args.length === 0 ||
          args.some((name) => !PACKAGE_NAME.test(name))
        ) {
          throw packageFailure();
        }
        const dependencies = stringRecord(manifest.dependencies) ?? {};
        const devDependencies = stringRecord(manifest.devDependencies) ?? {};
        const optionalDependencies =
          stringRecord(manifest.optionalDependencies) ?? {};
        for (const name of args) {
          delete dependencies[name];
          delete devDependencies[name];
          delete optionalDependencies[name];
          await vfs.rm(`/workspace/node_modules/${name}`, {
            recursive: true,
            force: true,
          });
        }
        await writeManifest(vfs, {
          ...manifest,
          dependencies,
          devDependencies,
          optionalDependencies,
        });
      } else if (args.length > 0) {
        throw packageFailure();
      }

      const registry = new RegistryClient({
        baseUrl: registryBaseUrl,
        fetch: (url, init) => fetch(url, { ...init, signal }),
        maxRetries: 0,
      });
      const installed = await install({
        vfs,
        cwd: WORKSPACE_ROOT,
        registry,
      });
      const lockfile: unknown = JSON.parse(
        await vfs.readFileText("/workspace/package-lock.json"),
      );
      if (
        !isUnknownRecord(lockfile) ||
        lockfile.lockfileVersion !== 3 ||
        (await vfs.exists("/workspace/bun.lock"))
      ) {
        throw packageFailure();
      }

      return {
        delta: makeDelta(operation.workspace, await snapshotFiles(vfs)),
        packageCount: installed.packages.length,
      };
    },
    catch: packageFailure,
  }).pipe(
    Effect.timeoutOrElse({
      duration: PACKAGE_DEADLINE,
      orElse: () => Effect.fail(packageFailure()),
    }),
  );

export const makeBunPackageMutationLayer = (options: {
  readonly fetch: Fetcher;
  readonly registryBaseUrl?: string;
}) =>
  Layer.succeed(BunPackageMutation)({
    install: Effect.fn("Flect.BunPackageMutation.install")((operation) =>
      mutate(
        operation,
        "install",
        options.fetch,
        options.registryBaseUrl ?? REGISTRY_BASE_URL,
      ),
    ),
    add: Effect.fn("Flect.BunPackageMutation.add")((operation) =>
      mutate(
        operation,
        "add",
        options.fetch,
        options.registryBaseUrl ?? REGISTRY_BASE_URL,
      ),
    ),
    remove: Effect.fn("Flect.BunPackageMutation.remove")((operation) =>
      mutate(
        operation,
        "remove",
        options.fetch,
        options.registryBaseUrl ?? REGISTRY_BASE_URL,
      ),
    ),
  });
