import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import {
  ModelSummary,
  RuntimeStatus,
  SessionSelection,
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
  prompt: () =>
    Stream.make(
      TurnStarted.make({ type: "turn_started" }),
      TextDelta.make({ type: "text_delta", delta: "Shaped" }),
      TurnCompleted.make({ type: "turn_completed" }),
    ),
  shape: () =>
    Effect.succeed(
      InterfaceDocument.make({
        ...defaultInterfaceDocument,
        name: "Focused Flect",
      }),
    ),
  cancel: () => Effect.void,
});

const handlers = makeFlectRpcHandlers().pipe(Layer.provide(runtimeLayer));

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
        const shaped = yield* client.Shape({
          sessionId,
          instruction: "Make this more focused",
          document: defaultInterfaceDocument,
        });
        yield* client.Cancel({ sessionId });

        assert.strictEqual(status.status, "ready");
        assert.strictEqual(models[0]?.name, "GPT-5.6");
        assert.strictEqual(sessionId, "session-1");
        assert.strictEqual(shaped.name, "Focused Flect");
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
});
