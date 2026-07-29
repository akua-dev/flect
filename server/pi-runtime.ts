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
  Effect,
  HashMap,
  Layer,
  Option,
  Queue,
  Ref,
  Stream,
} from "effect";
import {
  type FlectRuntimeError,
  ModelSummary,
  NoModelAvailable,
  PiOperationFailed,
  RuntimeStatus,
  SessionNotFound,
  type SessionSelection,
  TextDelta,
  TurnCancelled,
  TurnCompleted,
  TurnError,
  TurnStarted,
} from "../shared/contracts";
import { FlectRuntime } from "./runtime";

export type PiSessionPolicy = {
  readonly noTools: "all";
  readonly storage: "memory";
  readonly extensions: "disabled";
};

export type PiEvent = {
  readonly type: "text_delta";
  readonly delta: string;
};

export interface PiSession {
  readonly sessionId: string;
  readonly subscribe: (
    listener: (event: PiEvent) => void,
  ) => Effect.Effect<() => void>;
  readonly prompt: (text: string) => Effect.Effect<void, PiOperationFailed>;
  readonly abort: () => Effect.Effect<void, PiOperationFailed>;
}

export interface PiSdkShape {
  readonly listModels: Effect.Effect<
    ReadonlyArray<ModelSummary>,
    PiOperationFailed
  >;
  readonly createSession: (
    model: ModelSummary,
    policy: PiSessionPolicy,
  ) => Effect.Effect<PiSession, PiOperationFailed | NoModelAvailable>;
}

export class PiSdk extends Context.Service<PiSdk, PiSdkShape>()(
  "flect/server/PiSdk",
) {}

const protectedSessionPolicy: PiSessionPolicy = Object.freeze({
  noTools: "all",
  storage: "memory",
  extensions: "disabled",
});

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

    const createSession = Effect.fn("Flect.PiSdk.createSession")(function* (
      model: ModelSummary,
      policy: PiSessionPolicy,
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

      const settingsManager = SettingsManager.inMemory();
      const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: getAgentDir(),
        settingsManager,
        noExtensions: policy.extensions === "disabled",
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt:
          "You are the local agent behind Flect, an interface that takes the user's shape. Respond clearly and help the user think through, build, or change interfaces. You have no tools in this protected session.",
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
            noTools: policy.noTools,
            sessionManager: SessionManager.inMemory(),
            settingsManager,
            resourceLoader,
          }),
        catch: () => piFailure("create_session"),
      });

      return {
        sessionId: result.session.sessionId,
        subscribe: (listener: (event: PiEvent) => void) =>
          Effect.sync(() =>
            result.session.subscribe((event) => {
              if (
                event.type === "message_update" &&
                event.assistantMessageEvent.type === "text_delta"
              ) {
                listener({
                  type: "text_delta",
                  delta: event.assistantMessageEvent.delta,
                });
              }
            }),
          ),
        prompt: Effect.fn("Flect.PiSession.prompt")((text: string) =>
          Effect.tryPromise({
            try: () => result.session.prompt(text),
            catch: () => piFailure("prompt"),
          }),
        ),
        abort: Effect.fn("Flect.PiSession.abort")(() =>
          Effect.tryPromise({
            try: () => result.session.abort(),
            catch: () => piFailure("cancel"),
          }),
        ),
      };
    });

    return {
      listModels,
      createSession,
    };
  }),
);

type SessionRecord = {
  readonly session: PiSession;
  readonly cancelled: Ref.Ref<boolean>;
};

const PUBLIC_TURN_ERROR = "The model could not complete this turn.";

export const FlectRuntimeLive = Layer.effect(
  FlectRuntime,
  Effect.gen(function* () {
    const pi = yield* PiSdk;
    const sessions = yield* Ref.make(HashMap.empty<string, SessionRecord>());

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

      const session = yield* pi.createSession(model, protectedSessionPolicy);
      const cancelled = yield* Ref.make(false);
      yield* Ref.update(
        sessions,
        HashMap.set(session.sessionId, { session, cancelled }),
      );
      return session.sessionId;
    });

    const prompt = (
      sessionId: string,
      text: string,
    ): Stream.Stream<
      TurnStarted | TextDelta | TurnCompleted | TurnCancelled | TurnError,
      FlectRuntimeError
    > =>
      Stream.fromEffect(findSession(sessionId)).pipe(
        Stream.flatMap((record) =>
          Stream.callback((queue) =>
            Effect.gen(function* () {
              const completed = yield* Ref.make(false);
              yield* Ref.set(record.cancelled, false);
              Queue.offerUnsafe(
                queue,
                new TurnStarted({ type: "turn_started" }),
              );

              const unsubscribe = yield* record.session.subscribe((event) => {
                Queue.offerUnsafe(
                  queue,
                  new TextDelta({
                    type: "text_delta",
                    delta: event.delta,
                  }),
                );
              });

              yield* Effect.addFinalizer((_exit) =>
                Effect.sync(() => unsubscribe()),
              );
              yield* Effect.addFinalizer((_exit) =>
                Ref.get(completed).pipe(
                  Effect.flatMap((isComplete) =>
                    isComplete
                      ? Effect.void
                      : record.session
                          .abort()
                          .pipe(Effect.catch(() => Effect.void)),
                  ),
                ),
              );

              const terminal = yield* record.session.prompt(text).pipe(
                Effect.matchEffect({
                  onFailure: () =>
                    Ref.get(record.cancelled).pipe(
                      Effect.map((cancelled) =>
                        cancelled
                          ? new TurnCancelled({ type: "cancelled" })
                          : new TurnError({
                              type: "error",
                              message: PUBLIC_TURN_ERROR,
                            }),
                      ),
                    ),
                  onSuccess: () =>
                    Ref.get(record.cancelled).pipe(
                      Effect.map((cancelled) =>
                        cancelled
                          ? new TurnCancelled({ type: "cancelled" })
                          : new TurnCompleted({ type: "turn_completed" }),
                      ),
                    ),
                }),
              );

              Queue.offerUnsafe(queue, terminal);
              yield* Ref.set(completed, true);
              Queue.endUnsafe(queue);
            }),
          ),
        ),
      );

    const cancel = Effect.fn("Flect.Runtime.cancel")(function* (
      sessionId: string,
    ) {
      const record = yield* findSession(sessionId);
      yield* Ref.set(record.cancelled, true);
      yield* record.session.abort();
    });

    return {
      status: Effect.succeed(
        new RuntimeStatus({ version: 1, status: "ready" }),
      ),
      listModels: pi.listModels,
      createSession,
      prompt,
      cancel,
    };
  }),
);
