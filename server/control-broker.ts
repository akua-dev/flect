import { createServer } from 'node:http';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer';
import {
	Context,
	Deferred,
	Duration,
	Effect,
	Layer,
	Option,
	Queue,
	Ref,
	Schema,
	type Scope,
	Semaphore,
	Stream
} from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import {
	decodeFlectCommandEnvelope,
	type FlectCommandEnvelope,
	type FlectCommandError,
	type FlectWorkspaceEvent,
	type FlectWorkspaceSnapshot
} from '../shared/control';
import {
	ControlAck,
	ControlBrokerStatus,
	ControlCommandCompletion,
	ControlCommandFailed,
	type ControlCommandOutcome,
	ControlCommandSucceeded,
	ControlDescriptor
} from '../shared/control-channel';
import {
	makeControlToken,
	removeControlDescriptor,
	writeControlDescriptor
} from './control-descriptor';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 512;
const MAX_PENDING = 128;
const EVENTS_POLL_INTERVAL = Duration.millis(250);

export class ControlBrokerError extends Schema.TaggedErrorClass<ControlBrokerError>()(
	'ControlBrokerError',
	{
		message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))
	}
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

type ControlQueueItem = {
	readonly _tag: 'command';
	readonly command: FlectCommandEnvelope;
};

export interface FlectControlBrokerShape {
	readonly status: Effect.Effect<ControlBrokerStatus>;
	readonly enable: (
		snapshot: FlectWorkspaceSnapshot
	) => Effect.Effect<ControlBrokerStatus, ControlBrokerError>;
	readonly disable: Effect.Effect<void>;
	readonly nextCommand: (
		workspaceId: string
	) => Effect.Effect<FlectCommandEnvelope, ControlBrokerError>;
	readonly complete: (
		completion: ControlCommandCompletion
	) => Effect.Effect<void, ControlBrokerError>;
	readonly publishSnapshot: (
		snapshot: FlectWorkspaceSnapshot
	) => Effect.Effect<void, ControlBrokerError>;
	readonly publishEvent: (event: FlectWorkspaceEvent) => Effect.Effect<void, ControlBrokerError>;
	readonly submit: (
		command: FlectCommandEnvelope
	) => Effect.Effect<ControlCommandOutcome, ControlBrokerError>;
	readonly snapshot: Effect.Effect<FlectWorkspaceSnapshot, ControlBrokerError>;
	readonly eventsSince: (
		sequence: number
	) => Effect.Effect<ReadonlyArray<FlectWorkspaceEvent>, ControlBrokerError>;
}

export class FlectControlBroker extends Context.Service<
	FlectControlBroker,
	FlectControlBrokerShape
>()('flect/FlectControlBroker') {}

export interface ControlBrokerOptions {
	readonly stateDirectory?: string;
}

const noStoreHeaders = { 'cache-control': 'no-store' } as const;

const controlJson = (value: unknown, options?: { readonly status?: number }) =>
	HttpServerResponse.json(value, { status: options?.status ?? 200, headers: noStoreHeaders }).pipe(
		Effect.orDie
	);

/**
 * Bounds the request body the same way the previous `node:http` handler did:
 * a declared `content-length` above the cap is rejected before the body is
 * read, and the decoded text is re-checked against the cap in case the
 * header was absent or understated.
 */
const readBody = Effect.fn('ControlBroker.readBody')(function* (
	request: HttpServerRequest.HttpServerRequest
): Effect.fn.Return<unknown, ControlBrokerError> {
	const declared = Number(request.headers['content-length'] ?? 0);
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
		return yield* Effect.fail(brokerError('The control request is invalid.'));
	}
	const text = yield* request.text.pipe(
		Effect.mapError(() => brokerError('The control request is invalid.'))
	);
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
		return yield* Effect.fail(brokerError('The control request is invalid.'));
	}
	return yield* Effect.try({
		try: () => JSON.parse(text) as unknown,
		catch: () => brokerError('The control request is invalid.')
	});
});

interface LoopbackServer {
	readonly port: number;
}

