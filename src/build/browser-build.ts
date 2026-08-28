import {
	Context,
	type Duration,
	Effect,
	Layer,
	Ref,
	Schema,
	type SchemaAST,
	Semaphore
} from 'effect';
import {
	type BrowserBuildArtifact,
	BrowserBuildFailure,
	type BrowserBuildRequest,
	BrowserBuildWorkerRequest,
	BrowserBuildWorkerResponse
} from '../../shared/browser-build';
import { BrowserBuildStore, BrowserBuildStoreLive } from './browser-build-store';

export interface BrowserBuildWorker {
	readonly addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
	readonly removeEventListener: (
		type: string,
		listener: EventListenerOrEventListenerObject
	) => void;
	readonly postMessage: (message: unknown) => void;
	readonly terminate: () => void;
}

export interface BrowserBuildShape {
	readonly compile: (
		request: BrowserBuildRequest
	) => Effect.Effect<BrowserBuildArtifact, BrowserBuildFailure>;
	readonly lastSuccessful: Effect.Effect<BrowserBuildArtifact | undefined>;
}

export class BrowserBuild extends Context.Service<BrowserBuild, BrowserBuildShape>()(
	'flect/BrowserBuild'
) {}

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};
const decodeResponse = Schema.decodeUnknownEffect(BrowserBuildWorkerResponse, strictOptions);

const failure = (buildId: string, reason: BrowserBuildFailure['reason'], message: string) =>
	BrowserBuildFailure.make({ buildId, reason, message });

const requestWorker = (
	worker: BrowserBuildWorker,
	request: BrowserBuildRequest
): Effect.Effect<BrowserBuildArtifact, BrowserBuildFailure> =>
	Effect.callback<BrowserBuildArtifact, BrowserBuildFailure>((resume) => {
		const id = `request-${crypto.randomUUID().replaceAll('-', '')}`;
		let completed = false;
		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
		};
		const settle = (result: Effect.Effect<BrowserBuildArtifact, BrowserBuildFailure>) => {
			if (completed) {
				return;
			}
			completed = true;
			cleanup();
			resume(result);
		};
		const onError: EventListener = () => {
			settle(
				Effect.fail(
					failure(request.buildId, 'worker', 'The restricted browser build Worker failed safely.')
				)
			);
		};
		const onMessage: EventListener = (event) => {
			const data = event instanceof MessageEvent ? event.data : undefined;
			void Effect.runPromise(decodeResponse(data))
				.then((response) => {
					if (response.id !== id) {
						return;
					}
					settle(
						response.type === 'success'
							? Effect.succeed(response.artifact)
							: Effect.fail(BrowserBuildFailure.make(response.error))
					);
				})
				.catch(() => {
					settle(
						Effect.fail(
							failure(
								request.buildId,
								'invalid-result',
								'The restricted browser build Worker returned an invalid result.'
							)
						)
					);
				});
		};

		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		try {
			worker.postMessage(BrowserBuildWorkerRequest.make({ version: 1, id, request }));
		} catch {
			settle(
				Effect.fail(
					failure(
						request.buildId,
						'worker',
						'The restricted browser build request could not be sent.'
					)
				)
			);
		}
		return Effect.sync(cleanup);
	});

export const makeBrowserBuildLayer = (options?: {
	readonly makeWorker?: () => BrowserBuildWorker;
	readonly deadline?: Duration.Input;
	readonly crossOriginIsolated?: () => boolean;
}) =>
	Layer.effect(
		BrowserBuild,
		Effect.gen(function* () {
			const store = yield* BrowserBuildStore;
			const restored = yield* store.load.pipe(
				Effect.mapError(() =>
					failure(
						'build-storage-load',
						'storage',
						'The last successful browser build could not be restored safely.'
					)
				)
			);
			const lastSuccessful = yield* Ref.make<BrowserBuildArtifact | undefined>(restored);
			const semaphore = yield* Semaphore.make(1);
			const makeWorker =
				options?.makeWorker ??
				(() =>
					new Worker(new URL('./browser-build-worker.ts', import.meta.url), {
						type: 'module',
						name: 'flect-browser-build'
					}) as BrowserBuildWorker);
			const isCrossOriginIsolated =
				options?.crossOriginIsolated ?? (() => globalThis.crossOriginIsolated === true);

			const compile = Effect.fn('BrowserBuild.compile')((request: BrowserBuildRequest) =>
				!isCrossOriginIsolated()
					? Effect.fail(
							failure(
								request.buildId,
								'unsupported',
								'Restricted browser builds require cross-origin isolation.'
							)
						)
					: semaphore.withPermits(1)(
							Effect.acquireUseRelease(
								Effect.try({
									try: makeWorker,
									catch: () =>
										failure(
											request.buildId,
											'worker',
											'The restricted browser build Worker could not start.'
										)
								}),
								(worker) =>
									requestWorker(worker, request).pipe(
										Effect.timeoutOrElse({
											duration: options?.deadline ?? '30 seconds',
											orElse: () =>
												Effect.fail(
													failure(
														request.buildId,
														'deadline',
														'The restricted browser build exceeded its deadline.'
													)
												)
										}),
										Effect.tap((artifact) =>
											store
												.save(artifact)
												.pipe(
													Effect.mapError(() =>
														failure(
															request.buildId,
															'storage',
															'The successful browser build could not be persisted safely.'
														)
													)
												)
										),
										Effect.tap((artifact) => Ref.set(lastSuccessful, artifact))
									),
								(worker) => Effect.sync(() => worker.terminate())
							)
						)
			);

			return {
				compile,
				lastSuccessful: Ref.get(lastSuccessful)
			} satisfies BrowserBuildShape;
		})
	);

export const BrowserBuildLive = makeBrowserBuildLayer().pipe(
	Layer.provideMerge(BrowserBuildStoreLive)
);
