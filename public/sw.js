const previews = new Map();
const stoppedPreviews = new Map();
const REQUEST_TIMEOUT_MS = 3_000;
const BODY_LIMIT = 1_048_576;
const STOPPED_PREVIEW_LIMIT = 256;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const frame = event.data;
  if (
    !frame ||
    typeof frame.runId !== "string" ||
    !Number.isInteger(frame.port) ||
    frame.port < 1_024 ||
    frame.port > 65_535
  ) {
    return;
  }
  if (
    frame.type === "flect-preview-register" &&
    event.source &&
    typeof event.source.id === "string"
  ) {
    previews.set(frame.port, {
      runId: frame.runId,
      clientId: event.source.id,
    });
    stoppedPreviews.delete(frame.port);
    event.ports[0]?.postMessage({ type: "flect-preview-registered" });
    return;
  }
  if (frame.type === "flect-preview-stop") {
    const current = previews.get(frame.port);
    if (current?.runId !== frame.runId) {
      return;
    }
    previews.delete(frame.port);
    stoppedPreviews.set(frame.port, frame.runId);
    while (stoppedPreviews.size > STOPPED_PREVIEW_LIMIT) {
      const oldest = stoppedPreviews.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      stoppedPreviews.delete(oldest);
    }
    event.ports[0]?.postMessage({ type: "flect-preview-stopped" });
  }
});

const previewResponse = (status, body, headers = {}) => {
  const outputHeaders = new Headers(headers);
  outputHeaders.set(
    "content-security-policy",
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'",
  );
  outputHeaders.set("cross-origin-embedder-policy", "credentialless");
  outputHeaders.set("cross-origin-resource-policy", "cross-origin");
  outputHeaders.set("x-content-type-options", "nosniff");
  return new Response(body, { status, headers: outputHeaders });
};

const routePreview = async (request, port, path) => {
  const registration = previews.get(port);
  if (!registration) {
    const stopped = stoppedPreviews.has(port);
    const stoppedNavigation = stopped && request.mode === "navigate";
    return previewResponse(
      stoppedNavigation ? 200 : stopped ? 503 : 404,
      stopped ? "Preview stopped." : "Preview not found.",
      stoppedNavigation ? { "x-flect-preview-status": "503" } : {},
    );
  }
  const client = await self.clients.get(registration.clientId);
  if (!client) {
    return previewResponse(503, "Preview owner is unavailable.");
  }
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? ""
      : await request.text();
  if (body.length > BODY_LIMIT) {
    return previewResponse(413, "Preview request is too large.");
  }
  const headers = {};
  let headerCount = 0;
  for (const [name, value] of request.headers) {
    if (++headerCount > 64 || name.length > 128 || value.length > 4_096) {
      return previewResponse(431, "Preview request headers are too large.");
    }
    headers[name.toLowerCase()] = value;
  }

  const channel = new MessageChannel();
  const response = await new Promise((resolve) => {
    const timer = setTimeout(
      () =>
        resolve({
          status: 504,
          headers: {},
          body: "Preview broker timed out.",
        }),
      REQUEST_TIMEOUT_MS,
    );
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    client.postMessage(
      {
        type: "flect-preview-request",
        request: {
          version: 1,
          runId: registration.runId,
          port,
          method: request.method,
          path,
          headers,
          body,
        },
      },
      [channel.port2],
    );
  });
  if (
    !response ||
    !Number.isInteger(response.status) ||
    typeof response.body !== "string" ||
    response.body.length > BODY_LIMIT ||
    typeof response.headers !== "object" ||
    response.headers === null
  ) {
    return previewResponse(502, "Preview returned an invalid response.");
  }
  const stoppedNavigation =
    request.mode === "navigate" && response.status === 503;
  return previewResponse(
    stoppedNavigation ? 200 : response.status,
    request.method === "HEAD" ? null : response.body,
    stoppedNavigation
      ? { ...response.headers, "x-flect-preview-status": "503" }
      : response.headers,
  );
};

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/^\/preview\/(\d+)(\/.*)?$/);
  if (!match) {
    return;
  }
  const port = Number(match[1]);
  const path = `${match[2] ?? "/"}${url.search}`;
  event.respondWith(
    routePreview(event.request, port, path).catch(() =>
      previewResponse(502, "Preview broker failed."),
    ),
  );
});
