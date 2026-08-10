import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makePiWorkbenchBridge } from "./pi-workbench-bridge";

describe("Pi workbench bridge", () => {
  it.effect("emits one bounded typed interface-edit request", () =>
    Effect.gen(function* () {
      const events: Array<{
        readonly type: string;
        readonly requestId: string;
        readonly instruction: string;
      }> = [];
      const bridge = makePiWorkbenchBridge((event) => events.push(event));
      const result = yield* Effect.promise(() =>
        bridge.tool.execute(
          "tool-transition-1",
          { instruction: "Make the failed action clearer" },
          undefined,
          undefined,
          {} as never,
        ),
      );

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0]?.type, "interface_edit_requested");
      assert.strictEqual(events[0]?.requestId, "tool-transition-1");
      assert.strictEqual(
        events[0]?.instruction,
        "Make the failed action clearer",
      );
      const content = result.content[0];
      assert.strictEqual(content?.type, "text");
      if (content?.type === "text") {
        assert.include(content.text, "Flect will switch");
      }
    }),
  );
});
