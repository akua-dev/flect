import { describe, expect, it } from "vitest";
import {
  flectEventSchema,
  modelSummarySchema,
  promptRequestSchema,
  runtimeStatusSchema,
  sessionSelectionSchema,
} from "./contracts";

describe("runtime contracts", () => {
  it("accepts a public model summary", () => {
    expect(
      modelSummarySchema.parse({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
      }),
    ).toEqual({
      provider: "openai-codex",
      id: "gpt-5.6",
      name: "GPT-5.6",
    });
  });

  it("rejects credential-shaped model fields", () => {
    expect(() =>
      modelSummarySchema.parse({
        provider: "openai-codex",
        id: "gpt-5.6",
        name: "GPT-5.6",
        apiKey: "not-a-real-secret",
      }),
    ).toThrow();
  });

  it("rejects credential-shaped event fields", () => {
    expect(() =>
      flectEventSchema.parse({
        type: "error",
        message: "The model could not complete this turn.",
        credential: "not-a-real-secret",
      }),
    ).toThrow();
  });

  it("requires non-empty prompts", () => {
    expect(() => promptRequestSchema.parse({ text: "   " })).toThrow();
    expect(promptRequestSchema.parse({ text: "Shape this" })).toEqual({
      text: "Shape this",
    });
  });

  it("supports automatic and explicit model selection", () => {
    expect(sessionSelectionSchema.parse({})).toEqual({});
    expect(
      sessionSelectionSchema.parse({
        model: { provider: "anthropic", id: "claude-sonnet" },
      }),
    ).toEqual({
      model: { provider: "anthropic", id: "claude-sonnet" },
    });
  });

  it("keeps runtime status versioned", () => {
    expect(
      runtimeStatusSchema.parse({
        version: 1,
        status: "ready",
      }),
    ).toEqual({ version: 1, status: "ready" });
  });
});
