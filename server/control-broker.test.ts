import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber, Layer, Schema } from 'effect';
import {
	ControlCommandSource,
	ControlStateSnapshot,
	FlectCommandEnvelope,
	FlectCommandReceipt,
	FlectWorkspaceSnapshot,
	RailStateSnapshot,
	SetMode
} from '../shared/control';
import {
	ControlCommandCompletion,
	ControlCommandOutcome,
	ControlCommandSucceeded
} from '../shared/control-channel';
import { defaultInterfaceDocument } from '../shared/interface-document';
import { InterfaceRevision, RevisionId, ShapingEvent, ShapingSnapshot } from '../shared/revisions';
import { FlectControlBroker, makeControlBrokerLayer } from './control-broker';
import { readControlDescriptor } from './control-descriptor';

const builtIn = InterfaceRevision.make({
	version: 1,
	id: RevisionId.make('built-in'),
	status: 'accepted',
	source: 'built-in',
	document: defaultInterfaceDocument,
	createdAt: 0
});

const snapshot = FlectWorkspaceSnapshot.make({
	version: 1,
	workspaceId: 'workspace-broker-test',
	sequence: 0,
	phase: 'ready',
	mode: 'edit',
	document: defaultInterfaceDocument,
	shaping: ShapingSnapshot.make({
		version: 1,
		active: builtIn,
		lastKnownGood: builtIn,
		safeMode: false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 0,
			type: 'initialized',
			revisionId: builtIn.id
		})
	}),
	agent: {
		models: [],
		favoriteModels: [],
		externalExtensions: { app: false, shaper: false },
		app: {
			role: 'app',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		},
		previewApp: {
			role: 'app',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		},
		shaper: {
			role: 'shaper',
			status: 'ready',
			messages: [],
			activities: [],
			lastPrompt: ''
		}
	},
	rail: RailStateSnapshot.make({ collapsed: false, width: 400 }),
	control: ControlStateSnapshot.make({ enabled: true, clients: [] }),
	operations: []
});

const command = FlectCommandEnvelope.make({
	version: 1,
	commandId: 'cmd-broker-test-1',
	workspaceId: snapshot.workspaceId,
	source: ControlCommandSource.make({
		kind: 'control',
		clientId: 'client-broker-test',
		clientName: 'Broker test'
	}),
	command: SetMode.make({ type: 'set-mode', mode: 'run' })
});

const concurrentCommand = (index: number) =>
	FlectCommandEnvelope.make({
		...command,
		commandId: `cmd-broker-concurrent-${index}`
	});

