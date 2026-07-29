import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import {
  ModelSummary,
  PiOperationFailed,
  SessionNotFound,
  SessionSelection,
} from "../shared/contracts";
import {
  FlectRuntimeLive,
  PiSdk,
  type PiSession,
  type PiSessionPolicy,
} from "./pi-runtime";
import { FlectRuntime } from "./runtime";

type FakeOptions = {
  readonly promptFailure?: boolean;
};

function createFakePi(options: FakeOptions = {}) {
  let listener: ((delta: string) => void) | undefined;
  const unsubscribe = vi.fn();
  const abort = vi.fn(() => Effect.void);
  const prompt = vi.fn((_: string) =>
    options.promptFailure
      ? Effect.fail(
          new PiOperationFailed({
            operation: "prompt",
            message: "The model runtime could not complete the request.",
          }),
        )
      : Effect.sync(() => listener?.("A shaped response")),
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
  };

  const createSession = vi.fn(
    (_model: ModelSummary, _policy: PiSessionPolicy) => Effect.succeed(session),
  );

  const layer = Layer.succeed(PiSdk)({
    listModels: Effect.succeed([
      new ModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
    ]),
    createSession,
  });

  return {
    abort,
    createSession,
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
      expect(fake.createSession).toHaveBeenCalledWith(
        new ModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
        }),
        {
          noTools: "all",
          storage: "memory",
          extensions: "disabled",
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
      expect(fake.abort).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(fake.layer));
  });

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
