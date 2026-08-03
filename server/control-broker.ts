import {
  createServer,
  type IncomingMessage,
  type Server as NodeServer,
  type ServerResponse,
} from "node:http";
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Ref,
  Schema,
  Semaphore,
} from "effect";
import {
  decodeFlectCommandEnvelope,
  type FlectCommandEnvelope,
  type FlectCommandError,
  type FlectWorkspaceEvent,
  type FlectWorkspaceSnapshot,
} from "../shared/control";
import {
  ControlAck,
  ControlBrokerStatus,
  ControlCommandCompletion,
  ControlCommandFailed,
  type ControlCommandOutcome,
  ControlCommandSucceeded,
  ControlDescriptor,
} from "../shared/control-channel";
import {
  makeControlToken,
  removeControlDescriptor,
  writeControlDescriptor,
} from "./control-descriptor";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 512;
const MAX_PENDING = 128;

export class ControlBrokerError extends Schema.TaggedErrorClass<ControlBrokerError>()(
  "ControlBrokerError",
  {
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(240),
    ),
  },
) {}

const brokerError = (message: string) => ControlBrokerError.make({ message });

interface ActiveGrant {
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly token: string;
  readonly createdAt: number;
  readonly queue: Queue.Queue<ControlQueueItem>;
  readonly pending: ReadonlyMap<
    string,
    Deferred.Deferred<ControlCommandOutcome, ControlBrokerError>
  >;
  readonly snapshot: FlectWorkspaceSnapshot;
  readonly events: ReadonlyArray<FlectWorkspaceEvent>;
}

type ControlQueueItem =
  {
    readonly _tag: "command";
    readonly command: FlectCommandEnvelope;
  };

export interface FlectControlBrokerShape {
  readonly status: Effect.Effect<ControlBrokerStatus>;
  readonly enable: (
    snapshot: FlectWorkspaceSnapshot,
  ) => Effect.Effect<ControlBrokerStatus, ControlBrokerError>;
  readonly disable: Effect.Effect<void>;
  readonly nextCommand: (
    workspaceId: string,
  ) => Effect.Effect<FlectCommandEnvelope, ControlBrokerError>;
  readonly complete: (
    completion: ControlCommandCompletion,
  ) => Effect.Effect<void, ControlBrokerError>;
  readonly publishSnapshot: (
    snapshot: FlectWorkspaceSnapshot,
  ) => Effect.Effect<void, ControlBrokerError>;
  readonly publishEvent: (
    event: FlectWorkspaceEvent,
  ) => Effect.Effect<void, ControlBrokerError>;
  readonly submit: (
    command: FlectCommandEnvelope,
  ) => Effect.Effect<ControlCommandOutcome, ControlBrokerError>;
  readonly snapshot: Effect.Effect<FlectWorkspaceSnapshot, ControlBrokerError>;
  readonly eventsSince: (
    sequence: number,
  ) => Effect.Effect<ReadonlyArray<FlectWorkspaceEvent>, ControlBrokerError>;
}

export class FlectControlBroker extends Context.Service<
  FlectControlBroker,
  FlectControlBrokerShape
>()("flect/FlectControlBroker") {}

export interface ControlBrokerOptions {
  readonly stateDirectory?: string;
}

const json = (value: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });

const readBody = (request: Request) =>
  Effect.tryPromise({
    try: async () => {
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new Error("oversized");
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        throw new Error("oversized");
      }
      return JSON.parse(text) as unknown;
    },
    catch: () => brokerError("The control request is invalid."),
  });

