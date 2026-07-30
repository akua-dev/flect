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
import { makeBoundedWasiOutput } from "./rifty-wasi-output";

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
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
        Effect.sync(makeBoundedWasiOutput).pipe(
          Effect.flatMap((output) =>
            Effect.tryPromise({
              try: () =>
                runWasi(frame.request.module, {
                  args: [...frame.request.args],
                  env: { ...frame.request.env },
                  preopens: {},
                  stdout: output.stdout,
                  stderr: output.stderr,
                }),
              catch: failure,
            }).pipe(
              Effect.flatMap((result) =>
                Schema.decodeUnknownEffect(WasiExecutionResult)({
                  version: 1,
                  exitCode: result.exitCode,
                  stdout: output.stdoutText(),
                  stderr: output.stderrText(),
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
        ),
      ),
      Effect.tap((response) => Effect.sync(() => worker.postMessage(response))),
      Effect.catch(() => Effect.void),
    ),
  );
});
