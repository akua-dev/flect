import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  HashMap,
  Layer,
  Option,
  Queue,
  Ref,
  Stream,
} from "effect";
import type { BunCommandResult } from "../shared/bun-command";
import {
  AgentShellRequest,
  ExternalPiExtensionFailed,
  type FlectEvent,
  type FlectRuntimeError,
  GuardianDiagnostic,
  type InteractiveAgentRole,
  InterfaceEditRequested,
  ModelSummary,
  NoModelAvailable,
  PiOperationFailed,
  type ReasoningLevel,
  type RecoveryReason,
  RuntimeStatus,
  SessionBusy,
  SessionNotFound,
  type SessionSelection,
  ShapeCompleted,
  type ShapeEvent,
  TextDelta,
  ToolExecutionCompleted,
  ToolExecutionStarted,
  ToolExecutionUpdated,
  TurnCancelled,
  TurnCompleted,
  TurnError,
  TurnStarted,
} from "../shared/contracts";
import {
  type InterfaceDocument,
  validateInterfaceDocument,
} from "../shared/interface-document";
import { PiModelRuntime } from "./pi-model-runtime";
import { makePiShellBridge } from "./pi-shell-bridge";
import { makePiWorkbenchBridge } from "./pi-workbench-bridge";
import { ProviderAuthentication } from "./provider-authentication";
import { FlectRuntime } from "./runtime";

export type PiSessionPolicy = {
  readonly role: "guardian" | "app" | "shaper";
  readonly tools: "none" | "sandbox-bash";
  readonly storage: "memory";
  readonly extensions: "disabled" | "enabled";
  readonly userResources: "disabled";
};

export type PiEvent =
  | {
      readonly type: "text_delta";
      readonly delta: string;
    }
  | {
      readonly type: "shell_request";
      readonly requestId: string;
      readonly command: string;
    }
  | {
      readonly type: "interface_edit_requested";
      readonly requestId: string;
      readonly instruction: string;
    }
  | {
      readonly type: "tool_execution_started";
      readonly callId: string;
      readonly toolName: string;
      readonly startedAt: number;
      readonly inputSummary?: string;
    }
  | {
      readonly type: "tool_execution_updated";
      readonly callId: string;
      readonly toolName: string;
      readonly updatedAt: number;
      readonly output?: string;
    }
  | {
      readonly type: "tool_execution_completed";
      readonly callId: string;
      readonly toolName: string;
      readonly completedAt: number;
      readonly durationMs: number;
      readonly status: "succeeded" | "failed";
      readonly resultSummary?: string;
      readonly output?: string;
      readonly exitCode?: number;
      readonly previewUrl?: string;
    }
  | {
      readonly type: "external_extension_failed";
      readonly role: InteractiveAgentRole;
      readonly failureId: string;
      readonly stage: "load" | "turn";
      readonly message: "A trusted Pi extension failed.";
      readonly recovery: "Disable trusted Pi extensions for this agent and retry.";
    };

export interface PiSession {
  readonly sessionId: string;
  readonly subscribe: (
    listener: (event: PiEvent) => void,
  ) => Effect.Effect<() => void>;
  readonly prompt: (text: string) => Effect.Effect<void, PiOperationFailed>;
  readonly completeShellRequest: (
    requestId: string,
    result: BunCommandResult,
  ) => Effect.Effect<void, PiOperationFailed>;
  readonly abort: () => Effect.Effect<void, PiOperationFailed>;
  readonly dispose: Effect.Effect<void>;
}

export interface PiAgentSet {
  readonly guardian: PiSession;
  readonly app: PiSession;
  readonly shaper: PiSession;
}

type PiAgentPolicies = {
  readonly guardian: PiSessionPolicy;
  readonly app: PiSessionPolicy;
  readonly shaper: PiSessionPolicy;
};

export const acquireProtectedAgentSet = Effect.fn(
  "Flect.PiSdk.acquireProtectedAgentSet",
)(function* (
  policies: PiAgentPolicies,
  createProtectedSession: (
    policy: PiSessionPolicy,
  ) => Effect.Effect<PiSession, PiOperationFailed>,
) {
  const guardian = yield* createProtectedSession(policies.guardian);
  const app = yield* createProtectedSession(policies.app).pipe(
    Effect.tapError(() => guardian.dispose),
    Effect.onInterrupt(() => guardian.dispose),
  );
  const disposeEarlierSessions = Effect.all([app.dispose, guardian.dispose], {
    concurrency: "unbounded",
    discard: true,
  });
  const shaper = yield* createProtectedSession(policies.shaper).pipe(
    Effect.tapError(() => disposeEarlierSessions),
    Effect.onInterrupt(() => disposeEarlierSessions),
  );

  return {
    guardian,
    app,
    shaper,
  } satisfies PiAgentSet;
});

export interface PiSdkShape {
  readonly listModels: Effect.Effect<
    ReadonlyArray<ModelSummary>,
    PiOperationFailed
  >;
  readonly createAgentSet: (
    model: ModelSummary,
    reasoningLevel: ReasoningLevel | undefined,
    policies: {
      readonly guardian: PiSessionPolicy;
      readonly app: PiSessionPolicy;
      readonly shaper: PiSessionPolicy;
    },
  ) => Effect.Effect<PiAgentSet, PiOperationFailed | NoModelAvailable>;
}