describe('FlectControlBroker', () => {
	it.effect('rotates a private grant and interrupts queued work on disable', () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				mkdtemp(join(tmpdir(), 'flect-broker-lifecycle-'))
			);
			return yield* Effect.gen(function* () {
				const broker = yield* FlectControlBroker;

				const first = yield* broker.enable(snapshot);
				const descriptor = yield* readControlDescriptor(directory);
				const waiting = yield* broker.nextCommand(snapshot.workspaceId).pipe(Effect.forkChild);
				yield* broker.disable;
				const interrupted = yield* Fiber.await(waiting);

				assert.strictEqual(first.enabled, true);
				assert.strictEqual(first.url, descriptor.url);
				assert.strictEqual(interrupted._tag, 'Failure');

				yield* broker.enable(snapshot);
				const rotated = yield* readControlDescriptor(directory);
				assert.notStrictEqual(rotated.token, descriptor.token);
			}).pipe(
				Effect.provide(
					Layer.merge(
						makeControlBrokerLayer({ stateDirectory: directory }),
						Layer.merge(BunFileSystem.layer, BunPath.layer)
					)
				)
			);
		})
	);

	it.effect('authenticates HTTP commands and returns the exact completion', () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'flect-broker-http-')));
			return yield* Effect.gen(function* () {
				const broker = yield* FlectControlBroker;
				yield* broker.enable(snapshot);
				const descriptor = yield* readControlDescriptor(directory);

				const unauthorized = yield* Effect.promise(() => fetch(`${descriptor.url}/v1/status`));
				assert.strictEqual(unauthorized.status, 401);

				const request = yield* Effect.tryPromise({
					try: () =>
						fetch(`${descriptor.url}/v1/workspaces/${snapshot.workspaceId}/commands`, {
							method: 'POST',
							headers: {
								authorization: `Bearer ${descriptor.token}`,
								'content-type': 'application/json'
							},
							body: JSON.stringify(command)
						}),
					catch: () => new Error('request failed')
				}).pipe(Effect.forkChild);

				const queued = yield* broker.nextCommand(snapshot.workspaceId);
				const receipt = FlectCommandReceipt.make({
					version: 1,
					commandId: queued.commandId,
					workspaceId: queued.workspaceId,
					operationId: 'operation-broker-test-1',
					sequence: 2,
					status: 'completed'
				});
				yield* broker.complete(
					ControlCommandCompletion.make({
						commandId: queued.commandId,
						outcome: ControlCommandSucceeded.make({
							status: 'succeeded',
							receipt
						})
					})
				);

				const response = yield* Fiber.join(request);
				const body = yield* Effect.promise(() => response.json());
				assert.strictEqual(response.status, 200);
				assert.deepStrictEqual(body, {
					status: 'succeeded',
					receipt: { ...receipt }
				});
				assert.isFalse(JSON.stringify(body).includes(descriptor.token));

				yield* broker.disable;
				const stale = yield* Effect.promise(() =>
					fetch(`${descriptor.url}/v1/status`, {
						headers: { authorization: `Bearer ${descriptor.token}` }
					})
				);
				assert.strictEqual(stale.status, 401);
			}).pipe(
				Effect.provide(
					Layer.merge(
						makeControlBrokerLayer({ stateDirectory: directory }),
						Layer.merge(BunFileSystem.layer, BunPath.layer)
					)
				)
			);
		})
	);

	it.effect('retains every pending completion across concurrent HTTP submissions', () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				mkdtemp(join(tmpdir(), 'flect-broker-concurrent-'))
			);
			return yield* Effect.gen(function* () {
				const broker = yield* FlectControlBroker;
				yield* broker.enable(snapshot);
				const descriptor = yield* readControlDescriptor(directory);
				const commands = Array.from({ length: 32 }, (_, index) => concurrentCommand(index));
				const worker = yield* Effect.forEach(
					commands,
					(_, index) =>
						Effect.gen(function* () {
							const candidate = yield* broker.nextCommand(snapshot.workspaceId);
							yield* broker.complete(
								ControlCommandCompletion.make({
									commandId: candidate.commandId,
									outcome: ControlCommandSucceeded.make({
										status: 'succeeded',
										receipt: FlectCommandReceipt.make({
											version: 1,
											commandId: candidate.commandId,
											workspaceId: candidate.workspaceId,
											operationId: `operation-broker-concurrent-${index}`,
											sequence: index + 1,
											status: 'completed'
										})
									})
								})
							);
						}),
					{ discard: true }
				).pipe(Effect.forkChild);
				const responses = yield* Effect.forEach(
					commands,
					(candidate) =>
						Effect.promise(() =>
							fetch(`${descriptor.url}/v1/workspaces/${snapshot.workspaceId}/commands`, {
								method: 'POST',
								headers: {
									authorization: `Bearer ${descriptor.token}`,
									'content-type': 'application/json'
								},
								body: JSON.stringify(candidate)
							})
						),
					{ concurrency: 'unbounded' }
				);
				yield* Fiber.join(worker);

				assert.deepStrictEqual(
					responses.map((response) => response.status),
					commands.map(() => 200)
				);
				const outcomes = yield* Effect.forEach(responses, (response) =>
					Effect.promise(() => response.json()).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(ControlCommandOutcome))
					)
				);
				assert.deepStrictEqual(
					new Set(
						outcomes.map((outcome) =>
							outcome.status === 'succeeded' ? outcome.receipt.commandId : 'failed'
						)
					),
					new Set(commands.map((candidate) => candidate.commandId))
				);
			}).pipe(
				Effect.provide(
					Layer.merge(
						makeControlBrokerLayer({ stateDirectory: directory }),
						Layer.merge(BunFileSystem.layer, BunPath.layer)
					)
				)
			);
		})
	);
});
