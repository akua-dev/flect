import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FlectEvent,
  ModelSelection,
  type ModelSummary,
  type RecoveryReason,
  SessionSelection,
} from "../../shared/contracts";
import type { InterfaceDocument } from "../../shared/interface-document";
import { FlectClient, FlectUnavailableError } from "../lib/api";
import { browserRuntime, type FlectBrowserRuntime } from "../lib/runtime";

export type AgentSessionStatus =
  | "booting"
  | "ready"
  | "submitting"
  | "streaming"
  | "error"
  | "unavailable";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

const messageId = () => crypto.randomUUID();

interface SessionHandle {
  readonly id: string;
  readonly selectionKey: string;
}

const sessionSelection = (
  selectedModel: ModelSummary | undefined,
): SessionSelection =>
  selectedModel
    ? new SessionSelection({
        model: new ModelSelection({
          provider: selectedModel.provider,
          id: selectedModel.id,
        }),
      })
    : new SessionSelection({});

const modelSelectionKey = (selectedModel: ModelSummary | undefined) =>
  selectedModel === undefined
    ? "auto"
    : JSON.stringify([selectedModel.provider, selectedModel.id]);

const ensurePiSession = Effect.fn("Flect.AgentSession.ensureSession")(
  function* (
    selection: SessionSelection,
    selectionKey: string,
    readCurrent: () => SessionHandle | undefined,
    storeCurrent: (handle: SessionHandle | undefined) => void,
  ) {
    const client = yield* FlectClient;
    const existing = readCurrent();
    if (existing?.selectionKey === selectionKey) {
      return existing.id;
    }
    if (existing !== undefined) {
      storeCurrent(undefined);
      yield* client
        .closeSession(existing.id)
        .pipe(Effect.catch(() => Effect.void));
    }
    const sessionId = yield* client.createSession(selection);
    storeCurrent({ id: sessionId, selectionKey });
    return sessionId;
  },
);

