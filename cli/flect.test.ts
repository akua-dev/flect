import { assert, describe, it, vi } from '@effect/vitest';
import { Effect, Layer, Stream } from 'effect';
import { ControlUnauthorized } from '../shared/control';
import { ControlBrokerStatus } from '../shared/control-channel';
import { FlectCommandGateway, type FlectCommandGatewayShape } from '../src/axi/gateway';
import { type FlectCliIo, runFlectCli } from './flect';

const makeHarness = (stdin = '') => {
	const stdout: Array<string> = [];
	const stderr: Array<string> = [];
	const launch = vi.fn(async () => undefined);
	const command = vi.fn<FlectCommandGatewayShape['command']>(() =>
		Effect.fail(ControlUnauthorized.make({ message: 'Test command boundary reached.' }))
	);
	const layer = Layer.succeed(FlectCommandGateway)({
		audience: 'native',
		bin: 'flect',
		status: Effect.succeed(
			ControlBrokerStatus.make({
				version: 1,
				enabled: false,
				connected: false,
				port: 43128,
				url: 'http://127.0.0.1:43128'
			})
		),
		inspect: Effect.die('unused'),
		logs: Effect.die('unused'),
		events: () => Stream.empty,
		command
	});
	const io: FlectCliIo = {
		readStdin: async () => stdin,
		stdout: (value) => stdout.push(value),
		stderr: (value) => stderr.push(value),
		launch
	};
	return { command, io, launch, layer, stderr, stdout };
};

describe('flect CLI adapter', () => {
	it.effect('writes one TOON home result and no stderr', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const code = yield* runFlectCli([], harness.io);
			assert.strictEqual(code, 0);
			assert.strictEqual(harness.stdout.length, 1);
			assert.include(harness.stdout[0] ?? '', 'control: disabled');
			assert.deepStrictEqual(harness.stderr, []);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('materializes --stdin before sending a Shaper command', () => {
		const harness = makeHarness('Make the dashboard denser\n');
		return Effect.gen(function* () {
			const code = yield* runFlectCli(['shape', '--stdin'], harness.io);
			assert.strictEqual(code, 1);
			assert.strictEqual(harness.command.mock.calls.length, 1);
			const sent = harness.command.mock.calls[0]?.[0];
			assert.strictEqual(sent?.type, 'submit-shaper-instruction');
			assert.strictEqual(
				sent?.type === 'submit-shaper-instruction' ? sent.instruction : '',
				'Make the dashboard denser'
			);
			assert.include(harness.stdout[0] ?? '', 'code: unauthorized');
			assert.deepStrictEqual(harness.stderr, []);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('opens the graphical app through the native adapter', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const code = yield* runFlectCli(['app'], harness.io);
			assert.strictEqual(code, 0);
			assert.strictEqual(harness.launch.mock.calls.length, 1);
		}).pipe(Effect.provide(harness.layer));
	});

	it.effect('keeps usage errors structured on stdout', () => {
		const harness = makeHarness();
		return Effect.gen(function* () {
			const code = yield* runFlectCli(['--json', 'mode', 'guardian'], harness.io);
			assert.strictEqual(code, 2);
			assert.include(harness.stdout[0] ?? '', '"code":"invalid-argument"');
			assert.deepStrictEqual(harness.stderr, []);
		}).pipe(Effect.provide(harness.layer));
	});
});
