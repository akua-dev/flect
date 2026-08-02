// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BunCommandResult } from "../../shared/bun-command";
import {
  AgentShellRequest,
  GuardianDiagnostic,
  ModelSummary,
  RuntimeStatus,
  SessionBusy,
  SessionSelection,
  ShapeCompleted,
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
import {
  defaultShellPreferences,
  ShellPreferences,
} from "../lib/shell-preferences";
import {
  SandboxedShell,
  type SandboxedShellShape,
} from "../shell/sandboxed-shell-service";
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
  shape = (_sessionId, _instruction, document) =>
    Stream.succeed(ShapeCompleted.make({ type: "shape_completed", document })),
  cancel = () => Effect.void,
  completeShellRequest = () => Effect.void,
  shellExecute = () =>
    Effect.succeed(
      BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    ),
  diagnoseRecovery = () =>
    Effect.succeed(
      new GuardianDiagnostic({
        version: 1,
        message: "The protected launcher remains available.",
      }),
    ),
}: {
  readonly createSession?: FlectClientShape["createSession"];
  readonly models?: ReadonlyArray<ModelSummary>;
  readonly prompt?: FlectClientShape["prompt"];
  readonly shape?: FlectClientShape["shape"];
  readonly cancel?: FlectClientShape["cancel"];
  readonly completeShellRequest?: FlectClientShape["completeShellRequest"];
  readonly shellExecute?: SandboxedShellShape["execute"];
  readonly diagnoseRecovery?: FlectClientShape["diagnoseRecovery"];
} = {}) {
  const client: FlectClientShape = {
    status: Effect.succeed(new RuntimeStatus({ version: 1, status: "ready" })),
    models: Effect.succeed(models),
    createSession: vi.fn(createSession),
    closeSession: vi.fn(() => Effect.void),
    prompt: vi.fn(prompt),
    shape: vi.fn(shape),
    cancel: vi.fn(cancel),
    completeShellRequest: vi.fn(completeShellRequest),
    diagnoseRecovery: vi.fn(diagnoseRecovery),
  };
  const shell: SandboxedShellShape = {
    execute: vi.fn(shellExecute),
    stop: () => Effect.void,
  };
  const storage: InterfaceStorageShape = {
    read: () => Effect.succeed(null),
    write: () => Effect.void,
    remove: () => Effect.void,
  };
  const runtime: FlectBrowserRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(FlectClient)(client),
      Layer.succeed(InterfaceStorage)(storage),
      Layer.succeed(SandboxedShell)(shell),
      Layer.succeed(ShellPreferences)({
        load: Effect.succeed(defaultShellPreferences),
        save: () => Effect.void,
      }),
    ),
  );

  return { client, runtime, shell };
}

