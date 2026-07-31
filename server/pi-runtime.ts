import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
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
  type FlectEvent,
  type FlectRuntimeError,
  GuardianDiagnostic,
  type InteractiveAgentRole,
  ModelSummary,
  NoModelAvailable,
  PiOperationFailed,
  type RecoveryReason,
  RuntimeStatus,
  SessionBusy,
  SessionNotFound,
  type SessionSelection,
  ShapeCompleted,
  type ShapeEvent,
  TextDelta,
  TurnCancelled,
  TurnCompleted,
  TurnError,
  TurnStarted,
} from "../shared/contracts";
import {
  type InterfaceDocument,
  validateInterfaceDocument,
} from "../shared/interface-document";
import { makePiShellBridge } from "./pi-shell-bridge";
import { FlectRuntime } from "./runtime";

export type PiSessionPolicy = {
  readonly role: "guardian" | "app" | "shaper";
  readonly tools: "none" | "sandbox-bash";
  readonly storage: "memory";
  readonly extensions: "disabled";
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

const protectedAgentPolicies = Object.freeze({
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
    extensions: "disabled",
    userResources: "disabled",
  } satisfies PiSessionPolicy),
  shaper: Object.freeze({
    role: "shaper",
    tools: "sandbox-bash",
    storage: "memory",
    extensions: "disabled",
    userResources: "disabled",
  } satisfies PiSessionPolicy),
});

const guardianSystemPrompt =
  "You are Flect Guardian, the protected recovery agent. You may reason about typed validation summaries and request deterministic recovery actions only. You cannot load user resources, modify the revision journal, execute extensions, or use shell, filesystem, browser, network, or process tools.";

const appSystemPrompt =
  "You are Flect App Agent, the user-facing agent inside the current product experience. Help the user operate the product through its exposed interface and API capabilities. You may use the bash tool only inside Flect's disposable App workspace. It cannot access Shaper source, the host filesystem, credentials, the parent UI, the canonical workspace, or ambient network. You cannot reshape the interface, activate revisions, modify Guardian or safe mode, or load user resources and extensions.";

const shaperSystemPrompt =
  "You are Flect Shaper, the user-facing interface agent. Help the user describe and shape schema-defined interfaces. You may use the bash tool only inside Flect's disposable browser workspace. It cannot access the host filesystem, credentials, parent UI, canonical workspace, or ambient network; the reserved compatible bun command provides bounded run, build, package, preview, and stop operations. You cannot activate revisions, modify Guardian or safe mode, or load user resources and extensions.";

const piFailure = (operation: PiOperationFailed["operation"]) =>
  new PiOperationFailed({
    operation,
    message: "The model runtime could not complete the request.",
  });

