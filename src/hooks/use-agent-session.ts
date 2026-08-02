import { Effect, Fiber, Option, Stream } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BunCommandResult } from "../../shared/bun-command";
import {
  ExternalPiExtensionSelection,
  type FlectEvent,
  type InteractiveAgentRole,
  ModelSelection,
  type ModelSummary,
  type RecoveryReason,
  SessionSelection,
} from "../../shared/contracts";
import type { InterfaceDocument } from "../../shared/interface-document";
import {
  type AgentProductActionRequest,
  ProductActionResult,
} from "../../shared/product-action";
import { FlectClient, FlectUnavailableError } from "../lib/api";
import { browserRuntime, type FlectBrowserRuntime } from "../lib/runtime";
import { SandboxedShell } from "../shell/sandboxed-shell-service";

export type AgentSessionStatus =
  | "booting"
  | "ready"
  | "submitting"
  | "streaming"
  | "cancelling"
  | "error"
  | "setup-required"
  | "unavailable";

export const isAgentSessionActive = (status: AgentSessionStatus) =>
  status === "submitting" || status === "streaming" || status === "cancelling";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "activity";
  readonly content: string;
}

export interface RoleConversationState {
  readonly role: InteractiveAgentRole;
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
  readonly cancel: () => Promise<void>;
}

export interface AppConversationController extends RoleConversationState {
  readonly role: "app";
  readonly submit: (text: string) => Promise<void>;
}

export interface ShaperConversationController extends RoleConversationState {
  readonly role: "shaper";
  readonly shape: (
    instruction: string,
    document: InterfaceDocument,
  ) => Promise<InterfaceDocument>;
}

export interface AgentWorkspaceController {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly selectModel: (model: ModelSummary | undefined) => void;
  readonly refresh: () => Promise<void>;
  readonly externalExtensions: ExternalPiExtensionSelection;
  readonly toggleExternalExtensions: (
    role: InteractiveAgentRole,
  ) => Promise<void>;
  readonly app: AppConversationController;
  readonly shaper: ShaperConversationController;
  readonly productAction: ProductActionController;
  readonly diagnoseRecovery: (
    reason: RecoveryReason,
  ) => Promise<{ readonly version: 1; readonly message: string }>;
}

export interface ProductActionController {
  readonly pending: AgentProductActionRequest | undefined;
  readonly complete: (result: ProductActionResult) => Promise<void>;
  readonly deny: (message?: string) => Promise<void>;
}

interface ConversationSnapshot {
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
}

interface SessionHandle {
  readonly id: string;
  readonly selectionKey: string;
}

type RoleFiber = Fiber.Fiber<unknown, unknown>;

const initialConversation = (): ConversationSnapshot => ({
  status: "booting",
  messages: [],
  lastPrompt: "",
  error: undefined,
});

const messageId = () => crypto.randomUUID();

const sessionSelection = (
  selectedModel: ModelSummary | undefined,
  externalExtensions: ExternalPiExtensionSelection,
  productCapabilityId: string | undefined,
): SessionSelection =>
  new SessionSelection({
    ...(selectedModel === undefined
      ? {}
      : {
          model: new ModelSelection({
            provider: selectedModel.provider,
            id: selectedModel.id,
          }),
        }),
    ...(externalExtensions.app || externalExtensions.shaper
      ? { externalExtensions }
      : {}),
    ...(productCapabilityId === undefined ? {} : { productCapabilityId }),
  });

const modelSelectionKey = (
  selectedModel: ModelSummary | undefined,
  externalExtensions: ExternalPiExtensionSelection,
  productCapabilityId: string | undefined,
) =>
  JSON.stringify([
    selectedModel?.provider ?? "auto",
    selectedModel?.id ?? "auto",
    externalExtensions.app,
    externalExtensions.shaper,
    productCapabilityId ?? "none",
  ]);

