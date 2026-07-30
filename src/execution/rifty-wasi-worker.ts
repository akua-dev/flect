/// <reference lib="webworker" />

import { runWasi } from "@riftydev/runtime-wasi";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  BrowserExecutionFailed,
  WasiExecutionResult,
  WasiWorkerFailure,
  WasiWorkerRequest,
  WasiWorkerSuccess,
} from "../../shared/browser-execution";

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
const OUTPUT_LIMIT = 1_048_576;
const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const decodeRequest = Schema.decodeUnknownEffect(
  WasiWorkerRequest,
  strictOptions,
);

const failure = () =>
  BrowserExecutionFailed.make({
    reason: "execution",
    operation: "wasi",
    message: "Browser WASI execution failed safely.",
  });

worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  void Effect.runPromise(
    decodeRequest(event.data).pipe(
      Effect.flatMap((frame) =>
        Effect.tryPromise({
          try: () =>
            runWasi(frame.request.module, {
              args: [...frame.request.args],
              env: { ...frame.request.env },
              preopens: {},
            }),
          catch: failure,
        }).pipe(
          Effect.flatMap((result) =>
            Schema.decodeUnknownEffect(WasiExecutionResult)({
              version: 1,
              exitCode: result.exitCode,
              stdout: result.stdout.slice(0, OUTPUT_LIMIT + 1),
              stderr: result.stderr.slice(0, OUTPUT_LIMIT + 1),
            }),
          ),
          Effect.map((result) =>
            WasiWorkerSuccess.make({
              type: "success",
              id: frame.id,
              result,
            }),
          ),
          Effect.catch(() =>
            Effect.succeed(
              WasiWorkerFailure.make({
                type: "failure",
                id: frame.id,
                error: failure(),
              }),
            ),
          ),
        ),
      ),
      Effect.tap((response) => Effect.sync(() => worker.postMessage(response))),
      Effect.catch(() => Effect.void),
    ),
  );
});
