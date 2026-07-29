import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import {
  type QuickJsExtensionRequest,
  SandboxExecutionFailed,
  SandboxResult,
} from "../../shared/sandbox";

const SOURCE_LIMIT_BYTES = 256 * 1024;
const INPUT_LIMIT_BYTES = 1024 * 1024;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const DEADLINE_MILLISECONDS = 100;

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const decodeResult = Schema.decodeUnknownEffect(SandboxResult, strictOptions);
const textEncoder = new TextEncoder();

const sandboxFailure = (reason: SandboxExecutionFailed["reason"]) =>
  SandboxExecutionFailed.make({
    reason,
    message: "Extension execution failed safely.",
  });

const loadQuickJs = Effect.fn("Flect.Sandbox.loadQuickJs")(() =>
  Effect.tryPromise({
    try: () => newQuickJSWASMModuleFromVariant(variant),
    catch: () => sandboxFailure("worker"),
  }),
);

const hardeningProgram = `
  (() => {
    "use strict";
    const deny = (name) => {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        writable: false,
        configurable: false,
        enumerable: false
      });
    };
    const functionPrototypes = [
      Object.getPrototypeOf(function () {}),
      Object.getPrototypeOf(function* () {})
    ];
    for (const prototype of functionPrototypes) {
      const constructor = prototype.constructor;
      Object.defineProperty(constructor.prototype, "constructor", {
        value: undefined,
        writable: false,
        configurable: false
      });
    }
    for (const name of [
      "fetch",
      "document",
      "window",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "navigator",
      "process",
      "require",
      "Bun",
      "__TAURI__",
      "Date",
      "Promise",
      "Proxy",
      "eval",
      "Function",
      "AsyncFunction",
      "AsyncGeneratorFunction"
    ]) {
      deny(name);
    }
  })()
`;

const disposeEvaluation = (
  result: ReturnType<
    ReturnType<QuickJSWASMModule["newRuntime"]>["newContext"]
  >["evalCode"] extends (...arguments_: ReadonlyArray<never>) => infer Output
    ? Output
    : never,
) => {
  if (result.error) {
    result.error.dispose();
    return false;
  }
  result.value.dispose();
  return true;
};

const executeInModule = Effect.fn("Flect.Sandbox.executeInModule")(
  (module: QuickJSWASMModule, source: string, serializedInput: string) =>
    Effect.try({
      try: () => {
        const runtime = module.newRuntime();
        runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
        runtime.setMaxStackSize(STACK_LIMIT_BYTES);
        const startedAt = performance.now();
        let interrupted = false;
        runtime.setInterruptHandler(() => {
          interrupted = performance.now() - startedAt >= DEADLINE_MILLISECONDS;
          return interrupted;
        });
        let disposeRuntime = true;

        const context = runtime.newContext({
          intrinsics: {
            BaseObjects: true,
            Eval: true,
            JSON: true,
            Promise: false,
          },
        });

        try {
          const hardened = context.evalCode(hardeningProgram, "harden.js", {
            type: "global",
            strict: true,
          });
          if (!disposeEvaluation(hardened)) {
            throw sandboxFailure("execution");
          }

          const program = `
            "use strict";
            const __input = ${serializedInput};
            const __extension = (${source});
            const __value = __extension(__input);
            JSON.stringify(Array.isArray(__value) ? __value : [__value]);
          `;
          const evaluated = context.evalCode(program, "extension.js", {
            type: "global",
            strict: true,
          });
          if (evaluated.error) {
            // QuickJS can assert while disposing a runtime immediately after
            // stack or heap exhaustion. Live evaluations are isolated in a
            // dedicated Worker that ExtensionSandbox always terminates, so
            // dispose the handles here and let Worker teardown reclaim WASM.
            disposeRuntime = false;
            if (interrupted) {
              evaluated.error.dispose();
              throw sandboxFailure("deadline");
            }
            runtime.setMemoryLimit(-1);
            runtime.setMaxStackSize(0);
            const detail = context.dump(evaluated.error);
            evaluated.error.dispose();
            const memoryExhausted =
              typeof detail === "object" &&
              detail !== null &&
              "message" in detail &&
              typeof detail.message === "string" &&
              detail.message.toLowerCase().includes("memory");
            throw sandboxFailure(
              detail === null || memoryExhausted ? "memory" : "execution",
            );
          }
          return evaluated.value.consume((handle) => context.getString(handle));
        } finally {
          context.dispose();
          if (disposeRuntime) {
            runtime.dispose();
          }
        }
      },
      catch: (error) =>
        error instanceof SandboxExecutionFailed
          ? error
          : sandboxFailure("execution"),
    }),
);

export const executeQuickJsExtension = Effect.fn(
  "Flect.Sandbox.executeQuickJsExtension",
)(function* (request: QuickJsExtensionRequest) {
  if (textEncoder.encode(request.source).byteLength > SOURCE_LIMIT_BYTES) {
    return yield* Effect.fail(sandboxFailure("source-limit"));
  }

  const serializedInput = yield* Effect.try({
    try: () => JSON.stringify(request.input),
    catch: () => sandboxFailure("invalid-input"),
  });
  if (
    serializedInput === undefined ||
    textEncoder.encode(serializedInput).byteLength > INPUT_LIMIT_BYTES
  ) {
    return yield* Effect.fail(
      sandboxFailure(
        serializedInput === undefined ? "invalid-input" : "input-limit",
      ),
    );
  }

  const module = yield* loadQuickJs();
  const serializedResult = yield* executeInModule(
    module,
    request.source,
    serializedInput,
  );
  if (textEncoder.encode(serializedResult).byteLength > OUTPUT_LIMIT_BYTES) {
    return yield* Effect.fail(sandboxFailure("output-limit"));
  }

  const result = yield* Effect.try({
    try: (): unknown => JSON.parse(serializedResult),
    catch: () => sandboxFailure("invalid-result"),
  }).pipe(
    Effect.flatMap((intents) =>
      decodeResult({
        version: 1,
        intents,
      }),
    ),
    Effect.mapError(() => sandboxFailure("invalid-result")),
  );

  return result;
});
