import {
  Context,
  Effect,
  Layer,
  Ref,
  Schema,
  type SchemaAST,
  type Scope,
} from "effect";
import {
  type QuickJsExtensionRequest,
  SandboxExecutionFailed,
  type SandboxResult,
  SandboxWorkerRequest,
  SandboxWorkerResponse,
} from "../../shared/sandbox";

const OUTER_DEADLINE = "2 seconds";

const sandboxFailure = (reason: SandboxExecutionFailed["reason"]) =>
  SandboxExecutionFailed.make({
    reason,
    message: "Extension execution failed safely.",
  });

type SandboxWorker = Pick<
  Worker,
  "addEventListener" | "removeEventListener" | "postMessage"
>;

interface SandboxWorkerHandle {
  readonly run: (
    request: QuickJsExtensionRequest,
  ) => Effect.Effect<SandboxResult, SandboxExecutionFailed>;
}

interface SandboxWorkerFactoryShape {
  readonly acquire: Effect.Effect<
    SandboxWorkerHandle,
    SandboxExecutionFailed,
    Scope.Scope
  >;
}

class SandboxWorkerFactory extends Context.Service<
  SandboxWorkerFactory,
  SandboxWorkerFactoryShape
>()("flect/SandboxWorkerFactory") {}

export interface ExtensionSandboxShape {
  readonly execute: (
    request: QuickJsExtensionRequest,
  ) => Effect.Effect<SandboxResult, SandboxExecutionFailed>;
}

export class ExtensionSandbox extends Context.Service<
  ExtensionSandbox,
  ExtensionSandboxShape
>()("flect/ExtensionSandbox") {}

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const decodeResponse = Schema.decodeUnknownEffect(
  SandboxWorkerResponse,
  strictOptions,
);

export const makeSandboxWorkerHandle = (
  worker: SandboxWorker,
): SandboxWorkerHandle => ({
  run: Effect.fn("Flect.SandboxWorker.run")((request) =>
    Effect.callback<SandboxResult, SandboxExecutionFailed>((resume) => {
      const id = `request-${crypto.randomUUID().replaceAll("-", "")}`;
      let completed = false;
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const settle = (
        effect: Effect.Effect<SandboxResult, SandboxExecutionFailed>,
      ) => {
        if (completed) {
          return;
        }
        completed = true;
        cleanup();
        resume(effect);
      };
      const onError = () => {
        settle(Effect.fail(sandboxFailure("worker")));
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        Effect.runPromise(decodeResponse(event.data))
          .then((response) => {
            if (response.id !== id) {
              return;
            }
            settle(
              response.type === "success"
                ? Effect.succeed(response.result)
                : Effect.fail(response.error),
            );
          })
          .catch(() => {
            settle(Effect.fail(sandboxFailure("worker")));
          });
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      try {
        worker.postMessage(
          SandboxWorkerRequest.make({
            id,
            request,
          }),
        );
      } catch {
        settle(Effect.fail(sandboxFailure("invalid-input")));
      }

      return Effect.sync(cleanup);
    }),
  ),
});

export const SandboxWorkerFactoryLive = Layer.succeed(SandboxWorkerFactory)({
  acquire: Effect.acquireRelease(
    Effect.try({
      try: () =>
        new Worker(new URL("./extension-worker.ts", import.meta.url), {
          type: "module",
          name: "flect-extension-sandbox",
        }),
      catch: () => sandboxFailure("worker"),
    }),
    (worker) =>
      Effect.sync(() => {
        worker.terminate();
      }),
  ).pipe(Effect.map(makeSandboxWorkerHandle)),
});

export const ExtensionSandboxLive = Layer.effect(
  ExtensionSandbox,
  Effect.gen(function* () {
    const factory = yield* SandboxWorkerFactory;
    return {
      execute: Effect.fn("Flect.ExtensionSandbox.execute")((request) =>
        Effect.scoped(
          factory.acquire.pipe(
            Effect.flatMap((worker) => worker.run(request)),
            Effect.timeoutOrElse({
              duration: OUTER_DEADLINE,
              orElse: () => Effect.fail(sandboxFailure("deadline")),
            }),
          ),
        ),
      ),
    };
  }),
).pipe(Layer.provide(SandboxWorkerFactoryLive));

export const makeExtensionSandboxTestLayer = (options: {
  readonly run: (
    request: QuickJsExtensionRequest,
  ) => Effect.Effect<SandboxResult, SandboxExecutionFailed>;
}) => {
  const releases = Ref.makeUnsafe(0);
  const factoryLayer = Layer.succeed(SandboxWorkerFactory)({
    acquire: Effect.acquireRelease(
      Effect.succeed({
        run: options.run,
      }),
      () => Ref.update(releases, (count) => count + 1),
    ),
  });
  return {
    releases,
    layer: Layer.effect(
      ExtensionSandbox,
      Effect.gen(function* () {
        const factory = yield* SandboxWorkerFactory;
        return {
          execute: Effect.fn("Flect.ExtensionSandbox.execute")((request) =>
            Effect.scoped(
              factory.acquire.pipe(
                Effect.flatMap((worker) => worker.run(request)),
                Effect.timeoutOrElse({
                  duration: OUTER_DEADLINE,
                  orElse: () => Effect.fail(sandboxFailure("deadline")),
                }),
              ),
            ),
          ),
        };
      }),
    ).pipe(Layer.provide(factoryLayer)),
  };
};
