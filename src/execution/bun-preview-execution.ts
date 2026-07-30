import { Context, Effect, Layer, Ref, Schema } from "effect";
import { BunCommandFailed } from "../../shared/bun-command";
import {
  BunPreview,
  BunPreviewResponse,
  makeBunPreviewLayer,
} from "./bun-preview";
import { loadBrowserEsbuild } from "./esbuild-browser";
import { riftyCapabilityBoundarySource } from "./rifty-capability-boundary";

const WORKSPACE_ROOT = "/workspace";
const START_DEADLINE_MS = 10_000;
const BODY_LIMIT = 1_048_576;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface BunPreviewExecutionRequest {
  readonly entry: string;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
}

export interface BunPreviewExecutionResult {
  readonly previewUrl: string;
  readonly port: number;
}

export interface BunPreviewExecutionShape {
  readonly start: (
    request: BunPreviewExecutionRequest,
  ) => Effect.Effect<BunPreviewExecutionResult, BunCommandFailed>;
  readonly stop: Effect.Effect<void, BunCommandFailed>;
}

export class BunPreviewExecution extends Context.Service<
  BunPreviewExecution,
  BunPreviewExecutionShape
>()("flect/BunPreviewExecution") {}

const previewFailure = () =>
  BunCommandFailed.make({
    reason: "preview",
    message: "The isolated Bun-compatible preview failed safely.",
  });

export interface BunPreviewExecutionRelease {
  readonly runId: string;
  readonly port: number;
  readonly stopRealm: () => void;
  readonly stopPreview: (
    runId: string,
  ) => Effect.Effect<void, BunCommandFailed>;
  readonly stopRoute: (runId: string, port: number) => Effect.Effect<void>;
  readonly clearActive: (runId: string) => Effect.Effect<void>;
}

export const releaseBunPreviewExecution = Effect.fn(
  "Flect.BunPreviewExecution.release",
)((release: BunPreviewExecutionRelease) =>
  Effect.gen(function* () {
    yield* Effect.sync(release.stopRealm).pipe(
      Effect.catchDefect(() => Effect.void),
    );
    yield* release.stopPreview(release.runId).pipe(Effect.ignore);
    yield* release.stopRoute(release.runId, release.port).pipe(Effect.ignore);
    yield* release.clearActive(release.runId);
  }).pipe(
    Effect.catch(() => Effect.void),
    Effect.catchDefect(() => Effect.void),
  ),
);

const dirname = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
};

const normalize = (path: string) => {
  const output: Array<string> = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      output.pop();
    } else {
      output.push(segment);
    }
  }
  return `/${output.join("/")}`;
};

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
};

const sourceExtensions = ["", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".json"];

const resolveFile = (
  files: Readonly<Record<string, string | Uint8Array>>,
  candidate: string,
) => {
  const path = normalize(candidate);
  if (extension(path) === ".cjs") {
    return undefined;
  }
  const candidates = [
    ...sourceExtensions.map((suffix) => `${path}${suffix}`),
    ...sourceExtensions.slice(1).map((suffix) => `${path}/index${suffix}`),
  ];
  return candidates.find((entry) => files[entry] !== undefined);
};

const packageNameOf = (specifier: string) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);

const packageSubpathOf = (specifier: string, packageName: string) =>
  specifier.slice(packageName.length).replace(/^\/+/, "");

const text = (value: string | Uint8Array | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : decoder.decode(value);
};

const resolvePackage = (
  files: Readonly<Record<string, string | Uint8Array>>,
  specifier: string,
  resolveDir: string,
) => {
  const packageName = packageNameOf(specifier);
  const subpath = packageSubpathOf(specifier, packageName);
  let current = resolveDir;
  while (
    current === WORKSPACE_ROOT ||
    current.startsWith(`${WORKSPACE_ROOT}/`)
  ) {
    const root = `${current}/node_modules/${packageName}`;
    if (subpath.length > 0) {
      const resolved = resolveFile(files, `${root}/${subpath}`);
      if (resolved !== undefined) {
        return resolved;
      }
    }
    const manifestText = text(files[`${root}/package.json`]);
    if (manifestText !== undefined) {
      const manifest = JSON.parse(manifestText) as {
        readonly browser?: unknown;
        readonly module?: unknown;
        readonly main?: unknown;
      };
      const entry = [manifest.browser, manifest.module, manifest.main].find(
        (value): value is string => typeof value === "string",
      );
      const resolved = resolveFile(files, `${root}/${entry ?? "index.js"}`);
      if (resolved !== undefined) {
        return resolved;
      }
    }
    if (current === WORKSPACE_ROOT) {
      break;
    }
    current = dirname(current);
  }
  return undefined;
};

