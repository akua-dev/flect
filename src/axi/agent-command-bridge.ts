import { Context, Deferred, Effect, Layer } from 'effect';
import { FlectCommandEnvelope } from '../../shared/control';
import { ControlLogsResponse } from '../../shared/control-channel';
import { AgentWorkspace } from '../lib/agent-workspace';
import { FlectWorkspaceController } from '../lib/workspace-controller';
import { AgentCommandBus, type AgentCommandRequest, AgentGatewayResult } from './agent-command-bus';

export interface AgentCommandBridgeShape {
	readonly ready: Effect.Effect<void>;
}

export class AgentCommandBridge extends Context.Service<
	AgentCommandBridge,
	AgentCommandBridgeShape
>()('flect/AgentCommandBridge') {}

export const AgentCommandBridgeLive = Layer.effect(
	AgentCommandBridge,
	Effect.gen(function* () {
		const bus = yield* AgentCommandBus;
		const controller = yield* FlectWorkspaceController;
		const agent = yield* AgentWorkspace;

		const complete = Effect.fn('Flect.AgentCommandBridge.complete')(
			(request: AgentCommandRequest, result: AgentGatewayResult) =>
				Deferred.succeed(request.response, result).pipe(Effect.asVoid)
		);

		const runRequest = Effect.fn('Flect.AgentCommandBridge.runRequest')(function* (
			request: AgentCommandRequest
		) {
			switch (request.operation.type) {
				case 'inspect':
					yield* complete(
						request,
						AgentGatewayResult.make({
							type: 'inspect',
							value: yield* controller.snapshot
						})
					);
					return;
				case 'logs': {
					const snapshot = yield* controller.snapshot;
					yield* complete(
						request,
						AgentGatewayResult.make({
							type: 'logs',
							value: ControlLogsResponse.make({
								version: 1,
								operations: snapshot.operations
							})
						})
					);
					return;
				}
				case 'propose-interface':
					yield* agent.proposeShaperInterface(request.source, request.operation.document).pipe(
						Effect.matchEffect({
							onFailure: (error) => Deferred.fail(request.response, error).pipe(Effect.asVoid),
							onSuccess: (proposal) =>
								complete(
									request,
									AgentGatewayResult.make({
										type: 'propose-interface',
										value: {
											status: proposal.status,
											name: proposal.document.name
										}
									})
								)
						})
					);
					return;
				case 'propose-app':
					yield* agent
						.proposeShaperApp(request.source, request.operation.archive, request.operation.name)
						.pipe(
							Effect.matchEffect({
								onFailure: (error) => Deferred.fail(request.response, error).pipe(Effect.asVoid),
								onSuccess: (proposal) =>
									complete(
										request,
										AgentGatewayResult.make({
											type: 'propose-app',
											value: {
												status: proposal.status,
												name: proposal.name
											}
										})
									)
							})
						);
					return;
				case 'command': {
					const snapshot = yield* controller.snapshot;
					const envelope = FlectCommandEnvelope.make({
						version: 1,
						commandId: `cmd-${crypto.randomUUID()}`,
						workspaceId: snapshot.workspaceId,
						source: request.source,
						command: request.operation.command
					});
					yield* controller.dispatch(envelope).pipe(
						Effect.matchEffect({
							onFailure: (error) => Deferred.fail(request.response, error).pipe(Effect.asVoid),
							onSuccess: (receipt) =>
								complete(
									request,
									AgentGatewayResult.make({
										type: 'command',
										value: receipt
									})
								)
						})
					);
				}
			}
		});

		const runNext = Effect.fn('Flect.AgentCommandBridge.runNext')(function* () {
			yield* runRequest(yield* bus.take);
		});

		yield* Effect.forever(runNext()).pipe(Effect.forkScoped);
		return { ready: Effect.void };
	})
);
