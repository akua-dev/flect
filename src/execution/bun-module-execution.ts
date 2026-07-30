import { parse } from "acorn";
import { Context, Deferred, Effect, Layer, Ref, Semaphore } from "effect";
import {
  BunCommandFailed,
  BunCommandResult,
  WorkspaceDelta,
  type WorkspaceFileChange,
  WorkspaceFileRemove,
  WorkspaceFileWrite,
} from "../../shared/bun-command";
import {
  BunPreviewExecution,
  BunPreviewExecutionLive,
} from "./bun-preview-execution";
import { loadBrowserEsbuild } from "./esbuild-browser";
import {
  RiftyJavaScriptExecution,
  RiftyJavaScriptLive,
} from "./rifty-js-runtime";

const WORKSPACE_ROOT = "/workspace";
const BUILD_ROOT = "/workspace/.flect-build";
const MODULE_DEADLINE = "5 seconds";
const SOURCE_LIMIT = 262_144;
const WORKSPACE_FILE_LIMIT = 4_096;

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export interface BunWorkspace {
  readonly files: Readonly<Record<string, string | Uint8Array>>;
}

export interface BunModuleOperation {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly workspace: BunWorkspace;
}

export interface BunModuleRuntimeRequest {
  readonly cwd: string;
  readonly entry: string;
  readonly args: ReadonlyArray<string>;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
}

interface BunModuleRuntimeOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly previewUrl?: string;
}

export interface BunModuleBuildResult {
  readonly result: BunCommandResult;
  readonly delta: WorkspaceDelta;
}

interface BunModuleRuntimeShape {
  readonly execute: (
    request: BunModuleRuntimeRequest,
  ) => Effect.Effect<BunModuleRuntimeOutput, BunCommandFailed>;
  readonly stop: Effect.Effect<void, BunCommandFailed>;
}

class BunModuleRuntime extends Context.Service<
  BunModuleRuntime,
  BunModuleRuntimeShape
>()("flect/BunModuleRuntime") {}

export interface BunModuleExecutionShape {
  readonly run: (
    operation: BunModuleOperation,
  ) => Effect.Effect<BunCommandResult, BunCommandFailed>;
  readonly build: (
    operation: BunModuleOperation,
  ) => Effect.Effect<BunModuleBuildResult, BunCommandFailed>;
  readonly stop: () => Effect.Effect<BunCommandResult, BunCommandFailed>;
}

export class BunModuleExecution extends Context.Service<
  BunModuleExecution,
  BunModuleExecutionShape
>()("flect/BunModuleExecution") {}

const failure = (reason: BunCommandFailed["reason"], message: string) =>
  BunCommandFailed.make({ reason, message });

const result = (stdout: string, stderr = "", previewUrl?: string) =>
  BunCommandResult.make({
    version: 1,
    exitCode: 0,
    stdout,
    stderr,
    ...(previewUrl === undefined ? {} : { previewUrl }),
  });

const splitPath = (path: string): ReadonlyArray<string> => path.split("/");

const normalizeWorkspacePath = (
  base: string,
  input: string,
): string | undefined => {
  const source = input.startsWith("/") ? input : `${base}/${input}`;
  const segments: Array<string> = [];
  for (const segment of splitPath(source)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const normalized = `/${segments.join("/")}`;
  return normalized === WORKSPACE_ROOT ||
    normalized.startsWith(`${WORKSPACE_ROOT}/`)
    ? normalized
    : undefined;
};

const dirname = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
};

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
};

const withoutExtension = (path: string) => {
  const suffix = extension(path);
  return suffix.length === 0 ? path : path.slice(0, -suffix.length);
};

const resolveSource = (
  files: Readonly<Record<string, string | Uint8Array>>,
  base: string,
  specifier: string,
): string | undefined => {
  const path = normalizeWorkspacePath(base, specifier);
  if (path === undefined) {
    return undefined;
  }
  if (extension(path) === ".cjs") {
    return undefined;
  }
  const candidates = extension(path)
    ? [path]
    : [
        path,
        ...sourceExtensions.map((suffix) => `${path}${suffix}`),
        ...sourceExtensions.map((suffix) => `${path}/index${suffix}`),
      ];
  return candidates.find((candidate) => files[candidate] !== undefined);
};

const compiledPath = (path: string) => {
  const relative = path.slice(WORKSPACE_ROOT.length);
  const suffix = extension(relative);
  const output =
    suffix === ".ts" || suffix === ".tsx" || suffix === ".jsx"
      ? `${withoutExtension(relative)}.js`
      : relative;
  return `${BUILD_ROOT}${output}`;
};

