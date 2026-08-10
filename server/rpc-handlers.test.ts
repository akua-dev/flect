import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { BunCommandResult } from "../shared/bun-command";
import {
  AuthConnected,
  AuthStarted,
  GuardianDiagnostic,
  ModelSummary,
  ProviderAuthSummary,
  RuntimeStatus,
  SessionSelection,
  ShapeCompleted,
  TextDelta,
  TurnCompleted,
  TurnStarted,
} from "../shared/contracts";
import { ControlBrokerStatus } from "../shared/control-channel";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import { FlectRpcs } from "../shared/rpc";
import { AgentIntegrationStatus } from "../shared/setup";
import { AgentIntegration } from "../src/lib/agent-integration";
import { FlectControlBroker } from "./control-broker";
import { makeFlectRpcHandlers } from "./rpc-handlers";
import { FlectRuntime } from "./runtime";

const runtimeLayer = Layer.succeed(FlectRuntime)({
  status: Effect.succeed(RuntimeStatus.make({ version: 1, status: "ready" })),
  listModels: Effect.succeed([
    ModelSummary.make({
      provider: "openai-codex",
      id: "gpt-5.6",
      name: "GPT-5.6",
      reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
    }),
  ]),
  providerAuth: Effect.succeed([
    ProviderAuthSummary.make({
      version: 1,
      id: "openai-codex",
      name: "OpenAI Codex",
      status: "connected",
      sourceLabel: "Pi credential store",
      credentialType: "oauth",
      methods: [{ type: "oauth", label: "Sign in" }],
    }),
  ]),
  loginProvider: ({ providerId }) =>
    Stream.make(
      AuthStarted.make({
        type: "auth_started",
        loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        providerId,
      }),
      AuthConnected.make({
        type: "auth_connected",
        loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        providerId,
      }),
    ),
  replyProviderAuth: () => Effect.void,
  cancelProviderAuth: () => Effect.void,
  refreshProviderAuth: Effect.succeed([]),
  logoutProvider: () => Effect.succeed([]),
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

const controlLayer = Layer.succeed(FlectControlBroker)({
  status: Effect.succeed(
    ControlBrokerStatus.make({
      version: 1,
      enabled: false,
      connected: false,
      port: 43125,
      url: "http://127.0.0.1:43125",
    }),
  ),
  enable: () => Effect.die("unused"),
  disable: Effect.void,
  nextCommand: () => Effect.die("unused"),
  complete: () => Effect.void,
  publishSnapshot: () => Effect.void,
  publishEvent: () => Effect.void,
  submit: () => Effect.die("unused"),
  snapshot: Effect.die("unused"),
  eventsSince: () => Effect.succeed([]),
});

const integrationLayer = Layer.succeed(AgentIntegration)({
  status: (host) =>
    Effect.succeed(
      AgentIntegrationStatus.make({
        host,
        state: "absent",
        path: `/fixture/${host}`,
        changed: false,
      }),
    ),
  statusAll: Effect.succeed([
    AgentIntegrationStatus.make({
      host: "codex",
      state: "absent",
      path: "/fixture/codex",
      changed: false,
    }),
  ]),
  install: (host) =>
    Effect.succeed(
      AgentIntegrationStatus.make({
        host,
        state: "installed",
        path: `/fixture/${host}`,
        changed: true,
      }),
    ),
  remove: (host) =>
    Effect.succeed(
      AgentIntegrationStatus.make({
        host,
        state: "absent",
        path: `/fixture/${host}`,
        changed: true,
      }),
    ),
});

const handlers = makeFlectRpcHandlers().pipe(
  Layer.provide(Layer.mergeAll(runtimeLayer, controlLayer, integrationLayer)),
);

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
        const providers = yield* client.ListProviderAuth();
        const authEvents = yield* client
          .LoginProvider({ providerId: "openai-codex", method: "oauth" })
          .pipe(Stream.runCollect);
        yield* client.ReplyProviderAuthSelection({
          loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
          promptId: "prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
          optionId: "account-1",
        });
        yield* client.CancelProviderAuth({
          loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        });
        yield* client.RefreshProviderAuth();
        yield* client.LogoutProvider({ providerId: "openai-codex" });
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
        const integrations = yield* client.SetupAgentStatus();
        const installed = yield* client.SetupAgentInstall({ host: "codex" });
        yield* client.CloseSession({ sessionId });

        assert.strictEqual(status.status, "ready");
        assert.strictEqual(models[0]?.name, "GPT-5.6");
        assert.strictEqual(providers[0]?.status, "connected");
        assert.deepStrictEqual(
          authEvents.map((event) => event.type),
          ["auth_started", "auth_connected"],
        );
        assert.strictEqual(sessionId, "session-1");
        assert.strictEqual(shaped[0]?.type, "shape_completed");
        assert.strictEqual(
          shaped[0]?.type === "shape_completed" &&
            shaped[0].document !== undefined
            ? shaped[0].document.name
            : "",
          "Focused Flect",
        );
        assert.strictEqual(
          diagnostic.message,
          "The protected launcher remains available.",
        );
        assert.strictEqual(integrations[0]?.state, "absent");
        assert.strictEqual(installed.state, "installed");
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