const loaderFor = (path: string): "js" | "jsx" | "ts" | "tsx" | "json" => {
  switch (extension(path)) {
    case ".ts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".json":
      return "json";
    default:
      return "js";
  }
};

const bundleWorkspace = async (request: BunPreviewExecutionRequest) => {
  const esbuild = await loadBrowserEsbuild();
  const result = await esbuild.build({
    entryPoints: [request.entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    plugins: [
      {
        name: "flect-vfs",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            const resolved =
              args.kind === "entry-point"
                ? resolveFile(request.files, args.path)
                : args.path.startsWith(".") || args.path.startsWith("/")
                  ? resolveFile(
                      request.files,
                      args.path.startsWith("/")
                        ? args.path
                        : `${args.resolveDir}/${args.path}`,
                    )
                  : resolvePackage(request.files, args.path, args.resolveDir);
            if (
              resolved === undefined ||
              (!resolved.startsWith(`${WORKSPACE_ROOT}/`) &&
                resolved !== WORKSPACE_ROOT)
            ) {
              return {
                errors: [{ text: "Module is outside the preview workspace." }],
              };
            }
            return {
              path: resolved,
              namespace: "flect-vfs",
            };
          });
          build.onLoad({ filter: /.*/, namespace: "flect-vfs" }, (args) => {
            const contents = text(request.files[args.path]);
            return contents === undefined
              ? { errors: [{ text: "Module is unavailable." }] }
              : {
                  contents,
                  loader: loaderFor(args.path),
                  resolveDir: dirname(args.path),
                };
          });
        },
      },
    ],
  });
  const output = result.outputFiles?.[0]?.text;
  if (output === undefined || output.length > 8_388_608) {
    throw previewFailure();
  }
  return output;
};

const makeWorkerSource = (bundle: string) => `
(() => {
  "use strict";
  ${riftyCapabilityBoundarySource}
  let handler;
  let active = true;
  let selectedPort = 3000;
  const activeRequests = new Map();
  const send = (value) => globalThis.postMessage(value);
  const abortRequests = () => {
    for (const controller of activeRequests.values()) {
      controller.abort();
    }
    activeRequests.clear();
  };
  const boundedHeaders = (headers) => {
    const output = {};
    let count = 0;
    for (const [name, value] of headers) {
      if (++count > 64 || name.length > 128 || value.length > 4096) {
        throw new Error("response headers exceeded their limit");
      }
      output[name.toLowerCase()] = value;
    }
    return output;
  };
  globalThis.Bun = Object.freeze({
    argv: Object.freeze(["bun"]),
    env: Object.freeze({}),
    version: "flect-browser/1",
    serve(options) {
      if (handler !== undefined || !options || typeof options.fetch !== "function") {
        throw new Error("Bun.serve requires one fetch handler");
      }
      const requested = options.port === undefined ? 3000 : options.port;
      if (!Number.isInteger(requested) || requested < 1024 || requested > 65535) {
        throw new Error("Bun.serve port is invalid");
      }
      selectedPort = requested;
      handler = options.fetch;
      return Object.freeze({
        port: selectedPort,
        stop() {
          active = false;
          handler = undefined;
          abortRequests();
        },
      });
    },
  });
  globalThis.addEventListener("message", async (event) => {
    const frame = event.data;
    if (frame && frame.type === "stop") {
      active = false;
      handler = undefined;
      abortRequests();
      close();
      return;
    }
    if (frame && frame.type === "cancel" && typeof frame.id === "string") {
      activeRequests.get(frame.id)?.abort();
      return;
    }
    if (!frame || frame.type !== "request" || typeof frame.id !== "string") {
      return;
    }
    if (!active || typeof handler !== "function") {
      send({ type: "response", id: frame.id, response: { status: 503, headers: {}, body: "Preview stopped." } });
      return;
    }
    const controller = new AbortController();
    activeRequests.set(frame.id, controller);
    try {
      const init = {
        method: frame.request.method,
        headers: frame.request.headers,
        signal: controller.signal,
      };
      if (frame.request.method !== "GET" && frame.request.method !== "HEAD") {
        init.body = frame.request.body;
      }
      const request = new Request("https://preview.flect.invalid" + frame.request.path, init);
      const value = await handler(request);
      if (!(value instanceof Response)) {
        throw new Error("fetch handler did not return Response");
      }
      const body = await value.text();
      if (body.length > ${BODY_LIMIT}) {
        throw new Error("response body exceeded its limit");
      }
      if (!controller.signal.aborted) {
        send({
          type: "response",
          id: frame.id,
          response: {
            status: value.status,
            headers: boundedHeaders(value.headers),
            body,
          },
        });
      }
    } catch {
      if (!controller.signal.aborted) {
        send({ type: "response", id: frame.id, response: { status: 502, headers: {}, body: "Preview handler failed." } });
      }
    } finally {
      activeRequests.delete(frame.id);
    }
  });
  try {
    ${bundle}
    if (typeof handler !== "function") {
      throw new Error("Bun.serve was not called");
    }
    send({ type: "ready", port: selectedPort });
  } catch {
    send({ type: "startup-failure" });
  }
})();
`;

