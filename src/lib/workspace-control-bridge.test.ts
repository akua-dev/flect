import { assert, describe, it, vi } from '@effect/vitest';
import { Deferred, Effect, Layer, Queue, Stream, SubscriptionRef } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import {
	CancelRole,
	ControlCommandSource,
	ControlStateSnapshot,
	DisableControl,
	FlectCommandEnvelope,
	FlectCommandReceipt,
	FlectWorkspaceEvent,
	FlectWorkspaceSnapshot,
	RailStateSnapshot,
	SetMode,
	SubmitAppPrompt,
	UserCommandSource
} from '../../shared/control';
import { ControlBrokerStatus } from '../../shared/control-channel';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot
} from '../../shared/revisions';
import { WorkspaceControlBridge, WorkspaceControlBridgeLive } from './workspace-control-bridge';
import {
	WorkspaceControlTransport,
	type WorkspaceControlTransportShape
} from './workspace-control-transport';
import {
	FlectWorkspaceController,
	type FlectWorkspaceControllerShape
} from './workspace-controller';

const builtIn = InterfaceRevision.make({
	version: 1,
	id: RevisionId.make('built-in'),
	status: 'accepted',
	source: 'built-in',
	document: defaultInterfaceDocument,
	createdAt: 0
});

const initial = FlectWorkspaceSnapshot.make({
	version: 1,
	workspaceId: 'workspace-control-bridge',
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
	control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
	operations: []
});

const outsideCommand = FlectCommandEnvelope.make({
	version: 1,
	commandId: 'cmd-control-bridge-1',
	workspaceId: initial.workspaceId,
	source: ControlCommandSource.make({
		kind: 'control',
		clientId: 'client-control-bridge',
		clientName: 'Outside test agent'
	}),
	command: SetMode.make({ type: 'set-mode', mode: 'run' })
});

const outsideDisableCommand = FlectCommandEnvelope.make({
	version: 1,
	commandId: 'cmd-control-bridge-disable',
	workspaceId: initial.workspaceId,
	source: ControlCommandSource.make({
		kind: 'control',
		clientId: 'client-control-bridge',
		clientName: 'Outside test agent'
	}),
	command: DisableControl.make({ type: 'disable-control' })
});

const outsidePromptCommand = FlectCommandEnvelope.make({
	version: 1,
	commandId: 'cmd-control-bridge-prompt',
	workspaceId: initial.workspaceId,
	source: outsideCommand.source,
	command: SubmitAppPrompt.make({
		type: 'submit-app-prompt',
		text: 'Keep working'
	})
});

const outsideCancelCommand = FlectCommandEnvelope.make({
	version: 1,
	commandId: 'cmd-control-bridge-cancel',
	workspaceId: initial.workspaceId,
	source: outsideCommand.source,
	command: CancelRole.make({ type: 'cancel-role', role: 'app' })
});

