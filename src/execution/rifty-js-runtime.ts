import { type EvalResult, type RuntimeController, spawnRuntime } from '@riftydev/runtime-js';
import { Context, Effect, Layer, Ref, Schema, type Scope } from 'effect';
import {
	BrowserExecutionFailed,
	type JavaScriptExecutionRequest,
	JavaScriptExecutionResult
} from '../../shared/browser-execution';
import riftyWorkerUrl from './rifty-js-worker.ts?worker&url';

const OUTER_DEADLINE = '2 seconds';
const OUTPUT_LIMIT = 1_048_576;

type Evaluation =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly message: string };

interface RuntimeOutput {
	readonly stdout: string;
	readonly stderr: string;
}

interface RiftyJavaScriptRuntimeHandle {
	readonly evaluate: (
		source: string,
		cwd?: string
	) => Effect.Effect<Evaluation, BrowserExecutionFailed>;
	readonly writeFile: (
		path: string,
		source: string | Uint8Array
	) => Effect.Effect<void, BrowserExecutionFailed>;
	readonly output: Effect.Effect<RuntimeOutput, BrowserExecutionFailed>;
}

interface RiftyJavaScriptRuntimeFactoryShape {
	readonly acquire: Effect.Effect<
		RiftyJavaScriptRuntimeHandle,
		BrowserExecutionFailed,
		Scope.Scope
	>;
}

class RiftyJavaScriptRuntimeFactory extends Context.Service<
	RiftyJavaScriptRuntimeFactory,
	RiftyJavaScriptRuntimeFactoryShape
>()('flect/RiftyJavaScriptRuntimeFactory') {}

export interface RiftyJavaScriptExecutionShape {
	readonly evaluate: (
		request: JavaScriptExecutionRequest
	) => Effect.Effect<JavaScriptExecutionResult, BrowserExecutionFailed>;
	readonly runModule: (
		request: RiftyModuleExecutionRequest
	) => Effect.Effect<JavaScriptExecutionResult, BrowserExecutionFailed>;
}

export class RiftyJavaScriptExecution extends Context.Service<
	RiftyJavaScriptExecution,
	RiftyJavaScriptExecutionShape
>()('flect/RiftyJavaScriptExecution') {}

export interface RiftyModuleExecutionRequest {
	readonly files: Readonly<Record<string, string | Uint8Array>>;
	readonly entry: string;
	readonly cwd: string;
	readonly args: ReadonlyArray<string>;
	readonly previewProbe?: string;
}

const executionFailure = (reason: BrowserExecutionFailed['reason'], message: string) =>
	BrowserExecutionFailed.make({
		reason,
		operation: 'javascript',
		message
	});

const mapEvaluation = (result: EvalResult): Evaluation =>
	result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };

const waitUntilReady = (runtime: RuntimeController) =>
	runtime.isReady()
		? Effect.void
		: Effect.callback<undefined, BrowserExecutionFailed>((resume) => {
				const unsubscribe = runtime.on((event) => {
					if (event.type === 'ready') {
						unsubscribe();
						resume(Effect.succeed(undefined));
					} else if (event.type === 'exit') {
						unsubscribe();
						resume(
							Effect.fail(
								executionFailure('startup', 'The browser JavaScript runtime could not start.')
							)
						);
					}
				});
				return Effect.sync(unsubscribe);
			});

const makeRuntimeHandle = (
	runtime: RuntimeController,
	chunks: {
		readonly stdout: Array<string>;
		readonly stderr: Array<string>;
		overflow: boolean;
	}
): RiftyJavaScriptRuntimeHandle => ({
	evaluate: (source, cwd) =>
		Effect.tryPromise({
			try: () => runtime.eval(source, cwd === undefined ? undefined : { cwd }),
			catch: () => executionFailure('worker', 'Browser JavaScript execution failed safely.')
		}).pipe(Effect.map(mapEvaluation)),
	writeFile: (path, source) =>
		Effect.tryPromise({
			try: () => runtime.fs.writeFile(path, source),
			catch: () =>
				executionFailure('worker', 'The browser JavaScript workspace could not be prepared.')
		}),
	output: Effect.suspend(() =>
		chunks.overflow
			? Effect.fail(
					executionFailure('invalid-result', 'Browser JavaScript output exceeded its limit.')
				)
			: Effect.succeed({
					stdout: chunks.stdout.join(''),
					stderr: chunks.stderr.join('')
				})
	)
});

const acquireLiveRuntime = Effect.acquireRelease(
	Effect.try({
		try: () => {
			const runtime = spawnRuntime({ workerUrl: riftyWorkerUrl });
			const chunks = {
				stdout: [] as Array<string>,
				stderr: [] as Array<string>,
				overflow: false
			};
			let outputLength = 0;
			const unsubscribe = runtime.on((event) => {
				if (event.type !== 'stdout' && event.type !== 'stderr') {
					return;
				}
				outputLength += event.chunk.length;
				if (outputLength > OUTPUT_LIMIT) {
					chunks.overflow = true;
					return;
				}
				chunks[event.type].push(event.chunk);
			});
			return { runtime, chunks, unsubscribe };
		},
		catch: () => executionFailure('startup', 'The browser JavaScript runtime could not start.')
	}),
	({ runtime, unsubscribe }) =>
		Effect.sync(() => {
			unsubscribe();
			runtime.dispose();
		})
);