interface RealmRequest {
  readonly id: string;
  readonly promise: Promise<typeof BunPreviewResponse.Encoded>;
}

interface RealmHandle {
  readonly port: number;
  readonly request: (request: unknown) => RealmRequest;
  readonly cancel: (requestId: string) => void;
  readonly stop: () => void;
}

const bootstrapDocument = (token: string) => `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">
<script>
(() => {
  const token = ${JSON.stringify(token)};
  addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "flect-preview-init" || event.data.token !== token || event.ports.length !== 1) return;
    const host = event.ports[0];
    const url = URL.createObjectURL(new Blob([event.data.source], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = (message) => host.postMessage(message.data);
    worker.onerror = () => host.postMessage({ type: "startup-failure" });
    host.onmessage = (message) => worker.postMessage(message.data);
    host.start();
  }, { once: true });
  parent.postMessage({ type: "flect-preview-frame-ready", token }, "*");
})();
</script>`;

const createRealm = (source: string): Promise<RealmHandle> =>
  new Promise((resolve, reject) => {
    const token = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = bootstrapDocument(token);
    const channel = new MessageChannel();
    const pending = new Map<
      string,
      {
        readonly resolve: (response: typeof BunPreviewResponse.Encoded) => void;
        readonly reject: (error: Error) => void;
      }
    >();
    let settled = false;
    const cleanup = () => {
      globalThis.removeEventListener("message", onFrameReady);
      channel.port1.close();
      for (const request of pending.values()) {
        request.reject(new Error("Preview stopped."));
      }
      pending.clear();
      iframe.remove();
    };
    const timer = globalThis.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Preview startup timed out."));
      }
    }, START_DEADLINE_MS);
    const onFrameReady = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.data?.type !== "flect-preview-frame-ready" ||
        event.data?.token !== token
      ) {
        return;
      }
      iframe.contentWindow?.postMessage(
        {
          type: "flect-preview-init",
          token,
          source,
        },
        "*",
        [channel.port2],
      );
    };
    globalThis.addEventListener("message", onFrameReady);
    channel.port1.onmessage = (event) => {
      const frame = event.data;
      if (frame?.type === "startup-failure" && !settled) {
        settled = true;
        globalThis.clearTimeout(timer);
        cleanup();
        reject(new Error("Preview startup failed."));
      } else if (
        frame?.type === "ready" &&
        Number.isInteger(frame.port) &&
        !settled
      ) {
        settled = true;
        globalThis.clearTimeout(timer);
        globalThis.removeEventListener("message", onFrameReady);
        resolve({
          port: frame.port,
          request: (request) => {
            const id = `request-${crypto.randomUUID().replaceAll("-", "")}`;
            const promise = new Promise<typeof BunPreviewResponse.Encoded>(
              (requestResolve, requestReject) => {
                pending.set(id, {
                  resolve: requestResolve,
                  reject: requestReject,
                });
                channel.port1.postMessage({ type: "request", id, request });
              },
            );
            return { id, promise };
          },
          cancel: (requestId) => {
            const request = pending.get(requestId);
            if (request === undefined) {
              return;
            }
            pending.delete(requestId);
            try {
              channel.port1.postMessage({ type: "cancel", id: requestId });
            } catch {
              request.reject(new Error("Preview request cancelled."));
              return;
            }
            request.reject(new Error("Preview request cancelled."));
          },
          stop: () => {
            channel.port1.postMessage({ type: "stop" });
            cleanup();
          },
        });
      } else if (frame?.type === "response" && typeof frame.id === "string") {
        const request = pending.get(frame.id);
        if (request !== undefined) {
          pending.delete(frame.id);
          request.resolve(frame.response);
        }
      }
    };
    channel.port1.start();
    document.body.append(iframe);
  });

const ensurePreviewServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    throw previewFailure();
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          controlled,
        );
        reject(previewFailure());
      }, 3_000);
      function controlled() {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          controlled,
        );
        resolve();
      }
      navigator.serviceWorker.addEventListener("controllerchange", controlled, {
        once: true,
      });
      if (navigator.serviceWorker.controller !== null) {
        controlled();
      }
    });
  }
  return registration;
};