export function useAgentSession(runtime: FlectBrowserRuntime = browserRuntime) {
  const [status, setStatus] = useState<AgentSessionStatus>("booting");
  const [models, setModels] = useState<ReadonlyArray<ModelSummary>>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSummary>();
  const [messages, setMessages] = useState<ReadonlyArray<ConversationMessage>>(
    [],
  );
  const [lastPrompt, setLastPrompt] = useState("");
  const [error, setError] = useState<string>();
  const sessionRef = useRef<SessionHandle | undefined>(undefined);
  const requestRef = useRef<
    Fiber.Fiber<void, FlectUnavailableError> | undefined
  >(undefined);

  const releaseSession = useCallback(
    (expectedId: string) =>
      Effect.gen(function* () {
        const current = yield* Effect.sync(() => {
          const handle = sessionRef.current;
          if (handle === undefined || handle.id !== expectedId) {
            return undefined;
          }
          sessionRef.current = undefined;
          return handle;
        });
        if (current !== undefined) {
          const client = yield* FlectClient;
          yield* client
            .closeSession(current.id)
            .pipe(Effect.catch(() => Effect.void));
        }
      }),
    [],
  );

  const refresh = useCallback(() => {
    setStatus("booting");
    setError(undefined);
    const request = requestRef.current;
    requestRef.current = undefined;
    const sessionId = sessionRef.current?.id;

    const load = Effect.gen(function* () {
      if (request) {
        yield* Fiber.interrupt(request);
      }
      if (sessionId !== undefined) {
        yield* releaseSession(sessionId);
      }

      const client = yield* FlectClient;
      const [runtimeStatus, availableModels] = yield* Effect.all(
        [client.status, client.models],
        { concurrency: "unbounded" },
      );

      if (runtimeStatus.status !== "ready") {
        return yield* Effect.fail(
          new FlectUnavailableError({
            message: "The local Flect runtime is unavailable.",
          }),
        );
      }

      yield* Effect.sync(() => {
        setModels(availableModels);
        setStatus("ready");
      });
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          setModels([]);
          setStatus("unavailable");
          setError("Start the local Flect runtime to continue.");
        }),
      ),
    );

    return runtime.runPromise(load);
  }, [releaseSession, runtime]);

  useEffect(() => {
    void refresh();

    return () => {
      const request = requestRef.current;
      const sessionId = sessionRef.current?.id;
      runtime.runFork(
        Effect.gen(function* () {
          if (request) {
            yield* Fiber.interrupt(request);
          }
          if (sessionId !== undefined) {
            yield* releaseSession(sessionId);
          }
        }),
      );
    };
  }, [refresh, releaseSession, runtime]);

  const selection = useMemo(
    () => sessionSelection(selectedModel),
    [selectedModel],
  );
  const selectionKey = useMemo(
    () => modelSelectionKey(selectedModel),
    [selectedModel],
  );
  const ensureSession = useCallback(
    () =>
      ensurePiSession(
        selection,
        selectionKey,
        () => sessionRef.current,
        (handle) => {
          sessionRef.current = handle;
        },
      ),
    [selection, selectionKey],
  );

  const handleEvent = useCallback(
    (assistantId: string, event: FlectEvent): Effect.Effect<void> =>
      Effect.sync(() => {
        switch (event.type) {
          case "turn_started":
            setStatus("streaming");
            break;
          case "text_delta":
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content + event.delta,
                    }
                  : message,
              ),
            );
            break;
          case "turn_completed":
          case "cancelled":
            setStatus("ready");
            break;
          case "error":
            setStatus("error");
            setError(event.message);
            break;
        }
      }),
    [],
  );

  const submit = useCallback(
    (text: string): Promise<void> => {
      const prompt = text.trim();
      if (!prompt || status === "submitting" || status === "streaming") {
        return Promise.resolve();
      }

      const userId = messageId();
      const assistantId = messageId();
      setLastPrompt(prompt);
      setError(undefined);
      setStatus("submitting");
      setMessages((current) => [
        ...current,
        { id: userId, role: "user", content: prompt },
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const request = Effect.gen(function* () {
        const client = yield* FlectClient;
        const sessionId = yield* ensureSession();

        yield* client.prompt(sessionId, prompt).pipe(
          Stream.runForEach((event) => {
            const update = handleEvent(assistantId, event);
            return event.type === "error"
              ? update.pipe(Effect.andThen(releaseSession(sessionId)))
              : update;
          }),
          Effect.tapError(() => releaseSession(sessionId)),
        );
      }).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            setStatus("error");
            setError(failure.message);
          }),
        ),
      );

      const fiber = runtime.runFork(request);
      requestRef.current = fiber;

      return runtime
        .runPromise(Fiber.await(fiber))
        .then(() => undefined)
        .finally(() => {
          if (requestRef.current === fiber) {
            requestRef.current = undefined;
          }
        });
    },
    [ensureSession, handleEvent, releaseSession, runtime, status],
  );

  const shape = useCallback(
    (
      instruction: string,
      document: InterfaceDocument,
    ): Promise<InterfaceDocument> =>
      runtime.runPromise(
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const sessionId = yield* ensureSession();
          return yield* client
            .shape(sessionId, instruction, document)
            .pipe(Effect.tapError(() => releaseSession(sessionId)));
        }),
      ),
    [ensureSession, releaseSession, runtime],
  );

  const cancel = useCallback((): Promise<void> => {
    const request = requestRef.current;
    const sessionId = sessionRef.current?.id;

    const cancelRequest = Effect.gen(function* () {
      if (request) {
        yield* Fiber.interrupt(request);
      }

      if (sessionId) {
        const client = yield* FlectClient;
        yield* client.cancel(sessionId);
      }
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.ensuring(
        Effect.sync(() => {
          requestRef.current = undefined;
          setStatus("ready");
        }),
      ),
    );

    return runtime.runPromise(cancelRequest);
  }, [runtime]);

  const selectModel = useCallback(
    (model: ModelSummary | undefined) => {
      const request = requestRef.current;
      const sessionId = sessionRef.current?.id;
      requestRef.current = undefined;
      runtime.runFork(
        Effect.gen(function* () {
          if (request) {
            yield* Fiber.interrupt(request);
          }
          if (sessionId !== undefined) {
            yield* releaseSession(sessionId);
          }
        }),
      );
      setSelectedModel(model);
      setError(undefined);
      setStatus((current) =>
        current === "booting" || current === "unavailable" ? current : "ready",
      );
    },
    [releaseSession, runtime],
  );

  const diagnoseRecovery = useCallback(
    (reason: RecoveryReason) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const sessionId = yield* ensureSession();
          return yield* client.diagnoseRecovery(sessionId, reason);
        }),
      ),
    [ensureSession, runtime],
  );

  return {
    status,
    models,
    selectedModel,
    selectModel,
    messages,
    lastPrompt,
    error,
    submit,
    shape,
    cancel,
    diagnoseRecovery,
    refresh,
  };
}
