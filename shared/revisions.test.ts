import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { defaultInterfaceDocument } from "./interface-document";
import {
  InterfaceRevision,
  RevisionId,
  validateInterfaceRevision,
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
});
