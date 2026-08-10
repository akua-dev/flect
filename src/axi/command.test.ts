import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseAxiArguments } from "./command";

const parse = (argv: ReadonlyArray<string>) =>
  parseAxiArguments(argv, "native");

describe("AXI command parser", () => {
  it.effect(
    "parses noun-first state commands with explicit desired state",
    () =>
      Effect.gen(function* () {
        const mode = (yield* parse(["mode", "set", "run"])).command;
        const target = (yield* parse(["target", "shape"])).command;
        const action = (yield* parse(["action", "invoke", "run-report"]))
          .command;
        const extensions = (yield* parse(["extensions", "enable", "shaper"]))
          .command;
        const portableList = (yield* parse(["extensions", "list"])).command;
        const portableDescribe = (yield* parse([
          "extensions",
          "describe",
          "weather-card",
        ])).command;
        const portableCall = (yield* parse([
          "extensions",
          "call",
          "weather-card",
          "--input",
          '{"city":"Berlin"}',
        ])).command;
        const cancel = (yield* parse(["cancel", "shaper"])).command;
        const favorite = (yield* parse([
          "model",
          "favorite",
          "remove",
          "openai/gpt-5.6",
        ])).command;
        const product = (yield* parse([
          "product",
          "invoke",
          "projects.list",
          "--input",
          '{"limit":2}',
        ])).command;
        const permissions = (yield* parse(["permissions", "list"])).command;
        const revoke = (yield* parse([
          "permissions",
          "revoke",
          "decision-capability-0001",
        ])).command;

        assert.strictEqual(mode.kind, "command");
        assert.strictEqual(
          mode.kind === "command" ? mode.command.type : "",
          "set-mode",
        );
        assert.strictEqual(target.kind, "command");
        assert.deepInclude(
          target.kind === "command" ? target.command : undefined,
          { type: "select-workbench-target", target: "shape" },
        );
        assert.strictEqual(action.kind, "action-invoke");
        assert.strictEqual(
          action.kind === "action-invoke" ? action.nodeId : "",
          "run-report",
        );
        assert.strictEqual(extensions.kind, "command");
        if (
          extensions.kind !== "command" ||
          extensions.command.type !== "set-external-extensions"
        ) {
          return assert.fail("Expected an extensions command");
        }
        assert.strictEqual(extensions.command.role, "shaper");
        assert.isTrue(extensions.command.enabled);
        assert.deepInclude(portableList, { kind: "portable-extension-list" });
        assert.deepInclude(portableDescribe, {
          kind: "portable-extension-describe",
          extensionId: "weather-card",
        });
        assert.deepInclude(portableCall, {
          kind: "portable-extension-call",
          extensionId: "weather-card",
          input: { city: "Berlin" },
        });
        assert.strictEqual(cancel.kind, "command");
        if (
          cancel.kind !== "command" ||
          cancel.command.type !== "cancel-role"
        ) {
          return assert.fail("Expected a cancel command");
        }
        assert.strictEqual(cancel.command.role, "shaper");
        assert.strictEqual(favorite.kind, "command");
        if (
          favorite.kind !== "command" ||
          favorite.command.type !== "set-model-favorite"
        ) {
          return assert.fail("Expected a favorite command");
        }
        assert.isFalse(favorite.command.favorite);
        assert.strictEqual(favorite.command.model.provider, "openai");
        assert.strictEqual(favorite.command.model.id, "gpt-5.6");
        assert.strictEqual(product.kind, "product-invoke");
        if (product.kind !== "product-invoke") {
          return assert.fail("Expected a product operation command");
        }
        assert.strictEqual(product.operationId, "projects.list");
        assert.deepStrictEqual(product.input, { limit: 2 });
        assert.strictEqual(permissions.kind, "permissions-list");
        assert.deepInclude(revoke, {
          kind: "permissions-revoke",
          decisionId: "decision-capability-0001",
        });
      }),
  );

  it.effect("parses global flags only before the command", () =>
    Effect.gen(function* () {
      const parsed = yield* parse(["--json", "--full", "inspect"]);
      assert.strictEqual(parsed.format, "json");
      assert.isTrue(parsed.full);
      assert.strictEqual(parsed.command.kind, "inspect");
      const error = yield* parse(["inspect", "--json"]).pipe(Effect.flip);
      assert.strictEqual(error.code, "unknown-flag");
    }),
  );

  it.effect("parses bounded share discovery and source commands", () =>
    Effect.gen(function* () {
      assert.deepInclude((yield* parse(["share", "list"])).command, {
        kind: "share-list",
      });
      assert.deepInclude(
        (yield* parse(["share", "inspect", "dev.flect.weather"])).command,
        { kind: "share-inspect", shareId: "dev.flect.weather" },
      );
      const opened = (yield* parse([
        "share",
        "open-url",
        "https://example.test/weather.flect-share",
      ])).command;
      assert.strictEqual(opened.kind, "command");
      if (opened.kind === "command") {
        assert.strictEqual(opened.command.type, "open-share-source");
      }
      const git = (yield* parse([
        "share",
        "open-git",
        "https://example.test/weather.git",
        "a".repeat(40),
      ])).command;
      assert.strictEqual(git.kind, "command");
      if (git.kind === "command" && git.command.type === "open-share-source") {
        assert.strictEqual(git.command.source._tag, "git");
      }
      const rejected = (yield* parse(["share", "reject"])).command;
      assert.strictEqual(rejected.kind, "command");
      const exported = (yield* parse(["share", "export", "dev.flect.weather"]))
        .command;
      assert.strictEqual(exported.kind, "command");
    }),
  );

  it.effect(
    "rejects unsafe share URLs, commits, identifiers, and extra flags",
    () =>
      Effect.gen(function* () {
        const cases = [
          ["share", "open-url", "http://example.test/share"],
          ["share", "open-url", "https://token@example.test/share"],
          ["share", "open-git", "https://example.test/repo.git", "main"],
          ["share", "inspect", "../private"],
          ["share", "list", "--all"],
        ];
        for (const argv of cases) {
          const error = yield* parse(argv).pipe(Effect.flip);
          assert.include(["invalid-argument", "unknown-flag"], error.code);
        }
      }),
  );

  it.effect("fails closed on unknown flags before any gateway can run", () =>
    Effect.gen(function* () {
      const error = yield* parse(["action", "list", "--stat"]).pipe(
        Effect.flip,
      );
      assert.strictEqual(error.code, "unknown-flag");
      assert.include(error.message, "--stat");
    }),
  );

  it.effect("rejects invented cancellation roles", () =>
    Effect.gen(function* () {
      const error = yield* parse(["cancel", "guardian"]).pipe(Effect.flip);
      assert.strictEqual(error.code, "invalid-argument");
      assert.include(error.message, "app|shaper");
    }),
  );

  it.effect("rejects invented workbench targets", () =>
    Effect.gen(function* () {
      const error = yield* parse(["target", "preview"]).pipe(Effect.flip);
      assert.strictEqual(error.code, "invalid-argument");
      assert.include(error.message, "use|shape");
    }),
  );

  it.effect(
    "offers permission inspection and revocation but no grant command",
    () =>
      Effect.gen(function* () {
        const grant = yield* parse([
          "permissions",
          "grant",
          "product.projects.read",
        ]).pipe(Effect.flip);
        const invalidDecision = yield* parse([
          "permissions",
          "revoke",
          "not-a-decision",
        ]).pipe(Effect.flip);

        assert.strictEqual(grant.code, "invalid-argument");
        assert.strictEqual(invalidDecision.code, "invalid-argument");
      }),
  );

  it.effect(
    "offers deferred portable extension discovery and calls but no grant command",
    () =>
      Effect.gen(function* () {
        const grant = yield* parse([
          "extensions",
          "grant",
          "weather-card",
        ]).pipe(Effect.flip);
        const invalidInput = yield* parse([
          "extensions",
          "call",
          "weather-card",
          "--input",
          "not-json",
        ]).pipe(Effect.flip);
        const traversal = yield* parse([
          "extensions",
          "describe",
          "../outside",
        ]).pipe(Effect.flip);

        assert.strictEqual(grant.code, "invalid-argument");
        assert.strictEqual(invalidInput.code, "invalid-argument");
        assert.strictEqual(traversal.code, "invalid-argument");
      }),
  );

  it.effect("returns contextual help at roots, nouns, and leaves", () =>
    Effect.gen(function* () {
      assert.deepInclude(yield* parse(["--help"]), {
        command: { kind: "help", path: [] },
      });
      assert.deepInclude(yield* parse(["model", "--help"]), {
        command: { kind: "help", path: ["model"] },
      });
      assert.deepInclude(yield* parse(["model", "select", "--help"]), {
        command: { kind: "help", path: ["model", "select"] },
      });
    }),
  );

  it.effect(
    "parses the read and integration catalog without raw escape hatches",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
          [[], "home"],
          [["app"], "app"],
          [["status"], "status"],
          [["logs", "--limit", "20", "--role", "shaper"], "logs"],
          [["watch", "--after", "9"], "watch"],
          [["target", "use"], "command"],
          [["action", "list"], "action-list"],
          [["action", "inspect", "run-report"], "action-inspect"],
          [["interface", "schema"], "interface-schema"],
          [["interface", "validate", "./interface.json"], "interface-validate"],
          [["interface", "propose", "./interface.json"], "interface-propose"],
          [["revision", "list"], "revision-list"],
          [["repository", "status"], "repository-status"],
          [["model", "list"], "model-list"],
          [["permissions", "list"], "permissions-list"],
          [["extensions", "list"], "portable-extension-list"],
          [["control", "status"], "control-status"],
          [["context", "--host", "codex"], "context"],
          [["setup", "status"], "setup-status"],
          [["setup", "shell", "install"], "setup-shell"],
          [["setup", "agent", "install", "codex"], "setup-agent"],
          [["mcp"], "mcp"],
        ];

        yield* Effect.forEach(
          cases,
          ([argv, kind]) =>
            parse(argv).pipe(
              Effect.tap((parsed) =>
                Effect.sync(() =>
                  assert.strictEqual(parsed.command.kind, kind),
                ),
              ),
            ),
          { discard: true },
        );
        const raw = yield* parse(["raw", "{}"] as const).pipe(Effect.flip);
        assert.strictEqual(raw.code, "unknown-command");
        const host = yield* parse(["context", "--host", "cursor"]).pipe(
          Effect.flip,
        );
        assert.strictEqual(host.code, "invalid-argument");
      }),
  );
});
