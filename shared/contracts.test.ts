import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  AgentShellResultRequest,
  AuthLoginEvent,
  AuthSelectionReply,
  CancelRequest,
  decodeFlectEvent,
  decodeModelSummary,
  decodePromptRequest,
  decodeRuntimeStatus,
  decodeSessionSelection,
  decodeShapeEvent,
  ModelSummary,
  PromptRequest,
  ProviderAuthSummary,
  RuntimeStatus,
  SessionSelection,
} from "./contracts";

describe("runtime contracts", () => {
  it.effect("requires a closed role on cancellation requests", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(CancelRequest, {
        errors: "all",
        onExcessProperty: "error",
      });

      expect(yield* decode({ role: "app" })).toEqual(
        CancelRequest.make({ role: "app" }),
      );
      expect(yield* decode({ role: "shaper" })).toEqual(
        CancelRequest.make({ role: "shaper" }),
      );
      yield* decode({}).pipe(Effect.flip);
      yield* decode({ role: "guardian" }).pipe(Effect.flip);
      yield* decode({ role: "app", credential: "not-a-real-secret" }).pipe(
        Effect.flip,
      );
    }),
  );

  it.effect("requires a closed role on browser-shell results", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(AgentShellResultRequest, {
        errors: "all",
        onExcessProperty: "error",
      });
      const shellResult = {
        requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        result: {
          version: 1 as const,
          exitCode: 0,
          stdout: "42\n",
          stderr: "",
        },
      };

      expect(yield* decode({ role: "shaper", ...shellResult })).toEqual(
        AgentShellResultRequest.make({ role: "shaper", ...shellResult }),
      );
      yield* decode(shellResult).pipe(Effect.flip);
      yield* decode({ role: "guardian", ...shellResult }).pipe(Effect.flip);
    }),
  );

  it.effect("decodes a public model summary into its schema class", () =>
    Effect.gen(function* () {
      const model = yield* decodeModelSummary({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
        reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
      });

      expect(model).toEqual(
        new ModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
          reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
        }),
      );
    }),
  );

  it.effect("projects only bounded provider authentication metadata", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(ProviderAuthSummary, {
        errors: "all",
        onExcessProperty: "error",
      });
      const provider = yield* decode({
        version: 1,
        id: "openai-codex",
        name: "OpenAI Codex",
        status: "connected",
        sourceLabel: "OAuth",
        credentialType: "oauth",
        methods: [
          {
            type: "oauth",
            label: "ChatGPT subscription",
          },
        ],
      });

      expect(provider.status).toBe("connected");
      expect(provider.methods[0]?.type).toBe("oauth");
      yield* decode({
        ...provider,
        accessToken: "secret-provider-canary",
      }).pipe(Effect.flip);
      yield* decode({
        ...provider,
        sourceLabel: "x".repeat(241),
      }).pipe(Effect.flip);
    }),
  );

  it.effect("accepts only safe correlated login interaction events", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(AuthLoginEvent, {
        errors: "all",
        onExcessProperty: "error",
      });
      const started = yield* decode({
        type: "auth_started",
        loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        providerId: "openai-codex",
      });
      const selection = yield* decode({
        type: "auth_selection_required",
        loginId: started.loginId,
        promptId: "prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        message: "Choose a login method",
        options: [
          { id: "browser", label: "Browser login" },
          { id: "device", label: "Device code" },
        ],
      });
      const protectedEntry = yield* decode({
        type: "auth_protected_entry",
        loginId: started.loginId,
        promptId: "prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d3",
        label: "Enter credential securely",
        url: "http://127.0.0.1:43123/entry/one-use-path",
      });

      expect(selection.type).toBe("auth_selection_required");
      expect(protectedEntry.type).toBe("auth_protected_entry");
      yield* decode({
        ...protectedEntry,
        url: "http://attacker.invalid/entry/token",
      }).pipe(Effect.flip);
      yield* decode({
        ...selection,
        credential: "secret-provider-canary",
      }).pipe(Effect.flip);
    }),
  );

  it.effect("bounds safe selection replies to one login prompt", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(AuthSelectionReply, {
        errors: "all",
        onExcessProperty: "error",
      });
      const reply = yield* decode({
        loginId: "login-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        promptId: "prompt-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        optionId: "browser",
      });
      expect(reply.optionId).toBe("browser");
      yield* decode({
        ...reply,
        optionId: "x".repeat(81),
      }).pipe(Effect.flip);
    }),
  );

  it.effect("rejects credential-shaped model fields", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
          apiKey: "not-a-real-secret",
        }),
      );

      expect(error.message).toBe("Invalid contract value.");
      expect(error.message).not.toContain("not-a-real-secret");
    }),
  );

  it.effect("rejects credential-shaped event fields", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeFlectEvent({
          type: "error",
          message: "The model could not complete this turn.",
          credential: "not-a-real-secret",
        }),
      );

      expect(error.message).toBe("Invalid contract value.");
      expect(error.message).not.toContain("not-a-real-secret");
    }),
  );

  it.effect(
    "decodes a typed busy turn without treating it as a fatal error",
    () =>
      Effect.gen(function* () {
        const event = yield* decodeFlectEvent({
          type: "busy",
          message: "The session is busy.",
        });

        expect(event).toEqual({
          type: "busy",
          message: "The session is busy.",
        });
      }),
  );

  it.effect("decodes a bounded browser-shell request from the agent", () =>
    Effect.gen(function* () {
      const event = yield* decodeFlectEvent({
        type: "shell_request",
        requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        command: "bun run src/index.ts",
      });

      expect(event).toEqual({
        type: "shell_request",
        requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
        command: "bun run src/index.ts",
      });
    }),
  );

  it.effect(
    "decodes visible tool lifecycle events without arbitrary details",
    () =>
      Effect.gen(function* () {
        const started = yield* decodeFlectEvent({
          type: "tool_execution_started",
          role: "app",
          callId: "call-1",
          toolName: "bash",
          startedAt: 10,
          inputSummary: "bun test",
        });
        const completed = yield* decodeFlectEvent({
          type: "tool_execution_completed",
          role: "app",
          callId: "call-1",
          toolName: "bash",
          completedAt: 25,
          durationMs: 15,
          status: "succeeded",
          resultSummary: "Exit code: 0",
          exitCode: 0,
        });

        expect(started.type).toBe("tool_execution_started");
        expect(completed.type).toBe("tool_execution_completed");
        yield* decodeFlectEvent({
          ...started,
          credential: "not-a-real-secret",
        }).pipe(Effect.flip);
      }),
  );

  it.effect("decodes only bounded trusted Pi extension failures", () =>
    Effect.gen(function* () {
      const input = {
        type: "external_extension_failed",
        role: "app",
        failureId: "extension-failure-1",
        stage: "turn",
        message: "A trusted Pi extension failed.",
        recovery: "Disable trusted Pi extensions for this agent and retry.",
      };
      const promptEvent = yield* decodeFlectEvent(input);
      const shapeEvent = yield* decodeShapeEvent({ ...input, role: "shaper" });

      expect(promptEvent.type).toBe("external_extension_failed");
      expect(shapeEvent.type).toBe("external_extension_failed");
      yield* decodeFlectEvent({
        ...input,
        path: "/Users/example/.pi/agent/extensions/broken.ts",
        error: "private extension error",
      }).pipe(Effect.flip);
    }),
  );

  it.effect("decodes actionable Shaper validation issues", () =>
    Effect.gen(function* () {
      const event = yield* decodeShapeEvent({
        type: "proposal_validation_failed",
        attempt: 1,
        issues: [
          {
            path: ["root", "children", 0, "style"],
            code: "required",
            message: "Required field is missing.",
          },
        ],
      });

      expect(event.type).toBe("proposal_validation_failed");
      if (event.type !== "proposal_validation_failed") {
        return yield* Effect.die("Expected a proposal validation event.");
      }
      expect(event.issues[0]?.path).toEqual(["root", "children", 0, "style"]);
    }),
  );

  it.effect("trims prompts and requires visible text", () =>
    Effect.gen(function* () {
      yield* Effect.flip(decodePromptRequest({ text: "   " }));

      const prompt = yield* decodePromptRequest({ text: "  Shape this  " });
      expect(prompt).toEqual(new PromptRequest({ text: "Shape this" }));
    }),
  );

  it.effect("supports automatic and explicit model selection", () =>
    Effect.gen(function* () {
      const automatic = yield* decodeSessionSelection({});
      const explicit = yield* decodeSessionSelection({
        model: { provider: "anthropic", id: "claude-sonnet" },
        reasoningLevel: "high",
      });

      expect(automatic).toEqual(new SessionSelection({}));
      expect(explicit).toEqual(
        new SessionSelection({
          model: { provider: "anthropic", id: "claude-sonnet" },
          reasoningLevel: "high",
        }),
      );
      yield* decodeSessionSelection({ reasoningLevel: "extreme" }).pipe(
        Effect.flip,
      );
    }),
  );

  it.effect("decodes role-scoped external Pi extension enablement", () =>
    Effect.gen(function* () {
      const selection = yield* decodeSessionSelection({
        externalExtensions: { app: true, shaper: false },
      });

      expect(selection).toMatchObject({
        externalExtensions: { app: true, shaper: false },
      });
    }),
  );

  it.effect("keeps runtime status versioned", () =>
    Effect.gen(function* () {
      const status = yield* decodeRuntimeStatus({
        version: 1,
        status: "ready",
      });

      expect(status).toEqual(
        new RuntimeStatus({ version: 1, status: "ready" }),
      );
      yield* Effect.flip(decodeRuntimeStatus({ version: 2, status: "ready" }));
    }),
  );
});
