// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  GuardianDiagnostic,
  ModelSummary,
  RuntimeStatus,
  SessionBusy,
} from "../../shared/contracts";
import { defaultInterfaceDocument } from "../../shared/interface-document";
import {
  FlectClient,
  type FlectClientShape,
  FlectUnavailableError,
} from "../lib/api";
import {
  InterfaceStorage,
  type InterfaceStorageShape,
} from "../lib/interface-store";
import type { FlectBrowserRuntime } from "../lib/runtime";
import { useAgentSession } from "./use-agent-session";

function createFakeRuntime({
  createSession = () => Effect.succeed("session-1"),
  models = [
    new ModelSummary({
      provider: "openai-codex",
      id: "gpt-5.6",
      name: "GPT-5.6",
    }),
  ],
  prompt = () =>
    Stream.fromIterable([
      { type: "turn_started" as const },
      { type: "text_delta" as const, delta: "A shaped response" },
      { type: "turn_completed" as const },
    ]),
  shape = (_sessionId, _instruction, document) => Effect.succeed(document),
}: {
  readonly createSession?: FlectClientShape["createSession"];
  readonly models?: ReadonlyArray<ModelSummary>;
  readonly prompt?: FlectClientShape["prompt"];
  readonly shape?: FlectClientShape["shape"];
} = {}) {
  const client: FlectClientShape = {
    status: Effect.succeed(new RuntimeStatus({ version: 1, status: "ready" })),
    models: Effect.succeed(models),
    createSession: vi.fn(createSession),
    closeSession: vi.fn(() => Effect.void),
    prompt: vi.fn(prompt),
    shape: vi.fn(shape),
    cancel: vi.fn(() => Effect.void),
    diagnoseRecovery: vi.fn(() =>
      Effect.succeed(
        new GuardianDiagnostic({
          version: 1,
          message: "The protected launcher remains available.",
        }),
      ),
    ),
  };
  const storage: InterfaceStorageShape = {
    read: () => Effect.succeed(null),
    write: () => Effect.void,
    remove: () => Effect.void,
  };
  const runtime: FlectBrowserRuntime = ManagedRuntime.make(
    Layer.merge(
      Layer.succeed(FlectClient)(client),
      Layer.succeed(InterfaceStorage)(storage),
    ),
  );

  return { client, runtime };
}