const makeHarness = () => {
	let setControl = (_enabled: boolean) => Effect.void;
	let offer = (_command: FlectCommandEnvelope) => Effect.void;
	let awaitPromptStarted = Effect.void;
	let releasePrompt = Effect.void;
	const enable = vi.fn<WorkspaceControlTransportShape['enable']>();
	const status = Effect.succeed(
		ControlBrokerStatus.make({
			version: 1,
			enabled: true,
			connected: true,
			port: 43126,
			instanceId: 'instance-control-bridge',
			workspaceId: initial.workspaceId,
			url: 'http://127.0.0.1:43126'
		})
	);
	const disable = vi.fn<() => void>();
	const publishSnapshot = vi.fn<WorkspaceControlTransportShape['publishSnapshot']>();
	const complete = vi.fn<WorkspaceControlTransportShape['complete']>();
	const dispatch = vi.fn<FlectWorkspaceControllerShape['dispatch']>();
	const order: Array<'complete' | 'disable'> = [];

	const controllerLayer = Layer.effect(
		FlectWorkspaceController,
		Effect.gen(function* () {
			const state = yield* SubscriptionRef.make(initial);
			const promptStarted = yield* Deferred.make<undefined>();
			const promptGate = yield* Deferred.make<undefined>();
			awaitPromptStarted = Deferred.await(promptStarted);
			releasePrompt = Deferred.succeed(promptGate, undefined).pipe(Effect.asVoid);
			setControl = (enabled) =>
				SubscriptionRef.update(state, (current) =>
					FlectWorkspaceSnapshot.make({
						...current,
						sequence: current.sequence + 1,
						control: ControlStateSnapshot.make({
							enabled,
							...(enabled ? { instanceId: 'instance-control-bridge' } : {}),
							clients: []
						})
					})
				);
			dispatch.mockImplementation((envelope) => {
				const apply = SubscriptionRef.modify(state, (current) => {
					const sequence = current.sequence + 1;
					return [
						FlectCommandReceipt.make({
							version: 1,
							commandId: envelope.commandId,
							workspaceId: envelope.workspaceId,
							operationId: 'operation-control-bridge',
							sequence,
							status: 'completed'
						}),
						FlectWorkspaceSnapshot.make({
							...current,
							sequence,
							mode: envelope.command.type === 'set-mode' ? envelope.command.mode : current.mode,
							control:
								envelope.command.type === 'disable-control'
									? ControlStateSnapshot.make({
											enabled: false,
											clients: []
										})
									: current.control
						})
					];
				});
				return envelope.command.type === 'submit-app-prompt'
					? Deferred.succeed(promptStarted, undefined).pipe(
							Effect.andThen(Deferred.await(promptGate)),
							Effect.andThen(apply)
						)
					: apply;
			});
			return {
				snapshot: SubscriptionRef.get(state),
				changes: SubscriptionRef.changes(state),
				events: SubscriptionRef.changes(state).pipe(
					Stream.map((snapshot) =>
						FlectWorkspaceEvent.make({
							version: 1,
							id: `event-control-bridge-${snapshot.sequence}`,
							sequence: snapshot.sequence,
							timestamp: snapshot.sequence,
							workspaceId: snapshot.workspaceId,
							source: UserCommandSource.make({ kind: 'user' }),
							type: 'state-changed'
						})
					)
				),
				providerAuth: Effect.succeed({ providers: [] }),
				providerAuthChanges: Stream.empty,
				continuity: Effect.succeed({
					drafts: { acceptedUse: '', candidateUse: '', shape: '' },
					generation: 0,
					revisionSequence: 0
				}),
				continuityChanges: Stream.empty,
				setDraft: () => Effect.void,
				exportContinuity: Effect.succeed('{}'),
				exportRepository: Effect.succeed(new Uint8Array([1])),
				readShareExport: () => Effect.succeed(new Uint8Array([1])),
				discardContinuity: Effect.void,
				retryContinuity: Effect.void,
				dispatch,
				connectClient: () => Effect.void,
				disconnectClient: () => Effect.void,
				selectReasoning: () => Effect.void,
				loginProvider: () => Effect.void,
				replyProviderAuth: () => Effect.void,
				cancelProviderAuth: () => Effect.void,
				refreshProviderAuth: Effect.void,
				logoutProvider: () => Effect.void
			} satisfies FlectWorkspaceControllerShape;
		})
	);

	const transportLayer = Layer.effect(
		WorkspaceControlTransport,
		Effect.gen(function* () {
			const commands = yield* Queue.unbounded<FlectCommandEnvelope>();
			offer = (command) => Queue.offer(commands, command).pipe(Effect.asVoid);
			enable.mockImplementation(() =>
				Effect.succeed(
					ControlBrokerStatus.make({
						version: 1,
						enabled: true,
						connected: true,
						port: 43126,
						instanceId: 'instance-control-bridge',
						workspaceId: initial.workspaceId,
						url: 'http://127.0.0.1:43126'
					})
				)
			);
			publishSnapshot.mockImplementation(() => Effect.void);
			complete.mockImplementation(() =>
				Effect.sync(() => {
					order.push('complete');
				})
			);
			return {
				enable,
				status,
				disable: Effect.sync(() => {
					order.push('disable');
					disable();
				}),
				publishSnapshot,
				publishEvent: () => Effect.void,
				nextCommand: () => Queue.take(commands),
				complete
			} satisfies WorkspaceControlTransportShape;
		})
	);

	return {
		layer: WorkspaceControlBridgeLive.pipe(
			Layer.provideMerge(Layer.merge(controllerLayer, transportLayer))
		),
		enable,
		disable,
		publishSnapshot,
		complete,
		dispatch,
		order,
		setControl: (enabled: boolean) => setControl(enabled),
		offer: (command: FlectCommandEnvelope) => offer(command),
		awaitPromptStarted: () => awaitPromptStarted,
		releasePrompt: () => releasePrompt
	};
};

describe('WorkspaceControlBridge', () => {
	it.effect('renders external commands through the same reactive controller', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const bridge = yield* WorkspaceControlBridge;
			const controller = yield* FlectWorkspaceController;
			yield* bridge.ready;

			yield* harness.setControl(true);
			yield* TestClock.adjust('200 millis');
			assert.strictEqual(harness.enable.mock.calls.length, 1);

			yield* harness.offer(outsideCommand);
			yield* TestClock.adjust('200 millis');
			const snapshot = yield* controller.snapshot;

			assert.strictEqual(harness.dispatch.mock.calls.length, 1);
			assert.strictEqual(snapshot.mode, 'run');
			assert.strictEqual(harness.complete.mock.calls.length, 1);
			assert.strictEqual(harness.complete.mock.calls[0]?.[0].outcome.status, 'succeeded');
			assert.isTrue(harness.publishSnapshot.mock.calls.length > 0);

			yield* harness.setControl(false);
			yield* TestClock.adjust('200 millis');
			assert.strictEqual(harness.disable.mock.calls.length, 1);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('acknowledges an outside disable before revoking its grant', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const bridge = yield* WorkspaceControlBridge;
			yield* bridge.ready;

			yield* harness.setControl(true);
			yield* TestClock.adjust('200 millis');
			yield* harness.offer(outsideDisableCommand);
			yield* TestClock.adjust('200 millis');

			assert.deepStrictEqual(harness.order, ['complete', 'disable']);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('delivers cancellation while another outside command is still active', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const bridge = yield* WorkspaceControlBridge;
			yield* bridge.ready;

			yield* harness.setControl(true);
			yield* TestClock.adjust('200 millis');
			yield* harness.offer(outsidePromptCommand);
			yield* TestClock.adjust('200 millis');
			yield* harness.awaitPromptStarted();

			yield* harness.offer(outsideCancelCommand);
			yield* TestClock.adjust('200 millis');
			assert.deepStrictEqual(
				harness.dispatch.mock.calls.map(([command]) => command.command.type),
				['submit-app-prompt', 'cancel-role']
			);
			assert.strictEqual(harness.complete.mock.calls.length, 1);

			yield* harness.releasePrompt();
			yield* TestClock.adjust('200 millis');
			assert.strictEqual(harness.complete.mock.calls.length, 2);
		}).pipe(Effect.provide(harness.layer));
	});
});
