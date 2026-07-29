import { Context, Effect, Layer, Schema } from "effect";
import {
  ExtensionCapability,
  type ExtensionManifest,
} from "../../shared/extensions";
import type {
  CapabilityIntent,
  SandboxResult,
  SetTextIntent,
} from "../../shared/sandbox";

export class CapabilityDenied extends Schema.TaggedErrorClass<CapabilityDenied>()(
  "CapabilityDenied",
  {
    extensionId: Schema.String,
    capability: ExtensionCapability,
    reason: Schema.Literals(["undeclared", "not-granted"]),
    message: Schema.Literal("The extension capability was denied."),
  },
) {}

export interface CapabilityAdapterShape {
  readonly setText: (intent: SetTextIntent) => Effect.Effect<void>;
}

export class CapabilityAdapter extends Context.Service<
  CapabilityAdapter,
  CapabilityAdapterShape
>()("flect/CapabilityAdapter") {}

export interface SandboxCapabilityBrokerShape {
  readonly apply: (
    manifest: ExtensionManifest,
    result: SandboxResult,
    grants: ReadonlyArray<ExtensionCapability>,
  ) => Effect.Effect<void, CapabilityDenied>;
}

export class SandboxCapabilityBroker extends Context.Service<
  SandboxCapabilityBroker,
  SandboxCapabilityBrokerShape
>()("flect/SandboxCapabilityBroker") {}

const capabilityForIntent = (intent: CapabilityIntent): ExtensionCapability => {
  switch (intent.type) {
    case "set-text":
      return "interface:propose";
  }
};

const denied = (
  manifest: ExtensionManifest,
  capability: ExtensionCapability,
  reason: CapabilityDenied["reason"],
) =>
  CapabilityDenied.make({
    extensionId: manifest.id,
    capability,
    reason,
    message: "The extension capability was denied.",
  });

export const SandboxCapabilityBrokerLive = Layer.effect(
  SandboxCapabilityBroker,
  Effect.gen(function* () {
    const adapter = yield* CapabilityAdapter;

    return {
      apply: Effect.fn("Flect.SandboxCapabilityBroker.apply")(function* (
        manifest: ExtensionManifest,
        result: SandboxResult,
        grants: ReadonlyArray<ExtensionCapability>,
      ) {
        const intents = result.intents.map((intent) => ({
          intent,
          capability: capabilityForIntent(intent),
        }));

        for (const { capability } of intents) {
          if (!manifest.capabilities.includes(capability)) {
            return yield* Effect.fail(
              denied(manifest, capability, "undeclared"),
            );
          }
          if (!grants.includes(capability)) {
            return yield* Effect.fail(
              denied(manifest, capability, "not-granted"),
            );
          }
        }

        yield* Effect.forEach(
          intents,
          ({ intent }) => {
            switch (intent.type) {
              case "set-text":
                return adapter.setText(intent);
            }
          },
          { discard: true },
        );
      }),
    };
  }),
);
