import { readFile } from "node:fs/promises";
import { assert, describe, it } from "@effect/vitest";
import { parse } from "yaml";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown, label: string): JsonRecord => {
  assert.isObject(value, `${label} must be a mapping`);
  return value as JsonRecord;
};

describe("GitHub quality workflow", () => {
  it("runs the canonical credential-free gate with immutable dependencies", async () => {
    const source = await readFile(".github/workflows/quality.yml", "utf8");
    assert.notInclude(source, "secrets.");
    assert.notInclude(source, "pull_request_target");

    const workflow = record(
      parse(source, { uniqueKeys: true }),
      "quality workflow",
    );
    assert.strictEqual(workflow.name, "Flect quality");
    assert.deepStrictEqual(workflow.permissions, { contents: "read" });

    const triggers = record(workflow.on, "workflow triggers");
    assert.deepStrictEqual(Object.keys(triggers).sort(), [
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    assert.deepStrictEqual(
      record(triggers.pull_request, "pull request trigger").branches,
      ["main"],
    );
    assert.deepStrictEqual(record(triggers.push, "push trigger").branches, [
      "main",
    ]);
    assert.deepStrictEqual(
      record(
        record(triggers.workflow_dispatch, "manual trigger").inputs,
        "manual trigger inputs",
      ).failure_probe,
      {
        description: "Prove that the public quality check fails closed",
        required: false,
        type: "boolean",
        default: false,
      },
    );

    const concurrency = record(workflow.concurrency, "workflow concurrency");
    assert.strictEqual(concurrency["cancel-in-progress"], true);
    assert.match(String(concurrency.group), /github\.workflow/);
    assert.match(String(concurrency.group), /github\.ref/);

    const quality = record(
      record(workflow.jobs, "workflow jobs").quality,
      "quality job",
    );
    assert.strictEqual(quality.name, "Flect quality gate");
    assert.strictEqual(quality["runs-on"], "macos-15");
    assert.strictEqual(quality["timeout-minutes"], 45);

    const steps = quality.steps as ReadonlyArray<JsonRecord>;
    assert.isArray(steps);
    const actionSteps = steps.filter(
      (step): step is JsonRecord & { readonly uses: string } =>
        typeof step.uses === "string",
    );
    assert.isTrue(actionSteps.length > 0);
    for (const step of actionSteps) {
      assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }

    const action = (prefix: string) => {
      const step = actionSteps.find((candidate) =>
        candidate.uses.startsWith(prefix),
      );
      assert.isDefined(step, `${prefix} step is required`);
      return step;
    };
    assert.strictEqual(
      action("actions/checkout@").uses,
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    assert.deepStrictEqual(action("actions/checkout@").with, {
      "persist-credentials": false,
    });
    assert.strictEqual(
      action("oven-sh/setup-bun@").uses,
      "oven-sh/setup-bun@b7a1c7ccf290d58743029c4f6903da283811b979",
    );
    assert.deepStrictEqual(action("oven-sh/setup-bun@").with, {
      "bun-version": "1.3.14",
      "no-cache": true,
    });
    assert.strictEqual(
      action("dtolnay/rust-toolchain@").uses,
      "dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c",
    );
    assert.deepStrictEqual(action("dtolnay/rust-toolchain@").with, {
      toolchain: "1.93.0",
      components: "rustfmt",
    });

    const commands = steps.flatMap((step) =>
      typeof step.run === "string" ? [step.run] : [],
    );
    assert.include(commands, "bun install --frozen-lockfile");
    assert.include(commands, "bunx playwright install chromium");
    assert.include(commands, "bun run check:all");

    const artifact = action("actions/upload-artifact@");
    assert.strictEqual(
      artifact.uses,
      "actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4",
    );
    assert.strictEqual(artifact.if, "failure() && !cancelled()");
    const artifactInputs = record(artifact.with, "artifact inputs");
    assert.strictEqual(artifactInputs["retention-days"], 7);
    assert.strictEqual(artifactInputs["include-hidden-files"], false);
    assert.strictEqual(
      artifactInputs.path,
      "test-results/**\n!test-results/control-state/**\n",
    );
  });

  it("pins the local toolchains and includes Rust formatting in check:all", async () => {
    const packageJson = record(
      JSON.parse(await readFile("package.json", "utf8")),
      "package.json",
    );
    assert.strictEqual(packageJson.packageManager, "bun@1.3.14");
    const scripts = record(packageJson.scripts, "package scripts");
    assert.strictEqual(
      scripts["check:rust"],
      "cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml",
    );
    assert.match(String(scripts["check:all"]), /bun run check:rust/);
  });
});
