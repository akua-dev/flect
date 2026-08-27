import { Effect, ManagedRuntime, Ref, Stream } from 'effect';
import { FlectRuntimeWithPiLive } from '../server/pi-services';
import { FlectRuntime } from '../server/runtime';
import { BunCommandResult } from '../shared/bun-command';
import { SessionSelection } from '../shared/contracts';
import { defaultInterfaceDocument } from '../shared/interface-document';

const runtime = ManagedRuntime.make(FlectRuntimeWithPiLive);

const failSmoke = (message: string) => Effect.die(new Error(message));

const smoke = Effect.gen(function* () {
	const flect = yield* FlectRuntime;
	const status = yield* flect.status;
	const models = yield* flect.listModels;
	if (status.status !== 'ready' || models.length === 0) {
		return yield* failSmoke('Flect Pi smoke test has no authenticated model.');
	}

	const sessionId = yield* flect.createSession(SessionSelection.make({ model: models[0] }));
	const events = yield* flect
		.prompt(sessionId, 'Reply only with the word OK.')
		.pipe(Stream.runCollect);
	const completed = events.some((event) => event.type === 'turn_completed');
	const receivedText = events.some(
		(event) => event.type === 'text_delta' && event.delta.length > 0
	);

	if (!completed || !receivedText) {
		return yield* failSmoke('Flect Pi smoke test did not complete a private turn.');
	}

	const usedProposalCommand = yield* Ref.make(false);
	const shapeCompleted = yield* Ref.make(false);
	yield* flect
		.shape(
			sessionId,
			'Keep this interface unchanged, validate it, and propose it through the reserved Flect command.',
			defaultInterfaceDocument
		)
		.pipe(
			Stream.runForEach((event) => {
				if (event.type === 'shape_completed') {
					return Ref.set(shapeCompleted, true);
				}
				if (event.type !== 'shell_request') {
					return Effect.void;
				}
				return Ref.update(
					usedProposalCommand,
					(current) =>
						current || event.command.includes('flect interface propose /workspace/interface.json')
				).pipe(
					Effect.andThen(
						flect.completeShellRequest(
							sessionId,
							'shaper',
							event.requestId,
							BunCommandResult.make({
								version: 1,
								exitCode: 0,
								stdout: 'status: proposed\n',
								stderr: ''
							})
						)
					)
				);
			})
		);
	if (!(yield* Ref.get(shapeCompleted)) || !(yield* Ref.get(usedProposalCommand))) {
		return yield* failSmoke(
			'Flect Pi smoke test did not complete through the reserved proposal command.'
		);
	}
});

try {
	await runtime.runPromise(smoke);
	console.log('Flect Pi smoke passed with a private Guardian/Shaper pair.');
} finally {
	await runtime.dispose();
}
