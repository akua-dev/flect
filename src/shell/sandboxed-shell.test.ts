import { assert, describe, it, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { BunCommandResult } from "../../shared/bun-command";
import { type BunOperationCall, makeBunCommandTestLayer } from "./bun-command";
import {
  makeRoleSandboxedShellLayer,
  makeRoleSandboxedShellService,
  makeSandboxedShellLayer,
  SandboxedShell,
} from "./sandboxed-shell";

const operationResult = (operation: string) =>
  BunCommandResult.make({
    version: 1,
    exitCode: 0,
    stdout: `${operation}\n`,
    stderr: "",
  });

describe("SandboxedShell", () => {
  it.effect("keeps App and Shaper filesystems isolated in one service", () =>
    Effect.gen(function* () {
      const commandLayer = makeBunCommandTestLayer(() =>
        Effect.succeed(operationResult("unused")),
      );
      const shellLayer = makeRoleSandboxedShellLayer({
        app: {
          files: { "/workspace/role.txt": "app\n" },
        },
        shaper: {
          files: { "/workspace/role.txt": "shaper\n" },
        },
      }).pipe(Layer.provide(commandLayer));

      const results = yield* Effect.gen(function* () {
        const shell = yield* SandboxedShell;
        const app = yield* shell.execute(
          "app",
          "cat role.txt; echo app > marker",
        );
        const shaper = yield* shell.execute(
          "shaper",
          "cat role.txt; test ! -e marker",
        );
        return { app, shaper };
      }).pipe(Effect.provide(shellLayer));

      assert.strictEqual(results.app.stdout, "app\n");
      assert.strictEqual(results.shaper.stdout, "shaper\n");
      assert.strictEqual(results.shaper.exitCode, 0);
    }),
  );

  it.effect("stops only the selected role workspace", () =>
    Effect.gen(function* () {
      const appStop = vi.fn(() => undefined);
      const shaperStop = vi.fn(() => undefined);
      const shell = makeRoleSandboxedShellService({
        app: {
          execute: () => Effect.succeed(operationResult("app")),
          stop: Effect.sync(appStop),
        },
        shaper: {
          execute: () => Effect.succeed(operationResult("shaper")),
          stop: Effect.sync(shaperStop),
        },
      });

      yield* shell.stop("app");

      assert.strictEqual(appStop.mock.calls.length, 1);
      assert.strictEqual(shaperStop.mock.calls.length, 0);
    }),
  );

  it.effect("runs Bun commands through the actual just-bash parser", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Array<BunOperationCall>>([]);
      const commandLayer = makeBunCommandTestLayer((call) =>
        Ref.update(calls, (current) => [...current, call]).pipe(
          Effect.as(operationResult(call.operation)),
        ),
      );
      const shellLayer = makeSandboxedShellLayer({
        role: "shaper",
        files: {
          "/workspace/src/index.ts": "console.log(42);\n",
        },
      }).pipe(Layer.provide(commandLayer));

      const results = yield* Effect.gen(function* () {
        const shell = yield* SandboxedShell;
        return [
          yield* shell.execute("shaper", "bun run src/index.ts"),
          yield* shell.execute("shaper", "bun install && bun run src/index.ts"),
          yield* shell.execute(
            "shaper",
            "bun add flect-fixture@1.0.0 | tee install.log",
          ),
          yield* shell.execute("shaper", "bun stop"),
        ] as const;
      }).pipe(Effect.provide(shellLayer));

      assert.strictEqual(results[0].stdout, "run\n");
      assert.strictEqual(results[1].stdout, "install\nrun\n");
      assert.strictEqual(results[2].stdout, "add\n");
      assert.strictEqual(results[3].stdout, "stop\n");
      assert.deepStrictEqual(
        (yield* Ref.get(calls)).map(({ operation }) => operation),
        ["run", "install", "run", "add", "stop"],
      );
    }),
  );

  it.effect("preserves preview metadata returned by the reserved command", () =>
    Effect.gen(function* () {
      const commandLayer = makeBunCommandTestLayer(() =>
        Effect.succeed(
          BunCommandResult.make({
            version: 1,
            exitCode: 0,
            stdout: "Preview ready.\n",
            stderr: "",
            previewUrl: "/preview/3417/",
          }),
        ),
      );
      const shellLayer = makeSandboxedShellLayer({
        role: "shaper",
        files: {},
      }).pipe(Layer.provide(commandLayer));

      const output = yield* Effect.gen(function* () {
        const shell = yield* SandboxedShell;
        return yield* shell.execute("shaper", "bun run src/server.ts");
      }).pipe(Effect.provide(shellLayer));

      assert.strictEqual(output.previewUrl, "/preview/3417/");
    }),
  );

  it.effect(
    "does not let guest shell features shadow the reserved command",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const commandLayer = makeBunCommandTestLayer(() =>
          Ref.update(calls, (count) => count + 1).pipe(
            Effect.as(operationResult("reserved")),
          ),
        );
        const shellLayer = makeSandboxedShellLayer({
          role: "app",
          files: {},
        }).pipe(Layer.provide(commandLayer));

        const outputs = yield* Effect.gen(function* () {
          const shell = yield* SandboxedShell;
          return yield* Effect.forEach(
            [
              "alias bun='echo alias'; bun run src/index.ts",
              "bun() { echo function; }; bun run src/index.ts",
              "mkdir -p bin; echo '#!/bin/sh' > bin/bun; chmod +x bin/bun; PATH=/workspace/bin:$PATH bun run src/index.ts",
            ],
            (line) => shell.execute("app", line),
          );
        }).pipe(Effect.provide(shellLayer));

        assert.deepStrictEqual(
          outputs.map(({ stdout }) => stdout),
          ["reserved\n", "reserved\n", "reserved\n"],
        );
        assert.strictEqual(yield* Ref.get(calls), 3);
      }),
  );

  it.effect(
    "propagates shell cancellation into the active Effect command",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const commandLayer = makeBunCommandTestLayer(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        );
        const shellLayer = makeSandboxedShellLayer({
          role: "shaper",
          files: {},
        }).pipe(Layer.provide(commandLayer));

        const fiber = yield* Effect.gen(function* () {
          const shell = yield* SandboxedShell;
          return yield* shell.execute("shaper", "bun run src/index.ts");
        }).pipe(Effect.provide(shellLayer), Effect.forkChild);

        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(interrupted);
      }),
  );

  it.effect("keeps role filesystems and environments isolated", () =>
    Effect.gen(function* () {
      const commandLayer = makeBunCommandTestLayer(() =>
        Effect.succeed(operationResult("unused")),
      );
      const run = (
        role: "app" | "shaper",
        script: string,
        files: Readonly<Record<string, string>>,
      ) =>
        Effect.gen(function* () {
          const shell = yield* SandboxedShell;
          return yield* shell.execute(role, script);
        }).pipe(
          Effect.provide(
            makeSandboxedShellLayer({ role, files }).pipe(
              Layer.provide(commandLayer),
            ),
          ),
        );

      const app = yield* run(
        "app",
        "printf '%s:' \"$FLECT_ROLE\"; cat role.txt; echo app > only-app.txt",
        { "/workspace/role.txt": "app\n" },
      );
      const shaper = yield* run(
        "shaper",
        "printf '%s:' \"$FLECT_ROLE\"; cat role.txt; test ! -e only-app.txt",
        { "/workspace/role.txt": "shaper\n" },
      );

      assert.strictEqual(app.stdout, "app:app\n");
      assert.strictEqual(shaper.stdout, "shaper:shaper\n");
      assert.strictEqual(shaper.exitCode, 0);
    }),
  );
});
