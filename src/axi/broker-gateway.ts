import { Effect, Layer, Stream } from 'effect';
import { FlectControlClient, type FlectControlClientError } from '../../cli/flect-client';
import type { ControlDescriptorError } from '../../server/control-descriptor';
import type { FlectCommandError } from '../../shared/control';
import type { AxiAudience } from './contracts';
import { FlectCommandGateway, FlectGatewayError } from './gateway';

export interface BrokerFlectCommandGatewayOptions {
	readonly audience?: AxiAudience;
	readonly bin?: string;
}

const transportError = (error: FlectControlClientError | ControlDescriptorError) =>
	FlectGatewayError.make({
		reason: error._tag === 'FlectControlClientError' ? error.reason : 'unavailable',
		message:
			error._tag === 'FlectControlClientError'
				? error.message
				: 'Flect local control is unavailable.'
	});

const commandError = (
	error: FlectCommandError | FlectControlClientError | ControlDescriptorError
) =>
	error._tag === 'FlectControlClientError' || error._tag === 'ControlDescriptorError'
		? transportError(error)
		: error;

export const makeBrokerFlectCommandGatewayLayer = (
	options: BrokerFlectCommandGatewayOptions = {}
) =>
	Layer.effect(
		FlectCommandGateway,
		Effect.gen(function* () {
			const client = yield* FlectControlClient;
			return {
				audience: options.audience ?? 'native',
				bin: options.bin ?? 'flect',
				status: client.status.pipe(Effect.mapError(transportError)),
				inspect: client.inspect.pipe(Effect.mapError(transportError)),
				logs: client.logs.pipe(Effect.mapError(transportError)),
				events: (after: number) => client.events(after).pipe(Stream.mapError(transportError)),
				command: (command, expectedSequence) =>
					client.command(command, expectedSequence).pipe(Effect.mapError(commandError))
			};
		})
	);
