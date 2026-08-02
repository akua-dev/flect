import { assert, describe, it, layer } from "@effect/vitest";
import { Effect } from "effect";
import { ProductSurfaceRegistration } from "../shared/product-surface";
import {
  ProductSurfaceRegistry,
  ProductSurfaceRegistryLive,
} from "./product-surface-registry";

const registration = () =>
  ProductSurfaceRegistration.make({
    version: 1,
    capabilityId: "akua-outreach-review",
    title: "Outreach Review",
    origin: "http://127.0.0.1:3211",
    entryPath: "/?embed=1&capability=akua-outreach-review",
    sessionCredential: "session-capability-secret",
    expiresAt: "2099-08-02T23:00:00.000Z",
  });

describe("ProductSurfaceRegistry", () => {
  it.effect(
    "replaces a restarted session at the same endpoint and requires approval again",
    () =>
      Effect.gen(function* () {
        const registry = yield* ProductSurfaceRegistry;
        const first = ProductSurfaceRegistration.make({
          version: 1,
          capabilityId: "akua-outreach-review",
          title: "Outreach Review",
          origin: "http://127.0.0.1:3211",
          entryPath: "/?embed=1",
          sessionCredential: "first-local-session-secret",
          expiresAt: "2099-08-02T12:00:00.000Z",
        });
        yield* registry.register(first);
        yield* registry.approve(first.capabilityId);
        const restarted = yield* registry.register(
          ProductSurfaceRegistration.make({
            ...first,
            sessionCredential: "second-local-session-secret",
            expiresAt: "2099-08-02T13:00:00.000Z",
          }),
        );
        assert.strictEqual(restarted.status, "pending");
        const error = yield* registry
          .resolve(first.capabilityId)
          .pipe(Effect.flip);
        assert.strictEqual(error.code, "pending");
      }).pipe(Effect.provide(ProductSurfaceRegistryLive)),
  );

  layer(ProductSurfaceRegistryLive)((it) => {
    it.effect("keeps the secret hidden until explicit approval", () =>
      Effect.gen(function* () {
        const registry = yield* ProductSurfaceRegistry;
        const pending = yield* registry.register(registration());
        assert.strictEqual(pending.status, "pending");
        assert.isFalse(
          JSON.stringify(pending).includes("session-capability-secret"),
        );
        const denied = yield* Effect.exit(
          registry.resolve("akua-outreach-review"),
        );
        assert.isTrue(denied._tag === "Failure");

        yield* registry.approve("akua-outreach-review");
        const resolved = yield* registry.resolve("akua-outreach-review");
        assert.strictEqual(
          resolved.sessionCredential,
          "session-capability-secret",
        );
        yield* registry.revoke("akua-outreach-review");
        const missing = yield* Effect.exit(
          registry.resolve("akua-outreach-review"),
        );
        assert.isTrue(missing._tag === "Failure");
      }),
    );

    it.effect(
      "is idempotent for equal registrations and rejects conflicts",
      () =>
        Effect.gen(function* () {
          const registry = yield* ProductSurfaceRegistry;
          yield* registry.register(registration());
          const repeated = yield* registry.register(registration());
          assert.strictEqual(repeated.status, "pending");
          const conflict = yield* Effect.exit(
            registry.register(
              ProductSurfaceRegistration.make({
                ...registration(),
                origin: "http://127.0.0.1:7777",
              }),
            ),
          );
          assert.isTrue(conflict._tag === "Failure");
        }),
    );
  });
});
