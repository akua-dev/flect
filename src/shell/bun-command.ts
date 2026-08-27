import { Context, Effect, Layer } from 'effect';
import {
	BUN_COMMANDS,
	BunCommandFailed,
	type BunCommandRequest,
	BunCommandResult
} from '../../shared/bun-command';

export type BunOperation = (typeof BUN_COMMANDS)[number];

export interface BunOperationCall {
	readonly operation: BunOperation;
	readonly args: ReadonlyArray<string>;
	readonly cwd: string;
}

interface BunOperationsShape {
	readonly execute: (call: BunOperationCall) => Effect.Effect<BunCommandResult, BunCommandFailed>;
}

export interface BunCommandShape {
	readonly execute: (
		request: BunCommandRequest
	) => Effect.Effect<BunCommandResult, BunCommandFailed>;
}

export class BunCommand extends Context.Service<BunCommand, BunCommandShape>()(
	'flect/BunCommand'
) {}

const result = (exitCode: number, stdout: string, stderr: string): BunCommandResult =>
	BunCommandResult.make({
		version: 1,
		exitCode,
		stdout,
		stderr
	});

const help = result(
	0,
	[
		'Flect browser Bun compatibility command',
		'implementation: flect-browser',
		'transpiler: compatible',
		`commands: ${BUN_COMMANDS.join(', ')}`,
		''
	].join('\n'),
	''
);

const unsupported = (name: string) =>
	result(
		1,
		'',
		`bun: unsupported command or entry '${name}'. Supported commands: ${BUN_COMMANDS.join(', ')}.\n`
	);

const isEntryPath = (value: string) =>
	/^(?:\.{0,2}\/|\/workspace\/)/.test(value) || /\.(?:[cm]?[jt]sx?)$/.test(value);

const isBunOperation = (value: string): value is BunOperation =>
	BUN_COMMANDS.some((operation) => operation === value);

const route = (
	request: BunCommandRequest
): { readonly result: BunCommandResult } | { readonly call: BunOperationCall } => {
	const [command, ...args] = request.argv;

	if (command === '--help' || command === '-h') {
		return { result: help };
	}
	if (command === '--version' || command === '-v') {
		return { result: result(0, 'flect-browser/1\n', '') };
	}

	if (command === 'i') {
		return {
			call: { operation: 'install', args, cwd: request.cwd }
		};
	}
	if (command === 'rm') {
		return {
			call: { operation: 'remove', args, cwd: request.cwd }
		};
	}
	if (isBunOperation(command)) {
		return {
			call: {
				operation: command,
				args,
				cwd: request.cwd
			}
		};
	}
	if (!command.startsWith('-') && isEntryPath(command)) {
		return {
			call: {
				operation: 'run',
				args: [command, ...args],
				cwd: request.cwd
			}
		};
	}
	return { result: unsupported(command) };
};

const unexpectedFailure = () =>
	BunCommandFailed.make({
		reason: 'execution',
		message: 'The Bun-compatible command failed safely.'
	});

export const makeBunCommandService = (operations: BunOperationsShape): BunCommandShape => ({
	execute: Effect.fn('Flect.BunCommand.execute')((request) => {
		const routed = route(request);
		if ('result' in routed) {
			return Effect.succeed(routed.result);
		}
		return operations
			.execute(routed.call)
			.pipe(Effect.catchDefect(() => Effect.fail(unexpectedFailure())));
	})
});

export const makeBunCommandTestLayer = (execute: BunOperationsShape['execute']) =>
	Layer.succeed(BunCommand)(makeBunCommandService({ execute }));
