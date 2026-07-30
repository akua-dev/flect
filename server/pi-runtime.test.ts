import { describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import {
  ModelSummary,
  PiOperationFailed,
  SessionBusy,
  SessionNotFound,
  SessionSelection,
} from "../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import {
  FlectRuntimeLive,
  type PiAgentPair,
  PiSdk,
  type PiSession,
  type PiSessionPolicy,
} from "./pi-runtime";
import { FlectRuntime } from "./runtime";

type FakeOptions = {
  readonly promptFailure?: boolean;
  readonly promptResponse?: string;
  readonly guardianResponse?: string;
  readonly promptGate?: Deferred.Deferred<void>;
  readonly promptStarted?: Deferred.Deferred<void>;
};

function createFakePi(options: FakeOptions = {}) {
  let listener: ((delta: string) => void) | undefined;
  let guardianListener: ((delta: string) => void) | undefined;
  const unsubscribe = vi.fn();
  const guardianUnsubscribe = vi.fn();
  const abort = vi.fn(() => Effect.void);
  const guardianAbort = vi.fn(() => Effect.void);
  const dispose = vi.fn(() => undefined);
  const guardianDispose = vi.fn(() => undefined);
  const prompt = vi.fn((_: string) =>
    options.promptFailure
      ? Effect.fail(
          new PiOperationFailed({
            operation: "prompt",
            message: "The model runtime could not complete the request.",
          }),
        )
      : Effect.gen(function* () {
          if (options.promptStarted !== undefined) {
            yield* Deferred.succeed(options.promptStarted, undefined);
          }
          if (options.promptGate !== undefined) {
            yield* Deferred.await(options.promptGate);
          }
          listener?.(options.promptResponse ?? "A shaped response");
        }),
  );
  const guardianPrompt = vi.fn(() =>
    Effect.sync(() =>
      guardianListener?.(
        options.guardianResponse ?? "The protected launcher remains available.",
      ),
    ),
  );

  const session: PiSession = {
    sessionId: "session-1",
    subscribe: (next) =>
      Effect.sync(() => {
        listener = (delta) => next({ type: "text_delta", delta });
        return unsubscribe;
      }),
    prompt,
    abort,
    dispose: Effect.sync(dispose),
  };

  const guardian: PiSession = {
    sessionId: "guardian-1",
    subscribe: (next) =>
      Effect.sync(() => {
        guardianListener = (delta) => next({ type: "text_delta", delta });
        return guardianUnsubscribe;
      }),
    prompt: guardianPrompt,
    abort: guardianAbort,
    dispose: Effect.sync(guardianDispose),
  };

  const createAgentPair = vi.fn(
    (
      _model: ModelSummary,
      _policies: {
        readonly guardian: PiSessionPolicy;
        readonly shaper: PiSessionPolicy;
      },
    ): Effect.Effect<PiAgentPair> =>
      Effect.succeed({
        guardian,
        shaper: session,
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
    createAgentPair,
  });

  return {
    abort,
    createAgentPair,
    dispose,
    guardianAbort,
    guardianDispose,
    guardianPrompt,
    guardianUnsubscribe,
    layer: FlectRuntimeLive.pipe(Layer.provide(layer)),
    prompt,
    unsubscribe,
  };
}

describe("FlectRuntimeLive", () => {
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

  it.effect("requests a protected tool-free in-memory Pi session", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));

      expect(sessionId).toBe("session-1");
      expect(fake.createAgentPair).toHaveBeenCalledWith(
        new ModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
        }),
        {
          guardian: {
            role: "guardian",
            noTools: "all",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
          shaper: {
            role: "shaper",
            noTools: "all",
            storage: "memory",
            extensions: "disabled",
            userResources: "disabled",
          },
        },
      );
    }).pipe(Effect.provide(fake.layer));
  });

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
      expect(fake.unsubscribe).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

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
      const result = yield* runtime.shape(
        sessionId,
        "Make this more focused",
        defaultInterfaceDocument,
      );

      expect(result).toEqual(shaped);
      expect(fake.prompt).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("rejects shaping while a prompt is active", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const promptFiber = yield* runtime
        .prompt(sessionId, "Keep talking")
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const shapeError = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Effect.flip);
      expect(shapeError).toEqual(
        new SessionBusy({
          sessionId,
          message: "The session is busy.",
        }),
      );
      expect(fake.prompt).toHaveBeenCalledOnce();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(promptFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("does not cancel an active Shaper when cancelling a session", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      yield* runtime.cancel(sessionId);
      expect(fake.abort).not.toHaveBeenCalled();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(shapeFiber);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("rejects conflicts and waits before disposing an active session", () => {
    const promptStarted = Deferred.makeUnsafe<void>();
    const promptGate = Deferred.makeUnsafe<void>();
    const fake = createFakePi({
      promptGate,
      promptStarted,
      promptResponse: JSON.stringify(defaultInterfaceDocument),
    });

    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));
      const shapeFiber = yield* runtime
        .shape(sessionId, "Shape this", defaultInterfaceDocument)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(promptStarted);

      const busy = yield* runtime
        .prompt(sessionId, "Keep talking")
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
      expect(fake.dispose).not.toHaveBeenCalled();

      yield* Deferred.succeed(promptGate, undefined);
      yield* Fiber.join(shapeFiber);
      yield* Fiber.join(closeFiber);
      expect(fake.dispose).toHaveBeenCalledOnce();
      expect(fake.guardianDispose).toHaveBeenCalledOnce();
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
        .pipe(Effect.flip);
      yield* Effect.yieldNow;

      expect(error).toEqual(
        new PiOperationFailed({
          operation: "shape",
          message: "The model runtime could not complete the request.",
        }),
      );
      expect(fake.abort).toHaveBeenCalledOnce();
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
        .pipe(Effect.flip);

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

      yield* runtime.cancel(sessionId);
      expect(fake.abort).not.toHaveBeenCalled();
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
      expect(fake.prompt).not.toHaveBeenCalled();
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

  it.effect("closes and disposes both protected Pi sessions", () => {
    const fake = createFakePi();
    return Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const sessionId = yield* runtime.createSession(new SessionSelection({}));

      yield* runtime.closeSession(sessionId);
      const error = yield* runtime.cancel(sessionId).pipe(Effect.flip);

      expect(error).toEqual(
        new SessionNotFound({
          sessionId,
          message: "Session not found.",
        }),
      );
      expect(fake.abort).toHaveBeenCalledOnce();
      expect(fake.guardianAbort).toHaveBeenCalledOnce();
      expect(fake.dispose).toHaveBeenCalledOnce();
      expect(fake.guardianDispose).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "evicts the oldest protected pair when the session bound is reached",
    () => {
      let sequence = 0;
      const firstShaperAbort = vi.fn(() => Effect.void);
      const firstGuardianAbort = vi.fn(() => Effect.void);
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
        createAgentPair: () => {
          sequence += 1;
          const isFirst = sequence === 1;
          return Effect.succeed({
            shaper: makeSession(
              `session-${sequence}`,
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
        const missing = yield* runtime.cancel("session-1").pipe(Effect.flip);

        expect(missing).toEqual(
          new SessionNotFound({
            sessionId: "session-1",
            message: "Session not found.",
          }),
        );
        expect(firstShaperAbort).toHaveBeenCalledOnce();
        expect(firstGuardianAbort).toHaveBeenCalledOnce();
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
      const cancelError = yield* runtime.cancel("missing").pipe(Effect.flip);

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