interface LoopbackServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const requestBody = (request: IncomingMessage) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Array<Uint8Array> = [];
    let size = 0;
    request.on("data", (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("oversized"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const sendWebResponse = async (
  response: Response,
  destination: ServerResponse,
) => {
  destination.statusCode = response.status;
  for (const [name, value] of response.headers) {
    destination.setHeader(name, value);
  }
  if (response.body === null) {
    destination.end();
    return;
  }
  const reader = response.body.getReader();
  destination.on("close", () => {
    void reader.cancel();
  });
  while (!destination.destroyed) {
    const part = await reader.read();
    if (part.done) {
      break;
    }
    destination.write(Buffer.from(part.value));
  }
  if (!destination.destroyed) {
    destination.end();
  }
};

const startLoopbackServer = (
  handler: (request: Request) => Promise<Response>,
) =>
  new Promise<LoopbackServer>((resolve, reject) => {
    let server: NodeServer;
    server = createServer(async (incoming, outgoing) => {
      try {
        const method = incoming.method ?? "GET";
        const body =
          method === "GET" || method === "HEAD"
            ? undefined
            : await requestBody(incoming);
        const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
          method,
          headers: incoming.headers as HeadersInit,
          ...(body === undefined || body.byteLength === 0
            ? {}
            : { body: new TextDecoder().decode(body) }),
        });
        await sendWebResponse(await handler(request), outgoing);
      } catch {
        if (!outgoing.headersSent) {
          outgoing.statusCode = 400;
          outgoing.setHeader("content-type", "application/json");
        }
        outgoing.end('{"version":1,"error":"Invalid request"}');
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("missing address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((complete) => {
            server.closeAllConnections();
            server.close(() => complete());
          }),
      });
    });
  });

