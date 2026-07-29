import type { z } from "zod";
import {
  cancelResponseSchema,
  flectEventSchema,
  modelsResponseSchema,
  promptRequestSchema,
  publicErrorSchema,
  runtimeStatusSchema,
  sessionResponseSchema,
  sessionSelectionSchema,
} from "../shared/contracts";
import type { FlectRuntime } from "./runtime";

const defaultAllowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:3210",
  "http://localhost:3210",
]);

type Schema<T> = z.ZodType<T>;

function json<T>(schema: Schema<T>, value: T, status = 200): Response {
  return Response.json(schema.parse(value), { status });
}

function error(message: string, status: number): Response {
  return json(publicErrorSchema, { version: 1, error: message }, status);
}

async function parseJson<T>(
  request: Request,
  schema: Schema<T>,
): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function sessionPath(
  pathname: string,
  action: "prompts" | "cancel",
): string | undefined {
  const match = pathname.match(new RegExp(`^/api/sessions/([^/]+)/${action}$`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function createApp(
  runtime: FlectRuntime,
  allowedOrigins = defaultAllowedOrigins,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return error("Origin not allowed", 403);
    }

    const { pathname } = new URL(request.url);

    try {
      if (request.method === "GET" && pathname === "/api/runtime") {
        return json(runtimeStatusSchema, await runtime.status());
      }

      if (request.method === "GET" && pathname === "/api/models") {
        return json(modelsResponseSchema, {
          version: 1,
          models: await runtime.listModels(),
        });
      }

      if (request.method === "POST" && pathname === "/api/sessions") {
        const selection = await parseJson(request, sessionSelectionSchema);
        if (!selection) {
          return error("Invalid request", 400);
        }

        return json(
          sessionResponseSchema,
          {
            version: 1,
            sessionId: await runtime.createSession(selection),
          },
          201,
        );
      }

      const promptSessionId = sessionPath(pathname, "prompts");
      if (request.method === "POST" && promptSessionId) {
        const prompt = await parseJson(request, promptRequestSchema);
        if (!prompt) {
          return error("Invalid request", 400);
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              await runtime.prompt(promptSessionId, prompt.text, (event) => {
                const publicEvent = flectEventSchema.parse(event);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(publicEvent)}\n\n`),
                );
              });
            } catch {
              const publicEvent = {
                type: "error" as const,
                message: "The local runtime could not complete this request.",
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(publicEvent)}\n\n`),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/event-stream; charset=utf-8",
          },
        });
      }

      const cancelSessionId = sessionPath(pathname, "cancel");
      if (request.method === "POST" && cancelSessionId) {
        await runtime.cancel(cancelSessionId);
        return json(cancelResponseSchema, {
          version: 1,
          status: "cancelled",
        });
      }

      return error("Not found", 404);
    } catch {
      return error("The local runtime could not complete this request.", 500);
    }
  };
}
