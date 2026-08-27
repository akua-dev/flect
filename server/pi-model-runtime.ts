import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Context, Effect, Layer } from 'effect';
import { PiOperationFailed } from '../shared/contracts';

export class PiModelRuntime extends Context.Service<PiModelRuntime, ModelRuntime>()(
	'flect/server/PiModelRuntime'
) {}

export const PiModelRuntimeLive = Layer.effect(
	PiModelRuntime,
	Effect.tryPromise({
		try: () => ModelRuntime.create(),
		catch: () =>
			PiOperationFailed.make({
				operation: 'initialize',
				message: 'The model runtime could not complete the request.'
			})
	})
);