export class PiSdk extends Context.Service<PiSdk, PiSdkShape>()(
  "flect/server/PiSdk",
) {}

const protectedAgentPolicies = (selection: SessionSelection) => {
  const extensions = selection.externalExtensions ?? {
    app: false,
    shaper: false,
  };

  return Object.freeze({
    guardian: Object.freeze({
      role: "guardian",
      tools: "none",
      storage: "memory",
      extensions: "disabled",
      userResources: "disabled",
    } satisfies PiSessionPolicy),
    app: Object.freeze({
      role: "app",
      tools: "sandbox-bash",
      storage: "memory",
      extensions: extensions.app ? "enabled" : "disabled",
      userResources: "disabled",
    } satisfies PiSessionPolicy),
    shaper: Object.freeze({
      role: "shaper",
      tools: "sandbox-bash",
      storage: "memory",
      extensions: extensions.shaper ? "enabled" : "disabled",
      userResources: "disabled",
    } satisfies PiSessionPolicy),
  });
};

const guardianSystemPrompt =
  "You are Flect Guardian, the protected recovery agent. You may reason about typed validation summaries and request deterministic recovery actions only. You cannot load user resources, modify the revision journal, execute extensions, or use shell, filesystem, browser, network, or process tools.";

const appSystemPrompt =
  "You are Flect App Agent, the user-facing agent inside the current product experience. Help the user operate the product through its exposed interface and API capabilities. You may use the bash tool only inside Flect's disposable App workspace. It cannot access Shaper source, the host filesystem, credentials, the parent UI, the canonical workspace, or ambient network. You cannot reshape or activate revisions, modify Guardian or safe mode, or load user resources. When and only when the user clearly asks to change the interface, request a visible handoff through request_interface_edit; questions and ordinary product actions stay in this session.";

const shaperSystemPrompt =
  "You are Flect Shaper, the user-facing interface agent. Help the user describe and shape schema-defined interfaces. You may use the bash tool only inside Flect's disposable browser workspace. It cannot access the host filesystem, credentials, parent UI, canonical workspace, or ambient network; the reserved compatible bun command provides bounded run, build, package, preview, and stop operations. You cannot activate revisions, modify Guardian or safe mode, or load user resources.";

const systemPrompt = (policy: PiSessionPolicy) => {
  const extensionBoundary =
    policy.extensions === "enabled"
      ? "The user explicitly enabled Pi's configured external extensions for this role; those extensions are trusted local code and remain outside the protected Guardian domain."
      : "You cannot load user resources or external extensions.";

  return `${
    policy.role === "guardian"
      ? guardianSystemPrompt
      : policy.role === "app"
        ? appSystemPrompt
        : shaperSystemPrompt
  } ${extensionBoundary}`;
};

const piFailure = (operation: PiOperationFailed["operation"]) =>
  new PiOperationFailed({
    operation,
    message: "The model runtime could not complete the request.",
  });

const toolInputSummary = (toolName: string) => {
  if (toolName === "bash") {
    return "Browser sandbox command";
  }
  return "Extension tool";
};

const publicToolEvent = (
  role: InteractiveAgentRole,
  event: Extract<
    PiEvent,
    {
      readonly type:
        | "tool_execution_started"
        | "tool_execution_updated"
        | "tool_execution_completed";
    }
  >,
): ToolExecutionStarted | ToolExecutionUpdated | ToolExecutionCompleted => {
  switch (event.type) {
    case "tool_execution_started":
      return new ToolExecutionStarted({
        type: event.type,
        role,
        callId: event.callId,
        toolName: event.toolName,
        startedAt: event.startedAt,
        ...(event.inputSummary === undefined
          ? {}
          : { inputSummary: event.inputSummary }),
      });
    case "tool_execution_updated":
      return new ToolExecutionUpdated({
        type: event.type,
        role,
        callId: event.callId,
        toolName: event.toolName,
        updatedAt: event.updatedAt,
        ...(event.output === undefined ? {} : { output: event.output }),
      });
    case "tool_execution_completed":
      return new ToolExecutionCompleted({
        type: event.type,
        role,
        callId: event.callId,
        toolName: event.toolName,
        completedAt: event.completedAt,
        durationMs: event.durationMs,
        status: event.status,
        ...(event.resultSummary === undefined
          ? {}
          : { resultSummary: event.resultSummary }),
        ...(event.output === undefined ? {} : { output: event.output }),
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
        ...(event.previewUrl === undefined
          ? {}
          : { previewUrl: event.previewUrl }),
      });
  }
};

const publicExtensionFailure = (
  role: InteractiveAgentRole,
  event: Extract<PiEvent, { readonly type: "external_extension_failed" }>,
) =>
  ExternalPiExtensionFailed.make({
    type: "external_extension_failed",
    role,
    failureId: event.failureId,
    stage: event.stage,
    message: "A trusted Pi extension failed.",
    recovery: "Disable trusted Pi extensions for this agent and retry.",
  });

