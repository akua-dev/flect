import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { FLECT_COMMAND_METADATA } from "../src/axi/command";
import { generateFlectSkill, renderFlectSkill } from "./generate-flect-skill";

const PlatformLive = Layer.merge(BunFileSystem.layer, BunPath.layer);

describe("generated Flect skill", () => {
  it.effect(
    "renders concise trigger metadata and content-first role guidance",
    () =>
      Effect.sync(() => {
        const source = renderFlectSkill(FLECT_COMMAND_METADATA);

        assert.isTrue(source.startsWith("---\nname: flect\ndescription:"));
        assert.include(source, "Use when an agent needs to inspect");
        assert.include(source, "`flect`");
        assert.include(source, "content-first discovery");
        assert.include(source, "App Agent");
        assert.include(source, "Shaper");
        assert.include(source, "proposal acceptance remains a user decision");
        assert.notInclude(source, "workspace-");
        assert.notInclude(source, "gpt-");
        assert.notInclude(source.toLowerCase(), "bearer");
        assert.notInclude(source, "127.0.0.1");
        assert.isBelow(source.split("\n").length, 180);
      }),
  );

  it.effect("matches the checked-in skill and detects metadata drift", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const checkedIn = yield* path.fromFileUrl(
        new URL("../.agents/skills/flect/SKILL.md", import.meta.url),
      );
      const expected = renderFlectSkill(FLECT_COMMAND_METADATA);

      assert.strictEqual(yield* fs.readFileString(checkedIn), expected);
      yield* generateFlectSkill({ check: true, outputPath: checkedIn });

      const drifted = FLECT_COMMAND_METADATA.map((command, index) =>
        index === 0
          ? { ...command, summary: `${command.summary} Changed.` }
          : command,
      );
      const result = yield* Effect.result(
        generateFlectSkill({
          check: true,
          outputPath: checkedIn,
          commands: drifted,
        }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure._tag, "FlectSkillGenerationError");
      }
      if (
        Result.isFailure(result) &&
        result.failure._tag === "FlectSkillGenerationError"
      ) {
        assert.strictEqual(result.failure.reason, "stale");
      }
    }).pipe(Effect.provide(PlatformLive)),
  );

  it.effect(
    "writes the same deterministic skill through Effect FileSystem",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const root = yield* fs.makeTempDirectoryScoped({
            prefix: "flect-skill-",
          });
          const outputPath = `${root}/flect/SKILL.md`;

          yield* generateFlectSkill({ check: false, outputPath });
          assert.strictEqual(
            yield* fs.readFileString(outputPath),
            renderFlectSkill(FLECT_COMMAND_METADATA),
          );
        }),
      ).pipe(Effect.provide(PlatformLive)),
  );
});
