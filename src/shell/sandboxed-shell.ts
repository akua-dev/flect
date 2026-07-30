import type { Fetcher } from "@riftydev/npm-client";
import { Effect, Layer, Schema, type SchemaAST, Semaphore } from "effect";
import {
  Bash,
  type CommandName,
  defineCommand,
  getCommandNames,
  type IFileSystem,
  InMemoryFs,
} from "just-bash/browser";
import {
  BunCommandFailed,
  BunCommandRequest,
  BunCommandResult,
} from "../../shared/bun-command";
import type { BunModuleExecution } from "../execution/bun-module-execution";
import { BunCommand } from "./bun-command";
import { makeShellBunCommandLiveLayer } from "./bun-command-live";
import { type FlectAgentRole, SandboxedShell } from "./sandboxed-shell-service";

export {
  type FlectAgentRole,
  SandboxedShell,
  type SandboxedShellExecuteOptions,
  type SandboxedShellShape,
} from "./sandboxed-shell-service";

const WORKSPACE_ROOT = "/workspace";
const OUTPUT_LIMIT = 1_048_576;

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

interface AstRecord {
  type?: unknown;
  name?: unknown;
  parts?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is AstRecord =>
  typeof value === "object" && value !== null;

const staticWord = (word: unknown): string | undefined => {
  if (!isRecord(word) || !Array.isArray(word.parts)) {
    return undefined;
  }
  const values: Array<string> = [];
  for (const part of word.parts) {
    if (
      !isRecord(part) ||
      (part.type !== "Literal" &&
        part.type !== "SingleQuoted" &&
        part.type !== "Escaped") ||
      typeof part.value !== "string"
    ) {
      return undefined;
    }
    values.push(part.value);
  }
  return values.join("");
};

const replaceStaticWord = (word: AstRecord, value: string) => {
  word.parts = [{ type: "Literal", value }];
};

const reserveBunCommands = (ast: unknown, hiddenCommand: string) => {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!isRecord(value) || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (
      value.type === "SimpleCommand" &&
      isRecord(value.name) &&
      staticWord(value.name) === "bun"
    ) {
      replaceStaticWord(value.name, hiddenCommand);
    } else if (value.type === "FunctionDef" && value.name === "bun") {
      value.name = "__flect_guest_bun";
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const entry of child) {
          visit(entry);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(ast);
};

const shellFailure = (reason: BunCommandFailed["reason"], message: string) =>
  BunCommandFailed.make({ reason, message });

const blockedCommands = new Set([
  "curl",
  "gunzip",
  "gzip",
  "html-to-markdown",
  "js-exec",
  "python",
  "python3",
  "sqlite3",
  "zcat",
]);

const isEnabledCommand = (name: string): name is CommandName =>
  !blockedCommands.has(name);

export const makeSandboxedShellLayer = (options: {
  readonly role: FlectAgentRole;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly fs?: IFileSystem;
}) =>
  Layer.effect(
    SandboxedShell,
    Effect.gen(function* () {
      const command = yield* BunCommand;
      const executionPermit = yield* Semaphore.make(1);
      let previewUrl: string | undefined;
      const hiddenCommand = `__flect_reserved_bun_${crypto.randomUUID().replaceAll("-", "")}`;
      const bun = defineCommand(hiddenCommand, async (args, context) => {
        try {
          const request = await Schema.decodeUnknownPromise(
            BunCommandRequest,
            strict,
          )({
            version: 1,
            argv: args.length === 0 ? ["--help"] : args,
            cwd: context.cwd,
          });
          const output = await Effect.runPromise(command.execute(request), {
            signal: context.signal,
          });
          previewUrl = output.previewUrl;
          return {
            stdout: output.stdout,
            stderr: output.stderr,
            exitCode: output.exitCode,
          };
        } catch {
          return {
            stdout: "",
            stderr: context.signal?.aborted
              ? "bun: command cancelled\n"
              : "bun: command failed safely\n",
            exitCode: context.signal?.aborted ? 130 : 1,
          };
        }
      });
      const initialFiles = {
        "/workspace/.flect-root": "",
        ...options.files,
      };
      const bash = new Bash({
        cwd: WORKSPACE_ROOT,
        ...(options.fs === undefined
          ? { files: initialFiles }
          : { fs: options.fs }),
        env: {
          FLECT_ROLE: options.role,
          HOME: WORKSPACE_ROOT,
          PATH: "/usr/bin:/bin",
        },
        commands: getCommandNames().filter(isEnabledCommand),
        customCommands: [bun],
        executionLimitProfile: "hardened",
        executionLimits: {
          maxSourceBytes: 262_144,
          maxExecutionTimeMs: 30_000,
          maxExtensionCleanupTimeMs: 1_000,
          maxFileSystemBytes: 67_108_864,
          maxOutputSize: OUTPUT_LIMIT,
          maxCommandCount: 10_000,
          maxLoopIterations: 10_000,
        },
      });
      const reservedPlugin: Parameters<Bash["registerTransformPlugin"]>[0] = {
        name: "flect-reserved-bun",
        transform: ({
          ast,
          metadata,
        }: {
          readonly ast: unknown;
          readonly metadata: Record<string, unknown>;
        }) => {
          reserveBunCommands(ast, hiddenCommand);
          return { ast, metadata };
        },
      };
      bash.registerTransformPlugin(reservedPlugin);

      return {
        role: options.role,
        execute: Effect.fn("Flect.SandboxedShell.execute")(
          (line, executeOptions) =>
            executionPermit.withPermit(
              Effect.sync(() => {
                previewUrl = undefined;
              }).pipe(
                Effect.andThen(
                  Effect.tryPromise({
                    try: (effectSignal) => {
                      const signal =
                        executeOptions?.signal === undefined
                          ? effectSignal
                          : AbortSignal.any([
                              effectSignal,
                              executeOptions.signal,
                            ]);
                      return bash.exec(line, {
                        cwd: WORKSPACE_ROOT,
                        signal,
                      });
                    },
                    catch: () =>
                      shellFailure(
                        "execution",
                        "The sandboxed shell failed safely.",
                      ),
                  }),
                ),
                Effect.flatMap((output) =>
                  output.stdout.length > OUTPUT_LIMIT ||
                  output.stderr.length > OUTPUT_LIMIT
                    ? Effect.fail(
                        shellFailure(
                          "execution",
                          "The sandboxed shell output exceeded its limit.",
                        ),
                      )
                    : Effect.succeed(
                        BunCommandResult.make({
                          version: 1,
                          exitCode: Math.min(255, Math.max(0, output.exitCode)),
                          stdout: output.stdout,
                          stderr: output.stderr,
                          ...(previewUrl === undefined ? {} : { previewUrl }),
                        }),
                      ),
                ),
              ),
            ),
        ),
      };
    }),
  );

export const makeLiveSandboxedShellLayer = (options: {
  readonly role: FlectAgentRole;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly packageFetch?: Fetcher;
  readonly registryBaseUrl?: string;
  readonly moduleLayer?: Layer.Layer<BunModuleExecution>;
}) =>
  Layer.unwrap(
    Effect.sync(() => {
      const fs = new InMemoryFs({
        "/workspace/.flect-root": "",
        ...options.files,
      });
      const commandLayer = makeShellBunCommandLiveLayer({
        fs,
        ...(options.packageFetch === undefined
          ? {}
          : { packageFetch: options.packageFetch }),
        ...(options.registryBaseUrl === undefined
          ? {}
          : { registryBaseUrl: options.registryBaseUrl }),
        ...(options.moduleLayer === undefined
          ? {}
          : { moduleLayer: options.moduleLayer }),
      });
      return makeSandboxedShellLayer({
        role: options.role,
        files: {},
        fs,
      }).pipe(Layer.provide(commandLayer));
    }),
  );
