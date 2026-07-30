import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Stream } from "effect";
import {
  GuardianDiagnostic,
  ModelSummary,
  ModelsResponse,
  RuntimeStatus,
  SessionBusy,
  SessionSelection,
  TextDelta,
  TurnCompleted,
  TurnStarted,
} from "../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import { createApp, type FlectWebApp } from "./app";
import type { FlectRuntimeShape } from "./runtime";

function createFakeRuntime(): FlectRuntimeShape {
  return {
    status: Effect.succeed(new RuntimeStatus({ version: 1, status: "ready" })),
    listModels: Effect.succeed([
      new ModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
    ]),
    createSession: vi.fn(() => Effect.succeed("session-1")),
    closeSession: vi.fn(() => Effect.void),
    prompt: vi.fn(() =>
      Stream.make(
        new TurnStarted({ type: "turn_started" }),
        new TextDelta({ type: "text_delta", delta: "Shaped" }),
        new TurnCompleted({ type: "turn_completed" }),
      ),
    ),
    shape: vi.fn(() =>
      Effect.succeed(
        InterfaceDocument.make({
          ...defaultInterfaceDocument,
          name: "Focused Flect",
        }),
      ),
    ),
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
}

const useApp = (runtime: FlectRuntimeShape) =>
  Effect.acquireRelease(
    Effect.sync(() => createApp(runtime)),
    (app) => Effect.promise(() => app.dispose()),
  );

const send = (app: FlectWebApp, request: Request) =>
  Effect.promise(() => app.handler(request));

const readJson = (response: Response) => Effect.promise(() => response.json());

const readText = (response: Response) => Effect.promise(() => response.text());

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

describe("Flect HTTP application", () => {
  it.effect("returns schema-encoded runtime and model responses", () =>
    Effect.gen(function* () {
      const app = yield* useApp(createFakeRuntime());
      const status = yield* send(app, request("/api/runtime"));
      const models = yield* send(app, request("/api/models"));

      expect(status.status).toBe(200);
      expect(yield* readJson(status)).toEqual({
        version: 1,
        status: "ready",
      });
      expect(yield* readJson(models)).toEqual(
        new ModelsResponse({
          version: 1,
          models: [
            new ModelSummary({
              provider: "openai-codex",
              id: "gpt-5.6",
              name: "GPT-5.6",
            }),
          ],
        }),
      );
    }),
  );

  it.effect("creates a selected session from a strict schema body", () => {
    const runtime = createFakeRuntime();
    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            model: { provider: "openai-codex", id: "gpt-5.6" },
          }),
        }),
      );

      expect(response.status).toBe(201);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        sessionId: "session-1",
      });
      expect(runtime.createSession).toHaveBeenCalledWith(
        new SessionSelection({
          model: { provider: "openai-codex", id: "gpt-5.6" },
        }),
      );
    });
  });

  it.effect("streams schema-encoded public events as SSE", () =>
    Effect.gen(function* () {
      const app = yield* useApp(createFakeRuntime());
      const response = yield* send(
        app,
        request("/api/sessions/session-1/prompts", {
          method: "POST",
          body: JSON.stringify({ text: "Shape this" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(yield* readText(response)).toBe(
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
    }),
  );

  it.effect(
    "streams a non-destructive busy event for a prompt conflict",
    () => {
      const runtime = {
        ...createFakeRuntime(),
        prompt: vi.fn(() =>
          Stream.fail(
            new SessionBusy({
              sessionId: "session-1",
              message: "The session is busy.",
            }),
          ),
        ),
      } satisfies FlectRuntimeShape;

      return Effect.gen(function* () {
        const app = yield* useApp(runtime);
        const response = yield* send(
          app,
          request("/api/sessions/session-1/prompts", {
            method: "POST",
            body: JSON.stringify({ text: "Keep talking" }),
          }),
        );

        expect(response.status).toBe(200);
        expect(yield* readText(response)).toBe(
          'data: {"type":"busy","message":"The session is busy."}\n\n',
        );
      });
    },
  );

  it.effect("cancels a session through the Effect service", () => {
    const runtime = createFakeRuntime();
    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions/session-1/cancel", { method: "POST" }),
      );

      expect(response.status).toBe(200);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        status: "cancelled",
      });
      expect(runtime.cancel).toHaveBeenCalledWith("session-1");
    });
  });

  it.effect("closes a session through the Effect service", () => {
    const runtime = createFakeRuntime();
    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions/session-1", { method: "DELETE" }),
      );

      expect(response.status).toBe(200);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        status: "closed",
      });
      expect(runtime.closeSession).toHaveBeenCalledWith("session-1");
    });
  });

  it.effect("returns a strictly validated interface proposal", () => {
    const runtime = createFakeRuntime();
    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions/session-1/shape", {
          method: "POST",
          body: JSON.stringify({
            instruction: "Make this more focused",
            document: defaultInterfaceDocument,
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        document: {
          ...defaultInterfaceDocument,
          name: "Focused Flect",
        },
      });
      expect(runtime.shape).toHaveBeenCalledWith(
        "session-1",
        "Make this more focused",
        defaultInterfaceDocument,
      );
    });
  });

  it.effect("returns a conflict response for a busy shaping session", () => {
    const runtime = {
      ...createFakeRuntime(),
      shape: vi.fn(() =>
        Effect.fail(
          new SessionBusy({
            sessionId: "session-1",
            message: "The session is busy.",
          }),
        ),
      ),
    } satisfies FlectRuntimeShape;

    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions/session-1/shape", {
          method: "POST",
          body: JSON.stringify({
            instruction: "Make this more focused",
            document: defaultInterfaceDocument,
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        error: "The session is busy.",
      });
    });
  });

  it.effect("returns a narrow Guardian recovery diagnostic", () => {
    const runtime = createFakeRuntime();
    return Effect.gen(function* () {
      const app = yield* useApp(runtime);
      const response = yield* send(
        app,
        request("/api/sessions/session-1/guardian", {
          method: "POST",
          body: JSON.stringify({ reason: "rollback-failed" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        message: "The protected launcher remains available.",
      });
      expect(runtime.diagnoseRecovery).toHaveBeenCalledWith(
        "session-1",
        "rollback-failed",
      );
    });
  });

  it.effect("rejects malformed JSON, blank prompts, and excess fields", () =>
    Effect.gen(function* () {
      const app = yield* useApp(createFakeRuntime());
      const malformed = yield* send(
        app,
        request("/api/sessions", { method: "POST", body: "{" }),
      );
      const blank = yield* send(
        app,
        request("/api/sessions/session-1/prompts", {
          method: "POST",
          body: JSON.stringify({ text: "   " }),
        }),
      );
      const excessive = yield* send(
        app,
        request("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ credential: "not-a-real-secret" }),
        }),
      );
      const invalidRecovery = yield* send(
        app,
        request("/api/sessions/session-1/guardian", {
          method: "POST",
          body: JSON.stringify({ reason: "run-arbitrary-repair" }),
        }),
      );

      expect(malformed.status).toBe(400);
      expect(blank.status).toBe(400);
      expect(excessive.status).toBe(400);
      expect(invalidRecovery.status).toBe(400);
      expect(yield* readJson(blank)).toEqual({
        version: 1,
        error: "Invalid request",
      });
      expect(JSON.stringify(yield* readJson(excessive))).not.toContain(
        "not-a-real-secret",
      );
    }),
  );

  it.effect("rejects unexpected origins in global middleware", () =>
    Effect.gen(function* () {
      const app = yield* useApp(createFakeRuntime());
      const response = yield* send(
        app,
        request("/api/runtime", undefined, "https://unexpected.example"),
      );

      expect(response.status).toBe(403);
      expect(yield* readJson(response)).toEqual({
        version: 1,
        error: "Origin not allowed",
      });
    }),
  );

  it.effect("never returns credential-shaped keys", () =>
    Effect.gen(function* () {
      const app = yield* useApp(createFakeRuntime());
      const responses = yield* Effect.all([
        send(app, request("/api/runtime")),
        send(app, request("/api/models")),
        send(
          app,
          request("/api/sessions", {
            method: "POST",
            body: JSON.stringify({}),
          }),
        ),
      ]);

      for (const response of responses) {
        const body = JSON.stringify(yield* readJson(response));
        expect(body).not.toMatch(/token|secret|credential|apiKey/i);
      }
    }),
  );
});
