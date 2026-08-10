import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  CapsuleIntentFailed,
  CapsuleIntentSucceeded,
  decodeCapsuleHostMessage,
  decodeCapsuleMessage,
} from "./capsule-protocol";

describe("capsule frame protocol", () => {
  it("decodes the closed versioned message set", async () => {
    await expect(
      Effect.runPromise(decodeCapsuleMessage({ version: 1, type: "ready" })),
    ).resolves.toMatchObject({ type: "ready" });
    await expect(
      Effect.runPromise(
        decodeCapsuleMessage({
          version: 1,
          type: "intent",
          id: "intent-12345678",
          action: "product.refresh",
          input: { page: 2 },
        }),
      ),
    ).resolves.toMatchObject({ action: "product.refresh" });
  });

  it.each([
    { version: 2, type: "ready" },
    { version: 1, type: "unknown" },
    { version: 1, type: "ready", extra: true },
    { version: 1, type: "resize", height: 100_000 },
  ])("rejects malformed message %#", async (message) => {
    await expect(
      Effect.runPromise(decodeCapsuleMessage(message)),
    ).rejects.toMatchObject({ _tag: "InvalidCapsuleMessage" });
  });

  it("rejects oversized nested inputs before schema decoding", async () => {
    await expect(
      Effect.runPromise(
        decodeCapsuleMessage({
          version: 1,
          type: "intent",
          id: "intent-12345678",
          action: "product.refresh",
          input: { value: "x".repeat(70_000) },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidCapsuleMessage" });
  });

  it("decodes only correlated bounded JSON intent results from the host", async () => {
    await expect(
      Effect.runPromise(
        decodeCapsuleHostMessage(
          CapsuleIntentSucceeded.make({
            version: 1,
            type: "intent-result",
            id: "intent-12345678",
            ok: true,
            output: { projects: [{ id: "one" }] },
          }),
        ),
      ),
    ).resolves.toMatchObject({
      type: "intent-result",
      id: "intent-12345678",
      ok: true,
    });
    await expect(
      Effect.runPromise(
        decodeCapsuleHostMessage(
          CapsuleIntentFailed.make({
            version: 1,
            type: "intent-result",
            id: "intent-12345678",
            ok: false,
            error: {
              code: "denied",
              message: "The product operation was denied.",
            },
          }),
        ),
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "denied" } });
  });

  it.each([
    {
      version: 1,
      type: "intent-result",
      id: "intent-12345678",
      ok: true,
      output: undefined,
    },
    {
      version: 1,
      type: "intent-result",
      id: "intent-12345678",
      ok: true,
      output: { value: "x".repeat(70_000) },
    },
    {
      version: 1,
      type: "intent-result",
      id: "intent-12345678",
      ok: false,
      error: { code: "secret", message: "leak" },
    },
  ])("rejects malformed host result %#", async (message) => {
    await expect(
      Effect.runPromise(decodeCapsuleHostMessage(message)),
    ).rejects.toMatchObject({ _tag: "InvalidCapsuleMessage" });
  });
});