const registerPreviewRoute = async (runId: string, port: number) => {
  const registration = await ensurePreviewServiceWorker();
  const target = navigator.serviceWorker.controller ?? registration.active;
  if (target === null) {
    throw previewFailure();
  }
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(previewFailure());
    }, 3_000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type !== "flect-preview-registered") {
        return;
      }
      window.clearTimeout(timer);
      channel.port1.close();
      resolve();
    };
    target.postMessage(
      {
        type: "flect-preview-register",
        runId,
        port,
      },
      [channel.port2],
    );
  });
};

const stopPreviewRoute = async (runId: string, port: number) => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registration = await ensurePreviewServiceWorker();
  const target = navigator.serviceWorker.controller ?? registration.active;
  target?.postMessage({
    type: "flect-preview-stop",
    runId,
    port,
  });
};

export const BunPreviewExecutionLive = Layer.effect(
  BunPreviewExecution,
  Effect.gen(function* () {
    const preview = yield* BunPreview;
    const active = yield* Ref.make<
      | {
          readonly runId: string;
          readonly realm: RealmHandle;
        }
      | undefined
    >(undefined);

    const stop = Effect.fn("Flect.BunPreviewExecution.stop")(() =>
      Effect.gen(function* () {
        const current = yield* Ref.get(active);
        if (current === undefined) {
          return;
        }
        yield* Effect.sync(() => current.realm.stop()).pipe(
          Effect.catchDefect(() => Effect.void),
        );
        yield* preview.stop(current.runId).pipe(Effect.ignore);
        yield* Effect.tryPromise({
          try: () => stopPreviewRoute(current.runId, current.realm.port),
          catch: () => undefined,
        }).pipe(Effect.ignore);
        yield* Ref.set(active, undefined);
      }).pipe(
        Effect.ensuring(Ref.set(active, undefined)),
        Effect.catchDefect(() => Effect.void),
      ),
    );

    const clearActive = (runId: string) =>
      Ref.update(active, (current) =>
        current?.runId === runId ? undefined : current,
      );

    const serviceWorkerMessage = (event: MessageEvent) => {
      if (
        event.data?.type !== "flect-preview-request" ||
        event.ports.length !== 1
      ) {
        return;
      }
      const port = event.ports[0];
      Effect.runPromise(preview.request(event.data.request))
        .then((output) => {
          port.postMessage({
            status: output.status,
            headers: output.headers,
            body: output.body,
          });
        })
        .catch(() => {
          port.postMessage({
            status: 502,
            headers: {},
            body: "Preview broker failed.",
          });
        })
        .finally(() => port.close());
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        navigator.serviceWorker?.addEventListener(
          "message",
          serviceWorkerMessage,
        );
      }),
      () =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            navigator.serviceWorker?.removeEventListener(
              "message",
              serviceWorkerMessage,
            );
          });
          yield* stop();
        }),
    );

    return {
      start: Effect.fn("Flect.BunPreviewExecution.start")((request) =>
        Effect.gen(function* () {
          yield* stop();
          const bundle = yield* Effect.tryPromise({
            try: () => bundleWorkspace(request),
            catch: previewFailure,
          });
          const runId = `run-${crypto.randomUUID().replaceAll("-", "")}`;
          const realm = yield* Effect.tryPromise({
            try: () => createRealm(makeWorkerSource(bundle)),
            catch: previewFailure,
          });
          let committed = false;
          const release = releaseBunPreviewExecution({
            runId,
            port: realm.port,
            stopRealm: () => realm.stop(),
            stopPreview: preview.stop,
            stopRoute: (ownerRunId, ownerPort) =>
              Effect.tryPromise({
                try: () => stopPreviewRoute(ownerRunId, ownerPort),
                catch: () => undefined,
              }).pipe(Effect.ignore),
            clearActive,
          });

          return yield* Effect.gen(function* () {
            const registration = yield* preview.register({
              runId,
              port: realm.port,
              handler: (input) => {
                const pending = realm.request(input);
                return Effect.tryPromise({
                  try: () => pending.promise,
                  catch: previewFailure,
                }).pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => realm.cancel(pending.id)),
                  ),
                  Effect.flatMap((output) =>
                    Schema.decodeUnknownEffect(BunPreviewResponse)(output).pipe(
                      Effect.mapError(previewFailure),
                    ),
                  ),
                );
              },
              onTimeout: release,
            });
            yield* Effect.tryPromise({
              try: () => registerPreviewRoute(runId, realm.port),
              catch: previewFailure,
            });

            yield* Ref.set(active, { runId, realm });
            committed = true;
            return {
              previewUrl: registration.previewUrl,
              port: realm.port,
            };
          }).pipe(
            Effect.ensuring(
              Effect.suspend(() => (committed ? Effect.void : release)),
            ),
          );
        }).pipe(Effect.catchDefect(() => Effect.fail(previewFailure()))),
      ),
      stop: stop(),
    };
  }),
).pipe(Layer.provide(makeBunPreviewLayer()));
