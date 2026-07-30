import { BrowserHttpClient } from "@effect/platform-browser";
import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";
import { BunCommandResult } from "../../shared/bun-command";
import {
  ModelSummary,
  RuntimeStatus,
  SessionBusy,
  SessionSelection,
  ShapeCompleted,
} from "../../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import {
  FlectClient,
  FlectUnavailableError,
  makeFlectClientLayer,
} from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chunkedSse(chunks: ReadonlyArray<string>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

const withClient = <A, E>(
  fetcher: typeof fetch,
  effect: Effect.Effect<A, E, FlectClient>,
) => {
  const ClientLive = makeFlectClientLayer("http://flect.local/api").pipe(
    Layer.provide(BrowserHttpClient.layerFetch),
  );
  return effect.pipe(
    Effect.provide(
      Layer.merge(ClientLive, Layer.succeed(BrowserHttpClient.Fetch)(fetcher)),
    ),
  );
};

describe("FlectClient", () => {
  it.effect("decodes runtime and model responses strictly", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ version: 1, status: "ready" }))
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          models: [
            {
              provider: "openai-codex",
              id: "gpt-5.6",
              name: "GPT-5.6",
            },
          ],
        }),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const status = yield* client.status;
        const models = yield* client.models;

        expect(status).toEqual(
          new RuntimeStatus({ version: 1, status: "ready" }),
        );
        expect(models).toEqual([
          new ModelSummary({
            provider: "openai-codex",
            id: "gpt-5.6",
            name: "GPT-5.6",
          }),
        ]);
      }),
    );
  });

  it.effect(
    "creates an automatically selected session with a schema body",
    () => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ version: 1, sessionId: "session-1" }, 201),
        );

      return withClient(
        fetcher,
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const sessionId = yield* client.createSession(
            new SessionSelection({}),
          );

          expect(sessionId).toBe("session-1");
          const [input, init] = fetcher.mock.calls[0] ?? [];
          expect(String(input)).toBe("http://flect.local/api/sessions");
          expect(init?.method).toBe("POST");
          expect(
            init?.body instanceof Uint8Array
              ? new TextDecoder().decode(init.body)
              : init?.body,
          ).toBe("{}");
        }),
      );
    },
  );

  it.effect("closes sessions and requests Guardian diagnostics", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ version: 1, status: "closed" }))
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          message: "The protected launcher remains available.",
        }),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        yield* client.closeSession("session-1");
        const diagnostic = yield* client.diagnoseRecovery(
          "session-2",
          "rollback-failed",
        );

        const [closeInput, closeInit] = fetcher.mock.calls[0] ?? [];
        expect(String(closeInput)).toBe(
          "http://flect.local/api/sessions/session-1",
        );
        expect(closeInit?.method).toBe("DELETE");

        const [guardianInput, guardianInit] = fetcher.mock.calls[1] ?? [];
        expect(String(guardianInput)).toBe(
          "http://flect.local/api/sessions/session-2/guardian",
        );
        expect(guardianInit?.method).toBe("POST");
        expect(diagnostic.message).toBe(
          "The protected launcher remains available.",
        );
      }),
    );
  });

  it.effect(
    "returns a schema-encoded shell result to the agent session",
    () => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ version: 1, status: "accepted" }));
      const result = BunCommandResult.make({
        version: 1,
        exitCode: 0,
        stdout: "42\n",
        stderr: "",
      });

      return withClient(
        fetcher,
        Effect.gen(function* () {
          const client = yield* FlectClient;
          yield* client.completeShellRequest(
            "session-1",
            "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
            result,
          );

          const [input, init] = fetcher.mock.calls[0] ?? [];
          expect(String(input)).toBe(
            "http://flect.local/api/sessions/session-1/shell-results",
          );
          expect(init?.method).toBe("POST");
          expect(
            JSON.parse(
              init?.body instanceof Uint8Array
                ? new TextDecoder().decode(init.body)
                : String(init?.body),
            ),
          ).toEqual({
            requestId: "shell-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
            result: {
              version: 1,
              exitCode: 0,
              stdout: "42\n",
              stderr: "",
            },
          });
        }),
      );
    },
  );

  it.effect("decodes SSE split across arbitrary byte chunks", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        chunkedSse([
          'data: {"type":"turn_star',
          'ted"}\n\ndata: {"type":"text_delta","delta":"Sha',
          'ped"}\n\ndata: {"type":"turn_completed"}\n\n',
        ]),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const events = yield* client
          .prompt("session-1", "Shape this")
          .pipe(Stream.runCollect);

        expect(events).toEqual([
          { type: "turn_started" },
          { type: "text_delta", delta: "Shaped" },
          { type: "turn_completed" },
        ]);
      }),
    );
  });

  it.effect("decodes a non-destructive busy event from browser SSE", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        chunkedSse([
          'data: {"type":"busy","message":"The session is busy."}\n\n',
        ]),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const events = yield* client
          .prompt("session-1", "Keep talking")
          .pipe(Stream.runCollect);

        expect(events).toEqual([
          { type: "busy", message: "The session is busy." },
        ]);
      }),
    );
  });

  it.effect("requests and validates an interface proposal", () => {
    const shaped = InterfaceDocument.make({
      ...defaultInterfaceDocument,
      name: "Focused Flect",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        chunkedSse([
          `data: ${JSON.stringify({
            type: "shape_completed",
            document: shaped,
          })}\n\n`,
        ]),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const result = yield* client
          .shape(
            "session-1",
            "Make this more focused",
            defaultInterfaceDocument,
          )
          .pipe(Stream.runCollect);

        expect(result).toEqual([
          ShapeCompleted.make({ type: "shape_completed", document: shaped }),
        ]);
        const [input, init] = fetcher.mock.calls[0] ?? [];
        expect(String(input)).toBe(
          "http://flect.local/api/sessions/session-1/shape",
        );
        expect(init?.method).toBe("POST");
      }),
    );
  });

  it.effect("preserves a typed busy response for interface shaping", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ version: 1, error: "The session is busy." }, 409),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const error = yield* client
          .shape(
            "session-1",
            "Make this more focused",
            defaultInterfaceDocument,
          )
          .pipe(Stream.runCollect, Effect.flip);

        expect(error).toEqual(
          new SessionBusy({
            sessionId: "session-1",
            message: "The session is busy.",
          }),
        );
      }),
    );
  });

  it.effect("preserves a typed busy response for Guardian diagnostics", () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ version: 1, error: "The session is busy." }, 409),
      );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const error = yield* client
          .diagnoseRecovery("session-1", "rollback-failed")
          .pipe(Effect.flip);

        expect(error).toEqual(
          new SessionBusy({
            sessionId: "session-1",
            message: "The session is busy.",
          }),
        );
      }),
    );
  });

  it.effect(
    "interrupts the browser fetch when the prompt fiber is cancelled",
    () => {
      let observedSignal: AbortSignal | null | undefined;
      const fetcher = vi.fn<typeof fetch>();
      fetcher.mockImplementation((_input, init) => {
        observedSignal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start() {
                // Intentionally left open until the Effect fiber is interrupted.
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      });

      return withClient(
        fetcher,
        Effect.gen(function* () {
          const client = yield* FlectClient;
          const fiber = yield* client
            .prompt("session-1", "Shape this")
            .pipe(Stream.runDrain, Effect.forkChild);

          yield* Effect.yieldNow;
          yield* Fiber.interrupt(fiber);

          expect(observedSignal?.aborted).toBe(true);
        }),
      );
    },
  );

  it.effect("fails closed for malformed public responses", () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        version: 1,
        status: "ready",
        credential: "not-a-real-secret",
      }),
    );

    return withClient(
      fetcher,
      Effect.gen(function* () {
        const client = yield* FlectClient;
        const error = yield* client.status.pipe(Effect.flip);

        expect(error).toEqual(
          new FlectUnavailableError({
            message: "The local Flect runtime is unavailable.",
          }),
        );
        expect(error.message).not.toContain("not-a-real-secret");
      }),
    );
  });
});