const ensurePiSession = Effect.fn("Flect.AgentWorkspace.ensureSession")(
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

const appendBoundedActivity = (
  messages: ReadonlyArray<ConversationMessage>,
  message: ConversationMessage,
) => {
  const next = [...messages, message];
  const activity = next.filter((candidate) => candidate.role === "activity");
  if (activity.length <= 20) {
    return next;
  }
  const oldestActivity = activity[0];
  return next.filter((candidate) => candidate.id !== oldestActivity?.id);
};

export function useAgentSession(
  runtime: FlectBrowserRuntime = browserRuntime,
  productCapabilityId?: string,
): AgentWorkspaceController & {
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error: string | undefined;
  readonly submit: (text: string) => Promise<void>;
  readonly shape: (
    instruction: string,
    document: InterfaceDocument,
  ) => Promise<InterfaceDocument>;
  readonly cancel: () => Promise<void>;
} {
  const [models, setModels] = useState<ReadonlyArray<ModelSummary>>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSummary>();
  const [externalExtensions, setExternalExtensions] = useState(
    ExternalPiExtensionSelection.make({ app: false, shaper: false }),
  );
  const [appState, setAppState] = useState(initialConversation);
  const [shaperState, setShaperState] = useState(initialConversation);
  const [pendingProductAction, setPendingProductAction] = useState<
    AgentProductActionRequest | undefined
  >();
  const pendingProductActionRef = useRef<
    | {
        readonly sessionId: string;
        readonly request: AgentProductActionRequest;
      }
    | undefined
  >(undefined);
  const sessionRef = useRef<SessionHandle | undefined>(undefined);
  const requestRefs = useRef<
    Record<InteractiveAgentRole, RoleFiber | undefined>
  >({
    app: undefined,
    shaper: undefined,
  });
  const cancellingRefs = useRef<Record<InteractiveAgentRole, boolean>>({
    app: false,
    shaper: false,
  });

  const updateRole = useCallback(
    (
      role: InteractiveAgentRole,
      update: (current: ConversationSnapshot) => ConversationSnapshot,
    ) => {
      if (role === "app") {
        setAppState(update);
      } else {
        setShaperState(update);
      }
    },
    [],
  );

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

  const interruptRoleFibers = useCallback(() => {
    const fibers = [requestRefs.current.app, requestRefs.current.shaper].filter(
      (fiber): fiber is RoleFiber => fiber !== undefined,
    );
    requestRefs.current.app = undefined;
    requestRefs.current.shaper = undefined;
    return Effect.forEach(fibers, Fiber.interrupt, {
      concurrency: "unbounded",
      discard: true,
    });
  }, []);

  const refresh = useCallback(() => {
    pendingProductActionRef.current = undefined;
    setPendingProductAction(undefined);
    setAppState((current) => ({
      ...current,
      status: "booting",
      error: undefined,
    }));
    setShaperState((current) => ({
      ...current,
      status: "booting",
      error: undefined,
    }));
    const sessionId = sessionRef.current?.id;

    const load = Effect.gen(function* () {
      yield* interruptRoleFibers();
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
          FlectUnavailableError.make({
            message: "The local Flect runtime is unavailable.",
          }),
        );
      }

      if (availableModels.length === 0) {
        yield* Effect.sync(() => {
          setModels(availableModels);
          const setupRequired = (current: ConversationSnapshot) => ({
            ...current,
            status: "setup-required" as const,
            error: "Sign in to a Pi provider, then try again.",
          });
          setAppState(setupRequired);
          setShaperState(setupRequired);
        });
        return;
      }

      yield* Effect.sync(() => {
        setModels(availableModels);
        const ready = (current: ConversationSnapshot) => ({
          ...current,
          status: "ready" as const,
          error: undefined,
        });
        setAppState(ready);
        setShaperState(ready);
      });
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          setModels([]);
          const unavailable = (current: ConversationSnapshot) => ({
            ...current,
            status: "unavailable" as const,
            error: "Start the local Flect runtime to continue.",
          });
          setAppState(unavailable);
          setShaperState(unavailable);
        }),
      ),
    );

    return runtime.runPromise(load);
  }, [interruptRoleFibers, releaseSession, runtime]);

  useEffect(() => {
    void refresh();
    return () => {
      const sessionId = sessionRef.current?.id;
      runtime.runFork(
        interruptRoleFibers().pipe(
          Effect.andThen(
            sessionId === undefined ? Effect.void : releaseSession(sessionId),
          ),
        ),
      );
    };
  }, [interruptRoleFibers, refresh, releaseSession, runtime]);

  const selection = useMemo(
    () =>
      sessionSelection(selectedModel, externalExtensions, productCapabilityId),
    [externalExtensions, productCapabilityId, selectedModel],
  );
  const selectionKey = useMemo(
    () =>
      modelSelectionKey(selectedModel, externalExtensions, productCapabilityId),
    [externalExtensions, productCapabilityId, selectedModel],
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

  const executeShellRequest = useCallback(
    (
      sessionId: string,
      role: InteractiveAgentRole,
      event: { readonly requestId: string; readonly command: string },
    ) =>
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const shell = yield* SandboxedShell;
        yield* Effect.sync(() => {
          updateRole(role, (current) => ({
            ...current,
            messages: appendBoundedActivity(current.messages, {
              id: messageId(),
              role: "activity",
              content: `${role === "app" ? "App Agent" : "Shaper"} used its sandbox.`,
            }),
          }));
        });
        const result = yield* shell.execute(role, event.command).pipe(
          Effect.catch(() =>
            Effect.succeed(
              BunCommandResult.make({
                version: 1,
                exitCode: 1,
                stdout: "",
                stderr: "bash: command failed safely\n",
              }),
            ),
          ),
        );
        yield* client.completeShellRequest(
          sessionId,
          role,
          event.requestId,
          result,
        );
      }),
    [updateRole],
  );

  const handleAppEvent = useCallback(
    (
      assistantId: string,
      sessionId: string,
      event: FlectEvent,
    ): Effect.Effect<
      void,
      FlectUnavailableError,
      FlectClient | SandboxedShell
    > => {
      if (event.type === "shell_request") {
        return executeShellRequest(sessionId, "app", event);
      }
      if (event.type === "product_action_request") {
        return Effect.sync(() => {
          if (pendingProductActionRef.current !== undefined) return;
          pendingProductActionRef.current = { sessionId, request: event };
          setPendingProductAction(event);
          setAppState((current) => ({
            ...current,
            messages: appendBoundedActivity(current.messages, {
              id: messageId(),
              role: "activity",
              content: "App Agent proposed a product action.",
            }),
          }));
        });
      }
      return Effect.sync(() => {
        setAppState((current) => {
          switch (event.type) {
            case "turn_started":
              return { ...current, status: "streaming" };
            case "text_delta":
              return {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + event.delta }
                    : message,
                ),
              };
            case "turn_completed":
            case "cancelled":
              return { ...current, status: "ready", error: undefined };
            case "error":
            case "busy":
              return { ...current, status: "error", error: event.message };
          }
        });
      });
    },
    [executeShellRequest],
  );

  const completeProductAction = useCallback(
    (result: ProductActionResult): Promise<void> => {
      const current = pendingProductActionRef.current;
      if (current === undefined) return Promise.resolve();
      const completion = Effect.gen(function* () {
        const client = yield* FlectClient;
        yield* client.completeProductActionRequest(
          current.sessionId,
          current.request.requestId,
          result,
        );
        yield* Effect.sync(() => {
          if (
            pendingProductActionRef.current?.request.requestId ===
            current.request.requestId
          ) {
            pendingProductActionRef.current = undefined;
            setPendingProductAction(undefined);
          }
        });
      });
      return runtime.runPromise(completion);
    },
    [runtime],
  );

  const denyProductAction = useCallback(
    (message = "The product action was cancelled.") =>
      completeProductAction(
        ProductActionResult.make({
          version: 1,
          status: "denied",
          resultJson: JSON.stringify({ message }),
        }),
      ),
    [completeProductAction],
  );

  const submit = useCallback(
    (text: string): Promise<void> => {
      const prompt = text.trim();
      if (
        !prompt ||
        (appState.status !== "ready" && appState.status !== "error")
      ) {
        return Promise.resolve();
      }

      const assistantId = messageId();
      setAppState((current) => ({
        ...current,
        lastPrompt: prompt,
        error: undefined,
        status: "submitting",
        messages: [
          ...current.messages,
          { id: messageId(), role: "user", content: prompt },
          { id: assistantId, role: "assistant", content: "" },
        ],
      }));

      const request = Effect.gen(function* () {
        const client = yield* FlectClient;
        const sessionId = yield* ensureSession();
        yield* client.prompt(sessionId, prompt).pipe(
          Stream.runForEach((event) => {
            const update = handleAppEvent(assistantId, sessionId, event);
            return event.type === "error"
              ? update.pipe(Effect.andThen(releaseSession(sessionId)))
              : update;
          }),
          Effect.tapError((failure) =>
            failure._tag === "SessionBusy"
              ? Effect.void
              : releaseSession(sessionId),
          ),
        );
      }).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            setAppState((current) => ({
              ...current,
              status: "error",
              error: failure.message,
            }));
          }),
        ),
      );

      const fiber = runtime.runFork(request);
      requestRefs.current.app = fiber;
      return runtime
        .runPromise(Fiber.await(fiber))
        .then(() => undefined)
        .finally(() => {
          if (requestRefs.current.app === fiber) {
            requestRefs.current.app = undefined;
          }
        });
    },
    [appState.status, ensureSession, handleAppEvent, releaseSession, runtime],
  );

  const shape = useCallback(
    (
      instruction: string,
      document: InterfaceDocument,
    ): Promise<InterfaceDocument> => {
      const prompt = instruction.trim();
      if (
        !prompt ||
        (shaperState.status !== "ready" && shaperState.status !== "error")
      ) {
        return Promise.reject(
          FlectUnavailableError.make({
            message: "The local Flect runtime is unavailable.",
          }),
        );
      }

      setShaperState((current) => ({
        ...current,
        lastPrompt: prompt,
        error: undefined,
        status: "submitting",
        messages: [
          ...current.messages,
          { id: messageId(), role: "user", content: prompt },
        ],
      }));

      const request = Effect.gen(function* () {
        const client = yield* FlectClient;
        const sessionId = yield* ensureSession();
        const shaped = yield* client.shape(sessionId, prompt, document).pipe(
          Stream.tap((event) =>
            event.type === "shell_request"
              ? executeShellRequest(sessionId, "shaper", event)
              : Effect.void,
          ),
          Stream.runFold(
            () => Option.none<InterfaceDocument>(),
            (current, event) =>
              event.type === "shape_completed"
                ? Option.some(event.document)
                : current,
          ),
          Effect.tapError((failure) =>
            failure._tag === "SessionBusy"
              ? Effect.void
              : releaseSession(sessionId),
          ),
        );
        const candidate = yield* Option.match(shaped, {
          onNone: () =>
            Effect.fail(
              FlectUnavailableError.make({
                message: "The local Flect runtime is unavailable.",
              }),
            ),
          onSome: Effect.succeed,
        });
        yield* Effect.sync(() => {
          setShaperState((current) => ({
            ...current,
            status: "ready",
            error: undefined,
            messages: [
              ...current.messages,
              {
                id: messageId(),
                role: "assistant",
                content: `Preview ready: ${candidate.name}`,
              },
            ],
          }));
        });
        return candidate;
      }).pipe(
        Effect.tapError((failure) =>
          Effect.sync(() => {
            setShaperState((current) => ({
              ...current,
              status: "error",
              error: failure.message,
            }));
          }),
        ),
      );

      const fiber = runtime.runFork(request);
      requestRefs.current.shaper = fiber;
      return runtime.runPromise(Fiber.join(fiber)).finally(() => {
        if (requestRefs.current.shaper === fiber) {
          requestRefs.current.shaper = undefined;
        }
      });
    },
    [
      ensureSession,
      executeShellRequest,
      releaseSession,
      runtime,
      shaperState.status,
    ],
  );

  const cancelRole = useCallback(
    (role: InteractiveAgentRole): Promise<void> => {
      if (cancellingRefs.current[role]) {
        return Promise.resolve();
      }
      const request = requestRefs.current[role];
      const sessionId = sessionRef.current?.id;
      cancellingRefs.current[role] = true;
      updateRole(role, (current) => ({ ...current, status: "cancelling" }));

      const cancelRequest = Effect.gen(function* () {
        if (sessionId !== undefined) {
          const client = yield* FlectClient;
          yield* client.cancel(sessionId, role);
        }
        if (request !== undefined) {
          yield* Fiber.interrupt(request);
        }
        if (role === "app") {
          yield* Effect.sync(() => {
            pendingProductActionRef.current = undefined;
            setPendingProductAction(undefined);
          });
        }
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            requestRefs.current[role] = undefined;
            updateRole(role, (current) => ({
              ...current,
              status: "ready",
              error: undefined,
            }));
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            updateRole(role, (current) => ({
              ...current,
              status: "cancelling",
              error: "The response could not be stopped. Try again.",
            }));
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            cancellingRefs.current[role] = false;
          }),
        ),
      );
      return runtime.runPromise(cancelRequest);
    },
    [runtime, updateRole],
  );

  const cancelApp = useCallback(() => cancelRole("app"), [cancelRole]);
  const cancelShaper = useCallback(() => cancelRole("shaper"), [cancelRole]);

  const toggleExternalExtensions = useCallback(
    (role: InteractiveAgentRole) => {
      const sessionId = sessionRef.current?.id;
      setExternalExtensions((current) =>
        ExternalPiExtensionSelection.make({
          ...current,
          [role]: !current[role],
        }),
      );
      const reset = (current: ConversationSnapshot) => ({
        ...current,
        status:
          current.status === "unavailable" ||
          current.status === "setup-required"
            ? current.status
            : ("ready" as const),
        error: undefined,
      });

      return runtime
        .runPromise(
          interruptRoleFibers().pipe(
            Effect.andThen(
              sessionId === undefined ? Effect.void : releaseSession(sessionId),
            ),
          ),
        )
        .then(() => {
          setAppState(reset);
          setShaperState(reset);
        });
    },
    [interruptRoleFibers, releaseSession, runtime],
  );

  const selectModel = useCallback(
    (model: ModelSummary | undefined) => {
      const sessionId = sessionRef.current?.id;
      runtime.runFork(
        interruptRoleFibers().pipe(
          Effect.andThen(
            sessionId === undefined ? Effect.void : releaseSession(sessionId),
          ),
        ),
      );
      setSelectedModel(model);
      const reset = (current: ConversationSnapshot) => ({
        ...current,
        status:
          current.status === "booting" ||
          current.status === "unavailable" ||
          current.status === "setup-required"
            ? current.status
            : ("ready" as const),
        error: undefined,
      });
      setAppState(reset);
      setShaperState(reset);
    },
    [interruptRoleFibers, releaseSession, runtime],
  );

  const diagnoseRecovery = useCallback(
    (reason: RecoveryReason) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const sessionId = yield* ensureSession();
          return yield* client
            .diagnoseRecovery(sessionId, reason)
            .pipe(
              Effect.tapError((failure) =>
                failure._tag === "SessionBusy"
                  ? Effect.void
                  : releaseSession(sessionId),
              ),
            );
        }),
      ),
    [ensureSession, releaseSession, runtime],
  );

  const app: AppConversationController = {
    role: "app",
    ...appState,
    submit,
    cancel: cancelApp,
  };
  const productAction: ProductActionController = {
    pending: pendingProductAction,
    complete: completeProductAction,
    deny: denyProductAction,
  };
  const shaper: ShaperConversationController = {
    role: "shaper",
    ...shaperState,
    shape,
    cancel: cancelShaper,
  };

  return {
    models,
    selectedModel,
    selectModel,
    refresh,
    externalExtensions,
    toggleExternalExtensions,
    app,
    shaper,
    productAction,
    diagnoseRecovery,
    status: app.status,
    messages: app.messages,
    lastPrompt: app.lastPrompt,
    error: app.error,
    submit: app.submit,
    shape: shaper.shape,
    cancel: app.cancel,
  };
}