describe("useAgentSession", () => {
  it("boots into a ready state with Pi models", async () => {
    const { runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0]?.name).toBe("GPT-5.6");
    unmount();
    await runtime.dispose();
  });

  it("requires Pi setup when no authenticated models are available", async () => {
    const { client, runtime } = createFakeRuntime({ models: [] });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));

    await waitFor(() => expect(result.current.status).toBe("setup-required"));

    expect(result.current.error).toBe(
      "Sign in to a Pi provider, then try again.",
    );
    await act(async () => {
      await result.current.submit("This must not create a session");
    });
    expect(client.createSession).not.toHaveBeenCalled();
    unmount();
    await runtime.dispose();
  });

  it("creates one session and appends streamed text", async () => {
    const { client, runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Shape this");
    });
    await act(async () => {
      await result.current.submit("And this");
    });

    expect(client.createSession).toHaveBeenCalledOnce();
    expect(result.current.messages).toEqual([
      { id: expect.any(String), role: "user", content: "Shape this" },
      {
        id: expect.any(String),
        role: "assistant",
        content: "A shaped response",
      },
      { id: expect.any(String), role: "user", content: "And this" },
      {
        id: expect.any(String),
        role: "assistant",
        content: "A shaped response",
      },
    ]);
    expect(result.current.status).toBe("ready");
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("uses the protected Shaper session for interface proposals", async () => {
    const { client, runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const document = await act(() =>
      result.current.shape("Make it focused", defaultInterfaceDocument),
    );

    expect(document).toEqual(defaultInterfaceDocument);
    expect(client.createSession).toHaveBeenCalledOnce();
    expect(client.shape).toHaveBeenCalledWith(
      "session-1",
      "Make it focused",
      defaultInterfaceDocument,
    );
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("preserves the session after a busy Shaper conflict", async () => {
    const { client, runtime } = createFakeRuntime({
      shape: () =>
        Effect.fail(
          new SessionBusy({
            sessionId: "session-1",
            message: "The session is busy.",
          }),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await expect(
        result.current.shape("Make it focused", defaultInterfaceDocument),
      ).rejects.toEqual(
        new SessionBusy({
          sessionId: "session-1",
          message: "The session is busy.",
        }),
      );
    });

    expect(client.closeSession).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("releases the session after a fatal Shaper failure", async () => {
    const { client, runtime } = createFakeRuntime({
      shape: () =>
        Effect.fail(
          new FlectUnavailableError({
            message: "The local Flect runtime is unavailable.",
          }),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await expect(
        result.current.shape("Make it focused", defaultInterfaceDocument),
      ).rejects.toEqual(
        new FlectUnavailableError({
          message: "The local Flect runtime is unavailable.",
        }),
      );
    });

    await waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith("session-1"),
    );
    unmount();
    await runtime.dispose();
  });

  it("preserves a failed prompt for retry", async () => {
    const { client, runtime } = createFakeRuntime({
      prompt: () =>
        Stream.fail(
          new FlectUnavailableError({
            message: "The local Flect runtime is unavailable.",
          }),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Keep this prompt");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.lastPrompt).toBe("Keep this prompt");
    expect(client.closeSession).toHaveBeenCalledWith("session-1");
    unmount();
    await runtime.dispose();
  });

  it("preserves the active session after a busy prompt conflict", async () => {
    const { client, runtime } = createFakeRuntime({
      prompt: () =>
        Stream.fail(
          new SessionBusy({
            sessionId: "session-1",
            message: "The session is busy.",
          }),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Keep the active shape");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("The session is busy.");
    expect(client.closeSession).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("replaces a session after Pi returns a redacted turn error", async () => {
    let sequence = 0;
    const { client, runtime } = createFakeRuntime({
      createSession: () => Effect.succeed(`session-${++sequence}`),
      prompt: () =>
        Stream.make({
          type: "error" as const,
          message: "The model could not complete this turn.",
        }),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Try once");
      await result.current.submit("Try with a fresh session");
    });

    expect(client.closeSession).toHaveBeenCalledWith("session-1");
    expect(client.createSession).toHaveBeenCalledTimes(2);
    unmount();
    await waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith("session-2"),
    );
    await runtime.dispose();
  });

  it("cancels through both the runtime and active Effect fiber", async () => {
    let streamInterrupted = false;
    const { client, runtime } = createFakeRuntime({
      prompt: () =>
        Stream.never.pipe(
          Stream.ensuring(
            Effect.sync(() => {
              streamInterrupted = true;
            }),
          ),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      void result.current.submit("Shape this");
    });
    await waitFor(() => expect(client.prompt).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.cancel();
    });

    expect(client.cancel).toHaveBeenCalledWith("session-1");
    expect(streamInterrupted).toBe(true);
    expect(result.current.status).toBe("ready");
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("replaces the protected session when model selection changes", async () => {
    let sequence = 0;
    const models = [
      new ModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
      new ModelSummary({
        provider: "anthropic",
        id: "claude-sonnet",
        name: "Claude Sonnet",
      }),
    ];
    const { client, runtime } = createFakeRuntime({
      models,
      createSession: () => Effect.succeed(`session-${++sequence}`),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Use automatic selection");
    });
    act(() => {
      result.current.selectModel(models[1]);
    });
    await waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith("session-1"),
    );
    await act(async () => {
      await result.current.submit("Use Claude");
    });

    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(client.prompt).toHaveBeenLastCalledWith("session-2", "Use Claude");
    unmount();
    await waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith("session-2"),
    );
    await runtime.dispose();
  });

  it("invalidates the protected session when the runtime is refreshed", async () => {
    let sequence = 0;
    const { client, runtime } = createFakeRuntime({
      createSession: () => Effect.succeed(`session-${++sequence}`),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Before refresh");
      await result.current.refresh();
      await result.current.submit("After refresh");
    });

    expect(client.closeSession).toHaveBeenCalledWith("session-1");
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(client.prompt).toHaveBeenLastCalledWith(
      "session-2",
      "After refresh",
    );
    unmount();
    await waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith("session-2"),
    );
    await runtime.dispose();
  });

  it("uses the protected Guardian only for typed recovery diagnostics", async () => {
    const { client, runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const diagnostic = await act(() =>
      result.current.diagnoseRecovery("rollback-failed"),
    );

    expect(diagnostic.message).toBe(
      "The protected launcher remains available.",
    );
    expect(client.diagnoseRecovery).toHaveBeenCalledWith(
      "session-1",
      "rollback-failed",
    );
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });
});