/**
 * Starts the ephemeral loopback control listener on the Effect platform HTTP
 * server instead of a hand-rolled `node:http` request/response bridge. This
 * broker's layer is constructed unconditionally by every test that exercises
 * `server/app.ts` (it is threaded into `makeFlectHttpApp` regardless of
 * environment), and Flect's Vitest suite runs its workers under Node, not
 * Bun — `@effect/platform-bun`'s `BunHttpServer` calls `Bun.serve` directly,
 * which throws `Bun is not defined` there. `server/index.ts` can use
 * `BunHttpServer` because it is only ever launched by the real `bun`
 * executable (`bun --watch server/index.ts`), never imported by a test. This
 * listener instead uses `@effect/platform-node`'s `NodeHttpServer`, which
 * runs identically under real Bun (Bun implements `node:http`) and under the
 * Node-hosted Vitest workers. `node:http`'s bare `createServer` factory is
 * `NodeHttpServer.make`'s required socket constructor — the one line Effect's
 * platform layer does not own — everything else (headers, streaming bodies,
 * response writing) goes through `HttpServerRequest`/`HttpServerResponse`
 * exactly as `server/app.ts` does. Binding stays `127.0.0.1` with an
 * OS-assigned port — see `apps/flect/AGENTS.md`: "Bind local services to
 * loopback." The server and its request-serving fiber are scoped to the
 * broker layer, so both are torn down together when the layer is released.
 */
const startLoopbackServer = Effect.fn('ControlBroker.startLoopbackServer')(function* (
	handler: (
		request: HttpServerRequest.HttpServerRequest
	) => Effect.Effect<HttpServerResponse.HttpServerResponse>
): Effect.fn.Return<LoopbackServer, ControlBrokerError, Scope.Scope> {
	const server = yield* NodeHttpServer.make(() => createServer(), {
		host: '127.0.0.1',
		port: 0
	}).pipe(Effect.mapError(() => brokerError('The loopback control listener could not start.')));
	if (server.address._tag !== 'TcpAddress') {
		return yield* Effect.fail(brokerError('The loopback control listener could not start.'));
	}
	const httpApp = Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		return yield* handler(request);
	}).pipe(
		Effect.catchDefect(() => controlJson({ version: 1, error: 'Invalid request' }, { status: 400 }))
	);
	yield* server.serve(httpApp).pipe(Effect.forkScoped);
	return { port: server.address.port };
});

