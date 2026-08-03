import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import {
  AgentIntegration,
  makeAgentIntegrationLayer,
  OPENCODE_PLUGIN_SOURCE,
} from "./agent-integration";

const PlatformLive = Layer.merge(BunFileSystem.layer, BunPath.layer);

const withFixture = <A, E>(
  use: (
    root: string,
  ) => Effect.Effect<
    A,
    E,
    AgentIntegration | FileSystem.FileSystem | Path.Path
  >,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "flect-agent-integration-",
      });
      return yield* use(root).pipe(
        Effect.provide(makeAgentIntegrationLayer(root)),
      );
    }),
  ).pipe(Effect.provide(PlatformLive));

const readJson = Effect.fn("Flect.Test.readJson")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(path);
  return { source, decoded: JSON.parse(source) as unknown };
});

describe("AgentIntegration", () => {
  it.effect("keeps the shipped OpenCode asset identical to the installer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const asset = yield* path.fromFileUrl(
        new URL(
          "../../assets/agent-integrations/opencode/flect.js",
          import.meta.url,
        ),
      );

      assert.strictEqual(
        yield* fs.readFileString(asset),
        OPENCODE_PLUGIN_SOURCE,
      );
    }).pipe(Effect.provide(PlatformLive)),
  );

  it.effect(
    "merges Codex hooks idempotently and removes only its owned hook",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = `${root}/.codex/hooks.json`;
          yield* fs.makeDirectory(`${root}/.codex`, { recursive: true });
          yield* fs.writeFileString(
            path,
            `${JSON.stringify(
              {
                description: "Robin's hooks",
                hooks: {
                  PreToolUse: [{ matcher: "Bash", hooks: [] }],
                  SessionStart: [
                    {
                      matcher: "startup|resume|clear|compact",
                      hooks: [
                        {
                          type: "command",
                          command: "flect context --host codex",
                          statusMessage: "A user-authored similar hook",
                        },
                      ],
                    },
                  ],
                },
              },
              null,
              2,
            )}\n`,
          );
          const integrations = yield* AgentIntegration;

          const installed = yield* integrations.install("codex");
          const afterInstall = yield* readJson(path);
          const reinstalled = yield* integrations.install("codex");
          const afterReinstall = yield* readJson(path);

          assert.isTrue(installed.changed);
          assert.strictEqual(installed.state, "installed");
          assert.isFalse(reinstalled.changed);
          assert.strictEqual(afterReinstall.source, afterInstall.source);
          assert.include(
            afterInstall.source,
            '"description": "Robin\'s hooks"',
          );
          assert.include(afterInstall.source, '"PreToolUse"');
          assert.include(afterInstall.source, '"additionalContextLimit": 1200');
          assert.include(afterInstall.source, "dev.akua.flect-context");

          const removed = yield* integrations.remove("codex");
          const afterRemove = yield* readJson(path);
          assert.isTrue(removed.changed);
          assert.strictEqual(removed.state, "absent");
          assert.include(afterRemove.source, "A user-authored similar hook");
          assert.notInclude(afterRemove.source, "dev.akua.flect-context");
          assert.include(JSON.stringify(afterRemove.decoded), "PreToolUse");
        }),
      ),
  );

  it.effect(
    "merges Claude local settings without disturbing unrelated values",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = `${root}/.claude/settings.local.json`;
          yield* fs.makeDirectory(`${root}/.claude`, { recursive: true });
          yield* fs.writeFileString(
            path,
            `${JSON.stringify(
              {
                permissions: { allow: ["Bash(bun test:*)"] },
                hooks: {
                  Stop: [
                    {
                      hooks: [{ type: "command", command: "notify-send done" }],
                    },
                  ],
                },
              },
              null,
              2,
            )}\n`,
          );
          const integrations = yield* AgentIntegration;

          yield* integrations.install("claude");
          const installed = yield* readJson(path);
          assert.include(installed.source, '"permissions"');
          assert.include(installed.source, '"Stop"');
          assert.include(
            installed.source,
            '"matcher": "startup|resume|clear|compact"',
          );
          assert.include(installed.source, "flect context --host claude");
          assert.include(installed.source, "dev.akua.flect-context");

          yield* integrations.remove("claude");
          const removed = yield* readJson(path);
          assert.include(removed.source, '"permissions"');
          assert.include(removed.source, '"Stop"');
          assert.notInclude(removed.source, "dev.akua.flect-context");
        }),
      ),
  );

  it.effect(
    "installs a dependency-free OpenCode V2 plugin and preserves conflicts",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const integrations = yield* AgentIntegration;
          const path = `${root}/.opencode/plugins/flect.js`;

          const installed = yield* integrations.install("opencode");
          const source = yield* fs.readFileString(path);
          const info = yield* fs.stat(path);
          const reinstalled = yield* integrations.install("opencode");

          assert.isTrue(installed.changed);
          assert.isFalse(reinstalled.changed);
          assert.strictEqual(source, OPENCODE_PLUGIN_SOURCE);
          assert.include(source, 'id: "dev.akua.flect-context"');
          assert.include(source, 'session.hook("request"');
          assert.include(source, '"session.compacted"');
          assert.include(source, "event.system");
          assert.include(source, '"flect", "context", "--host", "opencode"');
          assert.notInclude(source, "@opencode-ai/plugin");
          assert.strictEqual(info.mode & 0o777, 0o600);

          yield* integrations.remove("opencode");
          assert.isFalse(yield* fs.exists(path));

          yield* fs.writeFileString(
            path,
            "export default { id: 'user.plugin' }\n",
          );
          const conflict = yield* Effect.result(
            integrations.install("opencode"),
          );
          assert.isTrue(Result.isFailure(conflict));
          if (Result.isFailure(conflict)) {
            assert.strictEqual(conflict.failure._tag, "AgentIntegrationError");
            assert.strictEqual(conflict.failure.reason, "conflict");
          }
          assert.strictEqual(
            yield* fs.readFileString(path),
            "export default { id: 'user.plugin' }\n",
          );
        }),
      ),
  );

  it.effect(
    "reports malformed host JSON as a conflict instead of overwriting it",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(`${root}/.codex`, { recursive: true });
          yield* fs.writeFileString(`${root}/.codex/hooks.json`, "{broken\n");
          const integrations = yield* AgentIntegration;

          const status = yield* integrations.status("codex");
          const install = yield* Effect.result(integrations.install("codex"));

          assert.strictEqual(status.state, "conflict");
          assert.isTrue(Result.isFailure(install));
          assert.strictEqual(
            yield* fs.readFileString(`${root}/.codex/hooks.json`),
            "{broken\n",
          );
        }),
      ),
  );
});