const relativePath = (fromDirectory: string, to: string) => {
  const from = splitPath(fromDirectory).filter(Boolean);
  const target = splitPath(to).filter(Boolean);
  let shared = 0;
  while (
    shared < from.length &&
    shared < target.length &&
    from[shared] === target[shared]
  ) {
    shared += 1;
  }
  const value = [
    ...Array.from({ length: from.length - shared }, () => ".."),
    ...target.slice(shared),
  ].join("/");
  return value.startsWith(".") ? value : `./${value}`;
};

const workspaceFailure = () =>
  failure("workspace", "The disposable workspace could not be prepared.");

interface PreparedModuleGraph {
  readonly entry: string;
  readonly modules: ReadonlyArray<string>;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
}

const moduleSpecifiers = (source: string): ReadonlyArray<string> => {
  const values = new Set<string>();
  const pattern =
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) {
      values.add(specifier);
    }
  }
  return [...values];
};

const loaderFor = (path: string): "js" | "jsx" | "ts" | "tsx" | "json" => {
  switch (extension(path)) {
    case ".ts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".json":
      return "json";
    default:
      return "js";
  }
};

interface AstRecord {
  readonly type: string;
  readonly [key: string]: unknown;
}

const isAstRecord = (value: unknown): value is AstRecord => {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  return typeof value.type === "string";
};

const identifierName = (value: unknown): string | undefined =>
  isAstRecord(value) &&
  value.type === "Identifier" &&
  typeof value.name === "string"
    ? value.name
    : undefined;

const stringLiteral = (value: unknown): string | undefined =>
  isAstRecord(value) &&
  value.type === "Literal" &&
  typeof value.value === "string"
    ? value.value
    : undefined;

const isBunServeMember = (value: unknown) => {
  if (!isAstRecord(value) || value.type !== "MemberExpression") {
    return false;
  }
  if (identifierName(value.object) !== "Bun") {
    return false;
  }
  return (
    identifierName(value.property) === "serve" ||
    stringLiteral(value.property) === "serve"
  );
};

const visitAst = (value: unknown, visit: (node: AstRecord) => void): void => {
  if (!isAstRecord(value)) {
    return;
  }
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        visitAst(entry, visit);
      }
    } else {
      visitAst(child, visit);
    }
  }
};

const bindingNames = (value: unknown): ReadonlyArray<string> => {
  const identifier = identifierName(value);
  if (identifier !== undefined) {
    return [identifier];
  }
  if (!isAstRecord(value) || value.type !== "ObjectPattern") {
    return [];
  }
  const names: Array<string> = [];
  for (const property of Array.isArray(value.properties)
    ? value.properties
    : []) {
    if (!isAstRecord(property) || property.type !== "Property") {
      continue;
    }
    const key = identifierName(property.key) ?? stringLiteral(property.key);
    if (key === "serve") {
      names.push(...bindingNames(property.value));
    }
  }
  return names;
};

const aliasedServeNames = (ast: unknown) => {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    visitAst(ast, (node) => {
      if (node.type !== "VariableDeclarator") {
        return;
      }
      const names = bindingNames(node.id);
      if (names.length === 0) {
        return;
      }
      if (isBunServeMember(node.init)) {
        for (const name of names) {
          if (!aliases.has(name)) {
            aliases.add(name);
            changed = true;
          }
        }
        return;
      }
      if (identifierName(node.init) === "Bun") {
        for (const name of names) {
          if (!aliases.has(name)) {
            aliases.add(name);
            changed = true;
          }
        }
        return;
      }
      if (
        identifierName(node.init) !== undefined &&
        aliases.has(identifierName(node.init) ?? "")
      ) {
        for (const name of names) {
          if (!aliases.has(name)) {
            aliases.add(name);
            changed = true;
          }
        }
      }
    });
  }
  return aliases;
};

export const containsBunServeCall = (source: string): boolean => {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const aliases = aliasedServeNames(ast);
  let found = false;
  visitAst(ast, (node) => {
    if (node.type !== "CallExpression") {
      return;
    }
    if (isBunServeMember(node.callee)) {
      found = true;
      return;
    }
    if (identifierName(node.callee) !== undefined) {
      if (aliases.has(identifierName(node.callee) ?? "")) {
        found = true;
      }
    }
  });
  return found;
};

export const detectsBunPreview = (
  files: Readonly<Record<string, string | Uint8Array>>,
) =>
  Object.values(files).some((content) => {
    if (typeof content !== "string") {
      return false;
    }
    try {
      return containsBunServeCall(content);
    } catch {
      return false;
    }
  });