export const PiSdkLive = Layer.effect(
  PiSdk,
  Effect.gen(function* () {
    const modelRuntime = yield* PiModelRuntime;

    const availableModels = Effect.fn("Flect.PiSdk.availableModels")(() =>
      Effect.tryPromise({
        try: () => modelRuntime.getAvailable(),
        catch: () => piFailure("list_models"),
      }),
    );

    const listModels = availableModels().pipe(
      Effect.map((models) =>
        models.map(
          (model) =>
            new ModelSummary({
              provider: model.provider,
              id: model.id,
              name: model.name,
              reasoningLevels: getSupportedThinkingLevels(model),
            }),
        ),
      ),
    );

    const createAgentSet = Effect.fn("Flect.PiSdk.createAgentSet")(function* (
      model: ModelSummary,
      reasoningLevel: ReasoningLevel | undefined,
      policies: {
        readonly guardian: PiSessionPolicy;
        readonly app: PiSessionPolicy;
        readonly shaper: PiSessionPolicy;
      },
    ) {
      const models = yield* availableModels();
      const selected = models.find(
        (candidate) =>
          candidate.provider === model.provider && candidate.id === model.id,
      );

      if (!selected) {
        return yield* Effect.fail(
          new NoModelAvailable({
            message: "No authenticated model is available.",
          }),
        );
      }

      const createProtectedSession = Effect.fn(
        "Flect.PiSdk.createProtectedSession",
      )(function* (policy: PiSessionPolicy) {
        const configuredSettings =
          policy.extensions === "enabled"
            ? SettingsManager.create(process.cwd(), getAgentDir(), {
                projectTrusted: false,
              })
            : undefined;
        const settingsManager = SettingsManager.inMemory(
          configuredSettings === undefined
            ? {}
            : {
                packages: configuredSettings.getPackages(),
                extensions: configuredSettings.getExtensionPaths(),
              },
        );
        const sessionManager = SessionManager.inMemory();
        const listeners = new Set<(event: PiEvent) => void>();
        const emit = (event: PiEvent) => {
          for (const listener of listeners) {
            listener(event);
          }
        };
        const shellBridge = yield* makePiShellBridge((event) => {
          emit(event);
        });
        const workbenchBridge = makePiWorkbenchBridge((event) => {
          emit(event);
        });
        const resourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: getAgentDir(),
          settingsManager,
          noExtensions: policy.extensions === "disabled",
          noSkills: policy.userResources === "disabled",
          noPromptTemplates: policy.userResources === "disabled",
          noThemes: policy.userResources === "disabled",
          noContextFiles: policy.userResources === "disabled",
          systemPrompt: systemPrompt(policy),
        });

        yield* Effect.tryPromise({
          try: () => resourceLoader.reload(),
          catch: () => piFailure("create_session"),
        });

        const extensionRole =
          policy.role === "guardian" ? undefined : policy.role;
        const makeExtensionFailure = (
          stage: "load" | "turn",
        ): Extract<
          PiEvent,
          { readonly type: "external_extension_failed" }
        > => ({
          type: "external_extension_failed",
          role: extensionRole ?? "app",
          failureId: `extension-failure-${crypto.randomUUID()}`,
          stage,
          message: "A trusted Pi extension failed.",
          recovery: "Disable trusted Pi extensions for this agent and retry.",
        });
        let pendingLoadFailure =
          extensionRole !== undefined &&
          policy.extensions === "enabled" &&
          resourceLoader.getExtensions().errors.length > 0
            ? makeExtensionFailure("load")
            : undefined;

        const result = yield* Effect.tryPromise({
          try: () =>
            createAgentSession({
              modelRuntime,
              model: selected,
              ...(reasoningLevel === undefined
                ? {}
                : { thinkingLevel: reasoningLevel }),
              ...(policy.tools === "none"
                ? { noTools: "all" }
                : {
                    noTools: "builtin",
                    tools:
                      policy.role === "app"
                        ? ["bash", "request_interface_edit"]
                        : ["bash"],
                    customTools:
                      policy.role === "app"
                        ? [shellBridge.tool, workbenchBridge.tool]
                        : [shellBridge.tool],
                  }),
              sessionManager,
              settingsManager,
              resourceLoader,
            }),
          catch: () => piFailure("create_session"),
        });

        const unsubscribeFromExtensionErrors =
          extensionRole === undefined || policy.extensions === "disabled"
            ? () => undefined
            : result.session.extensionRunner.onError(() => {
                emit(makeExtensionFailure("turn"));
              });

        let observedTextDelta = false;
        const toolStartedAt = new Map<string, number>();
        const unsubscribeFromPi = result.session.subscribe((event) => {
          switch (event.type) {
            case "message_update":
              if (event.assistantMessageEvent.type === "text_delta") {
                observedTextDelta = true;
                const delta = {
                  type: "text_delta",
                  delta: event.assistantMessageEvent.delta,
                } satisfies PiEvent;
                emit(delta);
              }
              break;
            case "tool_execution_start": {
              const startedAt = Date.now();
              toolStartedAt.set(event.toolCallId, startedAt);
              emit({
                type: "tool_execution_started",
                callId: event.toolCallId,
                toolName: event.toolName,
                startedAt,
                inputSummary: toolInputSummary(event.toolName),
              });
              break;
            }
            case "tool_execution_update":
              emit({
                type: "tool_execution_updated",
                callId: event.toolCallId,
                toolName: event.toolName,
                updatedAt: Date.now(),
              });
              break;
            case "tool_execution_end": {
              const completedAt = Date.now();
              const startedAt =
                toolStartedAt.get(event.toolCallId) ?? completedAt;
              toolStartedAt.delete(event.toolCallId);
              emit({
                type: "tool_execution_completed",
                callId: event.toolCallId,
                toolName: event.toolName,
                completedAt,
                durationMs: Math.max(0, completedAt - startedAt),
                status: event.isError ? "failed" : "succeeded",
                resultSummary: event.isError ? "Tool failed" : "Tool completed",
              });
              break;
            }
          }
        });

        return {
          sessionId: result.session.sessionId,
          subscribe: (listener: (event: PiEvent) => void) =>
            Effect.sync(() => {
              listeners.add(listener);
              if (pendingLoadFailure !== undefined) {
                listener(pendingLoadFailure);
                pendingLoadFailure = undefined;
              }
              return () => {
                listeners.delete(listener);
              };
            }),
          prompt: Effect.fn("Flect.PiSession.prompt")(function* (text: string) {
            observedTextDelta = false;
            const previousMessageCount = result.session.messages.length;
            yield* Effect.tryPromise({
              try: () => result.session.prompt(text),
              catch: () => piFailure("prompt"),
            });

            const assistant = result.session.messages
              .slice(previousMessageCount)
              .reverse()
              .find((message) => message.role === "assistant");
            if (assistant === undefined || assistant.stopReason === "error") {
              return yield* Effect.fail(piFailure("prompt"));
            }

            if (
              !observedTextDelta &&
              result.session.messages.length > previousMessageCount
            ) {
              const text = result.session.getLastAssistantText();
              if (text) {
                const fallback = {
                  type: "text_delta",
                  delta: text,
                } satisfies PiEvent;
                emit(fallback);
              }
            }
          }),
          completeShellRequest: Effect.fn(
            "Flect.PiSession.completeShellRequest",
          )((requestId: string, shellResult: BunCommandResult) =>
            shellBridge.complete(requestId, shellResult),
          ),
          abort: Effect.fn("Flect.PiSession.abort")(function* () {
            yield* shellBridge.cancel;
            yield* Effect.try({
              // AgentSession.abort() waits for idle. Flect's operation
              // controller owns that wait; trigger Pi's public immediate
              // abort here so cancellation cannot deadlock on itself.
              try: () => {
                result.session.abortRetry();
                result.session.agent.abort();
              },
              catch: () => piFailure("cancel"),
            });
          }),
          dispose: shellBridge.close.pipe(
            Effect.andThen(
              Effect.sync(() => {
                unsubscribeFromExtensionErrors();
                unsubscribeFromPi();
                listeners.clear();
                result.session.dispose();
              }),
            ),
            Effect.andThen(
              Effect.tryPromise({
                try: () => settingsManager.flush(),
                catch: () => undefined,
              }).pipe(Effect.catch(() => Effect.void)),
            ),
          ),
        } satisfies PiSession;
      });

      return yield* acquireProtectedAgentSet(policies, createProtectedSession);
    });

    return {
      listModels,
      createAgentSet,
    };
  }),
);

