import { describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { BunCommandResult } from "../shared/bun-command";
import {
  ModelSummary,
  PiOperationFailed,
  SessionBusy,
  SessionNotFound,
  SessionSelection,
  ShapeCompleted,
} from "../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
  InvalidInterfaceDocument,
} from "../shared/interface-document";
import {
  acquireProtectedAgentSet,
  FlectRuntimeLive,
  type PiAgentSet,
  type PiEvent,
  PiSdk,
  type PiSession,
  type PiSessionPolicy,
} from "./pi-runtime";
import { FlectRuntime } from "./runtime";

type FakeOptions = {
  readonly abortFailure?: boolean;
  readonly promptFailure?: boolean;
  readonly promptResponse?: string;
  readonly guardianResponse?: string;
  readonly promptGate?: Deferred.Deferred<void>;
  readonly promptStarted?: Deferred.Deferred<void>;
  readonly appPromptGate?: Deferred.Deferred<void>;
  readonly appPromptStarted?: Deferred.Deferred<void>;
  readonly shaperPromptGate?: Deferred.Deferred<void>;
  readonly shaperPromptStarted?: Deferred.Deferred<void>;
  readonly pendingPromptStarted?: Deferred.Deferred<void>;
  readonly abortStarted?: Deferred.Deferred<void>;
  readonly abortGate?: Deferred.Deferred<void>;
  readonly pairObserved?: Deferred.Deferred<void>;
  readonly shellRequest?: {
    readonly requestId: string;
    readonly command: string;
    readonly started: Deferred.Deferred<void>;
    readonly completed: Deferred.Deferred<BunCommandResult>;
  };
};

