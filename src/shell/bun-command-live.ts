import type { Fetcher } from "@riftydev/npm-client";
import { Effect, Layer } from "effect";
import type { IFileSystem } from "just-bash/browser";
import {
  BunCommandFailed,
  BunCommandResult,
  type WorkspaceDelta,
} from "../../shared/bun-command";
import {
  BunModuleExecution,
  BunModuleExecutionLive,
  type BunWorkspace,
} from "../execution/bun-module-execution";
import {
  BunPackageMutation,
  makeBunPackageMutationLayer,
} from "../execution/bun-package-mutation";
import {
  BunCommand,
  type BunOperationCall,
  makeBunCommandService,
} from "./bun-command";

const WORKSPACE_ROOT = "/workspace";
const FILE_LIMIT = 4_096;
const BYTE_LIMIT = 67_108_864;

const failure = (reason: BunCommandFailed["reason"], message: string) =>
  BunCommandFailed.make({ reason, message });

const dirname = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
};

const workspacePath = (path: string) =>
  path === WORKSPACE_ROOT ||
  (/^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[^/]+)+$/.test(path) &&
    !path.includes("\0"));

const snapshotWorkspace = (fs: IFileSystem) =>
  Effect.tryPromise({
    try: async (): Promise<BunWorkspace> => {
      const files: Record<string, Uint8Array> = {};
      let byteLength = 0;
      const paths = fs
        .getAllPaths()
        .filter(
          (path) => workspacePath(path) && path !== "/workspace/.flect-root",
        )
        .sort();
      for (const path of paths) {
        const stat = await fs.stat(path);
        if (!stat.isFile) {
          continue;
        }
        const content = await fs.readFileBuffer(path);
        byteLength += content.byteLength;
        files[path] = content;
      }
      if (Object.keys(files).length > FILE_LIMIT || byteLength > BYTE_LIMIT) {
        throw failure(
          "workspace",
          "The disposable workspace exceeds its limit.",
        );
      }
      return { files };
    },
    catch: () =>
      failure("workspace", "The disposable workspace could not be read."),
  });

const applyDelta = (fs: IFileSystem, delta: WorkspaceDelta) =>
  Effect.tryPromise({
    try: async () => {
      if (delta.files.length > FILE_LIMIT || delta.byteLength > BYTE_LIMIT) {
        throw failure("workspace", "The workspace delta exceeds its limit.");
      }
      for (const change of delta.files) {
        if (!workspacePath(change.path)) {
          throw failure(
            "workspace",
            "The workspace delta contains an invalid path.",
          );
        }
        if (change.operation === "remove") {
          await fs.rm(change.path, { force: true });
        } else {
          await fs.mkdir(dirname(change.path), { recursive: true });
          await fs.writeFile(change.path, change.content);
        }
      }
    },
    catch: () =>
      failure("workspace", "The workspace delta could not be applied."),
  });

const packageResult = (
  operation: "install" | "add" | "remove",
  packageCount: number,
) =>
  BunCommandResult.make({
    version: 1,
    exitCode: 0,
    stdout:
      operation === "remove"
        ? "Removed package dependencies.\n"
        : `Installed ${packageCount} ${packageCount === 1 ? "package" : "packages"}.\n`,
    stderr: "",
  });

export const trustedNpmRegistryFetch: Fetcher = (url, init) => {
  const parsed = new URL(url);
  const method = (init?.method ?? "GET").toUpperCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== "https://registry.npmjs.org" ||
    (method !== "GET" && method !== "HEAD")
  ) {
    return Promise.reject(
      new Error("The trusted npm registry broker denied the request."),
    );
  }
  return fetch(parsed, {
    method,
    signal: init?.signal,
    credentials: "omit",
    redirect: "error",
    headers: {
      accept: "application/vnd.npm.install-v1+json, application/json",
    },
  });
};

export const makeShellBunCommandLiveLayer = (options: {
  readonly fs: IFileSystem;
  readonly packageFetch?: Fetcher;
  readonly registryBaseUrl?: string;
  readonly moduleLayer?: Layer.Layer<BunModuleExecution>;
}) => {
  const packageLayer = makeBunPackageMutationLayer({
    fetch: options.packageFetch ?? trustedNpmRegistryFetch,
    registryBaseUrl: options.registryBaseUrl ?? "https://registry.npmjs.org",
  });
  const dependencies = Layer.merge(
    options.moduleLayer ?? BunModuleExecutionLive,
    packageLayer,
  );
  return Layer.effect(
    BunCommand,
    Effect.gen(function* () {
      const modules = yield* BunModuleExecution;
      const packages = yield* BunPackageMutation;

      const execute = (call: BunOperationCall) =>
        Effect.gen(function* () {
          if (call.operation === "stop") {
            return yield* modules.stop();
          }
          const workspace = yield* snapshotWorkspace(options.fs);
          if (call.operation === "run" || call.operation === "build") {
            const operation = {
              cwd: call.cwd,
              args: call.args,
              workspace,
            };
            if (call.operation === "run") {
              return yield* modules.run(operation);
            }
            const built = yield* modules.build(operation);
            yield* applyDelta(options.fs, built.delta);
            return built.result;
          }
          const output = yield* packages[call.operation]({
            cwd: call.cwd,
            args: call.args,
            workspace,
          });
          yield* applyDelta(options.fs, output.delta);
          return packageResult(call.operation, output.packageCount);
        });

      return makeBunCommandService({ execute });
    }),
  ).pipe(Layer.provide(dependencies));
};
