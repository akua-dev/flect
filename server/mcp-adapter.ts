import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Effect, type Layer, Option, Schema, Stream } from 'effect';
import { makeNativeFlectGatewayLayer } from '../cli/flect';
import { FlectCommand, type FlectCommand as FlectCommandType } from '../shared/control';
import { FlectCommandGateway } from '../src/axi/gateway';

const commandInput = Schema.toStandardJSONSchemaV1(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			command: FlectCommand,
			expectedSequence: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
		})
	)
);

const waitInput = Schema.toStandardJSONSchemaV1(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			timeoutMs: Schema.Int.check(
				Schema.isGreaterThanOrEqualTo(100),
				Schema.isLessThanOrEqualTo(120_000)
			).pipe(Schema.withDecodingDefaultKey(Effect.succeed(30_000)))
		})
	)
);

const logsInput = Schema.toStandardJSONSchemaV1(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
				Schema.withDecodingDefaultKey(Effect.succeed(0))
			),
			limit: Schema.Int.check(
				Schema.isGreaterThanOrEqualTo(1),
				Schema.isLessThanOrEqualTo(500)
			).pipe(Schema.withDecodingDefaultKey(Effect.succeed(100)))
		})
	)
);

const jsonObject = (value: unknown): Record<string, unknown> => {
	const encoded: unknown = JSON.parse(JSON.stringify(value));
	return typeof encoded === 'object' && encoded !== null && !Array.isArray(encoded)
		? Object.fromEntries(Object.entries(encoded))
		: { value: encoded };
};

const result = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
	structuredContent: jsonObject(value)
});

const failure = () => ({
	content: [
		{
			type: 'text' as const,
			text: 'Flect could not complete the local control request.'
		}
	],
	isError: true
});

export interface FlectMcpOptions {
	readonly stateDirectory?: string;
	readonly clientName?: string;
	readonly gatewayLayer?: Layer.Layer<FlectCommandGateway, unknown, never>;
}

export function createFlectMcpServer(options: FlectMcpOptions = {}): McpServer {
	const gatewayLayer =
		options.gatewayLayer ??
		makeNativeFlectGatewayLayer({
			stateDirectory: options.stateDirectory,
			clientName: options.clientName ?? 'Flect MCP'
		});
	const run = <A, E>(effect: Effect.Effect<A, E, FlectCommandGateway>) =>
		Effect.runPromise(effect.pipe(Effect.provide(gatewayLayer)));
	const server = new McpServer(
		{ name: 'flect', version: '0.2.0' },
		{ capabilities: { tools: {} } }
	);

	server.registerTool(
		'flect_inspect',
		{
			title: 'Inspect Flect',
			description: 'Read the complete live, non-secret Flect workspace snapshot.',
			annotations: { readOnlyHint: true, destructiveHint: false }
		},
		async () => {
			try {
				return result(await run(Effect.flatMap(FlectCommandGateway, (gateway) => gateway.inspect)));
			} catch {
				return failure();
			}
		}
	);

	server.registerTool(
		'flect_command',
		{
			title: 'Control Flect',
			description:
				"Run one command from Flect's closed user-equivalent command schema. Control cannot be enabled here.",
			inputSchema: commandInput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false
			}
		},
		async ({
			command,
			expectedSequence
		}: {
			readonly command: FlectCommandType;
			readonly expectedSequence?: number;
		}) => {
			try {
				return result(
					await run(
						Effect.flatMap(FlectCommandGateway, (gateway) =>
							gateway.command(command, expectedSequence)
						)
					)
				);
			} catch {
				return failure();
			}
		}
	);

	server.registerTool(
		'flect_wait',
		{
			title: 'Wait for Flect',
			description: 'Wait until the live workspace sequence advances beyond a known sequence.',
			inputSchema: waitInput,
			annotations: { readOnlyHint: true, destructiveHint: false }
		},
		async ({
			afterSequence,
			timeoutMs
		}: {
			readonly afterSequence: number;
			readonly timeoutMs: number;
		}) => {
			try {
				const waited = await run(
					Effect.gen(function* () {
						const gateway = yield* FlectCommandGateway;
						const event = yield* Effect.race(
							gateway.events(afterSequence).pipe(Stream.runHead, Effect.map(Option.getOrUndefined)),
							Effect.sleep(`${timeoutMs} millis`).pipe(Effect.as(undefined))
						);
						const snapshot = yield* gateway.inspect;
						return {
							version: 1,
							advanced: event !== undefined || snapshot.sequence > afterSequence,
							snapshot
						};
					})
				);
				return result(waited);
			} catch {
				return failure();
			}
		}
	);

	server.registerTool(
		'flect_logs',
		{
			title: 'Read Flect diagnostics',
			description: 'Read bounded, redacted operation evidence from the live Flect workspace.',
			inputSchema: logsInput,
			annotations: { readOnlyHint: true, destructiveHint: false }
		},
		async ({
			afterSequence,
			limit
		}: {
			readonly afterSequence: number;
			readonly limit: number;
		}) => {
			try {
				const logs = await run(Effect.flatMap(FlectCommandGateway, (gateway) => gateway.logs));
				return result({
					version: 1,
					operations: logs.operations
						.filter((operation) => operation.sequence > afterSequence)
						.slice(-limit)
				});
			} catch {
				return failure();
			}
		}
	);

	return server;
}

export const serveFlectMcp = (options: FlectMcpOptions = {}) =>
	serveStdio(() => createFlectMcpServer(options), {
		onerror: () => {
			console.error('Flect MCP transport failed.');
		}
	});

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const stateDirectoryIndex = argv.indexOf('--state-dir');
	const stateDirectory = stateDirectoryIndex < 0 ? undefined : argv[stateDirectoryIndex + 1];
	serveFlectMcp({ stateDirectory });
}
