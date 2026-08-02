import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { BunCommandResult } from "../shared/bun-command";
import {
  GuardianDiagnostic,
  ModelSummary,
  RuntimeStatus,
  SessionSelection,
  ShapeCompleted,
  TextDelta,
  TurnCompleted,
  TurnStarted,
} from "../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import { FlectRpcs } from "../shared/rpc";
import { makeFlectRpcHandlers } from "./rpc-handlers";
import { FlectRuntime } from "./runtime";

const runtimeLayer = Layer.succeed(FlectRuntime)({
  status: Effect.succeed(RuntimeStatus.make({ version: 1, status: "ready" })),
  listModels: Effect.succeed([
    ModelSummary.make({
      provider: "openai-codex",
      id: "gpt-5.6",
      name: "GPT-5.6",
    }),
  ]),
  createSession: () => Effect.succeed("session-1"),
  closeSession: () => Effect.void,
  prompt: () =>
    Stream.make(
      TurnStarted.make({ type: "turn_started" }),
      TextDelta.make({ type: "text_delta", delta: "Shaped" }),
      TurnCompleted.make({ type: "turn_completed" }),
    ),
  shape: () =>
    Stream.succeed(
      ShapeCompleted.make({
        type: "shape_completed",
        document: InterfaceDocument.make({
          ...defaultInterfaceDocument,
          name: "Focused Flect",
        }),
      }),
    ),
  cancel: () => Effect.void,
  completeShellRequest: () => Effect.void,
  diagnoseRecovery: () =>
    Effect.succeed(
      GuardianDiagnostic.make({
        version: 1,
        message: "The protected launcher remains available.",
      }),
    ),
});

const handlers = makeFlectRpcHandlers().pipe(Layer.provide(runtimeLayer));

const deeplyNestedDocument = (depth: number) => {
  let node: unknown = {
    id: "leaf",
    type: "text",
    text: "Too deep",
    style: "body",
  };

  for (let index = 0; index < depth; index += 1) {
    node = {
      id: `stack-${index}`,
      type: "stack",
      direction: "column",
      gap: "sm",
      children: [node],
    };
  }

  return {
    version: 2,
    name: "Pathological depth",
    root: node,
  };
};

describe("Flect RPC handlers", () => {
  it.effect(
    "serves finite runtime operations through the shared RPC group",
    () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(FlectRpcs);
        const status = yield* client.GetRuntime();
        const models = yield* client.ListModels();
        const sessionId = yield* client.CreateSession(
          SessionSelection.make({}),
        );
        const shaped = yield* client
          .Shape({
            sessionId,
            instruction: "Make this more focused",
            document: defaultInterfaceDocument,
          })
          .pipe(Stream.runCollect);
        yield* client.Cancel({ sessionId, role: "app" });
        yield* client.CompleteShellRequest({
          sessionId,
          role: "shaper",
          requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
          result: BunCommandResult.make({
            version: 1,
            exitCode: 0,
            stdout: "42\n",
            stderr: "",
          }),
        });
        const diagnostic = yield* client.DiagnoseRecovery({
          sessionId,
          reason: "rollback-failed",
        });
        yield* client.CloseSession({ sessionId });

        assert.strictEqual(status.status, "ready");
        assert.strictEqual(models[0]?.name, "GPT-5.6");
        assert.strictEqual(sessionId, "session-1");
        assert.strictEqual(shaped[0]?.type, "shape_completed");
        assert.strictEqual(
          shaped[0]?.type === "shape_completed" ? shaped[0].document.name : "",
          "Focused Flect",
        );
        assert.strictEqual(
          diagnostic.message,
          "The protected launcher remains available.",
        );
      }).pipe(Effect.provide(handlers)),
  );

  it.effect("streams ordered prompt events through the shared RPC group", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(FlectRpcs);
      const events = yield* client
        .Prompt({ sessionId: "session-1", text: "Shape this" })
        .pipe(Stream.runCollect);

      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn_started", "text_delta", "turn_completed"],
      );
    }).pipe(Effect.provide(handlers)),
  );

  it.effect("rejects a deep shape document before transport decoding", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(FlectRpcs);
      const error = yield* Effect.flip(
        client
          .Shape({
            sessionId: "session-1",
            instruction: "Make this more focused",
            document: deeplyNestedDocument(2_000) as never,
          })
          .pipe(Stream.runDrain),
      );

      assert.strictEqual(error._tag, "InvalidInterfaceDocument");
    }).pipe(Effect.provide(handlers)),
  );
});
