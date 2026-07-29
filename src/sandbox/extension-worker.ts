/// <reference lib="webworker" />

import { Effect, Schema, type SchemaAST } from "effect";
import {
  SandboxWorkerFailure,
  SandboxWorkerRequest,
  SandboxWorkerSuccess,
} from "../../shared/sandbox";
import { executeQuickJsExtension } from "./quickjs";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const decodeRequest = Schema.decodeUnknownEffect(
  SandboxWorkerRequest,
  strictOptions,
);

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  Effect.runFork(
    decodeRequest(event.data).pipe(
      Effect.flatMap((message) =>
        executeQuickJsExtension(message.request).pipe(
          Effect.match({
            onFailure: (error) =>
              SandboxWorkerFailure.make({
                type: "failure",
                id: message.id,
                error,
              }),
            onSuccess: (result) =>
              SandboxWorkerSuccess.make({
                type: "success",
                id: message.id,
                result,
              }),
          }),
        ),
      ),
      Effect.tap((response) =>
        Effect.sync(() => {
          self.postMessage(response);
        }),
      ),
      Effect.catch(() => Effect.void),
    ),
  );
});
