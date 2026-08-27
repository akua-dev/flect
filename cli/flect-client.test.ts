import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Schema, Stream } from 'effect';
import { makeControlToken, writeControlDescriptor } from '../server/control-descriptor';
import { FlectWorkspaceEvent, SetMode, UserCommandSource } from '../shared/control';
import { ControlDescriptor } from '../shared/control-channel';
import { FlectControlClient, makeFlectControlClientLayer } from './flect-client';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);

const SentCommandBody = Schema.Struct({
	source: Schema.Struct({
		kind: Schema.String,
		clientName: Schema.String
	}),
	command: Schema.Struct({
		type: Schema.String
	})
});
const decodeSentCommandBody = Schema.decodeUnknownSync(SentCommandBody);

const SentDisableBody = Schema.Struct({
	command: Schema.Struct({
		type: Schema.String
	})
});
const decodeSentDisableBody = Schema.decodeUnknownSync(SentDisableBody);

describe('FlectControlClient', () => {
	it.effect('discovers the private descriptor without exposing its bearer', () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'flect-client-test-')));
			const token = makeControlToken();
			yield* writeControlDescriptor(
				ControlDescriptor.make({
					version: 1,
					instanceId: 'instance-client-test',
					workspaceId: 'workspace-client-test',
					url: 'http://127.0.0.1:43127',
					token,
					pid: process.pid,
					createdAt: 1
				}),
				directory
			).pipe(Effect.provide(platform));
			const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							status: 'succeeded',
							receipt: {
								version: 1,
								commandId: 'cmd-client-test-response',
								workspaceId: 'workspace-client-test',
								operationId: 'operation-client-test',
								sequence: 2,
								status: 'completed'
							}
						}),
						{
							headers: { 'content-type': 'application/json' }
						}
					)
				)
			);

			return yield* Effect.gen(function* () {
				const client = yield* FlectControlClient;
				const receipt = yield* client.command(SetMode.make({ type: 'set-mode', mode: 'run' }));
				const [input, init] = fetcher.mock.calls[0] ?? [];
				const body = decodeSentCommandBody(JSON.parse(String(init?.body)));

				assert.strictEqual(
					String(input),
					'http://127.0.0.1:43127/v1/workspaces/workspace-client-test/commands'
				);
				assert.strictEqual(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
				assert.strictEqual(body.source.kind, 'control');
				assert.strictEqual(body.source.clientName, 'Outside test');
				assert.strictEqual(body.command.type, 'set-mode');
				assert.strictEqual(receipt.operationId, 'operation-client-test');
				assert.isFalse(JSON.stringify(receipt).includes(token));

				yield* client.disable;
				const [, disableInit] = fetcher.mock.calls[1] ?? [];
				const disableBody = decodeSentDisableBody(JSON.parse(String(disableInit?.body)));
				assert.strictEqual(disableBody.command.type, 'disable-control');
			}).pipe(
				Effect.provide(
					Layer.merge(
						makeFlectControlClientLayer({
							stateDirectory: directory,
							clientName: 'Outside test',
							clientId: 'client-client-test',
							fetch: fetcher
						}),
						platform
					)
				)
			);
		})
	);

	it.effect('strictly decodes the authenticated SSE event stream', () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				mkdtemp(join(tmpdir(), 'flect-client-events-test-'))
			);
			yield* writeControlDescriptor(
				ControlDescriptor.make({
					version: 1,
					instanceId: 'instance-client-events',
					workspaceId: 'workspace-client-test',
					url: 'http://127.0.0.1:43129',
					token: makeControlToken(),
					pid: process.pid,
					createdAt: 1
				}),
				directory
			).pipe(Effect.provide(platform));
			const event = FlectWorkspaceEvent.make({
				version: 1,
				id: 'event-client-test',
				sequence: 3,
				timestamp: 3,
				workspaceId: 'workspace-client-test',
				source: UserCommandSource.make({ kind: 'user' }),
				type: 'state-changed'
			});
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
				new Response(`id: 3\ndata: ${JSON.stringify(event)}\n\n`, {
					headers: { 'content-type': 'text/event-stream' }
				})
			);

			return yield* Effect.gen(function* () {
				const client = yield* FlectControlClient;
				const events = yield* client.events(2).pipe(Stream.take(1), Stream.runCollect);

				assert.strictEqual(events.length, 1);
				assert.strictEqual(events[0]?.sequence, 3);
				assert.isTrue(
					String(fetcher.mock.calls[0]?.[0]).endsWith(
						'/v1/workspaces/workspace-client-test/events?after=2'
					)
				);
			}).pipe(
				Effect.provide(
					Layer.merge(
						makeFlectControlClientLayer({
							stateDirectory: directory,
							fetch: fetcher
						}),
						platform
					)
				)
			);
		})
	);
});
