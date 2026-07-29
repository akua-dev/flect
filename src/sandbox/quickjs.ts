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
      Object.getPrototypeOf(function* () {}),
      Object.getPrototypeOf(async function () {}),
      Object.getPrototypeOf(async function* () {})
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
      "Function"
    ]) {
      deny(name);
    }
  })()
`;

const executeInModule = Effect.fn("Flect.Sandbox.executeInModule")(
  (module: QuickJSWASMModule, source: string, serializedInput: string) => {
    let interrupted = false;
    return Effect.try({
      try: () => {
        const startedAt = performance.now();
        const result = module.evalCode(
          `${hardeningProgram}
            "use strict";
            const __input = ${serializedInput};
            const __extension = (${source});
            const __value = __extension(__input);
            JSON.stringify(Array.isArray(__value) ? __value : [__value]);
          `,
          {
            memoryLimitBytes: MEMORY_LIMIT_BYTES,
            maxStackSizeBytes: STACK_LIMIT_BYTES,
            shouldInterrupt: () => {
              interrupted =
                performance.now() - startedAt >= DEADLINE_MILLISECONDS;
              return interrupted;
            },
          },
        );
        if (typeof result !== "string") {
          throw sandboxFailure("execution");
        }
        return result;
      },
      catch: (error) => {
        if (error instanceof SandboxExecutionFailed) {
          return error;
        }
        if (interrupted) {
          return sandboxFailure("deadline");
        }
        const detail =
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
            ? error.message.toLowerCase()
            : "";
        return sandboxFailure(
          detail.includes("memory") ? "memory" : "execution",
        );
      },
    });
  },
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
