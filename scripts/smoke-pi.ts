import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { FlectRuntimeLive, PiSdkLive } from "../server/pi-runtime";
import { FlectRuntime } from "../server/runtime";
import { SessionSelection } from "../shared/contracts";

const runtime = ManagedRuntime.make(
  FlectRuntimeLive.pipe(Layer.provide(PiSdkLive)),
);

const failSmoke = (message: string) => Effect.die(new Error(message));

const smoke = Effect.gen(function* () {
  const flect = yield* FlectRuntime;
  const status = yield* flect.status;
  const models = yield* flect.listModels;
  if (status.status !== "ready" || models.length === 0) {
    return yield* failSmoke("Flect Pi smoke test has no authenticated model.");
  }

  const sessionId = yield* flect.createSession(
    SessionSelection.make({ model: models[0] }),
  );
  const events = yield* flect
    .prompt(sessionId, "Reply only with the word OK.")
    .pipe(Stream.runCollect);
  const completed = events.some((event) => event.type === "turn_completed");
  const receivedText = events.some(
    (event) => event.type === "text_delta" && event.delta.length > 0,
  );

  if (!completed || !receivedText) {
    return yield* failSmoke(
      "Flect Pi smoke test did not complete a private turn.",
    );
  }
});

try {
  await runtime.runPromise(smoke);
  console.log("Flect Pi smoke passed with a private Guardian/Shaper pair.");
} finally {
  await runtime.dispose();
}
