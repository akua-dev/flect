import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Client, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client';
import { Effect, Fiber, Layer, Queue, Stdio, Stream } from 'effect';
import { forEach as sinkForEach } from 'effect/Sink';
import { ControlUnauthorized, FlectCommandReceipt } from '../shared/control';
import { ControlBrokerStatus, ControlLogsResponse } from '../shared/control-channel';
import { FlectCommandGateway, type FlectCommandGatewayShape } from '../src/axi/gateway';
import { makeFlectMcpServerLayer } from './mcp-adapter';

/**
 * Bridges @modelcontextprotocol/client's Transport interface (used only as a
 * devDependency, for this test) to the newline-delimited JSON-RPC framing
 * effect/unstable/ai's McpServer.layerStdio speaks over its `Stdio` service -
 * there is no Effect-native MCP client counterpart, and no Effect Stdio
 * implementation feeds bytes to/from an in-process test double either, so
 * this is the minimal glue between the two.
 */
class StdioBridgeTransport implements Transport {
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;
	private buffer = '';

	constructor(private readonly write: (bytes: Uint8Array) => void) {}

	async start() {}

	async send(message: JSONRPCMessage) {
		this.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
	}

	async close() {
		this.onclose?.();
	}

	feed(chunk: string | Uint8Array) {
		this.buffer += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
		let newlineIndex = this.buffer.indexOf('\n');
		while (newlineIndex >= 0) {
			const line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.trim().length > 0) {
				this.onmessage?.(JSON.parse(line));
			}
			newlineIndex = this.buffer.indexOf('\n');
		}
	}
}

const active: Array<{
	readonly client: Client;
	readonly fiber: Fiber.Fiber<never, unknown>;
}> = [];

afterEach(async () => {
	for (const connection of active.splice(0)) {
		await connection.client.close();
		await Effect.runPromise(Fiber.interrupt(connection.fiber));
	}
});

const makeConnection = async () => {
	const command = vi.fn<FlectCommandGatewayShape['command']>((value) =>
		value.type === 'enable-control'
			? Effect.fail(
					ControlUnauthorized.make({
						message: 'Outside clients cannot enable control.'
					})
				)
			: Effect.succeed(
					FlectCommandReceipt.make({
						version: 1,
						commandId: 'cmd-mcp-test-1',
						workspaceId: 'workspace-mcp-test',
						operationId: 'operation-mcp-test',
						sequence: 2,
						status: 'completed'
					})
				)
	);
	const gatewayLayer = Layer.succeed(FlectCommandGateway)({
		audience: 'native',
		bin: 'flect',
		status: Effect.succeed(
			ControlBrokerStatus.make({
				version: 1,
				enabled: true,
				connected: true,
				port: 43129,
				instanceId: 'instance-mcp-test',
				workspaceId: 'workspace-mcp-test',
				url: 'http://127.0.0.1:43129'
			})
		),
		inspect: Effect.die('unused'),
		logs: Effect.succeed(ControlLogsResponse.make({ version: 1, operations: [] })),
		events: () => Stream.empty,
		command
	});

	const toServer = Effect.runSync(Queue.make<Uint8Array>());
	const transport = new StdioBridgeTransport((bytes) => {
		Queue.offerUnsafe(toServer, bytes);
	});
	const serverLayer = makeFlectMcpServerLayer({ gatewayLayer }).pipe(
		Layer.provide(
			Stdio.layerTest({
				stdin: Stream.fromQueue(toServer),
				stdout: () =>
					sinkForEach((chunk: string | Uint8Array) => Effect.sync(() => transport.feed(chunk)))
			})
		)
	);
	const fiber = Effect.runFork(Layer.launch(serverLayer));

	const client = new Client(
		{ name: 'flect-stdio-test', version: '1.0.0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	await client.connect(transport);
	active.push({ client, fiber });
	return { client, command };
};

describe('Flect MCP', () => {
	it('exposes four compact tools over the closed command surface', async () => {
		const { client, command } = await makeConnection();
		const tools = await client.listTools();

		expect(tools.tools.map((tool) => tool.name)).toEqual([
			'flect_inspect',
			'flect_command',
			'flect_wait',
			'flect_logs'
		]);
		expect(JSON.stringify(tools)).not.toContain('Bearer');
		expect(JSON.stringify(tools)).not.toContain('token');

		const logsTool = tools.tools.find((tool) => tool.name === 'flect_logs');
		expect(logsTool?.inputSchema.required ?? []).not.toContain('afterSequence');
		expect(logsTool?.inputSchema.required ?? []).not.toContain('limit');

		const response = await client.callTool({
			name: 'flect_command',
			arguments: {
				command: { type: 'set-mode', mode: 'run' }
			}
		});
		expect(response.isError).not.toBe(true);
		expect(response.structuredContent).toMatchObject({
			operationId: 'operation-mcp-test',
			status: 'completed'
		});
		expect(command.mock.calls[0]?.[0]).toMatchObject({
			type: 'set-mode',
			mode: 'run'
		});
	});

	it('returns a safe tool error when authority expansion is rejected', async () => {
		const { client } = await makeConnection();
		const response = await client.callTool({
			name: 'flect_command',
			arguments: {
				command: { type: 'enable-control' }
			}
		});

		expect(response.isError).toBe(true);
		expect(JSON.stringify(response)).not.toContain('Outside clients');
	});

	it('applies flect_logs defaults for afterSequence and limit when omitted', async () => {
		const { client } = await makeConnection();
		const response = await client.callTool({ name: 'flect_logs', arguments: {} });

		expect(response.isError).not.toBe(true);
		expect(response.structuredContent).toMatchObject({ version: 1, operations: [] });
	});

	it('advertises flect_wait timeoutMs as optional, defaulted at decode time', async () => {
		const { client } = await makeConnection();
		const tools = await client.listTools();
		const waitTool = tools.tools.find((tool) => tool.name === 'flect_wait');

		expect(waitTool?.inputSchema.required ?? []).toEqual(['afterSequence']);
	});
});
