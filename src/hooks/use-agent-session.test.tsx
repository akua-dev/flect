// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ModelSummary, RuntimeStatus } from "../../shared/contracts";
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
  prompt = () =>
    Stream.fromIterable([
      { type: "turn_started" as const },
      { type: "text_delta" as const, delta: "A shaped response" },
      { type: "turn_completed" as const },
    ]),
}: {
  readonly prompt?: FlectClientShape["prompt"];
} = {}) {
  const client: FlectClientShape = {
    status: Effect.succeed(new RuntimeStatus({ version: 1, status: "ready" })),
    models: Effect.succeed([
      new ModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
    ]),
    createSession: vi.fn(() => Effect.succeed("session-1")),
    prompt: vi.fn(prompt),
    cancel: vi.fn(() => Effect.void),
  };
  const storage: InterfaceStorageShape = {
    read: () => Effect.succeed(null),
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
    await runtime.dispose();
  });

  it("preserves a failed prompt for retry", async () => {
    const { runtime } = createFakeRuntime({
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
    unmount();
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
    await runtime.dispose();
  });
});
