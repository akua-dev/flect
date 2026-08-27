import { assert, describe, it, vi } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Result,
  Stream,
} from "effect";
import { BunCommandFailed, BunCommandResult } from "../../shared/bun-command";
import {
  AgentShellRequest,
  ExternalPiExtensionFailed,
  ExternalPiExtensionSelection,
  GuardianDiagnostic,
  InterfaceEditRequested,
  ModelSelection,
  ModelSummary,
  ProposalValidationFailed,
  RuntimeStatus,
  SessionSelection,
  ShapeCompleted,
  ToolExecutionCompleted,
  ToolExecutionStarted,
  ValidationIssue,
} from "../../shared/contracts";
import {
  AgentCommandSource,
  ControlCommandSource,
  UserCommandSource,
} from "../../shared/control";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import { RevisionId } from "../../shared/revisions";
import {
  SandboxedShell,
  type SandboxedShellShape,
} from "../shell/sandboxed-shell-service";
import {
  AgentWorkspace,
  AgentWorkspaceLive,
  type AgentWorkspaceShape,
  OperationContext,
} from "./agent-workspace";
import { FlectClient, type FlectClientShape } from "./api";
import {
  OperationJournal,
  OperationJournalLive,
  OperationQuery,
} from "./operation-journal";

const model = ModelSummary.make({
  provider: "openai-codex",
  id: "gpt-5.6",
  name: "GPT-5.6",
  reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
});

const userOperation = (index: number) =>
  OperationContext.make({
    operationId: `operation-agent-workspace-${index}`,
    commandId: `cmd-agent-workspace-${index}`,
    workspaceId: "workspace-agent-workspace",
    source: UserCommandSource.make({ kind: "user" }),
  });

const makeLayer = ({
  prompt,
  shape,
  cancel,
  execute,
}: {
  readonly prompt?: FlectClientShape["prompt"];
  readonly shape?: FlectClientShape["shape"];
  readonly cancel?: FlectClientShape["cancel"];
  readonly execute?: SandboxedShellShape["execute"];
} = {}) => {
  let sessionSequence = 0;
  const createSession = vi.fn((_selection: SessionSelection) =>
    Effect.succeed(`session-agent-workspace-${++sessionSequence}`),
  );
  const closeSession = vi.fn((_sessionId: string) => Effect.void);
  const cancelSession = vi.fn(cancel ?? (() => Effect.void));
  const shellExecute = vi.fn(
    execute ??
      (() =>
        Effect.succeed(
          BunCommandResult.make({
            version: 1,
            exitCode: 0,
            stdout: "42\n",
            stderr: "",
          }),
        )),
  );
  const client: FlectClientShape = {
    status: Effect.succeed(RuntimeStatus.make({ version: 1, status: "ready" })),
    models: Effect.succeed([model]),
    providerAuth: Effect.succeed([]),
    loginProvider: () => Stream.empty,
    replyProviderAuth: () => Effect.void,
    cancelProviderAuth: () => Effect.void,
    refreshProviderAuth: Effect.succeed([]),
    logoutProvider: () => Effect.succeed([]),
    createSession,
    closeSession,
    prompt: vi.fn(
      prompt ??
        (() =>
          Stream.make(
            { type: "turn_started" },
            { type: "text_delta", delta: "Done." },
            { type: "turn_completed" },
          )),
    ),
    shape: vi.fn(
      shape ??
        ((_sessionId, _instruction, document) =>
          Stream.succeed(
            ShapeCompleted.make({ type: "shape_completed", document }),
          )),
    ),
    cancel: cancelSession,
    completeShellRequest: vi.fn(() => Effect.void),
    diagnoseRecovery: vi.fn(() =>
      Effect.succeed(
        GuardianDiagnostic.make({
          version: 1,
          message: "The protected launcher remains available.",
        }),
      ),
    ),
  };
  const shell: SandboxedShellShape = {
    replaceTree: () => Effect.void,
    execute: shellExecute,
    stop: () => Effect.void,
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(FlectClient)(client),
    Layer.succeed(SandboxedShell)(shell),
    OperationJournalLive,
  );
  return {
    client,
    closeSession,
    createSession,
    cancelSession,
    shell,
    shellExecute,
    layer: AgentWorkspaceLive.pipe(Layer.provideMerge(dependencies)),
  };
};