export const PiSdkLive = Layer.effect(
  PiSdk,
  Effect.gen(function* () {
    const modelRuntime = yield* Effect.tryPromise({
      try: () => ModelRuntime.create(),
      catch: () => piFailure("initialize"),
    });

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
            }),
        ),
      ),
    );

    const createAgentSet = Effect.fn("Flect.PiSdk.createAgentSet")(function* (
      model: ModelSummary,
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
        const settingsManager = SettingsManager.inMemory();
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
        const resourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: getAgentDir(),
          settingsManager,
          noExtensions: policy.extensions === "disabled",
          noSkills: policy.userResources === "disabled",
          noPromptTemplates: policy.userResources === "disabled",
          noThemes: policy.userResources === "disabled",
          noContextFiles: policy.userResources === "disabled",
          systemPrompt:
            policy.role === "guardian"
              ? guardianSystemPrompt
              : policy.role === "app"
                ? appSystemPrompt
                : shaperSystemPrompt,
        });

        yield* Effect.tryPromise({
          try: () => resourceLoader.reload(),
          catch: () => piFailure("create_session"),
        });

        const result = yield* Effect.tryPromise({
          try: () =>
            createAgentSession({
              modelRuntime,
              model: selected,
              ...(policy.tools === "none"
                ? { noTools: "all" }
                : {
                    noTools: "builtin",
                    tools: ["bash"],
                    customTools: [shellBridge.tool],
                  }),
              sessionManager,
              settingsManager,
              resourceLoader,
            }),
          catch: () => piFailure("create_session"),
        });

        let observedTextDelta = false;
        const unsubscribeFromPi = result.session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          ) {
            observedTextDelta = true;
            const delta = {
              type: "text_delta",
              delta: event.assistantMessageEvent.delta,
            } satisfies PiEvent;
            emit(delta);
          }
        });

        return {
          sessionId: result.session.sessionId,
          subscribe: (listener: (event: PiEvent) => void) =>
            Effect.sync(() => {
              listeners.add(listener);
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
            yield* Effect.tryPromise({
              try: () => result.session.abort(),
              catch: () => piFailure("cancel"),
            });
          }),
          dispose: shellBridge.close.pipe(
            Effect.andThen(
              Effect.sync(() => {
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

        yield* restore(
          Effect.gen(function* () {
            const interruptResult = yield* Effect.result(operation.interrupt);
            if (interruptResult._tag === "Failure") {
              return yield* Effect.fail(interruptResult.failure);
            }
            yield* Deferred.await(operation.done);
          }),
        ).pipe(Effect.ensuring(releaseClaim));
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
) => `Propose a revised Flect interface document.

Return exactly one JSON object and no markdown or commentary. The root must use
only these closed node types: stack, text, prompt, button, divider, agent-panel.
Never invent executable code, URLs, credentials, HTML, CSS, scripts, tools, or
capabilities. Preserve stable node IDs when possible.

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

const parseShaperDocument = Effect.fn("Flect.Runtime.parseShaperDocument")(
  function* (raw: string) {
    if (new TextEncoder().encode(raw).byteLength > MAX_SHAPER_RESPONSE_BYTES) {
      return yield* Effect.fail(piFailure("shape"));
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < start) {
      return yield* Effect.fail(piFailure("shape"));
    }

    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw.slice(start, end + 1)),
      catch: () => piFailure("shape"),
    });
    return yield* validateInterfaceDocument(parsed).pipe(
      Effect.mapError(() => piFailure("shape")),
    );
  },
);

export const FlectRuntimeLive = Layer.effect(
  FlectRuntime,
  Effect.gen(function* () {
    const pi = yield* PiSdk;
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

      const agents = yield* pi.createAgentSet(model, protectedAgentPolicies);
      return yield* Effect.gen(function* () {
        const appAbort = agents.app.abort;
        yield* Effect.yieldNow;
        const appOperation = yield* makeOperationController(
          agents.app.sessionId,
          appAbort,
        );
        const shaperOperation = yield* makeOperationController(
          agents.app.sessionId,
          agents.shaper.abort,
        );
        const guardianOperation = yield* makeOperationController(
          agents.app.sessionId,
          agents.guardian.abort,
        );
        const sequence = yield* Ref.getAndUpdate(
          sessionSequence,
          (current) => current + 1,
        );
        const record: SessionRecord = {
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
              const replaced = HashMap.get(current, agents.app.sessionId);
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
                  : HashMap.remove(current, evictedRecord.app.sessionId);
              return [
                evictedRecord,
                HashMap.set(withoutEvicted, agents.app.sessionId, record),
              ];
            });
            if (evicted !== undefined) {
              yield* disposeSessionRecord(evicted);
            }
          }),
        );
        return agents.app.sessionId;
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.uninterruptible(
            Ref.update(sessions, (current) => {
              const registered = HashMap.get(current, agents.app.sessionId);
              return Option.isSome(registered) &&
                registered.value.app === agents.app &&
                registered.value.shaper === agents.shaper &&
                registered.value.guardian === agents.guardian
                ? HashMap.remove(current, agents.app.sessionId)
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
                    Queue.offerUnsafe(
                      queue,
                      event.type === "text_delta"
                        ? new TextDelta({
                            type: "text_delta",
                            delta: event.delta,
                          })
                        : new AgentShellRequest({
                            type: "shell_request",
                            requestId: event.requestId,
                            command: event.command,
                          }),
                    );
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
          const shaped = yield* executeOperation(
            record.shaperOperation,
            operation,
            Effect.gen(function* () {
              const response = makeBoundedResponse(
                MAX_SHAPER_RESPONSE_BYTES,
                record.shaper.abort,
              );
              const unsubscribe = yield* record.shaper.subscribe((event) => {
                if (event.type === "text_delta") {
                  response.append(event.delta);
                } else {
                  Queue.offerUnsafe(
                    queue,
                    new AgentShellRequest({
                      type: "shell_request",
                      requestId: event.requestId,
                      command: event.command,
                    }),
                  );
                }
              });

              yield* record.shaper
                .prompt(shapePrompt(instruction, document))
                .pipe(Effect.ensuring(Effect.sync(() => unsubscribe())));

              if (response.isExceeded()) {
                return yield* Effect.fail(piFailure("shape"));
              }
              return yield* parseShaperDocument(response.text());
            }),
          );
          Queue.offerUnsafe(
            queue,
            new ShapeCompleted({ type: "shape_completed", document: shaped }),
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