const buildDelta = (
  operation: BunModuleOperation,
  graph: PreparedModuleGraph,
): WorkspaceDelta => {
  const generated = new Map(
    Object.entries(graph.files).filter(([path]) =>
      path.startsWith(`${BUILD_ROOT}/`),
    ),
  );
  const changes: Array<WorkspaceFileChange> = [];
  let byteLength = 0;
  for (const [path, source] of [...generated].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const content =
      typeof source === "string" ? encoder.encode(source) : source;
    byteLength += content.byteLength;
    changes.push(
      WorkspaceFileWrite.make({
        operation: "write",
        path,
        content,
      }),
    );
  }
  for (const path of Object.keys(operation.workspace.files)
    .filter(
      (candidate) =>
        candidate.startsWith(`${BUILD_ROOT}/`) && !generated.has(candidate),
    )
    .sort()) {
    changes.push(WorkspaceFileRemove.make({ operation: "remove", path }));
  }
  if (changes.length > 4_096 || byteLength > 67_108_864) {
    throw workspaceFailure();
  }
  return WorkspaceDelta.make({
    version: 1,
    files: changes,
    byteLength,
  });
};

const prepareModuleGraph = async (
  operation: BunModuleOperation,
): Promise<PreparedModuleGraph> => {
  if (
    Object.keys(operation.workspace.files).length > WORKSPACE_FILE_LIMIT ||
    operation.args.length === 0 ||
    operation.args[0]?.startsWith("-")
  ) {
    throw workspaceFailure();
  }
  const sourceEntry = resolveSource(
    operation.workspace.files,
    operation.cwd,
    operation.args[0] ?? "",
  );
  if (sourceEntry === undefined) {
    throw workspaceFailure();
  }

  const graph = new Set<string>();
  const imports = new Map<string, ReadonlyMap<string, string>>();
  const transformedSources = new Map<string, string>();
  const esbuild = await loadBrowserEsbuild();
  const visit = async (path: string): Promise<void> => {
    if (graph.has(path)) {
      return;
    }
    const content = operation.workspace.files[path];
    const source =
      typeof content === "string"
        ? content
        : content === undefined
          ? undefined
          : decoder.decode(content);
    if (
      source === undefined ||
      encoder.encode(source).byteLength > SOURCE_LIMIT
    ) {
      throw workspaceFailure();
    }
    graph.add(path);
    if (extension(path) === ".json") {
      transformedSources.set(path, source);
      return;
    }
    const transformed = await esbuild.transform(source, {
      loader: loaderFor(path),
      format: "esm",
      target: "es2022",
      sourcefile: path,
      sourcemap: false,
    });
    transformedSources.set(path, transformed.code);
    const resolvedImports = new Map<string, string>();
    for (const specifier of moduleSpecifiers(transformed.code)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        continue;
      }
      const resolved = resolveSource(
        operation.workspace.files,
        dirname(path),
        specifier,
      );
      if (resolved === undefined) {
        throw workspaceFailure();
      }
      resolvedImports.set(specifier, resolved);
      await visit(resolved);
    }
    imports.set(path, resolvedImports);
  };
  await visit(sourceEntry);

  const output: Record<string, string | Uint8Array> = {};
  for (const path of [...graph].sort()) {
    const builtPath = compiledPath(path);
    let transformed = transformedSources.get(path) ?? "";
    for (const [specifier, target] of imports.get(path) ?? []) {
      const replacement = relativePath(
        dirname(builtPath),
        compiledPath(target),
      );
      transformed = transformed
        .split(`"${specifier}"`)
        .join(`"${replacement}"`)
        .split(`'${specifier}'`)
        .join(`'${replacement}'`);
    }
    output[builtPath] = transformed;
  }

  for (const [path, source] of Object.entries(operation.workspace.files)) {
    if (
      path === "/workspace/package.json" ||
      path.startsWith("/workspace/node_modules/")
    ) {
      output[path] = source;
    }
  }

  return {
    entry: compiledPath(sourceEntry),
    modules: [...graph].sort(),
    files: output,
  };
};

const prepare = (operation: BunModuleOperation) =>
  Effect.tryPromise({
    try: () => prepareModuleGraph(operation),
    catch: workspaceFailure,
  });

