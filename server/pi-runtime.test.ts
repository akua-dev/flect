import { describe, expect, it, vi } from "vitest";
import type { FlectEvent } from "../shared/contracts";
import { createPiRuntime, type PiEvent, type PiSdk } from "./pi-runtime";

type Listener = (event: PiEvent) => void;

function createFakeSdk(options?: { promptError?: Error }) {
  let listener: Listener | undefined;
  const abort = vi.fn(async () => undefined);
  const unsubscribe = vi.fn();
  const prompt = vi.fn(async () => {
    if (options?.promptError) {
      throw options.promptError;
    }

    listener?.({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "A shaped response",
      },
    });
  });
  const createSession = vi.fn(async () => ({
    session: {
      sessionId: "session-1",
      subscribe(nextListener: Listener) {
        listener = nextListener;
        return unsubscribe;
      },
      prompt,
      abort,
    },
  }));

  const sdk: PiSdk = {
    createModelRuntime: async () => ({
      getAvailable: async () => [
        {
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
          apiKey: "must-not-cross",
        },
      ],
    }),
    createSession,
    createSessionManager: () => ({ kind: "memory-session" }),
    createSettingsManager: () => ({ kind: "memory-settings" }),
    createResourceLoader: async () => ({ kind: "protected-resources" }),
  };

  return {
    abort,
    createSession,
    prompt,
    sdk,
    unsubscribe,
  };
}

describe("createPiRuntime", () => {
  it("reduces Pi models to public summaries", async () => {
    const { sdk } = createFakeSdk();
    const runtime = await createPiRuntime(sdk);

    expect(await runtime.listModels()).toEqual([
      {
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      },
    ]);
  });

  it("creates a tool-free in-memory Pi session", async () => {
    const { createSession, sdk } = createFakeSdk();
    const runtime = await createPiRuntime(sdk);

    await expect(runtime.createSession()).resolves.toBe("session-1");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        noTools: "all",
        sessionManager: { kind: "memory-session" },
        settingsManager: { kind: "memory-settings" },
        resourceLoader: { kind: "protected-resources" },
      }),
    );
  });

  it("maps Pi text deltas to public events", async () => {
    const { sdk, unsubscribe } = createFakeSdk();
    const runtime = await createPiRuntime(sdk);
    const sessionId = await runtime.createSession();
    const events: FlectEvent[] = [];

    await runtime.prompt(sessionId, "Shape this", (event) =>
      events.push(event),
    );

    expect(events).toEqual([
      { type: "turn_started" },
      { type: "text_delta", delta: "A shaped response" },
      { type: "turn_completed" },
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("redacts raw Pi errors", async () => {
    const { sdk } = createFakeSdk({
      promptError: new Error("token=not-a-real-secret"),
    });
    const runtime = await createPiRuntime(sdk);
    const sessionId = await runtime.createSession();
    const events: FlectEvent[] = [];

    await runtime.prompt(sessionId, "Shape this", (event) =>
      events.push(event),
    );

    expect(events.at(-1)).toEqual({
      type: "error",
      message: "The model could not complete this turn.",
    });
    expect(JSON.stringify(events)).not.toContain("not-a-real-secret");
  });

  it("cancels the active Pi turn", async () => {
    const { abort, sdk } = createFakeSdk();
    const runtime = await createPiRuntime(sdk);
    const sessionId = await runtime.createSession();

    await runtime.cancel(sessionId);

    expect(abort).toHaveBeenCalledOnce();
  });

  it("fails closed for unknown sessions", async () => {
    const { sdk } = createFakeSdk();
    const runtime = await createPiRuntime(sdk);

    await expect(
      runtime.prompt("missing", "Shape this", () => undefined),
    ).rejects.toThrow("Session not found");
    await expect(runtime.cancel("missing")).rejects.toThrow(
      "Session not found",
    );
  });
});
