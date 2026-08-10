import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  ProductEvent,
  ProductEventFailure,
  ProductEventPolicy,
  ProductEventRequest,
} from "./product-events";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const policy = {
  version: 1,
  id: "reference.events.projects",
  operationId: "projects.watch",
  bufferCapacity: 16,
  eventBytes: 65_536,
  reconnectAttempts: 3,
  reconnectDelayMs: 1_000,
  sequenceResume: true,
};

describe("product event contracts", () => {
  it.effect("decodes one bounded sequence-aware policy and request", () =>
    Effect.gen(function* () {
      const decodedPolicy = yield* Schema.decodeUnknownEffect(
        ProductEventPolicy,
        strict,
      )(policy);
      const request = yield* Schema.decodeUnknownEffect(
        ProductEventRequest,
        strict,
      )({
        version: 1,
        policyId: policy.id,
        input: { projectId: "one" },
        resumeAfter: "18446744073709551616",
      });

      assert.strictEqual(decodedPolicy.bufferCapacity, 16);
      assert.strictEqual(request.resumeAfter, "18446744073709551616");
    }),
  );

  it.effect("rejects unbounded policy and excess authority", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ...policy, bufferCapacity: 0 },
        { ...policy, bufferCapacity: 257 },
        { ...policy, eventBytes: 0 },
        { ...policy, eventBytes: 1024 * 1024 + 1 },
        { ...policy, reconnectAttempts: 11 },
        { ...policy, reconnectDelayMs: 99 },
        { ...policy, operationId: "Projects Watch" },
        { ...policy, socketUrl: "wss://private.example.test" },
      ]) {
        const error = yield* Schema.decodeUnknownEffect(
          ProductEventPolicy,
          strict,
        )(invalid).pipe(Effect.flip);
        assert.strictEqual(error._tag, "SchemaError");
      }
    }),
  );

  it.effect("rejects invalid cursors and oversized inputs", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { version: 1, policyId: policy.id, input: null, resumeAfter: "" },
        { version: 1, policyId: policy.id, input: null, resumeAfter: "01" },
        { version: 1, policyId: policy.id, input: null, resumeAfter: "-1" },
        {
          version: 1,
          policyId: policy.id,
          input: { value: "x".repeat(1024 * 1024) },
        },
      ]) {
        const error = yield* Schema.decodeUnknownEffect(
          ProductEventRequest,
          strict,
        )(invalid).pipe(Effect.flip);
        assert.strictEqual(error._tag, "SchemaError");
      }
    }),
  );

  it.effect("decodes only bounded JSON events", () =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknownEffect(
        ProductEvent,
        strict,
      )({
        version: 1,
        policyId: policy.id,
        sequence: "2",
        payload: { status: "ready" },
      });
      assert.deepStrictEqual(event.payload, { status: "ready" });

      for (const invalid of [
        {
          version: 1,
          policyId: policy.id,
          sequence: "2",
          payload: { status: "ready" },
          credential: "private",
        },
        {
          version: 1,
          policyId: policy.id,
          sequence: "2",
          payload: { value: "x".repeat(1024 * 1024) },
        },
      ]) {
        const error = yield* Schema.decodeUnknownEffect(
          ProductEvent,
          strict,
        )(invalid).pipe(Effect.flip);
        assert.strictEqual(error._tag, "SchemaError");
      }
    }),
  );

  it("keeps event failures closed and private", () => {
    const failure = ProductEventFailure.make({
      policyId: policy.id,
      reason: "reconnect-exhausted",
      message: "The product event stream failed safely.",
    });

    assert.isTrue(Schema.is(ProductEventFailure)(failure));
    assert.notInclude(JSON.stringify(failure), "socket");
    assert.notInclude(JSON.stringify(failure), "credential");
  });
});
