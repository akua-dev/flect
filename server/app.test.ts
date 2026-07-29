import { describe, expect, it, vi } from "vitest";
import type {
  FlectEvent,
  RuntimeStatus,
  SessionSelection,
} from "../shared/contracts";
import { createApp } from "./app";
import type { FlectRuntime } from "./runtime";

function createFakeRuntime(): FlectRuntime {
  return {
    status: async (): Promise<RuntimeStatus> => ({
      version: 1,
      status: "ready",
    }),
    listModels: async () => [
      {
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      },
    ],
    createSession: vi.fn(async (_selection?: SessionSelection) => "session-1"),
    prompt: vi.fn(
      async (
        _sessionId: string,
        _text: string,
        emit: (event: FlectEvent) => void,
      ) => {
        emit({ type: "turn_started" });
        emit({ type: "text_delta", delta: "Shaped" });
        emit({ type: "turn_completed" });
      },
    ),
    cancel: vi.fn(async () => undefined),
  };
}

function request(
  path: string,
  init?: RequestInit,
  origin = "http://127.0.0.1:5173",
) {
  const headers = new Headers(init?.headers);
  headers.set("origin", origin);
  if (init?.body) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1:3210${path}`, {
    ...init,
    headers,
  });
}

describe("createApp", () => {
  it("returns strict runtime and model responses", async () => {
    const app = createApp(createFakeRuntime());

    const status = await app(request("/api/runtime"));
    const models = await app(request("/api/models"));

    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({
      version: 1,
      status: "ready",
    });
    await expect(models.json()).resolves.toEqual({
      version: 1,
      models: [
        {
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
        },
      ],
    });
  });

  it("creates a selected session", async () => {
    const runtime = createFakeRuntime();
    const app = createApp(runtime);

    const response = await app(
      request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          model: { provider: "openai-codex", id: "gpt-5.6" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      sessionId: "session-1",
    });
    expect(runtime.createSession).toHaveBeenCalledWith({
      model: { provider: "openai-codex", id: "gpt-5.6" },
    });
  });

  it("streams public events as SSE", async () => {
    const app = createApp(createFakeRuntime());

    const response = await app(
      request("/api/sessions/session-1/prompts", {
        method: "POST",
        body: JSON.stringify({ text: "Shape this" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toBe(
      [
        'data: {"type":"turn_started"}',
        "",
        'data: {"type":"text_delta","delta":"Shaped"}',
        "",
        'data: {"type":"turn_completed"}',
        "",
        "",
      ].join("\n"),
    );
  });

  it("cancels a session", async () => {
    const runtime = createFakeRuntime();
    const app = createApp(runtime);

    const response = await app(
      request("/api/sessions/session-1/cancel", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: "cancelled",
    });
    expect(runtime.cancel).toHaveBeenCalledWith("session-1");
  });

  it("rejects malformed JSON and blank prompts", async () => {
    const app = createApp(createFakeRuntime());

    const malformed = await app(
      request("/api/sessions", { method: "POST", body: "{" }),
    );
    const blank = await app(
      request("/api/sessions/session-1/prompts", {
        method: "POST",
        body: JSON.stringify({ text: "   " }),
      }),
    );

    expect(malformed.status).toBe(400);
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toEqual({
      version: 1,
      error: "Invalid request",
    });
  });

  it("rejects unexpected origins", async () => {
    const app = createApp(createFakeRuntime());

    const response = await app(
      request("/api/runtime", undefined, "https://unexpected.example"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: "Origin not allowed",
    });
  });

  it("never returns credential-shaped keys", async () => {
    const app = createApp(createFakeRuntime());
    const responses = await Promise.all([
      app(request("/api/runtime")),
      app(request("/api/models")),
      app(
        request("/api/sessions", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      ),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(await response.json());
      expect(body).not.toMatch(/token|secret|credential|apiKey/i);
    }
  });
});
