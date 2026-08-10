import { fileURLToPath } from "node:url";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";

const repository = fileURLToPath(new URL("..", import.meta.url));
const sourceFiles = new Bun.Glob(
  "{cli,packages,scripts,server,src,tests}/**/*.{ts,tsx}",
);
const forbiddenCall = ["Promise", "all"].join(".");

const listSourceFiles = Effect.tryPromise({
  try: async () => {
    const paths: Array<string> = [];
    for await (const path of sourceFiles.scan({ cwd: repository })) {
      paths.push(path);
    }
    return paths.sort();
  },
  catch: () => new Error("Flect source files could not be enumerated."),
});

const verifyEffectConcurrency = Effect.gen(function* () {
  const paths = yield* listSourceFiles;
  const violations = yield* Effect.forEach(
    paths,
    (path) =>
      Effect.tryPromise({
        try: async () => {
          const source = await Bun.file(`${repository}/${path}`).text();
          return source.includes(forbiddenCall) ? path : undefined;
        },
        catch: () => new Error(`Flect source could not be read: ${path}`),
      }),
    { concurrency: 16 },
  );
  const pathsWithNativeFanOut = violations.filter(
    (path): path is string => path !== undefined,
  );
  if (pathsWithNativeFanOut.length > 0) {
    return yield* Effect.fail(
      new Error(
        `Use Effect concurrency combinators in: ${pathsWithNativeFanOut.join(", ")}`,
      ),
    );
  }
});

if (import.meta.main) {
  BunRuntime.runMain(verifyEffectConcurrency);
}