export const makeControlBrokerLayer = (options: ControlBrokerOptions = {}) =>
  Layer.effect(
    FlectControlBroker,
    Effect.gen(function* () {
      const state = yield* Ref.make<ActiveGrant | undefined>(undefined);
      const statePermit = yield* Semaphore.make(1);
      let handleRequest: (request: Request) => Promise<Response> = () =>
        Promise.resolve(
          json({ version: 1, error: "Unavailable" }, { status: 503 }),
        );
      const server = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => startLoopbackServer((request) => handleRequest(request)),
          catch: () =>
            brokerError("The loopback control listener could not start."),
        }),
        (activeServer) => Effect.promise(() => activeServer.close()),
      );
      const port = server.port;
      const url = `http://127.0.0.1:${port}`;

      const status = Ref.get(state).pipe(
        Effect.map((active) =>
          ControlBrokerStatus.make({
            version: 1,
            enabled: active !== undefined,
            connected: active !== undefined,
            port,
            url,
            ...(active === undefined
              ? {}
              : {
                  instanceId: active.instanceId,
                  workspaceId: active.workspaceId,
                }),
          }),
        ),
      );

      const failPending = Effect.fn("Flect.ControlBroker.failPending")(
        (active: ActiveGrant) =>
          Effect.forEach(
            active.pending.values(),
            (deferred) =>
              Deferred.fail(
                deferred,
                brokerError("The Flect workspace is unavailable."),
              ),
            { discard: true },
          ),
      );

      const disableUnlocked = Effect.gen(function* () {
        const active = yield* Ref.getAndSet(state, undefined);
        if (active !== undefined) {
          yield* Queue.shutdown(active.queue);
          yield* failPending(active);
        }
        yield* removeControlDescriptor(options.stateDirectory);
      });
      const mutateState = statePermit.withPermits(1);
      const disable = mutateState(disableUnlocked);

      const enable = Effect.fn("Flect.ControlBroker.enable")(function* (
        snapshot: FlectWorkspaceSnapshot,
      ) {
        return yield* mutateState(
          Effect.gen(function* () {
            yield* disableUnlocked;
            const queue = yield* Queue.unbounded<ControlQueueItem>();
            const instanceId = `instance-${crypto.randomUUID()}`;
            const token = makeControlToken();
            const createdAt = Date.now();
            const active: ActiveGrant = {
              instanceId,
              workspaceId: snapshot.workspaceId,
              token,
              createdAt,
              queue,
              pending: new Map(),
              snapshot,
              events: [],
            };
            yield* writeControlDescriptor(
              ControlDescriptor.make({
                version: 1,
                instanceId,
                workspaceId: snapshot.workspaceId,
                url,
                token,
                pid: process.pid,
                createdAt,
              }),
              options.stateDirectory,
            ).pipe(
              Effect.mapError(() =>
                brokerError("The control grant could not be persisted."),
              ),
            );
            yield* Ref.set(state, active);
            return yield* status;
          }),
        );
      });

      const withActive = <A>(
        use: (active: ActiveGrant) => Effect.Effect<A, ControlBrokerError>,
      ) =>
        Ref.get(state).pipe(
          Effect.flatMap((active) =>
            active === undefined
              ? Effect.fail(brokerError("The Flect workspace is unavailable."))
              : use(active),
          ),
        );

      const nextCommand = Effect.fn("Flect.ControlBroker.nextCommand")(
        (workspaceId: string) =>
          withActive((active) =>
            active.workspaceId !== workspaceId
              ? Effect.fail(brokerError("The Flect workspace is unavailable."))
              : Queue.take(active.queue).pipe(
                  Effect.flatMap((item) =>
                    item._tag === "command"
                      ? Effect.succeed(item.command)
                      : Effect.fail(
                          brokerError("The Flect workspace is unavailable."),
                        ),
                  ),
                ),
          ),
      );

      const complete = Effect.fn("Flect.ControlBroker.complete")(
        (completion: ControlCommandCompletion) =>
          mutateState(
            withActive((active) => {
              const deferred = active.pending.get(completion.commandId);
              if (deferred === undefined) {
                return Effect.fail(
                  brokerError("The control operation is no longer pending."),
                );
              }
              return Ref.update(state, (current) =>
                current === undefined
                  ? current
                  : {
                      ...current,
                      pending: new Map(
                        [...current.pending].filter(
                          ([commandId]) => commandId !== completion.commandId,
                        ),
                      ),
                    },
              ).pipe(
                Effect.andThen(Deferred.succeed(deferred, completion.outcome)),
                Effect.asVoid,
              );
            }),
          ),
      );

      const publishSnapshot = Effect.fn("Flect.ControlBroker.publishSnapshot")(
        (snapshot: FlectWorkspaceSnapshot) =>
          mutateState(
            withActive((active) =>
              active.workspaceId !== snapshot.workspaceId
                ? Effect.fail(
                    brokerError("The Flect workspace is unavailable."),
                  )
                : Ref.set(state, { ...active, snapshot }),
            ),
          ),
      );

      const publishEvent = Effect.fn("Flect.ControlBroker.publishEvent")(
        (event: FlectWorkspaceEvent) =>
          mutateState(
            withActive((active) =>
              active.workspaceId !== event.workspaceId
                ? Effect.fail(
                    brokerError("The Flect workspace is unavailable."),
                  )
                : Ref.set(state, {
                    ...active,
                    events: [...active.events, event].slice(-MAX_EVENTS),
                  }),
            ),
          ),
      );

      const submit = Effect.fn("Flect.ControlBroker.submit")(
        (command: FlectCommandEnvelope) =>
          Effect.gen(function* () {
            const registered = yield* mutateState(
              withActive((active) =>
                Effect.gen(function* () {
                  if (
                    command.workspaceId !== active.workspaceId ||
                    command.source.kind !== "control" ||
                    command.command.type === "enable-control"
                  ) {
                    return yield* Effect.fail(
                      brokerError("The control command is not authorized."),
                    );
                  }
                  if (active.pending.size >= MAX_PENDING) {
                    return yield* Effect.fail(
                      brokerError("The control command queue is full."),
                    );
                  }
                  if (active.pending.has(command.commandId)) {
                    return yield* Effect.fail(
                      brokerError("The control command is already pending."),
                    );
                  }
                  const deferred = yield* Deferred.make<
                    ControlCommandOutcome,
                    ControlBrokerError
                  >();
                  yield* Ref.set(state, {
                    ...active,
                    pending: new Map(active.pending).set(
                      command.commandId,
                      deferred,
                    ),
                  });
                  return {
                    deferred,
                    queue: active.queue,
                  };
                }),
              ),
            );
            yield* Queue.offer(registered.queue, {
              _tag: "command",
              command,
            }).pipe(
              Effect.mapError(() =>
                brokerError("The Flect workspace is unavailable."),
              ),
            );
            return yield* Deferred.await(registered.deferred);
          }),
      );

      const snapshot = withActive((active) => Effect.succeed(active.snapshot));
      const eventsSince = (sequence: number) =>
        withActive((active) =>
          Effect.succeed(
            active.events.filter((event) => event.sequence > sequence),
          ),
        );

      const authenticated = (request: Request) =>
        Ref.get(state).pipe(
          Effect.map((active) => {
            const authorization = request.headers.get("authorization");
            return (
              active !== undefined && authorization === `Bearer ${active.token}`
            );
          }),
        );

      const externalRequest = Effect.fn("Flect.ControlBroker.externalRequest")(
        function* (request: Request) {
          if (!(yield* authenticated(request))) {
            return json({ version: 1, error: "Unauthorized" }, { status: 401 });
          }

          const requestUrl = new URL(request.url);
          const path = requestUrl.pathname;
          if (request.method === "GET" && path === "/v1/status") {
            return json(yield* status);
          }
          if (request.method === "GET" && path === "/v1/instances") {
            return json({ version: 1, instances: [yield* status] });
          }
          const workspaceMatch = path.match(
            /^\/v1\/workspaces\/([^/]+)(?:\/(events|logs|commands))?$/,
          );
          if (workspaceMatch !== null) {
            const workspaceId = decodeURIComponent(workspaceMatch[1] ?? "");
            const section = workspaceMatch[2];
            const current = yield* snapshot;
            if (workspaceId !== current.workspaceId) {
              return json(
                { version: 1, error: "Workspace unavailable" },
                { status: 404 },
              );
            }
            if (request.method === "GET" && section === undefined) {
              return json(current);
            }
            if (request.method === "GET" && section === "logs") {
              return json({ version: 1, operations: current.operations });
            }
            if (request.method === "GET" && section === "events") {
              const cursor = Number(
                requestUrl.searchParams.get("after") ??
                  request.headers.get("last-event-id") ??
                  0,
              );
              let lastSequence = Number.isFinite(cursor) ? cursor : 0;
              const encoder = new TextEncoder();
              let timer: ReturnType<typeof setTimeout> | undefined;
              let closed = false;
              const body = new ReadableStream<Uint8Array>({
                start(controller) {
                  const publish = async () => {
                    try {
                      const events = await Effect.runPromise(
                        eventsSince(lastSequence),
                      );
                      for (const event of events) {
                        lastSequence = Math.max(lastSequence, event.sequence);
                        controller.enqueue(
                          encoder.encode(
                            `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
                          ),
                        );
                      }
                      if (!closed) {
                        timer = setTimeout(publish, 250);
                      }
                    } catch {
                      closed = true;
                      controller.close();
                    }
                  };
                  void publish();
                },
                cancel() {
                  closed = true;
                  if (timer !== undefined) {
                    clearTimeout(timer);
                  }
                },
              });
              return new Response(body, {
                headers: {
                  "cache-control": "no-store",
                  "content-type": "text/event-stream; charset=utf-8",
                },
              });
            }
            if (request.method === "POST" && section === "commands") {
              const input = yield* readBody(request);
              const command = yield* decodeFlectCommandEnvelope(input).pipe(
                Effect.mapError(() =>
                  brokerError("The control request is invalid."),
                ),
              );
              const outcome = yield* submit(command);
              const responseStatus =
                outcome.status === "succeeded"
                  ? 200
                  : outcome.error._tag === "CommandConflict"
                    ? 409
                    : outcome.error._tag === "WorkspaceUnavailable"
                      ? 503
                      : outcome.error._tag === "ControlUnauthorized"
                        ? 403
                        : 422;
              return json(outcome, { status: responseStatus });
            }
          }
          if (request.method === "POST" && path === "/v1/control/disable") {
            const response = json(
              ControlAck.make({ version: 1, status: "accepted" }),
            );
            yield* disable;
            return response;
          }
          return json({ version: 1, error: "Not found" }, { status: 404 });
        },
      );

      handleRequest = (request) =>
        Effect.runPromise(
          externalRequest(request).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                json(
                  {
                    version: 1,
                    error:
                      error.message === "The control request is invalid."
                        ? "Invalid request"
                        : "Control unavailable",
                  },
                  {
                    status:
                      error.message === "The control request is invalid."
                        ? 400
                        : 503,
                  },
                ),
              ),
            ),
          ),
        );

      yield* Effect.addFinalizer(() => disable);

      return {
        status,
        enable,
        disable,
        nextCommand,
        complete,
        publishSnapshot,
        publishEvent,
        submit,
        snapshot,
        eventsSince,
      };
    }),
  );

export const ControlBrokerLive = makeControlBrokerLayer();

export const succeededCompletion = (
  receipt: ControlCommandSucceeded["receipt"],
) =>
  ControlCommandCompletion.make({
    commandId: receipt.commandId,
    outcome: ControlCommandSucceeded.make({
      status: "succeeded",
      receipt,
    }),
  });

export const failedCompletion = (commandId: string, error: FlectCommandError) =>
  ControlCommandCompletion.make({
    commandId,
    outcome: ControlCommandFailed.make({
      status: "failed",
      error,
    }),
  });