const makeBunModuleExecutionLayer = Layer.effect(
  BunModuleExecution,
  Effect.gen(function* () {
    const runtime = yield* BunModuleRuntime;
    const active = yield* Ref.make<
      | {
          readonly cancel: Deferred.Deferred<void>;
          readonly done: Deferred.Deferred<void>;
        }
      | undefined
    >(undefined);
    const runPermit = yield* Semaphore.make(1);

    const run = (operation: BunModuleOperation) =>
      runPermit.withPermit(
        Effect.gen(function* () {
          const graph = yield* prepare(operation);
          const cancel = yield* Deferred.make<void>();
          const done = yield* Deferred.make<void>();
          const runEffect = runtime
            .execute({
              cwd: operation.cwd,
              entry: graph.entry,
              args: operation.args.slice(1),
              files: graph.files,
            })
            .pipe(
              Effect.map((output) =>
                result(output.stdout, output.stderr, output.previewUrl),
              ),
              Effect.timeoutOrElse({
                duration: MODULE_DEADLINE,
                orElse: () =>
                  Effect.fail(
                    failure(
                      "deadline",
                      "The Bun-compatible module exceeded its deadline.",
                    ),
                  ),
              }),
              Effect.catchDefect(() =>
                Effect.fail(
                  failure(
                    "execution",
                    "The Bun-compatible module failed safely.",
                  ),
                ),
              ),
            );
          yield* Ref.set(active, { cancel, done });
          return yield* Effect.raceFirst(
            runEffect,
            Deferred.await(cancel).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  failure(
                    "cancelled",
                    "The Bun-compatible module was stopped.",
                  ),
                ),
              ),
            ),
          ).pipe(
            Effect.ensuring(
              Deferred.succeed(done, undefined).pipe(
                Effect.andThen(Ref.set(active, undefined)),
              ),
            ),
          );
        }),
      );

    return {
      run: Effect.fn("Flect.BunModuleExecution.run")(run),
      build: Effect.fn("Flect.BunModuleExecution.build")((operation) =>
        prepare(operation).pipe(
          Effect.map((graph) => ({
            result: result(
              `${Object.keys(graph.files)
                .filter((path) => path.startsWith(`${BUILD_ROOT}/`))
                .sort()
                .join("\n")}\n`,
            ),
            delta: buildDelta(operation, graph),
          })),
        ),
      ),
      stop: Effect.fn("Flect.BunModuleExecution.stop")(() =>
        Effect.gen(function* () {
          const running = yield* Ref.get(active);
          if (running === undefined) {
            yield* runtime.stop;
            return result("Stopped Bun-compatible module resources.\n");
          }
          yield* Deferred.succeed(running.cancel, undefined);
          yield* Deferred.await(running.done);
          yield* runtime.stop;
          return result("Stopped the active Bun-compatible module.\n");
        }),
      ),
    };
  }),
);

export const makeBunModuleExecutionTestLayer = (
  execute: BunModuleRuntimeShape["execute"],
  stop: BunModuleRuntimeShape["stop"] = Effect.void,
) =>
  makeBunModuleExecutionLayer.pipe(
    Layer.provide(Layer.succeed(BunModuleRuntime)({ execute, stop })),
  );

export const BunModuleExecutionBase = makeBunModuleExecutionLayer;

const RiftyBunModuleRuntimeLive = Layer.effect(
  BunModuleRuntime,
  Effect.gen(function* () {
    const runtime = yield* RiftyJavaScriptExecution;
    const preview = yield* BunPreviewExecution;
    return {
      execute: Effect.fn("Flect.BunModuleRuntime.execute")((request) => {
        const runModule = (previewProbe?: string) =>
          runtime
            .runModule({
              files: request.files,
              entry: request.entry,
              cwd: request.cwd,
              args: request.args,
              ...(previewProbe === undefined ? {} : { previewProbe }),
            })
            .pipe(
              Effect.map(({ stdout, stderr }) => ({ stdout, stderr })),
              Effect.mapError((error) =>
                failure(
                  error.reason === "deadline" ? "deadline" : "execution",
                  error.reason === "deadline"
                    ? "The Bun-compatible module exceeded its deadline."
                    : "The Bun-compatible module failed safely.",
                ),
              ),
            );
        if (!detectsBunPreview(request.files)) {
          return runModule();
        }
        const marker = `flect-preview-${crypto.randomUUID().replaceAll("-", "")}`;
        return runModule(marker).pipe(
          Effect.flatMap((probe) =>
            probe.stdout.includes(marker)
              ? preview
                  .start({
                    entry: request.entry,
                    files: request.files,
                  })
                  .pipe(
                    Effect.map(({ previewUrl }) => ({
                      stdout: `Preview ready at ${previewUrl}\n`,
                      stderr: "",
                      previewUrl,
                    })),
                  )
              : Effect.succeed(probe),
          ),
        );
      }),
      stop: preview.stop.pipe(
        Effect.mapError(() =>
          failure(
            "preview",
            "The Bun-compatible preview could not be stopped.",
          ),
        ),
      ),
    };
  }),
).pipe(
  Layer.provide(Layer.merge(RiftyJavaScriptLive, BunPreviewExecutionLive)),
);

export const BunModuleExecutionLive = makeBunModuleExecutionLayer.pipe(
  Layer.provide(RiftyBunModuleRuntimeLive),
);
