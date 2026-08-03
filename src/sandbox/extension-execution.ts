import { Context, Effect, Layer, Schema } from "effect";
import type {
  ExtensionCapability,
  ExtensionManifest,
} from "../../shared/extensions";
import { ExtensionIntentContext } from "../../shared/sandbox";
import type {
  SandboxExecutionFailed,
  SandboxResult,
} from "../../shared/sandbox";
import { ShapingKernel } from "../lib/shaping-kernel";
import {
  type CapabilityAdapterError,
  type CapabilityDenied,
  isExtensionIntentPackageFailure,
  SandboxCapabilityBroker,
} from "./capability-broker";
import { ExtensionSandbox } from "./extension-sandbox";

export class ExtensionDisabled extends Schema.TaggedErrorClass<ExtensionDisabled>()(
  "ExtensionDisabled",
  {
    extensionId: Schema.String,
    message: Schema.Literal("The extension is disabled."),
  },
) {}

export interface ExtensionExecutionShape {
  readonly execute: (
    manifest: ExtensionManifest,
    input: unknown,
    grants: ReadonlyArray<ExtensionCapability>,
  ) => Effect.Effect<
    SandboxResult,
    | SandboxExecutionFailed
    | CapabilityAdapterError
    | CapabilityDenied
    | ExtensionDisabled
  >;
}

export class ExtensionExecution extends Context.Service<
  ExtensionExecution,
  ExtensionExecutionShape
>()("flect/ExtensionExecution") {}

export const ExtensionExecutionLive = Layer.effect(
  ExtensionExecution,
  Effect.gen(function* () {
    const sandbox = yield* ExtensionSandbox;
    const broker = yield* SandboxCapabilityBroker;
    const kernel = yield* ShapingKernel;

    return {
      execute: Effect.fn("Flect.ExtensionExecution.execute")(
        function* (
          manifest: ExtensionManifest,
          input: unknown,
          grants: ReadonlyArray<ExtensionCapability>,
        ) {
          const snapshot = yield* kernel.snapshot;
          if (
            snapshot.safeMode ||
            snapshot.disabledExtensions.includes(manifest.id)
          ) {
            return yield* Effect.fail(
              ExtensionDisabled.make({
                extensionId: manifest.id,
                message: "The extension is disabled.",
              }),
            );
          }

          const result = yield* sandbox.execute({
            extensionId: manifest.id,
            source: manifest.source,
            input,
          });
          yield* broker.apply(
            ExtensionIntentContext.make({
              extensionId: manifest.id,
              role: "app",
              binding: "accepted",
              operationId: `extension-execution-${manifest.id}`,
            }),
            manifest,
            result,
            grants,
          );
          return result;
        },
        (effect, manifest) =>
          effect.pipe(
            Effect.tapError((error) =>
              error._tag === "ExtensionDisabled"
                ? Effect.void
                : error._tag === "CapabilityDenied" ||
                    error._tag === "SandboxExecutionFailed" ||
                    (error._tag === "CapabilityAdapterFailure" ||
                      (error._tag === "ExtensionIntentRejected" &&
                        isExtensionIntentPackageFailure(error)))
                  ? kernel.recordExtensionFailure(manifest.id)
                  : Effect.void,
            ),
          ),
      ),
    };
  }),
);
