import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from 'effect';
import { type ControlDescriptorError, readControlDescriptor } from '../server/control-descriptor';
import {
	ControlCommandSource,
	DisableControl,
	type FlectCommand,
	FlectCommandEnvelope,
	type FlectCommandError,
	type FlectCommandReceipt,
	FlectWorkspaceEvent,
	FlectWorkspaceSnapshot
} from '../shared/control';
import {
	ControlBrokerStatus,
	ControlCommandOutcome,
	ControlLogsResponse
} from '../shared/control-channel';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export class FlectControlClientError extends Schema.TaggedErrorClass<FlectControlClientError>()(
	'FlectControlClientError',
	{
		reason: Schema.Literals(['unavailable', 'unauthorized', 'invalid-response']),
		message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))
	}
) {}

const clientError = (reason: FlectControlClientError['reason'], message: string) =>
	FlectControlClientError.make({ reason, message });

export interface FlectControlClientShape {
	readonly status: Effect.Effect<
		ControlBrokerStatus,
		FlectControlClientError | ControlDescriptorError
	>;
	readonly inspect: Effect.Effect<
		FlectWorkspaceSnapshot,
		FlectControlClientError | ControlDescriptorError
	>;
	readonly logs: Effect.Effect<
		ControlLogsResponse,
		FlectControlClientError | ControlDescriptorError
	>;
	readonly events: (
		after?: number
	) => Stream.Stream<FlectWorkspaceEvent, FlectControlClientError | ControlDescriptorError>;
	readonly command: (
		command: FlectCommand,
		expectedSequence?: number
	) => Effect.Effect<
		FlectCommandReceipt,
		FlectCommandError | FlectControlClientError | ControlDescriptorError
	>;
	readonly disable: Effect.Effect<
		void,
		FlectCommandError | FlectControlClientError | ControlDescriptorError
	>;
}

export class FlectControlClient extends Context.Service<
	FlectControlClient,
	FlectControlClientShape
>()('flect/FlectControlClient') {}

export interface FlectControlClientOptions {
	readonly stateDirectory?: string;
	readonly clientName?: string;
	readonly clientId?: string;
	readonly fetch?: typeof fetch;
}

const sseData = async function* (body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let data: Array<string> = [];
	try {
		while (true) {
			const part = await reader.read();
			buffer += decoder.decode(part.value, { stream: !part.done });
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const raw = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
				if (line.length === 0) {
					if (data.length > 0) {
						yield JSON.parse(data.join('\n')) as unknown;
						data = [];
					}
				} else if (line.startsWith('data:')) {
					data.push(line.slice(5).trimStart());
				}
				newline = buffer.indexOf('\n');
			}
			if (part.done) {
				break;
			}
		}
		if (data.length > 0) {
			yield JSON.parse(data.join('\n')) as unknown;
		}
	} finally {
		reader.releaseLock();
	}
};

export const makeFlectControlClientLayer = (options: FlectControlClientOptions = {}) =>
	Layer.effect(
		FlectControlClient,
		Effect.sync(() => {
			const clientName = options.clientName ?? 'flect';
			const clientId = options.clientId ?? `client-${crypto.randomUUID()}`;
			const fetcher = options.fetch ?? globalThis.fetch;

			const execute = Effect.fn('Flect.ControlClient.execute')(function* (
				path: string,
				init: RequestInit = {}
			) {
				const descriptor = yield* readControlDescriptor(options.stateDirectory);
				const response = yield* Effect.tryPromise({
					try: (signal) =>
						fetcher(`${descriptor.url}${path}`, {
							...init,
							signal,
							headers: {
								...init.headers,
								authorization: `Bearer ${descriptor.token}`
							}
						}),
					catch: () => clientError('unavailable', 'Flect local control is unavailable.')
				});
				if (response.status === 401) {
					return yield* Effect.fail(
						clientError('unauthorized', 'Flect local control authorization was revoked.')
					);
				}
				return response;
			});

			const decode = <A, R>(schema: Schema.ConstraintDecoder<A, R>, response: Response) =>
				Effect.tryPromise({
					try: () => response.json(),
					catch: () =>
						clientError('invalid-response', 'Flect returned an invalid control response.')
				}).pipe(
					Effect.flatMap((input) =>
						Schema.decodeUnknownEffect(
							schema,
							strictOptions
						)(input).pipe(
							Effect.mapError(() =>
								clientError('invalid-response', 'Flect returned an invalid control response.')
							)
						)
					)
				);

			const status = execute('/v1/status').pipe(
				Effect.flatMap((response) => decode(ControlBrokerStatus, response))
			);

			const workspacePath = readControlDescriptor(options.stateDirectory).pipe(
				Effect.map((descriptor) => `/v1/workspaces/${encodeURIComponent(descriptor.workspaceId)}`)
			);

			const inspect = workspacePath.pipe(
				Effect.flatMap(execute),
				Effect.flatMap((response) => decode(FlectWorkspaceSnapshot, response))
			);

			const logs = workspacePath.pipe(
				Effect.flatMap((path) => execute(`${path}/logs`)),
				Effect.flatMap((response) => decode(ControlLogsResponse, response))
			);

			const events = (after = 0) =>
				Stream.unwrap(
					workspacePath.pipe(
						Effect.flatMap((path) => execute(`${path}/events?after=${Math.max(0, after)}`)),
						Effect.flatMap((response) =>
							response.ok && response.body !== null
								? Effect.succeed(
										Stream.fromAsyncIterable(sseData(response.body), () =>
											clientError('invalid-response', 'Flect returned an invalid event stream.')
										).pipe(
											Stream.mapEffect((input) =>
												Schema.decodeUnknownEffect(
													FlectWorkspaceEvent,
													strictOptions
												)(input).pipe(
													Effect.mapError(() =>
														clientError('invalid-response', 'Flect returned an invalid event.')
													)
												)
											)
										)
									)
								: Effect.fail(clientError('unavailable', 'Flect event streaming is unavailable.'))
						)
					)
				);

			const command = Effect.fn('Flect.ControlClient.command')(function* (
				value: FlectCommand,
				expectedSequence?: number
			) {
				if (value.type === 'enable-control') {
					return yield* Effect.fail(
						clientError('unauthorized', 'Outside clients cannot enable Flect control.')
					);
				}
				const descriptor = yield* readControlDescriptor(options.stateDirectory);
				const commandPath = `/v1/workspaces/${encodeURIComponent(descriptor.workspaceId)}/commands`;
				const envelope = FlectCommandEnvelope.make({
					version: 1,
					commandId: `cmd-${crypto.randomUUID()}`,
					workspaceId: descriptor.workspaceId,
					source: ControlCommandSource.make({
						kind: 'control',
						clientId,
						clientName
					}),
					...(expectedSequence === undefined ? {} : { expectedSequence }),
					command: value
				});
				const response = yield* execute(commandPath, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(envelope)
				});
				const outcome = yield* decode(ControlCommandOutcome, response);
				return outcome.status === 'succeeded' ? outcome.receipt : yield* Effect.fail(outcome.error);
			});

			const disable = command(DisableControl.make({ type: 'disable-control' })).pipe(Effect.asVoid);

			return { status, inspect, logs, events, command, disable };
		})
	);