type OperationKind = "prompt" | "shape" | "diagnose";

type ActiveOperation = {
  readonly kind: OperationKind;
  readonly interrupt: Effect.Effect<void, PiOperationFailed>;
  readonly done: Deferred.Deferred<void>;
  fiber: Fiber.Fiber<unknown, unknown> | undefined;
};

type OperationState = {
  readonly closed: boolean;
  readonly active: ActiveOperation | undefined;
  readonly cancelling: ActiveOperation | undefined;
};

type OperationController = {
  readonly start: (
    operation: ActiveOperation,
  ) => Effect.Effect<void, SessionBusy | SessionNotFound>;
  readonly finish: (operation: ActiveOperation) => Effect.Effect<void>;
  readonly cancelActive: () => Effect.Effect<void, PiOperationFailed>;
  readonly interruptActive: Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
};

const makeOperationController = Effect.fn(
  "Flect.Runtime.makeOperationController",
)(function* (
  sessionId: string,
  abort: () => Effect.Effect<void, PiOperationFailed>,
) {
  const state = yield* Ref.make<OperationState>({
    closed: false,
    active: undefined,
    cancelling: undefined,
  });

  const start = Effect.fn("Flect.Runtime.startOperation")(function* (
    operation: ActiveOperation,
  ) {
    const result = yield* Ref.modify(state, (current) => {
      const outcome = current.closed
        ? "closed"
        : current.active === undefined
          ? "started"
          : "busy";
      const next =
        outcome === "started" ? { ...current, active: operation } : current;
      return [outcome, next] satisfies readonly [
        "started" | "busy" | "closed",
        OperationState,
      ];
    });

    if (result === "busy") {
      return yield* Effect.fail(
        new SessionBusy({
          sessionId,
          message: "The session is busy.",
        }),
      );
    }
    if (result === "closed") {
      return yield* Effect.fail(
        new SessionNotFound({
          sessionId,
          message: "Session not found.",
        }),
      );
    }
  });

  const finish = Effect.fn("Flect.Runtime.finishOperation")(function* (
    operation: ActiveOperation,
  ) {
    yield* Ref.update(state, (current) =>
      current.active === operation
        ? current.cancelling === operation
          ? current
          : { ...current, active: undefined }
        : current,
    );
    yield* Deferred.succeed(operation.done, undefined);
  });

  const cancelActive = Effect.fn("Flect.Runtime.cancelActiveOperation")(() =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const operation = yield* Ref.modify(state, (current) => {
          if (
            current.active === undefined ||
            current.cancelling !== undefined
          ) {
            return [undefined, current] satisfies readonly [
              undefined,
              OperationState,
            ];
          }
          return [
            current.active,
            { ...current, cancelling: current.active },
          ] satisfies readonly [ActiveOperation, OperationState];
        });
        if (operation === undefined) {
          return;
        }

        const releaseClaim = Deferred.poll(operation.done).pipe(
          Effect.flatMap((settled) =>
            Ref.update(state, (current) =>
              current.cancelling === operation
                ? {
                    ...current,
                    active: Option.isSome(settled) ? undefined : current.active,
                    cancelling: undefined,
                  }
                : current,
            ),
          ),
        );

        const interruptResult = yield* restore(
          Effect.result(operation.interrupt),
        );
        if (interruptResult._tag === "Failure") {
          yield* releaseClaim;
          return yield* Effect.fail(interruptResult.failure);
        }
        yield* Deferred.await(operation.done).pipe(
          Effect.ensuring(releaseClaim),
          Effect.forkDetach,
        );
      }),
    ),
  );

  const close = Effect.fn("Flect.Runtime.closeOperationController")(
    function* () {
      const active = yield* Ref.modify(
        state,
        (current) =>
          [
            current.active,
            current.closed ? current : { ...current, closed: true },
          ] satisfies readonly [ActiveOperation | undefined, OperationState],
      );

      if (active !== undefined) {
        yield* active.interrupt.pipe(Effect.catch(() => Effect.void));
        yield* Deferred.await(active.done);
      } else {
        yield* Effect.suspend(abort).pipe(Effect.catch(() => Effect.void));
      }
    },
  );

  const interruptActive = Effect.fn("Flect.Runtime.interruptActiveOperation")(
    function* () {
      const active = yield* Ref.get(state);
      if (active.active?.fiber !== undefined) {
        yield* Fiber.interrupt(active.active.fiber).pipe(Effect.asVoid);
      }
    },
  );

  return {
    start,
    finish,
    cancelActive,
    interruptActive: interruptActive(),
    close: close(),
  } satisfies OperationController;
});

