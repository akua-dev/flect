import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import {
  AgentCommandSource,
  ControlStateSnapshot,
  ControlUnauthorized,
  FlectCommandReceipt,
  FlectWorkspaceSnapshot,
  InvokeInterfaceAction,
  RailStateSnapshot,
  SubmitShaperInstruction,
} from "../../shared/control";
import { defaultInterfaceDocument } from "../../shared/interface-document";
import {
  InterfaceRevision,
  RevisionId,
  ShapingEvent,
  ShapingSnapshot,
} from "../../shared/revisions";
import {
  AgentPromptOutcome,
  AgentWorkspace,
  type AgentWorkspaceShape,
} from "../lib/agent-workspace";
import {
  FlectWorkspaceController,
  type FlectWorkspaceControllerShape,
} from "../lib/workspace-controller";
import {
  AgentCommandBridge,
  AgentCommandBridgeLive,
} from "./agent-command-bridge";
import { AgentCommandBus, AgentCommandBusLive } from "./agent-command-bus";

const builtIn = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("built-in"),
  status: "accepted",
  source: "built-in",
  document: defaultInterfaceDocument,
  createdAt: 0,
});

const snapshot = FlectWorkspaceSnapshot.make({
  version: 1,
  workspaceId: "workspace-agent-bridge",
  sequence: 4,
  phase: "ready",
  mode: "run",
  document: defaultInterfaceDocument,
  shaping: ShapingSnapshot.make({
    version: 1,
    active: builtIn,
    lastKnownGood: builtIn,
    safeMode: false,
    disabledExtensions: [],
    lastEvent: ShapingEvent.make({
      version: 1,
      sequence: 0,
      type: "initialized",
      revisionId: builtIn.id,
    }),
  }),
  agent: {
    models: [],
    favoriteModels: [],
    externalExtensions: { app: false, shaper: false },
    app: {
      role: "app",
      status: "ready",
      messages: [],
      activities: [],
      lastPrompt: "",
    },
    previewApp: {
      role: "app",
      status: "ready",
      messages: [],
      activities: [],
      lastPrompt: "",
    },
    shaper: {
      role: "shaper",
      status: "ready",
      messages: [],
      activities: [],
      lastPrompt: "",
    },
  },
  rail: RailStateSnapshot.make({ collapsed: false, width: 400 }),
  control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
  operations: [],
});

const source = (role: "app" | "shaper", requestId: string) =>
  AgentCommandSource.make({
    kind: "agent",
    role,
    sessionId: `session-${role}-bridge`,
    parentOperationId: `operation-${role}-parent`,
    requestId,
  });