function createFakePi(options: FakeOptions = {}) {
  let guardianListener: ((delta: string) => void) | undefined;
  let releasePendingPrompt: (() => void) | undefined;
  const guardianUnsubscribe = vi.fn();
  const guardianAbort = vi.fn(() => Effect.void);
  const guardianDispose = vi.fn(() => undefined);
  const guardianPrompt = vi.fn(() =>
    Effect.sync(() =>
      guardianListener?.(
        options.guardianResponse ?? "The protected launcher remains available.",
      ),
    ),
  );

  const makeInteractiveSession = (
    role: "app" | "shaper",
    sessionId: string,
  ) => {
    let listener: ((event: PiEvent) => void) | undefined;
    let promptCalls = 0;
    const unsubscribe = vi.fn();
    const abort = vi.fn(() =>
      Effect.gen(function* () {
        if (options.abortStarted !== undefined) {
          yield* Deferred.succeed(options.abortStarted, undefined);
        }
        if (options.abortGate !== undefined) {
          yield* Deferred.await(options.abortGate);
        }
        if (options.abortFailure) {
          return yield* Effect.fail(
            new PiOperationFailed({
              operation: "cancel",
              message: "The model runtime could not complete the request.",
            }),
          );
        }
      }),
    );
    const dispose = vi.fn(() => undefined);
    const prompt = vi.fn((_: string) => {
      promptCalls += 1;
      if (options.promptFailure) {
        return Effect.fail(
          new PiOperationFailed({
            operation: "prompt",
            message: "The model runtime could not complete the request.",
          }),
        );
      }
      const pendingPromptStarted =
        role === "app" ? options.pendingPromptStarted : undefined;
      if (pendingPromptStarted !== undefined && promptCalls === 1) {
        const pending = new Promise<void>((resolve) => {
          releasePendingPrompt = resolve;
        });
        return Effect.gen(function* () {
          yield* Deferred.succeed(pendingPromptStarted, undefined);
          yield* Effect.tryPromise({
            try: () => pending,
            catch: () =>
              new PiOperationFailed({
                operation: "prompt",
                message: "The model runtime could not complete the request.",
              }),
          });
          listener?.({
            type: "text_delta",
            delta: options.promptResponse ?? "A shaped response",
          });
        });
      }
      return Effect.gen(function* () {
        const promptStarted =
          role === "app"
            ? (options.appPromptStarted ?? options.promptStarted)
            : (options.shaperPromptStarted ?? options.promptStarted);
        const promptGate =
          role === "app"
            ? (options.appPromptGate ?? options.promptGate)
            : (options.shaperPromptGate ?? options.promptGate);
        if (promptStarted !== undefined) {
          yield* Deferred.succeed(promptStarted, undefined);
        }
        if (promptGate !== undefined) {
          yield* Deferred.await(promptGate);
        }
        if (
          role === "shaper" &&
          options.shellRequest !== undefined &&
          promptCalls === 1
        ) {
          yield* Deferred.succeed(options.shellRequest.started, undefined);
          listener?.({
            type: "shell_request",
            requestId: options.shellRequest.requestId,
            command: options.shellRequest.command,
          });
          yield* Deferred.await(options.shellRequest.completed);
        }
        listener?.({
          type: "text_delta",
          delta: options.promptResponse ?? "A shaped response",
        });
      });
    });
    const completeShellRequest = vi.fn(
      (_requestId: string, result: BunCommandResult) =>
        role === "shaper" && options.shellRequest !== undefined
          ? Deferred.succeed(options.shellRequest.completed, result).pipe(
              Effect.asVoid,
            )
          : Effect.void,
    );
    const session: PiSession = {
      sessionId,
      subscribe: (next) =>
        Effect.sync(() => {
          listener = next;
          return unsubscribe;
        }),
      prompt,
      completeShellRequest,
      get abort() {
        if (role === "app" && options.pairObserved !== undefined) {
          Effect.runSync(Deferred.succeed(options.pairObserved, undefined));
        }
        return abort;
      },
      dispose: Effect.sync(dispose),
    };
    return {
      abort,
      completeShellRequest,
      dispose,
      prompt,
      session,
      unsubscribe,
    };
  };

  const app = makeInteractiveSession("app", "session-1");
  const shaper = makeInteractiveSession("shaper", "shaper-1");

  const guardian: PiSession = {
    sessionId: "guardian-1",
    subscribe: (next) =>
      Effect.sync(() => {
        guardianListener = (delta) => next({ type: "text_delta", delta });
        return guardianUnsubscribe;
      }),
    prompt: guardianPrompt,
    completeShellRequest: () => Effect.void,
    abort: guardianAbort,
    dispose: Effect.sync(guardianDispose),
  };

  const createAgentSet = vi.fn(
    (
      _model: ModelSummary,
      _policies: {
        readonly guardian: PiSessionPolicy;
        readonly app: PiSessionPolicy;
        readonly shaper: PiSessionPolicy;
      },
    ): Effect.Effect<PiAgentSet> =>
      Effect.succeed({
        guardian,
        app: app.session,
        shaper: shaper.session,
      }),
  );

  const layer = Layer.succeed(PiSdk)({
    listModels: Effect.succeed([
      new ModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
    ]),
    createAgentSet,
  });

  return {
    appAbort: app.abort,
    appCompleteShellRequest: app.completeShellRequest,
    appDispose: app.dispose,
    appPrompt: app.prompt,
    appUnsubscribe: app.unsubscribe,
    createAgentSet,
    guardianAbort,
    guardianDispose,
    guardianPrompt,
    guardianUnsubscribe,
    layer: FlectRuntimeLive.pipe(Layer.provide(layer)),
    releasePendingPrompt: () => releasePendingPrompt?.(),
    shaperAbort: shaper.abort,
    shaperCompleteShellRequest: shaper.completeShellRequest,
    shaperDispose: shaper.dispose,
    shaperPrompt: shaper.prompt,
    shaperUnsubscribe: shaper.unsubscribe,
  };
}