const executeOperation = <A, E>(
  controller: OperationController,
  operation: ActiveOperation,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | SessionBusy | SessionNotFound> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* controller.start(operation);
      const fiber = yield* effect
        .pipe(Effect.ensuring(controller.finish(operation)))
        .pipe(Effect.forkDetach);
      operation.fiber = fiber;
      return yield* restore(Fiber.join(fiber)).pipe(
        Effect.onInterrupt(() =>
          operation.interrupt.pipe(Effect.catch(() => Effect.void)),
        ),
      );
    }),
  );

type SessionRecord = {
  readonly sessionId: string;
  readonly app: PiSession;
  readonly shaper: PiSession;
  readonly guardian: PiSession;
  readonly appOperation: OperationController;
  readonly shaperOperation: OperationController;
  readonly guardianOperation: OperationController;
  readonly sequence: number;
};

const PUBLIC_TURN_ERROR = "The model could not complete this turn.";
const MAX_SHAPER_RESPONSE_BYTES = 256 * 1024;
const MAX_GUARDIAN_RESPONSE_BYTES = 16 * 1024;
const MAX_ACTIVE_SESSIONS = 32;
const SESSION_DISPOSAL_TIMEOUT = "2 seconds";

const makeBoundedResponse = (
  limit: number,
  abort: () => Effect.Effect<void, PiOperationFailed>,
) => {
  const encoder = new TextEncoder();
  const chunks: Array<string> = [];
  let byteLength = 0;
  let exceeded = false;

  const append = (delta: string) => {
    if (exceeded) {
      return;
    }
    const nextByteLength = byteLength + encoder.encode(delta).byteLength;
    if (nextByteLength > limit) {
      exceeded = true;
      Effect.runFork(abort().pipe(Effect.catch(() => Effect.void)));
      return;
    }
    byteLength = nextByteLength;
    chunks.push(delta);
  };

  return {
    append,
    isExceeded: () => exceeded,
    text: () => chunks.join(""),
  };
};

