import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { Effect, Layer, Stream } from 'effect';
import { ControlUnauthorized, FlectCommandReceipt } from '../shared/control';
import { ControlBrokerStatus, ControlLogsResponse } from '../shared/control-channel';
import { FlectCommandGateway, type FlectCommandGatewayShape } from '../src/axi/gateway';
import { createFlectMcpServer } from './mcp-adapter';

const active: Array<{
	readonly client: Client;
	readonly server: ReturnType<typeof createFlectMcpServer>;
}> = [];

afterEach(async () => {
	for (const connection of active.splice(0)) {
		await connection.client.close();
		await connection.server.close();
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
	const server = createFlectMcpServer({ gatewayLayer });
	const client = new Client(
		{ name: 'flect-stdio-test', version: '1.0.0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	active.push({ client, server });
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
});