describe("FlectRuntimeLive", () => {
  it.effect("disposes Guardian when App Agent acquisition fails", () => {
    const guardianDispose = vi.fn(() => undefined);
    const createSession = vi.fn((policy: PiSessionPolicy) =>
      policy.role === "app"
        ? Effect.fail(
            new PiOperationFailed({
              operation: "create_session",
              message: "The model runtime could not complete the request.",
            }),
          )
        : Effect.succeed({
            sessionId: policy.role,
            subscribe: () => Effect.succeed(() => undefined),
            prompt: () => Effect.void,
            completeShellRequest: () => Effect.void,
            abort: () => Effect.void,
            dispose: Effect.sync(guardianDispose),
          } satisfies PiSession),
    );

    return Effect.gen(function* () {
      yield* acquireProtectedAgentSet(
        {
          guardian: {
            role: "guardian",
            tools: "none",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          app: {
            role: "app",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          shaper: {
            role: "shaper",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
        },
        createSession,
      ).pipe(Effect.flip);

      expect(createSession).toHaveBeenCalledTimes(2);
      expect(guardianDispose).toHaveBeenCalledOnce();
    });
  });

  it.effect("disposes Guardian and App when Shaper acquisition fails", () => {
    const guardianDispose = vi.fn(() => undefined);
    const appDispose = vi.fn(() => undefined);
    const createSession = vi.fn((policy: PiSessionPolicy) =>
      policy.role === "shaper"
        ? Effect.fail(
            new PiOperationFailed({
              operation: "create_session",
              message: "The model runtime could not complete the request.",
            }),
          )
        : Effect.succeed({
            sessionId: policy.role,
            subscribe: () => Effect.succeed(() => undefined),
            prompt: () => Effect.void,
            completeShellRequest: () => Effect.void,
            abort: () => Effect.void,
            dispose: Effect.sync(
              policy.role === "guardian" ? guardianDispose : appDispose,
            ),
          } satisfies PiSession),
    );

    return Effect.gen(function* () {
      yield* acquireProtectedAgentSet(
        {
          guardian: {
            role: "guardian",
            tools: "none",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          app: {
            role: "app",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          shaper: {
            role: "shaper",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
        },
        createSession,
      ).pipe(Effect.flip);

      expect(createSession).toHaveBeenCalledTimes(3);
      expect(guardianDispose).toHaveBeenCalledOnce();
      expect(appDispose).toHaveBeenCalledOnce();
    });
  });

  it.effect(
    "routes each operation to its independent protected Pi role",
    () => {
      const makeSession = (sessionId: string, response: string) => {
        let listener: ((event: PiEvent) => void) | undefined;
        const prompt = vi.fn(() =>
          Effect.sync(() => {
            listener?.({ type: "text_delta", delta: response });
          }),
        );
        const session: PiSession = {
          sessionId,
          subscribe: (next) =>
            Effect.sync(() => {
              listener = next;
              return () => {
                listener = undefined;
              };
            }),
          prompt,
          completeShellRequest: () => Effect.void,
          abort: () => Effect.void,
          dispose: Effect.void,
        };
        return { prompt, session };
      };
      const app = makeSession("app-1", "The product action completed.");
      const shaper = makeSession(
        "shaper-1",
        JSON.stringify(defaultInterfaceDocument),
      );
      const guardian = makeSession(
        "guardian-1",
        "The protected launcher remains available.",
      );
      const createAgentSet = vi.fn(
        (
          _model: ModelSummary,
          _policies: {
            readonly guardian: PiSessionPolicy;
            readonly app: PiSessionPolicy;
            readonly shaper: PiSessionPolicy;
          },
        ): Effect.Effect<PiAgentSet> =>
          Effect.succeed({
            guardian: guardian.session,
            app: app.session,
            shaper: shaper.session,
          }),
      );
      const piLayer = Layer.succeed(PiSdk)({
        listModels: Effect.succeed([
          new ModelSummary({
            provider: "openai-codex",
            id: "gpt-5.6",
            name: "GPT-5.6",
          }),
        ]),
        createAgentSet,
      });

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );

        yield* runtime
          .prompt(sessionId, "Use the product")
          .pipe(Stream.runDrain);
        yield* runtime
          .shape(sessionId, "Change the product", defaultInterfaceDocument)
          .pipe(Stream.runDrain);
        yield* runtime.diagnoseRecovery(sessionId, "rollback-failed");

        expect(app.prompt).toHaveBeenCalledWith("Use the product");
        expect(shaper.prompt).toHaveBeenCalledOnce();
        expect(guardian.prompt).toHaveBeenCalledOnce();
        expect(createAgentSet).toHaveBeenCalledWith(expect.any(ModelSummary), {
          guardian: {
            role: "guardian",
            tools: "none",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          app: {
            role: "app",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          shaper: {
            role: "shaper",
            tools: "sandbox-bash",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
        });
      }).pipe(Effect.provide(FlectRuntimeLive.pipe(Layer.provide(piLayer))));
    },
  );

  it.effect("cancels only the selected interactive role", () => {
    const appStarted = Deferred.makeUnsafe<void>();
    const appGate = Deferred.makeUnsafe<void>();
    const shaperStarted = Deferred.makeUnsafe<void>();
    const shaperGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      appPromptStarted: appStarted,
      appPromptGate: appGate,
      shaperPromptStarted: shaperStarted,
      shaperPromptGate: shaperGate,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const appFiber = yield* runtime
        .prompt(sessionId, "Use the app")
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      const shaperFiber = yield* runtime
        .shape(sessionId, "Shape the app", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(appStarted);
      yield* Deferred.await(shaperStarted);

      const cancelFiber = yield* runtime
        .cancel(sessionId, "app")
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;

      expect(fake.appAbort).toHaveBeenCalledOnce();
      expect(fake.shaperAbort).not.toHaveBeenCalled();

      yield* Deferred.succeed(appGate, undefined);
      yield* Deferred.succeed(shaperGate, undefined);
      yield* Fiber.join(appFiber);
      yield* Fiber.join(shaperFiber);
      yield* Fiber.join(cancelFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("completes a shell request only in its selected role", () => {
    const fake = createFakePi();
    const result = BunCommandResult.make({
      version: 1,
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      yield* runtime.completeShellRequest(
        sessionId,
        "app",
        "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        result,
      );

      expect(fake.appCompleteShellRequest).toHaveBeenCalledWith(
        "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        result,
      );
      expect(fake.shaperCompleteShellRequest).not.toHaveBeenCalled();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("reduces Pi models to public schema values", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const models = yield* runtime.listModels;

      expect(models).toEqual([
        new ModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
        }),
      ]);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "keeps Guardian tool-free and gives Shaper only sandbox Bash",
    () => {
      const fake = createFakePi();
      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );

        expect(sessionId).toBe("session-1");
        expect(fake.createAgentSet).toHaveBeenCalledWith(
          new ModelSummary({
            provider: "openai-codex",
            id: "gpt-5.6",
            name: "GPT-5.6",
          }),
          {
            guardian: {
              role: "guardian",
              tools: "none",
              storage: "memory",
              extensions: "disabled",
              userResources: "disabled",
            },
            app: {
              role: "app",
              tools: "sandbox-bash",
              storage: "memory",
              extensions: "disabled",
              userResources: "disabled",
            },
            shaper: {
              role: "shaper",
              tools: "sandbox-bash",
              storage: "memory",
              extensions: "disabled",
              userResources: "disabled",
            },
          },
        );
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect(
    "disposes every protected Pi role when registration is interrupted",
    () => {
      const pairObserved = Deferred.makeUnsafe<void>();
      const fake = createFakePi({ pairObserved });

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const createFiber = yield* runtime
          .createSession(new SessionSelection({}))
          .pipe(Effect.forkChild({ startImmediately: true }));

        yield* Deferred.await(pairObserved);
        yield* Fiber.interrupt(createFiber);

        expect(fake.appDispose).toHaveBeenCalledOnce();
        expect(fake.shaperDispose).toHaveBeenCalledOnce();
        expect(fake.guardianDispose).toHaveBeenCalledOnce();
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect("maps Pi text deltas into a public Effect Stream", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const events = yield* runtime
        .prompt(sessionId, "Shape this")
        .pipe(Stream.runCollect);

      expect(events).toEqual([
        { type: "turn_started" },
        { type: "text_delta", delta: "A shaped response" },
        { type: "turn_completed" },
      ]);
      expect(fake.appUnsubscribe).toHaveBeenCalledOnce();
      expect(fake.appAbort).not.toHaveBeenCalled();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("returns browser sandbox results to the pending Pi tool", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const result = BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "42\n",
        stderr: "",
      });

      yield* runtime.completeShellRequest(
        sessionId,
        "shaper",
        "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        result,
      );

      expect(fake.shaperCompleteShellRequest).toHaveBeenCalledWith(
        "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        result,
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "releases a prompt operation before returning its terminal event",
    () => {
      const fake = createFakePi({
        promptResponse: JSON.stringify(defaultInterfaceDocument),
      });
      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );

        const events = yield* runtime
          .prompt(sessionId, "Keep talking")
          .pipe(Stream.runCollect);
        expect(events.at(-1)).toEqual({ type: "turn_completed" });

        const shaped = yield* runtime
          .shape(sessionId, "Shape this", defaultInterfaceDocument)
          .pipe(Stream.runCollect);
        expect(shaped).toEqual([
          ShapeCompleted.make({
            type: "shape_completed",
            document: defaultInterfaceDocument,
          }),
        ]);
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect("validates a Shaper proposal before returning it", () => {
    const shaped = InterfaceDocument.make({
      ...defaultInterfaceDocument,
      name: "Focused Flect",
    });
    const fake = createFakePi({
      promptResponse: JSON.stringify(shaped),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const result = yield* runtime
        .shape(sessionId, "Make this more focused", defaultInterfaceDocument)
        .pipe(Stream.runCollect);

      expect(result).toEqual([
        ShapeCompleted.make({ type: "shape_completed", document: shaped }),
      ]);
      expect(fake.shaperPrompt).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("services a browser shell request during shaping", () => {
    const shellRequest = {
      requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      command: "bun run src/index.ts",
      started: Deferred.makeUnsafe<void>(),
      completed: Deferred.makeUnsafe<BunCommandResult>(),
    };
    const shaped = InterfaceDocument.make({
      ...defaultInterfaceDocument,
      name: "Shell-assisted Flect",
    });
    const fake = createFakePi({
      shellRequest,
      promptResponse: JSON.stringify(shaped),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const fiber = yield* runtime
        .shape(sessionId, "Use the browser shell", defaultInterfaceDocument)
        .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }));

      yield* Deferred.await(shellRequest.started);
      expect(fiber.pollUnsafe()).toBeUndefined();

      const result = BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "42\n",
        stderr: "",
      });
      yield* runtime.completeShellRequest(
        sessionId,
        "shaper",
        shellRequest.requestId,
        result,
      );

      expect(yield* Fiber.join(fiber)).toEqual([
        {
          type: "shell_request",
          requestId: shellRequest.requestId,
          command: shellRequest.command,
        },
        ShapeCompleted.make({ type: "shape_completed", document: shaped }),
      ]);
      expect(fake.shaperCompleteShellRequest).toHaveBeenCalledWith(
        shellRequest.requestId,
        result,
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("validates the Shaper input before starting Pi work", () => {
    const fake = createFakePi();
    const invalidDocument = {
      version: 2,
      name: "Invalid",
      root: {
        id: "root",
        type: "stack",
        direction: "column",
        gap: "lg",
        children: [
          {
            id: "duplicate",
            type: "text",
            text: "One",
            style: "body",
          },
          {
            id: "duplicate",
            type: "text",
            text: "Two",
            style: "body",
          },
        ],
      },
    };

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const error = yield* runtime
        .shape(sessionId, "Keep this safe", invalidDocument)
        .pipe(Stream.runDrain, Effect.flip);

      expect(error).toEqual(
        InvalidInterfaceDocument.make({
          message: "The interface document is invalid.",
        }),
      );
      expect(fake.shaperPrompt).not.toHaveBeenCalled();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("keeps App and Shaper operation slots independent", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      appPromptGate: promptGate,
      appPromptStarted: promptStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const promptFiber = yield* runtime
        .prompt(sessionId, "Keep talking")
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const shaped = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Stream.runCollect);
      expect(shaped).toEqual([
        ShapeCompleted.make({
          type: "shape_completed",
          document: defaultInterfaceDocument,
        }),
      ]);
      expect(fake.appPrompt).toHaveBeenCalledOnce();
      expect(fake.shaperPrompt).toHaveBeenCalledOnce();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(promptFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("cancels an active Shaper during a pending shell request", () => {
    const shellRequest = {
      requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      command: "bun run src/index.ts",
      started: Deferred.makeUnsafe<void>(),
      completed: Deferred.makeUnsafe<BunCommandResult>(),
    };
    const fake = createFakePi({
      shellRequest,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(shellRequest.started);

      const cancelFiber = yield* runtime
        .cancel(sessionId, "shaper")
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;
      expect(fake.shaperAbort).toHaveBeenCalledOnce();
      expect(cancelFiber.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(
        shellRequest.completed,
        BunCommandResult.make({
          version: 1,
          exitCode: 130,
          stdout: "",
          stderr: "bash: operation cancelled\n",
        }),
      );
      yield* Fiber.join(shapeFiber);
      yield* Fiber.join(cancelFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "waits for an interrupted prompt before acknowledging cancel",
    () => {
      const promptStarted = Deferred.makeUnsafe<void>();
      const promptGate = Deferred.makeUnsafe<void>();
      const abortStarted = Deferred.makeUnsafe<void>();
      const fake = createFakePi({
        promptGate,
        promptStarted,
        abortStarted,
      });

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );
        const promptFiber = yield* runtime
          .prompt(sessionId, "Keep talking")
          .pipe(
            Stream.runCollect,
            Effect.forkChild({ startImmediately: true }),
          );
        yield* Deferred.await(promptStarted);

        const cancelFiber = yield* runtime
          .cancel(sessionId, "app")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(abortStarted);
        yield* Effect.yieldNow;
        expect(cancelFiber.pollUnsafe()).toBeUndefined();

        yield* Deferred.succeed(promptGate, undefined);
        const events = yield* Fiber.join(promptFiber);
        expect(events.at(-1)).toEqual({ type: "cancelled" });
        yield* Fiber.join(cancelFiber);
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect("aborts Pi work when the request consumer is interrupted", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const abortStarted = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      abortStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const interruptFiber = yield* Fiber.interrupt(shapeFiber).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(abortStarted);
      expect(fake.shaperAbort).toHaveBeenCalledOnce();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(interruptFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("holds the session slot while cancellation is claimed", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const abortStarted = Deferred.makeUnsafe<void>();
    const abortGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      abortStarted,
      abortGate,
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const promptFiber = yield* runtime
        .prompt(sessionId, "Keep talking")
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const cancelFiber = yield* runtime
        .cancel(sessionId, "app")
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(abortStarted);
      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(promptFiber);

      const busy = yield* runtime
        .prompt(sessionId, "Do not abort this newer turn")
        .pipe(Stream.runDrain, Effect.flip);
      expect(busy).toEqual(
        new SessionBusy({
          sessionId,
          message: "The session is busy.",
        }),
      );

      yield* Deferred.succeed(abortGate, undefined);
      yield* Fiber.join(cancelFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "keeps an interrupted Pi promise occupying its session slot",
    () => {
      const pendingPromptStarted = Deferred.makeUnsafe<void>();
      const fake = createFakePi({
        abortFailure: true,
        pendingPromptStarted,
        promptResponse: JSON.stringify(defaultInterfaceDocument),
      });

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );
        const promptFiber = yield* runtime
          .prompt(sessionId, "Keep talking")
          .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(pendingPromptStarted);

        const cancelError = yield* runtime
          .cancel(sessionId, "app")
          .pipe(Effect.flip);
        expect(cancelError).toEqual(
          new PiOperationFailed({
            operation: "cancel",
            message: "The model runtime could not complete the request.",
          }),
        );
        yield* Fiber.interrupt(promptFiber);

        const busy = yield* runtime
          .prompt(sessionId, "Start another request")
          .pipe(Stream.runDrain, Effect.flip);
        expect(busy).toEqual(
          new SessionBusy({
            sessionId,
            message: "The session is busy.",
          }),
        );
        expect(fake.appPrompt).toHaveBeenCalledOnce();

        fake.releasePendingPrompt();
        yield* Effect.yieldNow;
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect(
    "rejects conflicts and waits before disposing an active session",
    () => {
      const promptStarted = Deferred.makeUnsafe<void>();
      const promptGate = Deferred.makeUnsafe<void>();
      const fake = createFakePi({
        promptGate,
        promptStarted,
        promptResponse: JSON.stringify(defaultInterfaceDocument),
      });

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        const sessionId = yield* runtime.createSession(
          new SessionSelection({}),
        );
        const shapeFiber = yield* runtime
          .shape(sessionId, "Shape this", defaultInterfaceDocument)
          .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(promptStarted);

        const busy = yield* runtime
          .shape(sessionId, "Keep shaping", defaultInterfaceDocument)
          .pipe(Stream.runDrain, Effect.flip);
        expect(busy).toEqual(
          new SessionBusy({
            sessionId,
            message: "The session is busy.",
          }),
        );

        const closeFiber = yield* runtime
          .closeSession(sessionId)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        expect(fake.appDispose).not.toHaveBeenCalled();
        expect(fake.shaperDispose).not.toHaveBeenCalled();

        yield* Deferred.succeed(promptGate, undefined);
        yield* Fiber.join(shapeFiber);
        yield* Fiber.join(closeFiber);
        expect(fake.appDispose).toHaveBeenCalledOnce();
        expect(fake.shaperDispose).toHaveBeenCalledOnce();
        expect(fake.guardianDispose).toHaveBeenCalledOnce();
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect("completes disposal when the close fiber is interrupted", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const abortStarted = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      abortStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const closeFiber = yield* runtime
        .closeSession(sessionId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(abortStarted);
      const interruptedClose = yield* Fiber.interrupt(closeFiber).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      expect(fake.appDispose).not.toHaveBeenCalled();
      expect(fake.shaperDispose).not.toHaveBeenCalled();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(shapeFiber);
      yield* Fiber.join(interruptedClose);
      expect(fake.appDispose).toHaveBeenCalledOnce();
      expect(fake.shaperDispose).toHaveBeenCalledOnce();
      expect(fake.guardianDispose).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("forces disposal after an unresponsive active operation", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const abortStarted = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      abortStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const closeFiber = yield* runtime
        .closeSession(sessionId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(abortStarted);
      yield* TestClock.adjust("2 seconds");
      yield* Fiber.join(closeFiber);
      expect(shapeFiber.pollUnsafe()).not.toBeUndefined();

      expect(fake.appDispose).toHaveBeenCalledOnce();
      expect(fake.shaperDispose).toHaveBeenCalledOnce();
      expect(fake.guardianDispose).toHaveBeenCalledOnce();
      yield* Fiber.interrupt(shapeFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("aborts and bounds oversized Shaper responses", () => {
    const fake = createFakePi({
      promptResponse: "x".repeat(256 * 1024 + 1),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const error = yield* runtime
        .shape(sessionId, "Make it huge", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.flip);
      yield* Effect.yieldNow;

      expect(error).toEqual(
        new PiOperationFailed({
          operation: "shape",
          message: "The model runtime could not complete the request.",
        }),
      );
      expect(fake.shaperAbort).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("fails closed when Shaper returns an invalid document", () => {
    const fake = createFakePi({
      promptResponse: '{"version":2,"name":"Unsafe","root":{"type":"script"}}',
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const error = yield* runtime
        .shape(sessionId, "Run a script", defaultInterfaceDocument)
        .pipe(Stream.runDrain, Effect.flip);

      expect(error).toEqual(
        new PiOperationFailed({
          operation: "shape",
          message: "The model runtime could not complete the request.",
        }),
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("redacts Pi prompt failures into a public event", () => {
    const fake = createFakePi({ promptFailure: true });
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const events = yield* runtime
        .prompt(sessionId, "Shape this")
        .pipe(Stream.runCollect);

      expect(events.at(-1)).toEqual({
        type: "error",
        message: "The model could not complete this turn.",
      });
      expect(JSON.stringify(events)).not.toContain("not-a-real-secret");
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("cancels the active Pi turn", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));

      yield* runtime.cancel(sessionId, "app");
      expect(fake.appAbort).not.toHaveBeenCalled();
      expect(fake.shaperAbort).not.toHaveBeenCalled();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("uses Guardian for a narrow recovery diagnostic", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));

      const diagnostic = yield* runtime.diagnoseRecovery(
        sessionId,
        "rollback-failed",
      );

      expect(diagnostic).toEqual({
        version: 1,
        message: "The protected launcher remains available.",
      });
      expect(fake.guardianPrompt).toHaveBeenCalledOnce();
      expect(fake.guardianUnsubscribe).toHaveBeenCalledOnce();
      expect(fake.appPrompt).not.toHaveBeenCalled();
      expect(fake.shaperPrompt).not.toHaveBeenCalled();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("aborts and bounds oversized Guardian diagnostics", () => {
    const fake = createFakePi({
      guardianResponse: "x".repeat(16 * 1024 + 1),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const error = yield* runtime
        .diagnoseRecovery(sessionId, "rollback-failed")
        .pipe(Effect.flip);
      yield* Effect.yieldNow;

      expect(error).toEqual(
        new PiOperationFailed({
          operation: "diagnose",
          message: "The model runtime could not complete the request.",
        }),
      );
      expect(fake.guardianAbort).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("closes and disposes all protected Pi sessions", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));

      yield* runtime.closeSession(sessionId);
      const error = yield* runtime.cancel(sessionId, "app").pipe(Effect.flip);

      expect(error).toEqual(
        new SessionNotFound({
          sessionId,
          message: "Session not found.",
        }),
      );
      expect(fake.appAbort).toHaveBeenCalledOnce();
      expect(fake.shaperAbort).toHaveBeenCalledOnce();
      expect(fake.guardianAbort).toHaveBeenCalledOnce();
      expect(fake.appDispose).toHaveBeenCalledOnce();
      expect(fake.shaperDispose).toHaveBeenCalledOnce();
      expect(fake.guardianDispose).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "evicts the oldest protected agent set when the session bound is reached",
    () => {
      let sequence = 0;
      const firstAppAbort = vi.fn(() => Effect.void);
      const firstShaperAbort = vi.fn(() => Effect.void);
      const firstGuardianAbort = vi.fn(() => Effect.void);
      const firstAppDispose = vi.fn(() => undefined);
      const firstShaperDispose = vi.fn(() => undefined);
      const firstGuardianDispose = vi.fn(() => undefined);
      const makeSession = (
        sessionId: string,
        abort: () => Effect.Effect<void>,
        dispose: () => void,
      ): PiSession => ({
        sessionId,
        subscribe: () => Effect.succeed(() => undefined),
        prompt: () => Effect.void,
        completeShellRequest: () => Effect.void,
        abort,
        dispose: Effect.sync(dispose),
      });
      const piLayer = Layer.succeed(PiSdk)({
        listModels: Effect.succeed([
          new ModelSummary({
            provider: "openai-codex",
            id: "gpt-5.6",
            name: "GPT-5.6",
          }),
        ]),
        createAgentSet: () => {
          sequence += 1;
          const isFirst = sequence === 1;
          return Effect.succeed({
            app: makeSession(
              `session-${sequence}`,
              isFirst ? firstAppAbort : () => Effect.void,
              isFirst ? firstAppDispose : () => undefined,
            ),
            shaper: makeSession(
              `shaper-${sequence}`,
              isFirst ? firstShaperAbort : () => Effect.void,
              isFirst ? firstShaperDispose : () => undefined,
            ),
            guardian: makeSession(
              `guardian-${sequence}`,
              isFirst ? firstGuardianAbort : () => Effect.void,
              isFirst ? firstGuardianDispose : () => undefined,
            ),
          });
        },
      });
      const layer = FlectRuntimeLive.pipe(Layer.provide(piLayer));

      return Effect.gen(function* () {
        const runtime = yield* FlectRuntime;
        yield* Effect.forEach(
          Array.from({ length: 33 }),
          () => runtime.createSession(new SessionSelection({})),
          { discard: true },
        );
        const missing = yield* runtime
          .cancel("session-1", "app")
          .pipe(Effect.flip);

        expect(missing).toEqual(
          new SessionNotFound({
            sessionId: "session-1",
            message: "Session not found.",
          }),
        );
        expect(firstAppAbort).toHaveBeenCalledOnce();
        expect(firstShaperAbort).toHaveBeenCalledOnce();
        expect(firstGuardianAbort).toHaveBeenCalledOnce();
        expect(firstAppDispose).toHaveBeenCalledOnce();
        expect(firstShaperDispose).toHaveBeenCalledOnce();
        expect(firstGuardianDispose).toHaveBeenCalledOnce();
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("keeps missing sessions typed in the error channel", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const promptError = yield* runtime
        .prompt("missing", "Shape this")
        .pipe(Stream.runDrain, Effect.flip);
      const cancelError = yield* runtime
        .cancel("missing", "app")
        .pipe(Effect.flip);

      expect(promptError).toEqual(
        new SessionNotFound({
          sessionId: "missing",
          message: "Session not found.",
        }),
      );
      expect(cancelError).toEqual(promptError);
    }).pipe(Effect.provide(fake.layer));
  });
});
