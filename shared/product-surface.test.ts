import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, type SchemaAST } from "effect";
import { ProductSurfaceRegistration } from "./product-surface";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const decode = Schema.decodeUnknownEffect(ProductSurfaceRegistration, strict);

describe("product surface contracts", () => {
  it.effect("accepts an exact loopback registration", () =>
    Effect.gen(function* () {
      const registration = yield* decode({
        version: 1,
        capabilityId: "akua-outreach-review",
        title: "Outreach Review",
        origin: "http://127.0.0.1:3211",
        entryPath: "/?embed=1&capability=akua-outreach-review",
        agentActionPath: "/api/agent-actions",
        sessionCredential: "session-capability-secret",
        expiresAt: "2026-08-02T23:00:00.000Z",
      });
      assert.strictEqual(registration.origin, "http://127.0.0.1:3211");
      assert.strictEqual(registration.agentActionPath, "/api/agent-actions");
    }),
  );

  it.effect("rejects non-loopback, credential-bearing, and excess input", () =>
    Effect.gen(function* () {
      for (const input of [
        { origin: "https://example.com" },
        { origin: "http://0.0.0.0:3211" },
        { origin: "http://user:pass@127.0.0.1:3211" },
        { entryPath: "/?token=secret" },
        { agentActionPath: "https://example.com/actions" },
        { agentActionPath: "/api/actions?credential=secret" },
        { extra: "unsafe" },
      ]) {
        const result = yield* Effect.exit(
          decode({
            version: 1,
            capabilityId: "akua-outreach-review",
            title: "Outreach Review",
            origin: "http://127.0.0.1:3211",
            entryPath: "/?embed=1&capability=akua-outreach-review",
            sessionCredential: "session-capability-secret",
            expiresAt: "2026-08-02T23:00:00.000Z",
            ...input,
          }),
        );
        assert.isTrue(result._tag === "Failure");
      }
    }),
  );
});
