import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { selectSidecarMode } from "./sidecar-mode";

describe("private sidecar mode", () => {
  it.effect(
    "uses RPC only when no private marker or arguments are present",
    () =>
      Effect.gen(function* () {
        const selected = yield* selectSidecarMode([]);
        assert.deepStrictEqual(selected, { mode: "rpc", argv: [] });
      }),
  );

  it.effect("selects AXI and MCP while stripping only the private marker", () =>
    Effect.gen(function* () {
      const axi = yield* selectSidecarMode([
        "--flect-private-mode=axi",
        "--json",
        "inspect",
      ]);
      const mcp = yield* selectSidecarMode([
        "--flect-private-mode=mcp",
        "--state-dir",
        "/tmp/flect-test",
      ]);
      assert.deepStrictEqual(axi, {
        mode: "axi",
        argv: ["--json", "inspect"],
      });
      assert.deepStrictEqual(mcp, {
        mode: "mcp",
        argv: ["--state-dir", "/tmp/flect-test"],
      });
    }),
  );

  it.effect(
    "fails closed on unknown, missing, misplaced, or duplicate modes",
    () =>
      Effect.gen(function* () {
        const cases = [
          ["status"],
          ["--flect-private-mode=unknown"],
          ["status", "--flect-private-mode=axi"],
          ["--flect-private-mode=axi", "--flect-private-mode=mcp"],
        ];
        for (const argv of cases) {
          const error = yield* selectSidecarMode(argv).pipe(Effect.flip);
          assert.strictEqual(error._tag, "SidecarModeError");
        }
      }),
  );
});