const shapePrompt = (
  instruction: string,
  document: InterfaceDocument,
) => `Propose a revised Flect interface document using only Bash.

Run \`flect interface schema\`, write the candidate to
\`/workspace/interface.json\`, run
\`flect interface validate /workspace/interface.json\`, then run
\`flect interface propose /workspace/interface.json\` exactly once as your
final action. Never return the document as prose, Markdown, or a JSON code
block. Preserve stable node IDs when possible.
The candidate must be strict JSON: use double-quoted keys and strings, with
no comments or trailing commas. Use \`flect interface validate\` as the only
validation step. If it fails, rewrite the file with corrected strict JSON and
validate again. Do not probe with \`cat\`, \`node\`, \`python\`, or commands
outside the provided browser shell.
Never invent executable code, URLs, credentials, HTML, CSS, scripts, tools, or
capabilities.

Current validated document:
${JSON.stringify(document)}

User instruction:
${JSON.stringify(instruction)}`;

const guardianPrompt = (
  reason: RecoveryReason,
) => `Assess this typed Flect recovery signal.

Return one short plain-text diagnostic for the user. Do not propose code, invoke
tools, claim that recovery already happened, or request additional authority.
Deterministic safe mode and rollback remain owned by the protected Flect kernel.

Recovery reason: ${reason}`;