export const RiftyJavaScriptRuntimeFactoryLive = Layer.succeed(RiftyJavaScriptRuntimeFactory)({
	acquire: acquireLiveRuntime.pipe(
		Effect.tap(({ runtime }) => waitUntilReady(runtime)),
		Effect.map(({ runtime, chunks }) => makeRuntimeHandle(runtime, chunks))
	)
});

const makeRiftyJavaScriptExecutionLayer = Layer.effect(
	RiftyJavaScriptExecution,
	Effect.gen(function* () {
		const factory = yield* RiftyJavaScriptRuntimeFactory;
		const execute = (
			source: string,
			options?: {
				readonly cwd?: string;
				readonly prepare?: (
					runtime: RiftyJavaScriptRuntimeHandle
				) => Effect.Effect<void, BrowserExecutionFailed>;
			}
		) =>
			Effect.scoped(
				factory.acquire.pipe(
					Effect.flatMap((runtime) =>
						(options?.prepare?.(runtime) ?? Effect.void).pipe(
							Effect.andThen(runtime.evaluate(source, options?.cwd)),
							Effect.flatMap((result) =>
								result.ok
									? runtime.output.pipe(
											Effect.flatMap((output) =>
												Schema.decodeUnknownEffect(JavaScriptExecutionResult)({
													version: 1,
													value: result.value,
													...output
												}).pipe(
													Effect.mapError(() =>
														executionFailure(
															'invalid-result',
															'Browser JavaScript execution returned an invalid result.'
														)
													)
												)
											)
										)
									: Effect.fail(
											executionFailure('execution', 'Browser JavaScript execution failed safely.')
										)
							)
						)
					),
					Effect.timeoutOrElse({
						duration: OUTER_DEADLINE,
						orElse: () =>
							Effect.fail(
								executionFailure('deadline', 'Browser JavaScript execution exceeded its deadline.')
							)
					})
				)
			);
		return {
			evaluate: Effect.fn('RiftyJavaScript.evaluate')((request) => execute(request.source)),
			runModule: Effect.fn('RiftyJavaScript.runModule')((request) =>
				execute(
					[
						`globalThis.Bun = Object.freeze({ argv: ${JSON.stringify(['bun', request.entry, ...request.args])}, env: Object.freeze({}), version: "flect-browser/1"${request.previewProbe === undefined ? '' : ', serve() { globalThis.__flectPreviewRequested = true; return Object.freeze({ stop() {} }); }'} });`,
						...(request.previewProbe === undefined
							? []
							: ['globalThis.__flectPreviewRequested = false;']),
						`globalThis.__flectEntry = ${JSON.stringify(request.entry)};`,
						'await globalThis.__riftyImport(globalThis.__flectEntry);',
						...(request.previewProbe === undefined
							? []
							: [
									`if (globalThis.__flectPreviewRequested === true) console.log(${JSON.stringify(request.previewProbe)});`
								])
					].join('\n'),
					{
						cwd: request.cwd,
						prepare: (runtime) =>
							Effect.forEach(
								Object.entries(request.files).sort(([left], [right]) => left.localeCompare(right)),
								([path, source]) => runtime.writeFile(path, source),
								{ discard: true }
							)
					}
				)
			)
		};
	})
);

export const RiftyJavaScriptLive = makeRiftyJavaScriptExecutionLayer.pipe(
	Layer.provide(RiftyJavaScriptRuntimeFactoryLive)
);

export const makeRiftyJavaScriptTestLayer = (options: {
	readonly evaluate: (
		source: string,
		cwd?: string
	) => Effect.Effect<Evaluation, BrowserExecutionFailed>;
	readonly writeFile?: (
		path: string,
		source: string | Uint8Array
	) => Effect.Effect<void, BrowserExecutionFailed>;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: ReadonlyArray<string>;
}) => {
	const releases = Ref.makeUnsafe(0);
	const factoryLayer = Layer.succeed(RiftyJavaScriptRuntimeFactory)({
		acquire: Effect.acquireRelease(
			Effect.succeed<RiftyJavaScriptRuntimeHandle>({
				evaluate: options.evaluate,
				writeFile: options.writeFile ?? (() => Effect.void),
				output: Effect.succeed({
					stdout: options.stdout.join(''),
					stderr: options.stderr.join('')
				})
			}),
			() => Ref.update(releases, (count) => count + 1)
		)
	});
	return {
		releases,
		layer: makeRiftyJavaScriptExecutionLayer.pipe(Layer.provide(factoryLayer))
	};
};
