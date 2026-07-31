import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  AgentShellResultRequest,
  CancelRequest,
  decodeFlectEvent,
  decodeModelSummary,
  decodePromptRequest,
  decodeRuntimeStatus,
  decodeSessionSelection,
  ModelSummary,
  PromptRequest,
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
      });

      expect(model).toEqual(
        new ModelSummary({
          provider: "openai-codex",
          id: "gpt-5.6",
          name: "GPT-5.6",
        }),
      );
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
      });

      expect(automatic).toEqual(new SessionSelection({}));
      expect(explicit).toEqual(
        new SessionSelection({
          model: { provider: "anthropic", id: "claude-sonnet" },
        }),
      );
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
