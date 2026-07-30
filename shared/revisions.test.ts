import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { defaultInterfaceDocument } from "./interface-document";
import {
  InterfaceRevision,
  RevisionId,
  ShapingEvent,
  ShapingSnapshot,
  validateInterfaceRevision,
  validateShapingSnapshot,
} from "./revisions";

const revision = (status: "proposed" | "previewed" | "accepted" | "rejected") =>
  ({
    version: 1,
    id: "revision-1",
    parentId: "revision-0",
    status,
    source: "shaper",
    document: defaultInterfaceDocument,
    createdAt: 1,
  }) as const;

describe("interface revisions", () => {
  it.effect("decodes a schema-defined immutable revision", () =>
    Effect.gen(function* () {
      const decoded = yield* validateInterfaceRevision(revision("proposed"));

      assert.instanceOf(decoded, InterfaceRevision);
      assert.strictEqual(decoded.id, RevisionId.make("revision-1"));
      assert.strictEqual(decoded.status, "proposed");
    }),
  );

  it.effect(
    "rejects credentials and provider payloads in revision records",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          validateInterfaceRevision({
            ...revision("proposed"),
            apiKey: "must-never-land-here",
          }),
        );

        assert.strictEqual(error._tag, "InvalidRevision");
        assert.notInclude(error.message, "must-never-land-here");
      }),
  );

  it.effect(
    "rejects built-in revisions outside the exact initial revision",
    () =>
      Effect.gen(function* () {
        const initial = InterfaceRevision.make({
          version: 1,
          id: RevisionId.make("built-in"),
          status: "accepted",
          source: "built-in",
          document: defaultInterfaceDocument,
          createdAt: 0,
        });
        const forged = InterfaceRevision.make({
          version: 1,
          id: RevisionId.make("revision-1"),
          parentId: initial.id,
          status: "accepted",
          source: "built-in",
          document: defaultInterfaceDocument,
          createdAt: 1,
        });
        const validActive = InterfaceRevision.make({
          version: 1,
          id: RevisionId.make("revision-2"),
          parentId: forged.id,
          status: "accepted",
          source: "shaper",
          document: defaultInterfaceDocument,
          createdAt: 2,
        });
        const activeForged = ShapingSnapshot.make({
          version: 1,
          active: forged,
          lastKnownGood: initial,
          safeMode: false,
          disabledExtensions: [],
          lastEvent: ShapingEvent.make({
            version: 1,
            sequence: 1,
            type: "revision-accepted",
            revisionId: forged.id,
          }),
        });
        const lastKnownGoodForged = ShapingSnapshot.make({
          version: 1,
          active: validActive,
          lastKnownGood: forged,
          safeMode: false,
          disabledExtensions: [],
          lastEvent: ShapingEvent.make({
            version: 1,
            sequence: 1,
            type: "revision-accepted",
            revisionId: validActive.id,
          }),
        });

        const activeError = yield* Effect.flip(
          validateShapingSnapshot(activeForged),
        );
        const lastKnownGoodError = yield* Effect.flip(
          validateShapingSnapshot(lastKnownGoodForged),
        );

        assert.strictEqual(activeError._tag, "InvalidRevision");
        assert.strictEqual(lastKnownGoodError._tag, "InvalidRevision");
      }),
  );
});