// oxlint-disable effecttsgo/missing-effect-context -- false positive: `tsc -b`
// confirms this whole layer's R resolves to never (control-descriptor's
// FileSystem/Path requirement is threaded through `platform` below and
// provided at every call site). effecttsgo cannot fully resolve the
// requirement type once a Layer.provide(Layer.merge(...)) composition this
// large is involved — same class of false positive documented for
// tauri-transport.ts and workspace-controller.ts. See the escalations list
// in the conformance burn-down report.
export const makeControlBrokerLayer = (options: ControlBrokerOptions = {}) =>
	Layer.effect(
		FlectControlBroker,
		Effect.gen(function* () {
			const state = yield* Ref.make<ActiveGrant | undefined>(undefined);
			const statePermit = yield* Semaphore.make(1);
			let handleRequest: (
				request: HttpServerRequest.HttpServerRequest
			) => Effect.Effect<HttpServerResponse.HttpServerResponse> = () =>
				controlJson({ version: 1, error: 'Unavailable' }, { status: 503 });
			const server = yield* startLoopbackServer((request) => handleRequest(request));
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
									workspaceId: active.workspaceId
								})
					})
				)
			);

			const failPending = Effect.fn('ControlBroker.failPending')(
				(active: ActiveGrant): Effect.Effect<void, never> =>
					Effect.forEach(
						active.pending.values(),
						(deferred) =>
							Deferred.fail(deferred, brokerError('The Flect workspace is unavailable.')),
						{ discard: true }
					)
			);

			const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
			const disableUnlocked = Effect.gen(function* () {
				const active = yield* Ref.getAndSet(state, undefined);
				if (active !== undefined) {
					yield* Queue.shutdown(active.queue);
					yield* failPending(active);
				}
				yield* removeControlDescriptor(options.stateDirectory).pipe(Effect.provide(platform));
			});
			const mutateState = statePermit.withPermits(1);
			const disable = mutateState(disableUnlocked);

			const enable = Effect.fn('ControlBroker.enable')(function* (
				snapshot: FlectWorkspaceSnapshot
			): Effect.fn.Return<ControlBrokerStatus, ControlBrokerError> {
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
							events: []
						};
						yield* writeControlDescriptor(
							ControlDescriptor.make({
								version: 1,
								instanceId,
								workspaceId: snapshot.workspaceId,
								url,
								token,
								pid: process.pid,
								createdAt
							}),
							options.stateDirectory
						).pipe(
							Effect.provide(platform),
							Effect.mapError(() => brokerError('The control grant could not be persisted.'))
						);
						yield* Ref.set(state, active);
						return yield* status;
					})
				);
			});

			const withActive = <A>(use: (active: ActiveGrant) => Effect.Effect<A, ControlBrokerError>) =>
				Ref.get(state).pipe(
					Effect.flatMap((active) =>
						active === undefined
							? Effect.fail(brokerError('The Flect workspace is unavailable.'))
							: use(active)
					)
				);

			const nextCommand = Effect.fn('ControlBroker.nextCommand')(
				(workspaceId: string): Effect.Effect<FlectCommandEnvelope, ControlBrokerError> =>
					withActive((active) =>
						active.workspaceId !== workspaceId
							? Effect.fail(brokerError('The Flect workspace is unavailable.'))
							: Queue.take(active.queue).pipe(
									Effect.flatMap((item) =>
										item._tag === 'command'
											? Effect.succeed(item.command)
											: Effect.fail(brokerError('The Flect workspace is unavailable.'))
									)
								)
					)
			);

			const complete = Effect.fn('ControlBroker.complete')(
				(completion: ControlCommandCompletion): Effect.Effect<void, ControlBrokerError> =>
					mutateState(
						withActive((active) => {
							const deferred = active.pending.get(completion.commandId);
							if (deferred === undefined) {
								return Effect.fail(brokerError('The control operation is no longer pending.'));
							}
							return Ref.update(state, (current) =>
								current === undefined
									? current
									: {
											...current,
											pending: new Map(
												[...current.pending].filter(
													([commandId]) => commandId !== completion.commandId
												)
											)
										}
							).pipe(Effect.andThen(Deferred.succeed(deferred, completion.outcome)), Effect.asVoid);
						})
					)
			);

			const publishSnapshot = Effect.fn('ControlBroker.publishSnapshot')(
				(snapshot: FlectWorkspaceSnapshot): Effect.Effect<void, ControlBrokerError> =>
					mutateState(
						withActive((active) =>
							active.workspaceId !== snapshot.workspaceId
								? Effect.fail(brokerError('The Flect workspace is unavailable.'))
								: Ref.set(state, { ...active, snapshot })
						)
					)
			);

			const publishEvent = Effect.fn('ControlBroker.publishEvent')(
				(event: FlectWorkspaceEvent): Effect.Effect<void, ControlBrokerError> =>
					mutateState(
						withActive((active) =>
							active.workspaceId !== event.workspaceId
								? Effect.fail(brokerError('The Flect workspace is unavailable.'))
								: Ref.set(state, {
										...active,
										events: [...active.events, event].slice(-MAX_EVENTS)
									})
						)
					)
			);

			const submit = Effect.fn('ControlBroker.submit')(
				(command: FlectCommandEnvelope): Effect.Effect<ControlCommandOutcome, ControlBrokerError> =>
					Effect.gen(function* () {
						const registered = yield* mutateState(
							withActive((active) =>
								Effect.gen(function* () {
									if (
										command.workspaceId !== active.workspaceId ||
										command.source.kind !== 'control' ||
										command.command.type === 'enable-control'
									) {
										return yield* Effect.fail(
											brokerError('The control command is not authorized.')
										);
									}
									if (active.pending.size >= MAX_PENDING) {
										return yield* Effect.fail(brokerError('The control command queue is full.'));
									}
									if (active.pending.has(command.commandId)) {
										return yield* Effect.fail(
											brokerError('The control command is already pending.')
										);
									}
									const deferred = yield* Deferred.make<
										ControlCommandOutcome,
										ControlBrokerError
									>();
									yield* Ref.set(state, {
										...active,
										pending: new Map(active.pending).set(command.commandId, deferred)
									});
									return {
										deferred,
										queue: active.queue
									};
								})
							)
						);
						yield* Queue.offer(registered.queue, {
							_tag: 'command',
							command
						}).pipe(Effect.mapError(() => brokerError('The Flect workspace is unavailable.')));
						return yield* Deferred.await(registered.deferred);
					})
			);

			const snapshot = withActive((active) => Effect.succeed(active.snapshot));
			const eventsSince = (sequence: number) =>
				withActive((active) =>
					Effect.succeed(active.events.filter((event) => event.sequence > sequence))
				);

			const authenticated = (request: HttpServerRequest.HttpServerRequest) =>
				Ref.get(state).pipe(
					Effect.map(
						(active) =>
							active !== undefined && request.headers.authorization === `Bearer ${active.token}`
					)
				);

			/** SSE stream of workspace events, polling `eventsSince` every 250ms after an immediate first read. */
			const eventsSseStream = (initialCursor: number) =>
				Stream.paginate(initialCursor, (cursor) =>
					eventsSince(cursor).pipe(
						Effect.delay(cursor === initialCursor ? Duration.zero : EVENTS_POLL_INTERVAL),
						Effect.map((events) => {
							const next = events.reduce((max, event) => Math.max(max, event.sequence), cursor);
							return [events, Option.some(next)] as const;
						})
					)
				).pipe(
					Stream.map((event) => `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`),
					Stream.catch(() => Stream.empty),
					Stream.encodeText
				);

			// oxlint-disable effecttsgo/missing-effect-error -- false positive: `tsc -b`
			// confirms `disable` (built from `mutateState(disableUnlocked)`, itself composed
			// from `Ref`/`Queue`/`Deferred` operations that are all `E = never` plus
			// `removeControlDescriptor(...).pipe(Effect.provide(platform))`, which is also
			// `E = never`) is `Effect<void, never, never>` end to end - trivially assignable
			// to this function's declared `ControlBrokerError`. effecttsgo cannot fully
			// resolve the error channel through the `Semaphore.withPermits`/
			// `Layer.provide(Layer.merge(...))` composition here and falls back to reporting
			// `unknown` - same class of false positive as `makeControlBrokerLayer` above.
			const externalRequest = Effect.fn('ControlBroker.externalRequest')(function* (
				request: HttpServerRequest.HttpServerRequest
			): Effect.fn.Return<HttpServerResponse.HttpServerResponse, ControlBrokerError> {
				if (!(yield* authenticated(request))) {
					return yield* controlJson({ version: 1, error: 'Unauthorized' }, { status: 401 });
				}

				const requestUrl = new URL(request.url, 'http://control.invalid');
				const path = requestUrl.pathname;
				if (request.method === 'GET' && path === '/v1/status') {
					return yield* controlJson(yield* status);
				}
				if (request.method === 'GET' && path === '/v1/instances') {
					return yield* controlJson({ version: 1, instances: [yield* status] });
				}
				const workspaceMatch = path.match(
					/^\/v1\/workspaces\/([^/]+)(?:\/(events|logs|commands))?$/
				);
				if (workspaceMatch !== null) {
					const workspaceId = decodeURIComponent(workspaceMatch[1] ?? '');
					const section = workspaceMatch[2];
					const current = yield* snapshot;
					if (workspaceId !== current.workspaceId) {
						return yield* controlJson(
							{ version: 1, error: 'Workspace unavailable' },
							{ status: 404 }
						);
					}
					if (request.method === 'GET' && section === undefined) {
						return yield* controlJson(current);
					}
					if (request.method === 'GET' && section === 'logs') {
						return yield* controlJson({ version: 1, operations: current.operations });
					}
					if (request.method === 'GET' && section === 'events') {
						const afterParam =
							requestUrl.searchParams.get('after') ?? request.headers['last-event-id'];
						const cursor = Number(afterParam ?? 0);
						const initialCursor = Number.isFinite(cursor) ? cursor : 0;
						return HttpServerResponse.stream(eventsSseStream(initialCursor), {
							contentType: 'text/event-stream; charset=utf-8',
							headers: noStoreHeaders
						});
					}
					if (request.method === 'POST' && section === 'commands') {
						const input = yield* readBody(request);
						const command = yield* decodeFlectCommandEnvelope(input).pipe(
							Effect.mapError(() => brokerError('The control request is invalid.'))
						);
						const outcome = yield* submit(command);
						const responseStatus =
							outcome.status === 'succeeded'
								? 200
								: outcome.error._tag === 'CommandConflict'
									? 409
									: outcome.error._tag === 'WorkspaceUnavailable'
										? 503
										: outcome.error._tag === 'ControlUnauthorized'
											? 403
											: 422;
						return yield* controlJson(outcome, { status: responseStatus });
					}
				}
				if (request.method === 'POST' && path === '/v1/control/disable') {
					const response = yield* controlJson(ControlAck.make({ version: 1, status: 'accepted' }));
					yield* disable;
					return response;
				}
				return yield* controlJson({ version: 1, error: 'Not found' }, { status: 404 });
			});

			handleRequest = (request) =>
				externalRequest(request).pipe(
					Effect.catch((error) =>
						controlJson(
							{
								version: 1,
								error:
									error.message === 'The control request is invalid.'
										? 'Invalid request'
										: 'Control unavailable'
							},
							{
								status: error.message === 'The control request is invalid.' ? 400 : 503
							}
						)
					)
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
				eventsSince
			};
		})
	).pipe(Layer.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)));
// oxlint-enable effecttsgo/missing-effect-context

export const ControlBrokerLive = makeControlBrokerLayer();

export const succeededCompletion = (receipt: ControlCommandSucceeded['receipt']) =>
	ControlCommandCompletion.make({
		commandId: receipt.commandId,
		outcome: ControlCommandSucceeded.make({
			status: 'succeeded',
			receipt
		})
	});

export const failedCompletion = (commandId: string, error: FlectCommandError) =>
	ControlCommandCompletion.make({
		commandId,
		outcome: ControlCommandFailed.make({
			status: 'failed',
			error
		})
	});
