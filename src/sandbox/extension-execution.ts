import { Context, Effect, Layer, Schema } from "effect";
import type {
  ExtensionCapability,
  ExtensionManifest,
} from "../../shared/extensions";
import type {
  SandboxExecutionFailed,
  SandboxResult,
} from "../../shared/sandbox";
import type { InterfaceStorageError } from "../lib/interface-store";
import { ShapingKernel } from "../lib/shaping-kernel";
import {
  type CapabilityDenied,
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
    | CapabilityDenied
    | ExtensionDisabled
    | InterfaceStorageError
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
          if (snapshot.disabledExtensions.includes(manifest.id)) {
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
          yield* broker.apply(manifest, result, grants);
          yield* kernel.recordExtensionSuccess(manifest.id);
          return result;
        },
        (effect, manifest) =>
          effect.pipe(
            Effect.tapError((error) =>
              error._tag === "ExtensionDisabled"
                ? Effect.void
                : kernel.recordExtensionFailure(manifest.id),
            ),
          ),
      ),
    };
  }),
);