const makeProposalBridge = (document: InterfaceDocument) => {
  let propose: AgentWorkspaceShape["proposeShaperInterface"] | undefined;
  return {
    connect: (workspace: AgentWorkspaceShape) => {
      propose = workspace.proposeShaperInterface;
    },
    execute: ((role, _line, options) =>
      Effect.gen(function* () {
        const submit = propose;
        if (submit === undefined || options?.agentContext === undefined) {
          return yield* Effect.fail(
            BunCommandFailed.make({
              reason: "execution",
              message: "The test Shaper proposal bridge is unavailable.",
            }),
          );
        }
        yield* submit(
          AgentCommandSource.make({
            kind: "agent",
            role: role === "previewApp" ? "app" : role,
            ...options.agentContext,
          }),
          document,
        ).pipe(
          Effect.mapError(() =>
            BunCommandFailed.make({
              reason: "execution",
              message: "The test proposal was rejected.",
            }),
          ),
        );
        return BunCommandResult.make({
          version: 1,
          exitCode: 0,
          stdout: "status: proposed\n",
          stderr: "",
        });
      })) satisfies SandboxedShellShape["execute"],
  };
};

const makeAppProposalBridge = (archive: Uint8Array, name: string) => {
  let propose: AgentWorkspaceShape["proposeShaperApp"] | undefined;
  return {
    connect: (workspace: AgentWorkspaceShape) => {
      propose = workspace.proposeShaperApp;
    },
    execute: ((role, _line, options) =>
      Effect.gen(function* () {
        const submit = propose;
        if (submit === undefined || options?.agentContext === undefined) {
          return yield* Effect.fail(
            BunCommandFailed.make({
              reason: "execution",
              message: "The test Shaper app bridge is unavailable.",
            }),
          );
        }
        yield* submit(
          AgentCommandSource.make({
            kind: "agent",
            role: role === "previewApp" ? "app" : role,
            ...options.agentContext,
          }),
          archive,
          name,
        ).pipe(
          Effect.mapError(() =>
            BunCommandFailed.make({
              reason: "execution",
              message: "The test app proposal was rejected.",
            }),
          ),
        );
        return BunCommandResult.make({
          version: 1,
          exitCode: 0,
          stdout: "status: proposed\n",
          stderr: "",
        });
      })) satisfies SandboxedShellShape["execute"],
  };
};

