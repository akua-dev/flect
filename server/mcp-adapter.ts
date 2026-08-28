import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunStdio from '@effect/platform-bun/BunStdio';
import { Effect, Layer, Option, Schema, Stream } from 'effect';
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai';
import { makeNativeFlectGatewayLayer } from '../cli/flect';
import { FlectCommand, FlectCommandReceipt, FlectWorkspaceSnapshot } from '../shared/control';
import { ControlLogsResponse } from '../shared/control-channel';
import { FlectCommandGateway } from '../src/axi/gateway';

const FAILURE_MESSAGE = 'Flect could not complete the local control request.';

/**
 * The single failure every Flect MCP tool reports through. Every gateway
 * error (unauthorized, unavailable, a rejected command, ...) is collapsed
 * into this one fixed, non-secret message before it reaches the failure
 * channel - the same "always generic, never contextual" contract the
 * previous zod/try-catch implementation enforced by construction.
 */
export class FlectMcpToolError extends Schema.TaggedErrorClass<FlectMcpToolError>()(
	'FlectMcpToolError',
	{ message: Schema.String }
) {}

const toFailure = () => new FlectMcpToolError({ message: FAILURE_MESSAGE });

const WaitResult = Schema.Struct({
	version: Schema.Literal(1),
	advanced: Schema.Boolean,
	snapshot: FlectWorkspaceSnapshot
});

const InspectTool = Tool.make('flect_inspect', {
	description: 'Read the complete live, non-secret Flect workspace snapshot.',
	success: FlectWorkspaceSnapshot,
	failure: FlectMcpToolError,
	dependencies: [FlectCommandGateway]
})
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false);

const CommandTool = Tool.make('flect_command', {
	description:
		"Run one command from Flect's closed user-equivalent command schema. Control cannot be enabled here.",
	parameters: Schema.Struct({
		command: FlectCommand,
		expectedSequence: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	success: FlectCommandReceipt,
	failure: FlectMcpToolError,
	dependencies: [FlectCommandGateway]
})
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, false);

const WaitTool = Tool.make('flect_wait', {
	description: 'Wait until the live workspace sequence advances beyond a known sequence.',
	parameters: Schema.Struct({
		afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		timeoutMs: Schema.Int.check(
			Schema.isGreaterThanOrEqualTo(100),
			Schema.isLessThanOrEqualTo(120_000)
		).pipe(Schema.withDecodingDefaultKey(Effect.succeed(30_000)))
	}),
	success: WaitResult,
	failure: FlectMcpToolError,
	dependencies: [FlectCommandGateway]
})
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false);

const LogsTool = Tool.make('flect_logs', {
	description: 'Read bounded, redacted operation evidence from the live Flect workspace.',
	parameters: Schema.Struct({
		afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed(0))
		),
		limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed(100))
		)
	}),
	success: ControlLogsResponse,
	failure: FlectMcpToolError,
	dependencies: [FlectCommandGateway]
})
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false);

const FlectToolkit = Toolkit.make(InspectTool, CommandTool, WaitTool, LogsTool);

export interface FlectMcpOptions {
	readonly stateDirectory?: string;
	readonly clientName?: string;
	readonly gatewayLayer?: Layer.Layer<FlectCommandGateway, unknown, never>;
}

const makeHandlersLayer = (options: FlectMcpOptions) => {
	const gatewayLayer =
		options.gatewayLayer ??
		makeNativeFlectGatewayLayer({
			stateDirectory: options.stateDirectory,
			clientName: options.clientName ?? 'Flect MCP'
		});
	return FlectToolkit.toLayer({
		flect_inspect: () =>
			Effect.flatMap(FlectCommandGateway, (gateway) => gateway.inspect).pipe(
				Effect.mapError(toFailure)
			),
		flect_command: ({ command, expectedSequence }) =>
			Effect.flatMap(FlectCommandGateway, (gateway) =>
				gateway.command(command, expectedSequence)
			).pipe(Effect.mapError(toFailure)),
		flect_wait: Effect.fn('FlectMcp.wait')(
			function* ({ afterSequence, timeoutMs }) {
				const gateway = yield* FlectCommandGateway;
				const event = yield* Effect.race(
					gateway.events(afterSequence).pipe(Stream.runHead, Effect.map(Option.getOrUndefined)),
					Effect.sleep(`${timeoutMs} millis`).pipe(Effect.as(undefined))
				);
				const snapshot = yield* gateway.inspect;
				return {
					version: 1 as const,
					advanced: event !== undefined || snapshot.sequence > afterSequence,
					snapshot
				};
			},
			(effect) => effect.pipe(Effect.mapError(toFailure))
		),
		flect_logs: ({ afterSequence, limit }) =>
			Effect.flatMap(FlectCommandGateway, (gateway) => gateway.logs).pipe(
				Effect.map((logs) =>
					ControlLogsResponse.make({
						version: 1,
						operations: logs.operations
							.filter((operation) => operation.sequence > afterSequence)
							.slice(-limit)
					})
				),
				Effect.mapError(toFailure)
			)
	}).pipe(Layer.provide(gatewayLayer));
};

/**
 * Builds the Flect MCP server as an Effect `Layer`. Requires a `Stdio`
 * implementation from its environment - `BunStdio.layer`/`NodeStdio.layer`
 * for a real process, or `Stdio.layerTest` for an in-memory round trip.
 */
export const makeFlectMcpServerLayer = (options: FlectMcpOptions = {}) =>
	McpServer.toolkit(FlectToolkit).pipe(
		Layer.provide(makeHandlersLayer(options)),
		Layer.provide(McpServer.layerStdio({ name: 'flect', version: '0.2.0' }))
	);

/**
 * Runs the Flect MCP server over the real process's stdio until its scope is
 * interrupted. This effect never completes on its own.
 */
export const serveFlectMcp = (options: FlectMcpOptions = {}) =>
	Layer.launch(makeFlectMcpServerLayer(options)).pipe(Effect.provide(BunStdio.layer));

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const stateDirectoryIndex = argv.indexOf('--state-dir');
	const stateDirectory = stateDirectoryIndex < 0 ? undefined : argv[stateDirectoryIndex + 1];
	BunRuntime.runMain(serveFlectMcp({ stateDirectory }));
}
