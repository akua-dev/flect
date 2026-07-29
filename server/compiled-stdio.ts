import { BunStdio } from "@effect/platform-bun";
import { Effect, Layer, Stdio, Stream } from "effect";

export const BunCompiledStdioLive = Layer.effect(
  Stdio.Stdio,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const stdin = Stream.fromAsyncIterable(
      Bun.stdin.stream(),
      (cause) => cause,
    ).pipe(Stream.orDie);

    return Stdio.make({
      args: stdio.args,
      stdout: stdio.stdout,
      stderr: stdio.stderr,
      stdin,
    });
  }),
).pipe(Layer.provide(BunStdio.layer));