describe("AgentWorkspace", () => {
  it.effect(
    "returns a typed edit request without treating questions as Shape",
    () => {
      const { layer } = makeLayer({
        prompt: (_sessionId, text) =>
          text.includes("change")
            ? Stream.make(
                { type: "turn_started" },
                InterfaceEditRequested.make({
                  type: "interface_edit_requested",
                  requestId: "tool-edit-request-1",
                  instruction: "Make the primary action blue",
                }),
                { type: "turn_completed" },
              )
            : Stream.make(
                { type: "turn_started" },
                { type: "text_delta", delta: "It is visible." },
                { type: "turn_completed" },
              ),
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        const question = yield* workspace.submitAppPrompt(
          userOperation(55),
          "Can you see it?",
        );
        const change = yield* workspace.submitAppPrompt(
          userOperation(56),
          "Please change the action",
        );

        assert.strictEqual(question.editRequest, undefined);
        assert.strictEqual(
          change.editRequest?.instruction,
          "Make the primary action blue",
        );
        assert.strictEqual(
          change.editRequest?.requestId,
          "tool-edit-request-1",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "keeps a candidate-bound Preview App conversation in a separate session",
    () => {
      const { client, createSession, layer } = makeLayer();
      const candidate = InterfaceDocument.make({
        ...defaultInterfaceDocument,
        name: "Preview candidate",
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        yield* workspace.setExternalExtensions("app", true);
        yield* workspace.setExternalExtensions("shaper", true);
        yield* workspace.selectReasoning("high");
        yield* workspace.submitAppPrompt(userOperation(50), "Use accepted");
        yield* workspace.submitPreviewPrompt(
          userOperation(51),
          "Can you see the candidate?",
          candidate,
          RevisionId.make("revision-preview-1"),
        );
        yield* workspace.submitPreviewPrompt(
          userOperation(52),
          "What actions are available?",
          candidate,
          RevisionId.make("revision-preview-1"),
        );
        const snapshot = yield* workspace.snapshot;
        const promptCalls = vi.mocked(client.prompt).mock.calls;

        assert.strictEqual(createSession.mock.calls.length, 2);
        assert.strictEqual(
          createSession.mock.calls[0]?.[0].externalExtensions?.app,
          true,
        );
        assert.strictEqual(
          createSession.mock.calls[0]?.[0].externalExtensions?.shaper,
          true,
        );
        assert.strictEqual(
          createSession.mock.calls[1]?.[0].externalExtensions?.app,
          true,
        );
        assert.strictEqual(
          createSession.mock.calls[1]?.[0].externalExtensions?.shaper,
          false,
        );
        assert.deepStrictEqual(
          snapshot.app.messages.map((message) => message.content),
          ["Use accepted", "Done."],
        );
        assert.deepStrictEqual(
          snapshot.previewApp.messages.map((message) => message.content),
          [
            "Can you see the candidate?",
            "Done.",
            "What actions are available?",
            "Done.",
          ],
        );
        assert.notStrictEqual(promptCalls[0]?.[0], promptCalls[1]?.[0]);
        assert.include(String(promptCalls[1]?.[1]), "Preview candidate");
        assert.include(
          String(promptCalls[1]?.[1]),
          "Can you see the candidate?",
        );
        assert.notInclude(String(promptCalls[1]?.[1]), "Use accepted");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "executes candidate Bash in the isolated Preview App workspace",
    () => {
      const { client, layer, shellExecute } = makeLayer({
        prompt: () =>
          Stream.make(
            ToolExecutionStarted.make({
              type: "tool_execution_started",
              role: "app",
              callId: "shell-preview-app-1",
              toolName: "bash",
              startedAt: 1,
            }),
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-preview-app-1",
              command: "echo candidate > marker",
            }),
            ToolExecutionCompleted.make({
              type: "tool_execution_completed",
              role: "app",
              callId: "shell-preview-app-1",
              toolName: "bash",
              completedAt: 2,
              durationMs: 1,
              status: "succeeded",
            }),
            { type: "turn_completed" },
          ),
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        const journal = yield* OperationJournal;
        yield* workspace.refresh;
        const revisionId = RevisionId.make("revision-preview-shell-1");
        yield* workspace.submitPreviewPrompt(
          userOperation(57),
          "Exercise the candidate",
          defaultInterfaceDocument,
          revisionId,
        );

        assert.strictEqual(shellExecute.mock.calls[0]?.[0], "previewApp");
        assert.strictEqual(
          shellExecute.mock.calls[0]?.[2]?.agentContext?.binding,
          "candidate",
        );
        assert.strictEqual(
          vi.mocked(client.completeShellRequest).mock.calls[0]?.[1],
          "app",
        );
        const evidence = yield* journal.query(
          OperationQuery.make({ category: "tool", revisionId }),
        );
        assert.isAbove(evidence.length, 0);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "disposes candidate authority without clearing accepted history",
    () => {
      const { closeSession, layer } = makeLayer();
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        yield* workspace.submitAppPrompt(userOperation(53), "Accepted history");
        yield* workspace.submitPreviewPrompt(
          userOperation(54),
          "Candidate history",
          defaultInterfaceDocument,
          RevisionId.make("revision-preview-2"),
        );

        yield* workspace.releasePreview;
        const snapshot = yield* workspace.snapshot;

        assert.strictEqual(closeSession.mock.calls.length, 1);
        assert.deepStrictEqual(
          snapshot.app.messages.map((message) => message.content),
          ["Accepted history", "Done."],
        );
        assert.deepStrictEqual(snapshot.previewApp.messages, []);
        assert.strictEqual(snapshot.previewApp.status, "ready");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "isolates candidate overlap and cancellation from accepted App",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const { cancelSession, createSession, layer } = makeLayer({
          prompt: () =>
            Stream.make({ type: "turn_started" } as const).pipe(
              Stream.concat(
                Stream.fromEffect(Deferred.await(gate)).pipe(
                  Stream.map(() => ({ type: "turn_completed" }) as const),
                ),
              ),
            ),
        });
        yield* Effect.gen(function* () {
          const workspace = yield* AgentWorkspace;
          yield* workspace.refresh;
          const running = yield* workspace
            .submitPreviewPrompt(
              userOperation(58),
              "Run candidate work",
              defaultInterfaceDocument,
              RevisionId.make("revision-preview-cancel-1"),
            )
            .pipe(Effect.forkChild({ startImmediately: true }));
          for (let attempt = 0; attempt < 20; attempt += 1) {
            if ((yield* workspace.snapshot).previewApp.status === "streaming") {
              break;
            }
            yield* Effect.yieldNow;
          }

          const overlap = yield* workspace
            .submitPreviewPrompt(
              userOperation(59),
              "Overlap candidate work",
              defaultInterfaceDocument,
              RevisionId.make("revision-preview-cancel-1"),
            )
            .pipe(Effect.flip);
          assert.strictEqual(overlap._tag, "FlectUnavailableError");

          yield* workspace.cancelPreview;
          yield* Fiber.await(running);
          const snapshot = yield* workspace.snapshot;
          assert.strictEqual(snapshot.previewApp.status, "ready");
          assert.strictEqual(snapshot.app.status, "ready");
          assert.strictEqual(createSession.mock.calls.length, 1);
          assert.strictEqual(
            cancelSession.mock.calls[0]?.[0],
            "session-agent-workspace-1",
          );
          assert.strictEqual(cancelSession.mock.calls[0]?.[1], "app");
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("stays busy until the completed turn stream has closed", () => {
    const streamClosed = Deferred.makeUnsafe<void>();
    const { layer } = makeLayer({
      prompt: () =>
        Stream.make(
          { type: "turn_started" } as const,
          { type: "turn_completed" } as const,
        ).pipe(
          Stream.concat(
            Stream.fromEffect(Deferred.await(streamClosed)).pipe(
              Stream.map(() => ({ type: "turn_completed" }) as const),
            ),
          ),
        ),
    });

    return Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* workspace.refresh;
      const running = yield* workspace
        .submitAppPrompt(userOperation(60), "Wait for transport close")
        .pipe(Effect.forkChild({ startImmediately: true }));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((yield* workspace.snapshot).app.status === "streaming") break;
        yield* Effect.yieldNow;
      }

      assert.strictEqual((yield* workspace.snapshot).app.status, "streaming");
      yield* Deferred.succeed(streamClosed, undefined);
      yield* Fiber.join(running);
      assert.strictEqual((yield* workspace.snapshot).app.status, "ready");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "reuses one protected session across separate App and Shaper state",
    () => {
      const proposal = makeProposalBridge(defaultInterfaceDocument);
      const { client, createSession, layer } = makeLayer({
        shape: () =>
          Stream.make(
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-default-proposal",
              command: "flect interface propose /workspace/interface.json",
            }),
            ShapeCompleted.make({ type: "shape_completed" }),
          ),
        execute: proposal.execute,
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        proposal.connect(workspace);
        yield* workspace.refresh;
        yield* workspace.submitAppPrompt(userOperation(1), "Use the product");
        const outcome = yield* workspace.submitShaperInstruction(
          userOperation(2),
          "Change the interface\n\nProtected selection context: headline",
          defaultInterfaceDocument,
          "Change the interface",
        );
        const snapshot = yield* workspace.snapshot;

        assert.deepStrictEqual(outcome, {
          kind: "document",
          document: defaultInterfaceDocument,
        });
        assert.strictEqual(createSession.mock.calls.length, 1);
        assert.deepStrictEqual(
          snapshot.app.messages.map((message) => message.content),
          ["Use the product", "Done."],
        );
        assert.deepStrictEqual(
          snapshot.shaper.messages.map((message) => message.content),
          [
            "Change the interface",
            `Change complete: ${defaultInterfaceDocument.name}`,
          ],
        );
        assert.deepStrictEqual(
          snapshot.app.messages.map((message) => message.turnId),
          ["operation-agent-workspace-1", "operation-agent-workspace-1"],
        );
        assert.deepStrictEqual(
          snapshot.shaper.messages.map((message) => message.turnId),
          ["operation-agent-workspace-2", "operation-agent-workspace-2"],
        );
        assert.deepStrictEqual(
          snapshot.shaper.activities.map((activity) => activity.turnId),
          ["operation-agent-workspace-2"],
        );
        assert.include(
          String(vi.mocked(client.shape).mock.calls[0]?.[1]),
          "Protected selection context: headline",
        );
        assert.notInclude(
          snapshot.shaper.messages.map((message) => message.content).join("\n"),
          "Protected selection context",
        );
        assert.strictEqual(snapshot.app.status, "ready");
        assert.strictEqual(snapshot.shaper.status, "ready");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "replaces the session for model or extension selection changes",
    () => {
      const { closeSession, createSession, layer } = makeLayer();
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        yield* workspace.submitAppPrompt(userOperation(1), "First");
        yield* workspace.selectModel(
          ModelSelection.make({ provider: model.provider, id: model.id }),
        );
        yield* workspace.setExternalExtensions("shaper", true);
        yield* workspace.selectReasoning("high");
        yield* workspace.submitAppPrompt(userOperation(2), "Second");
        const snapshot = yield* workspace.snapshot;

        assert.strictEqual(closeSession.mock.calls.length, 1);
        assert.strictEqual(createSession.mock.calls.length, 2);
        assert.deepStrictEqual(
          createSession.mock.calls.at(-1)?.[0],
          SessionSelection.make({
            model: ModelSelection.make({
              provider: model.provider,
              id: model.id,
            }),
            externalExtensions: ExternalPiExtensionSelection.make({
              app: false,
              shaper: true,
            }),
            reasoningLevel: "high",
          }),
        );
        assert.strictEqual(snapshot.externalExtensions.shaper, true);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("does not replace a session for already-satisfied settings", () => {
    const { closeSession, createSession, layer } = makeLayer();
    return Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* workspace.refresh;
      yield* workspace.submitAppPrompt(userOperation(10), "First");
      yield* workspace.setExternalExtensions("shaper", false);
      yield* workspace.setModelFavorite(
        ModelSelection.make({ provider: model.provider, id: model.id }),
        false,
      );

      assert.strictEqual(createSession.mock.calls.length, 1);
      assert.strictEqual(closeSession.mock.calls.length, 0);
      assert.strictEqual((yield* workspace.snapshot).favoriteModels.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "keeps tool and validation activity visible without dropping the session",
    () => {
      const issues = [
        ValidationIssue.make({
          path: ["root", "children", 0, "style"],
          code: "required",
          message: "Required field is missing.",
        }),
      ];
      const proposal = makeProposalBridge(defaultInterfaceDocument);
      const { closeSession, createSession, layer, shellExecute } = makeLayer({
        shape: () =>
          Stream.make(
            ToolExecutionStarted.make({
              type: "tool_execution_started",
              role: "shaper",
              callId: "proposal-call-1",
              toolName: "bash",
              startedAt: 10,
              inputSummary: "Interface proposal",
            }),
            ProposalValidationFailed.make({
              type: "proposal_validation_failed",
              attempt: 1,
              issues,
            }),
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
              command: "bun test",
            }),
            ToolExecutionCompleted.make({
              type: "tool_execution_completed",
              role: "shaper",
              callId: "proposal-call-1",
              toolName: "bash",
              completedAt: 20,
              durationMs: 10,
              status: "succeeded",
              resultSummary: "Tool completed",
            }),
            ShapeCompleted.make({ type: "shape_completed" }),
          ),
        execute: proposal.execute,
      });
      const external = OperationContext.make({
        operationId: "operation-agent-workspace-external",
        commandId: "cmd-agent-workspace-external",
        workspaceId: "workspace-agent-workspace",
        source: ControlCommandSource.make({
          kind: "control",
          clientId: "client-agent-workspace",
          clientName: "Outside agent",
        }),
      });

      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        proposal.connect(workspace);
        yield* workspace.refresh;
        yield* workspace.submitShaperInstruction(
          external,
          "Fix the proposal",
          defaultInterfaceDocument,
        );
        const snapshot = yield* workspace.snapshot;

        assert.strictEqual(createSession.mock.calls.length, 1);
        assert.strictEqual(closeSession.mock.calls.length, 0);
        assert.strictEqual(shellExecute.mock.calls.length, 1);
        assert.strictEqual(snapshot.shaper.activities.length, 2);
        assert.strictEqual(snapshot.shaper.activities[0]?.toolName, "bash");
        assert.deepStrictEqual(
          snapshot.shaper.activities[1]?.validationIssues,
          issues,
        );
        assert.strictEqual(snapshot.shaper.messages[0]?.source.kind, "control");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("retries once and fails when Shaper submits no proposal", () => {
    const { client, layer } = makeLayer({
      shape: () =>
        Stream.succeed(ShapeCompleted.make({ type: "shape_completed" })),
    });
    return Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* workspace.refresh;
      const error = yield* workspace
        .submitShaperInstruction(
          userOperation(21),
          "Return prose only",
          defaultInterfaceDocument,
        )
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "FlectUnavailableError");
      assert.strictEqual(vi.mocked(client.shape).mock.calls.length, 2);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "latches the first Shaper Bash proposal and rejects duplicate authority",
    () => {
      const candidate = InterfaceDocument.make({
        ...defaultInterfaceDocument,
        name: "Focused workspace",
      });
      const conflictingCandidate = InterfaceDocument.make({
        ...candidate,
        name: "Conflicting workspace",
      });
      let propose: AgentWorkspaceShape["proposeShaperInterface"] | undefined;
      const completed = BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "status: proposed\n",
        stderr: "",
      });
      const { client, layer } = makeLayer({
        shape: () =>
          Stream.make(
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-shaper-proposal",
              command: "flect interface propose /workspace/interface.json",
            }),
            ShapeCompleted.make({ type: "shape_completed" }),
          ),
        execute: (role, _line, options) =>
          Effect.gen(function* () {
            if (propose === undefined || options?.agentContext === undefined) {
              return yield* Effect.fail(
                BunCommandFailed.make({
                  reason: "execution",
                  message: "The test Shaper proposal bridge is unavailable.",
                }),
              );
            }
            const source = AgentCommandSource.make({
              kind: "agent",
              role: role === "previewApp" ? "app" : role,
              ...options.agentContext,
            });
            const submit = (
              proposalSource: AgentCommandSource,
              document: InterfaceDocument,
            ) =>
              propose?.(proposalSource, document).pipe(
                Effect.mapError(() =>
                  BunCommandFailed.make({
                    reason: "execution",
                    message: "The test proposal was rejected.",
                  }),
                ),
              ) ??
              Effect.fail(
                BunCommandFailed.make({
                  reason: "execution",
                  message: "The test Shaper proposal bridge is unavailable.",
                }),
              );
            const first = yield* submit(source, candidate);
            const duplicate = yield* submit(source, candidate);
            const conflict = yield* Effect.result(
              submit(source, conflictingCandidate),
            );
            const appAttempt = yield* Effect.result(
              submit(
                AgentCommandSource.make({ ...source, role: "app" }),
                candidate,
              ),
            );

            assert.strictEqual(first.status, "proposed");
            assert.strictEqual(duplicate.status, "duplicate");
            assert.strictEqual(conflict._tag, "Failure");
            assert.strictEqual(appAttempt._tag, "Failure");
            return completed;
          }),
      });

      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        propose = workspace.proposeShaperInterface;
        yield* workspace.refresh;
        const shaped = yield* workspace.submitShaperInstruction(
          userOperation(20),
          "Make the workspace focused",
          defaultInterfaceDocument,
        );
        const afterTurn = yield* Effect.result(
          workspace.proposeShaperInterface(
            AgentCommandSource.make({
              kind: "agent",
              role: "shaper",
              sessionId: "session-agent-workspace-1",
              parentOperationId: userOperation(20).operationId,
              requestId: "shell-after-turn",
            }),
            candidate,
          ),
        );

        assert.deepStrictEqual(shaped, {
          kind: "document",
          document: candidate,
        });
        assert.strictEqual(vi.mocked(client.shape).mock.calls.length, 1);
        assert.strictEqual(afterTurn._tag, "Failure");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "confirms an authored app only when the controller concludes the turn",
    () => {
      const archive = new Uint8Array([1, 2, 3]);
      const bridge = makeAppProposalBridge(archive, "Driftwood Coffee");
      const { layer } = makeLayer({
        shape: () =>
          Stream.make(
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-app-proposal",
              command: "flect app propose /workspace/project",
            }),
            ShapeCompleted.make({ type: "shape_completed" }),
          ),
        execute: bridge.execute,
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        bridge.connect(workspace);
        yield* workspace.refresh;
        const outcome = yield* workspace.submitShaperInstruction(
          userOperation(30),
          "Make a landing page website",
          defaultInterfaceDocument,
        );
        const afterTurn = yield* workspace.snapshot;

        assert.deepStrictEqual(outcome, {
          kind: "app",
          archive,
          name: "Driftwood Coffee",
        });
        assert.deepStrictEqual(
          afterTurn.shaper.messages.map((message) => message.content),
          ["Make a landing page website"],
        );
        assert.strictEqual(afterTurn.shaper.status, "ready");

        yield* workspace.concludeShaperTurn(userOperation(30), {
          kind: "completed",
          name: "Driftwood Coffee",
        });
        const confirmed = yield* workspace.snapshot;

        assert.deepStrictEqual(
          confirmed.shaper.messages.map((message) => message.content),
          ["Make a landing page website", "Change complete: Driftwood Coffee"],
        );
        assert.deepStrictEqual(
          confirmed.shaper.messages.map((message) => message.turnId),
          ["operation-agent-workspace-30", "operation-agent-workspace-30"],
        );
        assert.strictEqual(confirmed.shaper.status, "ready");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "reports a bounded activation failure without any completion claim",
    () => {
      const archive = new Uint8Array([4, 5, 6]);
      const bridge = makeAppProposalBridge(archive, "Driftwood Coffee");
      const { layer } = makeLayer({
        shape: () =>
          Stream.make(
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-app-proposal-failure",
              command: "flect app propose /workspace/project",
            }),
            ShapeCompleted.make({ type: "shape_completed" }),
          ),
        execute: bridge.execute,
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        bridge.connect(workspace);
        yield* workspace.refresh;
        yield* workspace.submitShaperInstruction(
          userOperation(31),
          "Make a landing page website",
          defaultInterfaceDocument,
        );
        yield* workspace.concludeShaperTurn(userOperation(31), {
          kind: "failed",
          reason: "The authored project could not be checkpointed safely.",
        });
        const snapshot = yield* workspace.snapshot;

        assert.deepStrictEqual(
          snapshot.shaper.messages.map((message) => message.content),
          [
            "Make a landing page website",
            "The app could not be activated: The authored project could not be checkpointed safely. Your previous canvas is unchanged.",
          ],
        );
        assert.notInclude(
          snapshot.shaper.messages.map((message) => message.content).join("\n"),
          "Change complete",
        );
        assert.strictEqual(snapshot.shaper.status, "error");
        assert.strictEqual(
          snapshot.shaper.error,
          "The authored project could not be checkpointed safely.",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "cancels a running role through the runtime and its Effect fiber",
    () => {
      let interrupted = false;
      const { cancelSession, layer } = makeLayer({
        prompt: () =>
          Stream.never.pipe(
            Stream.ensuring(
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          ),
      });
      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        const running = yield* workspace
          .submitAppPrompt(userOperation(1), "Keep running")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        yield* workspace.cancel("app");
        const exit = yield* Fiber.await(running);
        const snapshot = yield* workspace.snapshot;

        assert.strictEqual(cancelSession.mock.calls.length, 1);
        assert.strictEqual(interrupted, true);
        assert.strictEqual(snapshot.app.status, "ready");
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.findError(exit.cause);
          assert.isTrue(Result.isSuccess(error));
          if (Result.isSuccess(error)) {
            assert.strictEqual(error.success._tag, "AgentTurnCancelled");
          }
        }
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "finishes a running shell activity when its role is cancelled",
    () => {
      const shellStarted = Deferred.makeUnsafe<void>();
      const callId = "tool-agent-workspace-cancelled";
      const { layer } = makeLayer({
        prompt: () =>
          Stream.make(
            { type: "turn_started" },
            ToolExecutionStarted.make({
              type: "tool_execution_started",
              role: "app",
              callId,
              toolName: "bash",
              startedAt: 10,
              inputSummary: "Browser sandbox command",
            }),
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-agent-workspace-cancelled",
              command: "sleep 30",
            }),
          ),
        execute: () =>
          Deferred.succeed(shellStarted, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
      });

      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        const running = yield* workspace
          .submitAppPrompt(userOperation(42), "Keep running")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(shellStarted);

        yield* workspace.cancel("app");
        yield* Fiber.await(running);

        const snapshot = yield* workspace.snapshot;
        const activity = snapshot.app.activities.find(
          (candidate) => candidate.callId === callId,
        );
        assert.strictEqual(snapshot.app.status, "ready");
        assert.strictEqual(activity?.phase, "failed");
        assert.strictEqual(activity?.exitCode, 130);
        assert.strictEqual(activity?.resultSummary, "Command cancelled");
        assert.include(activity?.output ?? "", "operation cancelled");
        assert.isNumber(activity?.completedAt);
        assert.isNumber(activity?.durationMs);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("acknowledges cancellation while stream cleanup drains", () => {
    const cleanupStarted = Deferred.makeUnsafe<void>();
    const cleanupGate = Deferred.makeUnsafe<void>();
    const { layer } = makeLayer({
      prompt: () =>
        Stream.never.pipe(
          Stream.ensuring(
            Deferred.succeed(cleanupStarted, undefined).pipe(
              Effect.andThen(Deferred.await(cleanupGate)),
            ),
          ),
        ),
    });

    return Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* workspace.refresh;
      const running = yield* workspace
        .submitAppPrompt(userOperation(41), "Keep running")
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;
      const cancelling = yield* workspace
        .cancel("app")
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(cleanupStarted);
      yield* Effect.yieldNow;

      assert.isDefined(cancelling.pollUnsafe());
      assert.strictEqual((yield* workspace.snapshot).app.status, "ready");

      yield* Deferred.succeed(cleanupGate, undefined);
      yield* Fiber.await(running);
    }).pipe(Effect.provide(layer));
  });

  it.effect("records the real sandbox exit status and bounded output", () => {
    const callId = "tool-agent-workspace-failure";
    const requestId = "shell-agent-workspace-failure";
    const { layer } = makeLayer({
      prompt: () =>
        Stream.make(
          { type: "turn_started" },
          ToolExecutionStarted.make({
            type: "tool_execution_started",
            role: "app",
            callId,
            toolName: "bash",
            startedAt: 10,
            inputSummary: "Browser sandbox command",
          }),
          AgentShellRequest.make({
            type: "shell_request",
            requestId,
            command: "flect interface propose /workspace/interface.json",
          }),
          ToolExecutionCompleted.make({
            type: "tool_execution_completed",
            role: "app",
            callId,
            toolName: "bash",
            completedAt: 20,
            durationMs: 10,
            status: "succeeded",
            resultSummary: "Tool completed",
          }),
          { type: "turn_completed" },
        ),
      execute: () =>
        Effect.succeed(
          BunCommandResult.make({
            version: 1,
            exitCode: 1,
            stdout: "",
            stderr: "flect: authenticated agent context unavailable\n",
          }),
        ),
    });

    return Effect.gen(function* () {
      const workspace = yield* AgentWorkspace;
      yield* workspace.refresh;
      yield* workspace.submitAppPrompt(userOperation(40), "Inspect the app");
      const snapshot = yield* workspace.snapshot;
      const activity = snapshot.app.activities.find(
        (candidate) => candidate.callId === callId,
      );
      const journal = yield* OperationJournal;
      const entries = yield* journal.query(
        OperationQuery.make({ operationId: "operation-agent-workspace-40" }),
      );

      assert.strictEqual(activity?.phase, "failed");
      assert.strictEqual(activity?.exitCode, 1);
      assert.include(activity?.output ?? "", "authenticated agent context");
      assert.strictEqual(activity?.resultSummary, "Command exited with code 1");
      assert.isTrue(
        entries.some(
          (entry) =>
            entry.toolCallId === callId &&
            entry.phase === "failed" &&
            entry.summary === "bash failed",
        ),
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "renders a bounded trusted-extension failure as transferable activity evidence",
    () => {
      const { layer } = makeLayer({
        prompt: () =>
          Stream.make(
            { type: "turn_started" },
            ExternalPiExtensionFailed.make({
              type: "external_extension_failed",
              role: "app",
              failureId: "extension-failure-agent-workspace",
              stage: "turn",
              message: "A trusted Pi extension failed.",
              recovery:
                "Disable trusted Pi extensions for this agent and retry.",
            }),
            { type: "turn_completed" },
          ),
      });

      return Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        yield* workspace.refresh;
        yield* workspace.submitAppPrompt(
          userOperation(41),
          "Exercise the trusted extension",
        );
        const snapshot = yield* workspace.snapshot;
        const activity = snapshot.app.activities.find(
          (candidate) =>
            candidate.callId === "extension-failure-agent-workspace",
        );
        const journal = yield* OperationJournal;
        const entries = yield* journal.query(
          OperationQuery.make({ operationId: "operation-agent-workspace-41" }),
        );

        assert.strictEqual(activity?.phase, "failed");
        assert.strictEqual(activity?.toolName, "Trusted Pi extension");
        assert.strictEqual(
          activity?.resultSummary,
          "A trusted Pi extension failed.",
        );
        assert.strictEqual(
          activity?.output,
          "Disable trusted Pi extensions for this agent and retry.",
        );
        assert.isTrue(
          entries.some(
            (entry) =>
              entry.toolCallId === "extension-failure-agent-workspace" &&
              entry.phase === "failed",
          ),
        );
        assert.notInclude(JSON.stringify({ snapshot, entries }), "/Users/");
        assert.notInclude(JSON.stringify({ snapshot, entries }), "stack");
      }).pipe(Effect.provide(layer));
    },
  );
});