describe("useAgentSession", () => {
  it("recreates a session with role-scoped external Pi extensions", async () => {
    const { client, runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.app.status).toBe("ready"));

    await act(async () => {
      await result.current.toggleExternalExtensions("shaper");
    });
    await waitFor(() =>
      expect(result.current.externalExtensions.shaper).toBe(true),
    );

    await act(async () => {
      await result.current.shaper.shape(
        "Use the enabled extension",
        defaultInterfaceDocument,
      );
    });

    expect(client.createSession).toHaveBeenLastCalledWith(
      new SessionSelection({
        externalExtensions: { app: false, shaper: true },
      }),
    );

    unmount();
    await runtime.dispose();
  });

  it("keeps App and Shaper conversations separate behind one session", async () => {
    const { client, runtime } = createFakeRuntime();
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.app.status).toBe("ready"));

    await act(async () => {
      await result.current.app.submit("Use the product");
      await result.current.shaper.shape(
        "Change the interface",
        defaultInterfaceDocument,
      );
    });

    expect(client.createSession).toHaveBeenCalledOnce();
    expect(result.current.app.messages).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "Use the product",
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "A shaped response",
      },
    ]);
    expect(result.current.shaper.messages).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "Change the interface",
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: `Preview ready: ${defaultInterfaceDocument.name}`,
      },
    ]);

    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

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

  it("runs an agent bash request in the browser sandbox and returns it", async () => {
    const shellResult = BunCommandResult.make({
      version: 1,
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    });
    const { client, runtime, shell } = createFakeRuntime({
      prompt: () =>
        Stream.fromIterable([
          { type: "turn_started" as const },
          AgentShellRequest.make({
            type: "shell_request",
            requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
            command: "bun run src/index.ts",
          }),
          { type: "turn_completed" as const },
        ]),
      shellExecute: () => Effect.succeed(shellResult),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.submit("Run the project");
    });

    expect(shell.execute).toHaveBeenCalledWith("app", "bun run src/index.ts");
    expect(client.completeShellRequest).toHaveBeenCalledWith(
      "session-1",
      "app",
      "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      shellResult,
    );
    unmount();
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

  it("services a Shaper shell request through the browser shell", async () => {
    const shellResult = BunCommandResult.make({
      version: 1,
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    });
    const { client, runtime, shell } = createFakeRuntime({
      shape: (_sessionId, _instruction, document) =>
        Stream.concat(
          Stream.succeed(
            AgentShellRequest.make({
              type: "shell_request",
              requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
              command: "bun run src/index.ts",
            }),
          ),
          Stream.succeed(
            ShapeCompleted.make({ type: "shape_completed", document }),
          ),
        ),
      shellExecute: () => Effect.succeed(shellResult),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.shape(
        "Use the browser shell",
        defaultInterfaceDocument,
      );
    });

    expect(shell.execute).toHaveBeenCalledWith(
      "shaper",
      "bun run src/index.ts",
    );
    expect(client.completeShellRequest).toHaveBeenCalledWith(
      "session-1",
      "shaper",
      "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      shellResult,
    );
    expect(result.current.shaper.messages).toContainEqual({
      id: expect.any(String),
      role: "activity",
      content: "Shaper used its sandbox.",
    });
    expect(JSON.stringify(result.current.shaper.messages)).not.toContain(
      "bun run src/index.ts",
    );
    unmount();
    await runtime.dispose();
  });

  it("preserves the session after a busy Shaper conflict", async () => {
    const { client, runtime } = createFakeRuntime({
      shape: () =>
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
    expect(result.current.shaper.status).toBe("error");
    expect(result.current.app.status).toBe("ready");
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("releases the session after a fatal Shaper failure", async () => {
    const { client, runtime } = createFakeRuntime({
      shape: () =>
        Stream.fail(
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
    expect(result.current.shaper.status).toBe("error");
    expect(result.current.app.status).toBe("ready");
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

    expect(client.cancel).toHaveBeenCalledWith("session-1", "app");
    expect(streamInterrupted).toBe(true);
    expect(result.current.status).toBe("ready");
    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("cancels Shaper without changing the App conversation", async () => {
    let shapeInterrupted = false;
    const { client, runtime } = createFakeRuntime({
      shape: () =>
        Stream.never.pipe(
          Stream.ensuring(
            Effect.sync(() => {
              shapeInterrupted = true;
            }),
          ),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.app.status).toBe("ready"));

    let shapeOutcome: Promise<unknown> | undefined;
    act(() => {
      shapeOutcome = result.current.shaper
        .shape("Keep shaping", defaultInterfaceDocument)
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    });
    await waitFor(() => expect(client.shape).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.shaper.cancel();
    });

    expect(client.cancel).toHaveBeenCalledWith("session-1", "shaper");
    expect(shapeInterrupted).toBe(true);
    expect(result.current.shaper.status).toBe("ready");
    expect(result.current.app.status).toBe("ready");
    expect(await shapeOutcome).toBeDefined();

    unmount();
    await waitFor(() => expect(client.closeSession).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("keeps the session active when cancellation is rejected", async () => {
    const { client, runtime } = createFakeRuntime({
      prompt: () => Stream.never,
      cancel: () =>
        Effect.fail(
          new FlectUnavailableError({
            message: "The local Flect runtime is unavailable.",
          }),
        ),
    });
    const { result, unmount } = renderHook(() => useAgentSession(runtime));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      void result.current.submit("Keep this prompt");
    });
    await waitFor(() => expect(client.prompt).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.status).toBe("cancelling");
    expect(result.current.error).toBe(
      "The response could not be stopped. Try again.",
    );
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
    expect(result.current.app.messages).toHaveLength(4);
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

  it("releases the session after a fatal Guardian failure", async () => {
    const { client, runtime } = createFakeRuntime({
      diagnoseRecovery: () =>
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
        result.current.diagnoseRecovery("rollback-failed"),
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

  it("preserves the session after a busy Guardian conflict", async () => {
    const { client, runtime } = createFakeRuntime({
      diagnoseRecovery: () =>
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
        result.current.diagnoseRecovery("rollback-failed"),
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
});
