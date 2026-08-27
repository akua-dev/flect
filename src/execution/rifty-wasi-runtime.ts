import { Context, Effect, Layer, Ref, Schema, type SchemaAST, type Scope } from 'effect';
import {
	BrowserExecutionFailed,
	type WasiExecutionRequest,
	type WasiExecutionResult,
	WasiWorkerRequest,
	WasiWorkerResponse
} from '../../shared/browser-execution';

const OUTER_DEADLINE = '2 seconds';
const MAX_MODULE_BYTES = 8 * 1024 * 1024;

type WasiWorker = Pick<Worker, 'addEventListener' | 'removeEventListener' | 'postMessage'>;

interface RiftyWasiWorkerHandle {
	readonly run: (
		request: WasiExecutionRequest
	) => Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>;
}

interface RiftyWasiWorkerFactoryShape {
	readonly acquire: Effect.Effect<RiftyWasiWorkerHandle, BrowserExecutionFailed, Scope.Scope>;
}

class RiftyWasiWorkerFactory extends Context.Service<
	RiftyWasiWorkerFactory,
	RiftyWasiWorkerFactoryShape
>()('flect/RiftyWasiWorkerFactory') {}

export interface RiftyWasiExecutionShape {
	readonly run: (
		request: WasiExecutionRequest
	) => Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>;
}

export class RiftyWasiExecution extends Context.Service<
	RiftyWasiExecution,
	RiftyWasiExecutionShape
>()('flect/RiftyWasiExecution') {}

const wasiFailure = (reason: BrowserExecutionFailed['reason'], message: string) =>
	BrowserExecutionFailed.make({
		reason,
		operation: 'wasi',
		message
	});

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

const decodeResponse = Schema.decodeUnknownEffect(WasiWorkerResponse, strictOptions);

export const makeRiftyWasiWorkerHandle = (worker: WasiWorker): RiftyWasiWorkerHandle => ({
	run: Effect.fn('Flect.RiftyWasiWorker.run')((request) =>
		Effect.callback<WasiExecutionResult, BrowserExecutionFailed>((resume) => {
			const id = `request-${crypto.randomUUID().replaceAll('-', '')}`;
			let completed = false;
			const cleanup = () => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
			};
			const settle = (effect: Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>) => {
				if (completed) {
					return;
				}
				completed = true;
				cleanup();
				resume(effect);
			};
			const onError = () => {
				settle(Effect.fail(wasiFailure('worker', 'Browser WASI execution failed safely.')));
			};
			const onMessage = (event: MessageEvent<unknown>) => {
				Effect.runPromise(decodeResponse(event.data))
					.then((response) => {
						if (response.id !== id) {
							return;
						}
						settle(
							response.type === 'success'
								? Effect.succeed(response.result)
								: Effect.fail(response.error)
						);
					})
					.catch(() => {
						settle(
							Effect.fail(
								wasiFailure('invalid-result', 'Browser WASI execution returned an invalid result.')
							)
						);
					});
			};

			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);
			try {
				worker.postMessage(
					WasiWorkerRequest.make({
						type: 'run',
						id,
						request
					})
				);
			} catch {
				settle(Effect.fail(wasiFailure('worker', 'Browser WASI execution failed safely.')));
			}

			return Effect.sync(cleanup);
		})
	)
});

const RiftyWasiWorkerFactoryLive = Layer.succeed(RiftyWasiWorkerFactory)({
	acquire: Effect.acquireRelease(
		Effect.try({
			try: () =>
				new Worker(new URL('./rifty-wasi-worker.ts', import.meta.url), {
					type: 'module',
					name: 'flect-rifty-wasi'
				}),
			catch: () => wasiFailure('worker', 'The browser WASI Worker could not start.')
		}),
		(worker) =>
			Effect.sync(() => {
				worker.terminate();
			})
	).pipe(Effect.map(makeRiftyWasiWorkerHandle))
});

const makeRiftyWasiExecutionLayer = Layer.effect(
	RiftyWasiExecution,
	Effect.gen(function* () {
		const factory = yield* RiftyWasiWorkerFactory;
		return {
			run: Effect.fn('Flect.RiftyWasi.run')((request) => {
				if (request.module.byteLength === 0 || request.module.byteLength > MAX_MODULE_BYTES) {
					return Effect.fail(
						wasiFailure('invalid-input', 'The browser WASI module size is invalid.')
					);
				}

				return Effect.scoped(
					factory.acquire.pipe(
						Effect.flatMap((worker) => worker.run(request)),
						Effect.timeoutOrElse({
							duration: OUTER_DEADLINE,
							orElse: () =>
								Effect.fail(
									wasiFailure('deadline', 'Browser WASI execution exceeded its deadline.')
								)
						})
					)
				);
			})
		};
	})
);

export const RiftyWasiLive = makeRiftyWasiExecutionLayer.pipe(
	Layer.provide(RiftyWasiWorkerFactoryLive)
);

export const makeRiftyWasiTestLayer = <E>(options: {
	readonly run: (request: WasiExecutionRequest) => Effect.Effect<WasiExecutionResult, E>;
}) => {
	const releases = Ref.makeUnsafe(0);
	const factoryLayer = Layer.succeed(RiftyWasiWorkerFactory)({
		acquire: Effect.acquireRelease(
			Effect.succeed<RiftyWasiWorkerHandle>({
				run: (request) =>
					options
						.run(request)
						.pipe(
							Effect.mapError(() =>
								wasiFailure('invalid-result', 'Browser WASI execution returned an invalid result.')
							)
						)
			}),
			() => Ref.update(releases, (count) => count + 1)
		)
	});
	return {
		releases,
		layer: makeRiftyWasiExecutionLayer.pipe(Layer.provide(factoryLayer))
	};
};
