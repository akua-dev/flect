import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Deferred, Effect, Layer, Redacted } from "effect";
import { ProviderAuthOperationFailed } from "../shared/contracts";
import {
  ProtectedPromptHost,
  type ProtectedPromptLease,
} from "./provider-authentication";

const MAX_FORM_BYTES = 8 * 1024;
const MAX_VALUE_BYTES = 4 * 1024;

const entryFailure = () =>
  ProviderAuthOperationFailed.make({
    operation: "reply",
    message: "Provider authentication could not be completed.",
  });

const responseHeaders = (nonce: string) => ({
  "cache-control": "no-store, max-age=0",
  "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const entryHtml = (nonce: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Flect secure provider entry</title>
  <style nonce="${nonce}">
    :root{color-scheme:light dark;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f5f5f7;color:#1d1d1f}
    main{box-sizing:border-box;width:min(30rem,calc(100% - 2rem));padding:2rem;border:1px solid #d2d2d7;border-radius:1.25rem;background:#fff;box-shadow:0 1.25rem 4rem #00000014}
    h1{margin:0 0 .5rem;font-size:1.5rem;letter-spacing:-.025em}p{margin:.5rem 0 1.25rem;color:#6e6e73}
    label{display:block;margin-bottom:.45rem;font-weight:600}input{box-sizing:border-box;width:100%;min-height:3rem;padding:.7rem .8rem;border:1px solid #86868b;border-radius:.7rem;background:#fff;color:#1d1d1f;font:inherit}
    button{width:100%;min-height:3rem;margin-top:1rem;border:0;border-radius:.7rem;background:#1d1d1f;color:#fff;font:600 1rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
    small{display:block;margin-top:1rem;color:#6e6e73}@media(prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}main{border-color:#424245;background:#1d1d1f}p,small{color:#a1a1a6}input{border-color:#6e6e73;background:#2c2c2e;color:#fff}button{background:#f5f5f7;color:#1d1d1f}}
  </style>
</head>
<body>
  <main>
    <h1>Continue securely</h1>
    <p>This value goes directly to Pi’s local runtime. Flect’s interface cannot read or store it.</p>
    <form method="post">
      <label for="value">Provider information</label>
      <input id="value" name="value" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required autofocus>
      <button type="submit">Continue</button>
    </form>
    <small>You can close this page to cancel.</small>
  </main>
</body>
</html>`;

const fixedPage = (title: string, message: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

const readBoundedBody = async (request: IncomingMessage) => {
  const chunks: Array<Uint8Array> = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > MAX_FORM_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(bytes);
  }
  if (tooLarge) {
    return undefined;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};

const send = (
  response: ServerResponse,
  body: string,
  options: {
    readonly status?: number;
    readonly headers: Record<string, string>;
  },
) => {
  response.writeHead(options.status ?? 200, options.headers);
  response.end(body);
};

export const ProtectedPromptHostLive = Layer.succeed(ProtectedPromptHost)({
  open: (input) =>
    Effect.gen(function* () {
      const submission = yield* Deferred.make<
        Redacted.Redacted<string>,
        ProviderAuthOperationFailed
      >();
      const valueRef: {
        consumed: boolean;
        closed: boolean;
      } = { consumed: false, closed: false };
      const path = `/entry/${crypto.randomUUID()}`;
      const nonce = crypto.randomUUID().replaceAll("-", "");
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      let origin = "";
      let abortListener: (() => void) | undefined;
      const server = createServer(async (request, response) => {
        try {
          const requestUrl = new URL(request.url ?? "/", origin);
          const headers = responseHeaders(nonce);
          const remoteAddress = request.socket.remoteAddress;
          if (
            remoteAddress !== "127.0.0.1" &&
            remoteAddress !== "::ffff:127.0.0.1"
          ) {
            send(response, "Request rejected", { status: 400, headers });
            await runPromise(close);
            return;
          }
          if (requestUrl.pathname !== path) {
            send(response, "Not found", { status: 404, headers });
            return;
          }
          if (request.method === "GET") {
            if (valueRef.consumed || valueRef.closed) {
              send(
                response,
                fixedPage("Entry expired", "Return to Flect and try again."),
                {
                  status: 410,
                  headers: {
                    ...headers,
                    "content-type": "text/html; charset=utf-8",
                  },
                },
              );
              return;
            }
            send(response, entryHtml(nonce), {
              headers: {
                ...headers,
                "content-type": "text/html; charset=utf-8",
              },
            });
            return;
          }
          if (request.method !== "POST") {
            send(response, "Method not allowed", {
              status: 405,
              headers: { ...headers, allow: "GET, POST" },
            });
            await runPromise(close);
            return;
          }
          const contentType = request.headers["content-type"] ?? "";
          if (
            request.headers.origin !== origin ||
            !contentType
              .toLowerCase()
              .startsWith("application/x-www-form-urlencoded")
          ) {
            send(response, "Request rejected", { status: 400, headers });
            await runPromise(close);
            return;
          }
          if (valueRef.consumed || valueRef.closed) {
            send(
              response,
              fixedPage("Entry expired", "Return to Flect and try again."),
              {
                status: 410,
                headers: {
                  ...headers,
                  "content-type": "text/html; charset=utf-8",
                },
              },
            );
            return;
          }
          const declaredLength = request.headers["content-length"];
          if (
            declaredLength !== undefined &&
            (!/^\d+$/.test(declaredLength) ||
              Number(declaredLength) > MAX_FORM_BYTES)
          ) {
            send(response, "Request rejected", { status: 400, headers });
            await runPromise(close);
            return;
          }
          const body = await readBoundedBody(request);
          const value =
            body === undefined
              ? undefined
              : new URLSearchParams(body).get("value");
          if (
            value === undefined ||
            value === null ||
            value.length === 0 ||
            new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES
          ) {
            if (!response.destroyed) {
              send(response, "Request rejected", { status: 400, headers });
            }
            await runPromise(close);
            return;
          }
          valueRef.consumed = true;
          send(
            response,
            fixedPage(
              "Continue in Flect",
              "Provider information was delivered to Pi’s local runtime. You can close this page.",
            ),
            {
              status: 200,
              headers: {
                ...headers,
                "content-type": "text/html; charset=utf-8",
              },
            },
          );
          await runPromise(
            Deferred.succeed(
              submission,
              Redacted.make(value, { label: "provider credential" }),
            ),
          );
        } catch {
          if (!response.headersSent && !response.destroyed) {
            send(response, "Request rejected", {
              status: 400,
              headers: responseHeaders(nonce),
            });
          }
          await runPromise(close);
        }
      });

      yield* Effect.callback<void, ProviderAuthOperationFailed>((resume) => {
        const onError = () => resume(Effect.fail(entryFailure()));
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", onError);
          const address = server.address();
          if (address === null || typeof address === "string") {
            resume(Effect.fail(entryFailure()));
            return;
          }
          origin = `http://127.0.0.1:${address.port}`;
          resume(Effect.void);
        });
        return Effect.sync(() => server.close());
      });

      const close = Effect.gen(function* () {
        if (valueRef.closed) {
          return;
        }
        valueRef.closed = true;
        if (abortListener !== undefined && input.signal !== undefined) {
          input.signal.removeEventListener("abort", abortListener);
        }
        yield* Deferred.fail(submission, entryFailure());
        yield* Effect.sync(() => server.close());
      });
      abortListener = () => {
        void runPromise(close);
      };
      if (input.signal !== undefined) {
        input.signal.addEventListener("abort", abortListener, { once: true });
        if (input.signal.aborted) {
          yield* close;
        }
      }
      const value = Deferred.await(submission).pipe(
        Effect.timeoutOrElse({
          duration: "10 minutes",
          orElse: () => Effect.fail(entryFailure()),
        }),
        Effect.ensuring(close),
      );

      return {
        url: `${origin}${path}`,
        value,
        close,
      } satisfies ProtectedPromptLease;
    }),
});