const makeLayer = () => {
  const dispatch = vi.fn<FlectWorkspaceControllerShape["dispatch"]>(
    (envelope) =>
      envelope.command.type === "submit-shaper-instruction"
        ? Effect.fail(
            ControlUnauthorized.make({ message: "App Agent cannot shape." }),
          )
        : Effect.succeed(
            FlectCommandReceipt.make({
              version: 1,
              commandId: envelope.commandId,
              workspaceId: envelope.workspaceId,
              operationId: "operation-agent-child",
              sequence: 5,
              status: "completed",
            }),
          ),
  );
  const controller = Layer.succeed(FlectWorkspaceController)({
    snapshot: Effect.succeed(snapshot),
    changes: Stream.empty,
    events: Stream.empty,
    providerAuth: Effect.succeed({ providers: [] }),
    providerAuthChanges: Stream.empty,
    continuity: Effect.succeed({
      drafts: { acceptedUse: "", candidateUse: "", shape: "" },
      generation: 0,
      revisionSequence: 0,
    }),
    continuityChanges: Stream.empty,
    setDraft: () => Effect.void,
    exportContinuity: Effect.succeed("{}"),
    exportRepository: Effect.succeed(new Uint8Array([1])),
    readShareExport: () => Effect.succeed(new Uint8Array([1])),
    discardContinuity: Effect.void,
    retryContinuity: Effect.void,
    dispatch,
    connectClient: () => Effect.void,
    disconnectClient: () => Effect.void,
    selectReasoning: () => Effect.void,
    loginProvider: () => Effect.void,
    replyProviderAuth: () => Effect.void,
    cancelProviderAuth: () => Effect.void,
    refreshProviderAuth: Effect.void,
    logoutProvider: () => Effect.void,
  });
  const agent = Layer.succeed(AgentWorkspace)({
    snapshot: Effect.succeed(snapshot.agent),
    changes: Stream.empty,
    providerAuth: Effect.succeed({ providers: [] }),
    providerAuthChanges: Stream.empty,
    restoreContinuity: () => Effect.void,
    refresh: Effect.void,
    selectModel: () => Effect.void,
    selectReasoning: () => Effect.void,
    loginProvider: () => Effect.void,
    replyProviderAuth: () => Effect.void,
    cancelProviderAuth: () => Effect.void,
    refreshProviderAuth: Effect.void,
    logoutProvider: () => Effect.void,
    setModelFavorite: () => Effect.void,
    setExternalExtensions: () => Effect.void,
    proposeShaperInterface: (_source, document) =>
      Effect.succeed({ status: "proposed", document }),
    proposeShaperApp: (_source, _archive, name) =>
      Effect.succeed({ status: "proposed", name }),
    submitAppPrompt: () => Effect.succeed(AgentPromptOutcome.make({})),
    submitPreviewPrompt: () => Effect.succeed(AgentPromptOutcome.make({})),
    submitShaperInstruction: (_operation, _instruction, document) =>
      Effect.succeed({ kind: "document", document }),
    cancel: () => Effect.void,
    cancelPreview: Effect.void,
    releasePreview: Effect.void,
    diagnoseRecovery: () =>
      Effect.succeed({ version: 1, message: "Recovery available." }),
    close: Effect.void,
  } satisfies AgentWorkspaceShape);
  const dependencies = Layer.mergeAll(AgentCommandBusLive, controller, agent);
  return {
    dispatch,
    layer: AgentCommandBridgeLive.pipe(Layer.provideMerge(dependencies)),
  };
};

describe("AgentCommandBridge", () => {
  it.effect("serves inspect and logs directly from the controller", () => {
    const { dispatch, layer } = makeLayer();
    return Effect.gen(function* () {
      yield* AgentCommandBridge;
      const bus = yield* AgentCommandBus;
      const inspected = yield* bus.submit(source("app", "tool-inspect"), {
        type: "inspect",
      });
      const logs = yield* bus.submit(source("shaper", "tool-logs"), {
        type: "logs",
      });
      assert.strictEqual(inspected.type, "inspect");
      assert.strictEqual(logs.type, "logs");
      assert.strictEqual(dispatch.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "dispatches with the captured agent source and exact response",
    () => {
      const { dispatch, layer } = makeLayer();
      return Effect.gen(function* () {
        yield* AgentCommandBridge;
        const bus = yield* AgentCommandBus;
        const app = source("app", "tool-action");
        const result = yield* bus.submit(app, {
          type: "command",
          command: InvokeInterfaceAction.make({
            type: "invoke-interface-action",
            nodeId: "primary-action",
          }),
        });
        assert.strictEqual(result.type, "command");
        const envelope = dispatch.mock.calls[0]?.[0];
        assert.strictEqual(envelope?.source.kind, "agent");
        assert.strictEqual(
          envelope?.source.kind === "agent" ? envelope.source.requestId : "",
          "tool-action",
        );
        assert.strictEqual(
          envelope?.source.kind === "agent"
            ? envelope.source.parentOperationId
            : "",
          "operation-app-parent",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "returns the controller's authorization failure to the caller",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        yield* AgentCommandBridge;
        const bus = yield* AgentCommandBus;
        const error = yield* bus
          .submit(source("app", "tool-forbidden"), {
            type: "command",
            command: SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: "Bypass role policy",
            }),
          })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "ControlUnauthorized");
        assert.strictEqual(error.message, "App Agent cannot shape.");
      }).pipe(Effect.provide(layer));
    },
  );
});