export const FlectRuntimeLive = Layer.effect(
  FlectRuntime,
  Effect.gen(function* () {
    const pi = yield* PiSdk;
    const authentication = yield* ProviderAuthentication;
    const sessions = yield* Ref.make(HashMap.empty<string, SessionRecord>());
    const sessionSequence = yield* Ref.make(0);

    const closeOperation = (controller: OperationController) =>
      controller.close.pipe(
        Effect.interruptible,
        Effect.timeoutOption(SESSION_DISPOSAL_TIMEOUT),
        Effect.flatMap((result) =>
          Option.isNone(result) ? controller.interruptActive : Effect.void,
        ),
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    const disposeSessionRecord = Effect.fn(
      "Flect.Runtime.disposeSessionRecord",
    )((record: SessionRecord) =>
      Effect.uninterruptible(
        Effect.all(
          [
            closeOperation(record.appOperation),
            closeOperation(record.shaperOperation),
            closeOperation(record.guardianOperation),
          ],
          { concurrency: "unbounded", discard: true },
        ).pipe(
          Effect.andThen(
            Effect.all(
              [
                record.app.dispose,
                record.shaper.dispose,
                record.guardian.dispose,
              ],
              {
                concurrency: "unbounded",
                discard: true,
              },
            ),
          ),
        ),
      ),
    );

    yield* Effect.addFinalizer(() =>
      Ref.get(sessions).pipe(
        Effect.flatMap((records) =>
          Effect.forEach(HashMap.values(records), disposeSessionRecord, {
            concurrency: "unbounded",
            discard: true,
          }),
        ),
      ),
    );

    const findSession = Effect.fn("Flect.Runtime.findSession")(function* (
      sessionId: string,
    ) {
      const current = yield* Ref.get(sessions);
      const record = HashMap.get(current, sessionId);
      if (Option.isNone(record)) {
        return yield* Effect.fail(
          new SessionNotFound({
            sessionId,
            message: "Session not found.",
          }),
        );
      }
      return record.value;
    });

    const createSession = Effect.fn("Flect.Runtime.createSession")(function* (
      selection: SessionSelection,
    ) {
      const models = yield* pi.listModels;
      const model = selection.model
        ? models.find(
            (candidate) =>
              candidate.provider === selection.model?.provider &&
              candidate.id === selection.model.id,
          )
        : models[0];

      if (!model) {
        return yield* Effect.fail(
          new NoModelAvailable({
            message: "No authenticated model is available.",
          }),
        );
      }

      const agents = yield* pi.createAgentSet(
        model,
        selection.reasoningLevel,
        protectedAgentPolicies(selection),
      );
      // Pi session identifiers belong to the embedded SDK. Flect exposes a
      // separate capability-shaped handle so browser commands can be
      // validated without leaking or depending on Pi's identifier format.
      const sessionId = `session-${crypto.randomUUID()}`;
      return yield* Effect.gen(function* () {
        const appAbort = agents.app.abort;
        yield* Effect.yieldNow;
        const appOperation = yield* makeOperationController(
          sessionId,
          appAbort,
        );
        const shaperOperation = yield* makeOperationController(
          sessionId,
          agents.shaper.abort,
        );
        const guardianOperation = yield* makeOperationController(
          sessionId,
          agents.guardian.abort,
        );
        const sequence = yield* Ref.getAndUpdate(
          sessionSequence,
          (current) => current + 1,
        );
        const record: SessionRecord = {
          sessionId,
          app: agents.app,
          shaper: agents.shaper,
          guardian: agents.guardian,
          appOperation,
          shaperOperation,
          guardianOperation,
          sequence,
        };
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const evicted = yield* Ref.modify(sessions, (current) => {
              const replaced = HashMap.get(current, sessionId);
              let oldest: SessionRecord | undefined;
              if (
                Option.isNone(replaced) &&
                HashMap.size(current) >= MAX_ACTIVE_SESSIONS
              ) {
                for (const candidate of HashMap.values(current)) {
                  if (
                    oldest === undefined ||
                    candidate.sequence < oldest.sequence
                  ) {
                    oldest = candidate;
                  }
                }
              }
              const evictedRecord = Option.getOrUndefined(replaced) ?? oldest;
              const withoutEvicted =
                evictedRecord === undefined
                  ? current
                  : HashMap.remove(current, evictedRecord.sessionId);
              return [
                evictedRecord,
                HashMap.set(withoutEvicted, sessionId, record),
              ];
            });
            if (evicted !== undefined) {
              yield* disposeSessionRecord(evicted);
            }
          }),
        );
        return sessionId;
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.uninterruptible(
            Ref.update(sessions, (current) => {
              const registered = HashMap.get(current, sessionId);
              return Option.isSome(registered) &&
                registered.value.app === agents.app &&
                registered.value.shaper === agents.shaper &&
                registered.value.guardian === agents.guardian
                ? HashMap.remove(current, sessionId)
                : current;
            }).pipe(
              Effect.andThen(
                Effect.all(
                  [
                    agents.app.dispose,
                    agents.shaper.dispose,
                    agents.guardian.dispose,
                  ],
                  {
                    concurrency: "unbounded",
                    discard: true,
                  },
                ),
              ),
            ),
          ),
        ),
      );
    });

    const closeSession = Effect.fn("Flect.Runtime.closeSession")(function* (
      sessionId: string,
    ) {
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const removed = yield* Ref.modify(sessions, (current) => {
            const record = HashMap.get(current, sessionId);
            return [
              record,
              Option.isNone(record)
                ? current
                : HashMap.remove(current, sessionId),
            ];
          });
          if (Option.isNone(removed)) {
            return yield* Effect.fail(
              new SessionNotFound({
                sessionId,
                message: "Session not found.",
              }),
            );
          }
          yield* disposeSessionRecord(removed.value);
        }),
      );
    });

    const diagnoseRecovery = Effect.fn("Flect.Runtime.diagnoseRecovery")(
      function* (sessionId: string, reason: RecoveryReason) {
        const record = yield* findSession(sessionId);
        const operation: ActiveOperation = {
          kind: "diagnose",
          interrupt: Effect.suspend(() => record.guardian.abort()),
          done: yield* Deferred.make<void>(),
          fiber: undefined,
        };
        return yield* executeOperation(
          record.guardianOperation,
          operation,
          Effect.gen(function* () {
            const response = makeBoundedResponse(
              MAX_GUARDIAN_RESPONSE_BYTES,
              record.guardian.abort,
            );
            const unsubscribe = yield* record.guardian.subscribe((event) => {
              if (event.type === "text_delta") {
                response.append(event.delta);
              }
            });

            yield* record.guardian.prompt(guardianPrompt(reason)).pipe(
              Effect.mapError(() => piFailure("diagnose")),
              Effect.ensuring(Effect.sync(() => unsubscribe())),
            );

            const message = response.text().trim();
            if (response.isExceeded() || message.length === 0) {
              return yield* Effect.fail(piFailure("diagnose"));
            }

            return GuardianDiagnostic.make({
              version: 1,
              message,
            });
          }),
        );
      },
    );

    const prompt = (
      sessionId: string,
      text: string,
    ): Stream.Stream<FlectEvent, FlectRuntimeError> =>
      Stream.fromEffect(findSession(sessionId)).pipe(
        Stream.flatMap((record) =>
          Stream.callback<FlectEvent, FlectRuntimeError>((queue) =>
            Effect.gen(function* () {
              const cancelled = yield* Ref.make(false);
              const operation: ActiveOperation = {
                kind: "prompt",
                interrupt: Effect.gen(function* () {
                  yield* Ref.set(cancelled, true);
                  yield* record.app.abort();
                }),
                done: yield* Deferred.make<void>(),
                fiber: undefined,
              };

              const terminal = yield* executeOperation(
                record.appOperation,
                operation,
                Effect.gen(function* () {
                  const completed = yield* Ref.make(false);
                  Queue.offerUnsafe(
                    queue,
                    new TurnStarted({ type: "turn_started" }),
                  );

                  const unsubscribe = yield* record.app.subscribe((event) => {
                    switch (event.type) {
                      case "text_delta":
                        Queue.offerUnsafe(
                          queue,
                          new TextDelta({
                            type: "text_delta",
                            delta: event.delta,
                          }),
                        );
                        break;
                      case "shell_request":
                        Queue.offerUnsafe(
                          queue,
                          new AgentShellRequest({
                            type: "shell_request",
                            requestId: event.requestId,
                            command: event.command,
                          }),
                        );
                        break;
                      case "interface_edit_requested":
                        Queue.offerUnsafe(
                          queue,
                          InterfaceEditRequested.make(event),
                        );
                        break;
                      case "tool_execution_started":
                      case "tool_execution_updated":
                      case "tool_execution_completed":
                        Queue.offerUnsafe(queue, publicToolEvent("app", event));
                        break;
                      case "external_extension_failed":
                        Queue.offerUnsafe(
                          queue,
                          publicExtensionFailure("app", event),
                        );
                        break;
                    }
                  });

                  const turn = Effect.gen(function* () {
                    return yield* record.app.prompt(text).pipe(
                      Effect.matchEffect({
                        onFailure: () =>
                          Ref.get(cancelled).pipe(
                            Effect.map((isCancelled) =>
                              isCancelled
                                ? new TurnCancelled({ type: "cancelled" })
                                : new TurnError({
                                    type: "error",
                                    message: PUBLIC_TURN_ERROR,
                                  }),
                            ),
                          ),
                        onSuccess: () =>
                          Ref.get(cancelled).pipe(
                            Effect.map((isCancelled) =>
                              isCancelled
                                ? new TurnCancelled({ type: "cancelled" })
                                : new TurnCompleted({
                                    type: "turn_completed",
                                  }),
                            ),
                          ),
                      }),
                    );
                  });

                  const terminal = yield* turn.pipe(
                    Effect.tap(() => Ref.set(completed, true)),
                    Effect.ensuring(Effect.sync(() => unsubscribe())),
                    Effect.ensuring(
                      Ref.get(completed).pipe(
                        Effect.flatMap((isComplete) =>
                          isComplete
                            ? Effect.void
                            : record.app
                                .abort()
                                .pipe(Effect.catch(() => Effect.void)),
                        ),
                      ),
                    ),
                  );
                  return terminal;
                }),
              );
              Queue.offerUnsafe(queue, terminal);
              Queue.endUnsafe(queue);
            }).pipe(
              Effect.catch((error) =>
                Queue.fail(queue, error).pipe(Effect.asVoid),
              ),
            ),
          ),
        ),
      );

    const completeShellRequest = Effect.fn(
      "Flect.Runtime.completeShellRequest",
    )(function* (
      sessionId: string,
      role: InteractiveAgentRole,
      requestId: string,
      result: BunCommandResult,
    ) {
      const record = yield* findSession(sessionId);
      const session = role === "app" ? record.app : record.shaper;
      yield* session.completeShellRequest(requestId, result);
    });

    const cancel = Effect.fn("Flect.Runtime.cancel")(function* (
      sessionId: string,
      role: InteractiveAgentRole,
    ) {
      const record = yield* findSession(sessionId);
      const controller =
        role === "app" ? record.appOperation : record.shaperOperation;
      yield* controller.cancelActive();
    });

    const makeShape = Effect.fn("Flect.Runtime.makeShape")(function* (
      sessionId: string,
      instruction: string,
      input: unknown,
    ) {
      const document = yield* validateInterfaceDocument(input);
      const record = yield* findSession(sessionId);
      return Stream.callback<ShapeEvent, FlectRuntimeError>((queue) =>
        Effect.gen(function* () {
          const operation: ActiveOperation = {
            kind: "shape",
            interrupt: Effect.suspend(() => record.shaper.abort()),
            done: yield* Deferred.make<void>(),
            fiber: undefined,
          };
          yield* executeOperation(
            record.shaperOperation,
            operation,
            Effect.gen(function* () {
              const runAttempt = Effect.fn("Flect.Runtime.runShapeAttempt")(
                function* (promptText: string) {
                  const response = makeBoundedResponse(
                    MAX_SHAPER_RESPONSE_BYTES,
                    record.shaper.abort,
                  );
                  const unsubscribe = yield* record.shaper.subscribe(
                    (event) => {
                      switch (event.type) {
                        case "text_delta":
                          response.append(event.delta);
                          break;
                        case "shell_request":
                          Queue.offerUnsafe(
                            queue,
                            new AgentShellRequest({
                              type: "shell_request",
                              requestId: event.requestId,
                              command: event.command,
                            }),
                          );
                          break;
                        case "tool_execution_started":
                        case "tool_execution_updated":
                        case "tool_execution_completed":
                          Queue.offerUnsafe(
                            queue,
                            publicToolEvent("shaper", event),
                          );
                          break;
                        case "external_extension_failed":
                          Queue.offerUnsafe(
                            queue,
                            publicExtensionFailure("shaper", event),
                          );
                          break;
                      }
                    },
                  );

                  yield* record.shaper
                    .prompt(promptText)
                    .pipe(Effect.ensuring(Effect.sync(() => unsubscribe())));

                  if (response.isExceeded()) {
                    return yield* Effect.fail(piFailure("shape"));
                  }
                },
              );
              yield* runAttempt(shapePrompt(instruction, document));
            }),
          );
          Queue.offerUnsafe(
            queue,
            new ShapeCompleted({ type: "shape_completed" }),
          );
          Queue.endUnsafe(queue);
        }).pipe(
          Effect.catch((error) => Queue.fail(queue, error).pipe(Effect.asVoid)),
          Effect.onError((cause) =>
            Queue.failCause(queue, cause).pipe(Effect.asVoid),
          ),
        ),
      );
    });

    const shape = (
      sessionId: string,
      instruction: string,
      input: unknown,
    ): Stream.Stream<ShapeEvent, FlectRuntimeError> =>
      Stream.unwrap(makeShape(sessionId, instruction, input));

    return {
      status: Effect.succeed(
        new RuntimeStatus({ version: 1, status: "ready" }),
      ),
      listModels: pi.listModels,
      providerAuth: authentication.providers,
      loginProvider: authentication.login,
      replyProviderAuth: authentication.reply,
      cancelProviderAuth: authentication.cancel,
      refreshProviderAuth: authentication.refresh,
      logoutProvider: authentication.logout,
      createSession,
      closeSession,
      prompt,
      shape,
      cancel,
      completeShellRequest,
      diagnoseRecovery,
    };
  }),
);
