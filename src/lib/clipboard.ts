import { Context, Effect, Layer, Schema } from "effect";

export class ClipboardWriteError extends Schema.TaggedErrorClass<ClipboardWriteError>()(
  "ClipboardWriteError",
  {
    message: Schema.Literal("Flect could not copy this content."),
  },
) {}

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly writeText: (
      value: string,
    ) => Effect.Effect<void, ClipboardWriteError>;
  }
>()("Flect/Clipboard") {}

const unavailable = () =>
  ClipboardWriteError.make({
    message: "Flect could not copy this content.",
  });

export const ClipboardLive = Layer.succeed(Clipboard)({
  writeText: Effect.fn("Flect.Clipboard.writeText")((value: string) =>
    Effect.tryPromise({
      try: () => {
        if (globalThis.navigator?.clipboard?.writeText === undefined) {
          return Promise.reject(new Error("Clipboard API unavailable"));
        }
        return globalThis.navigator.clipboard.writeText(value);
      },
      catch: unavailable,
    }),
  ),
});
