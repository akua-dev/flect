import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Option, Ref, Stream } from "effect";
import { PortableExtensionPackage } from "../../shared/extensions";
import { InterfaceStorage } from "../lib/interface-store";
import {
  ExtensionCatalog,
  makeExtensionCatalogLayer,
} from "./extension-catalog";

const extension = (version = "1.0.0") =>
  PortableExtensionPackage.make({
    formatVersion: 1,
    id: "weather-card",
    name: "Weather card",
    description: "Adds a bounded weather summary.",
    version,
    bundle: "extensions/weather-card/bundle.mjs",
    roles: ["app", "shaper"],
    compatibility: {
      flect: ">=0.2.0 <1.0.0",
      extensionApi: 1,
      platforms: ["browser", "macos"],
    },
    capabilities: [
      { id: "interface:read", required: true },
      { id: "interface:propose", required: false },
    ],
    publicInstructions: "Use only when weather context is useful.",
    commands: [],
    tools: [],
    resources: {
      deadlineMs: 100,
      memoryBytes: 16 * 1024 * 1024,
      inputBytes: 1024 * 1024,
      outputBytes: 1024 * 1024,
      maxIntents: 20,
    },
    provenance: {
      publisher: "akua-dev",
      source: "https://github.com/akua-dev/weather-card",
      revision: `v${version}`,
      bundleSha256: version === "1.0.0" ? "a".repeat(64) : "b".repeat(64),
    },
  });

const candidate = {
  capsuleId: "dev.akua.weather",
  packages: [extension()],
  flectVersion: "0.2.0",
  platform: "browser",
} as const;

const key = (
  role: "app" | "shaper",
  binding: "accepted" | "candidate" = "candidate",
) => ({
  capsuleId: "dev.akua.weather",
  extensionId: "weather-card",
  role,
  binding,
});

const makeStorage = (initial: string | null = null) => {
  const value = Ref.makeUnsafe(initial);
  return {
    value,
    layer: Layer.succeed(InterfaceStorage)({
      read: () => Ref.get(value),
      write: (_key, next) => Ref.set(value, next),
      remove: () => Ref.set(value, null),
    }),
  };
};

const makeLayer = (initial: string | null = null) => {
  const storage = makeStorage(initial);
  return {
    storage,
    layer: makeExtensionCatalogLayer().pipe(Layer.provide(storage.layer)),
  };
};

describe("ExtensionCatalog", () => {
  it.effect(
    "stages separate inactive candidate records for each declared role",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        yield* catalog.stageCandidate(candidate);
        const snapshot = yield* catalog.snapshot;

        assert.deepStrictEqual(
          snapshot.entries.map((entry) => [
            entry.role,
            entry.binding,
            entry.state,
          ]),
          [
            ["app", "candidate", "available"],
            ["shaper", "candidate", "available"],
          ],
        );
        assert.isTrue(snapshot.entries.every((entry) => !entry.tested));
        assert.isTrue(
          snapshot.entries.every(
            (entry) => entry.grantedCapabilities.length === 0,
          ),
        );
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "enables only one explicit role and requires its required grants",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        yield* catalog.stageCandidate(candidate);
        const denied = yield* catalog.enable(key("app"), []).pipe(Effect.flip);
        assert.strictEqual(denied._tag, "ExtensionCatalogFailure");
        assert.strictEqual(denied.reason, "required-capability");

        yield* catalog.enable(key("app"), [
          "interface:read",
          "interface:propose",
        ]);
        const snapshot = yield* catalog.snapshot;
        const app = snapshot.entries.find((entry) => entry.role === "app");
        const shaper = snapshot.entries.find(
          (entry) => entry.role === "shaper",
        );
        assert.strictEqual(app?.state, "enabled");
        assert.deepStrictEqual(app?.grantedCapabilities, [
          "interface:read",
          "interface:propose",
        ]);
        assert.strictEqual(shaper?.state, "available");
        assert.deepStrictEqual(shaper?.grantedCapabilities, []);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "requires candidate testing before promotion and keeps roles isolated",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        yield* catalog.stageCandidate(candidate);
        yield* catalog.enable(key("app"), ["interface:read"]);
        const untested = yield* catalog.promoteCandidate.pipe(Effect.flip);
        assert.strictEqual(untested.reason, "untested-candidate");

        yield* catalog.recordSuccess(key("app"));
        yield* catalog.promoteCandidate;
        const snapshot = yield* catalog.snapshot;
        assert.isTrue(
          snapshot.entries.every((entry) => entry.binding === "accepted"),
        );
        assert.strictEqual(
          snapshot.entries.find((entry) => entry.role === "app")?.tested,
          true,
        );
        assert.strictEqual(
          snapshot.entries.find((entry) => entry.role === "shaper")?.tested,
          false,
        );
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "preserves pins and local forks as update conflicts without widening grants",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        yield* catalog.stageCandidate(candidate);
        yield* catalog.enable(key("app"), ["interface:read"]);
        yield* catalog.recordSuccess(key("app"));
        yield* catalog.promoteCandidate;
        yield* catalog.pin(key("app", "accepted"), true);
        yield* catalog.fork(key("shaper", "accepted"), "local-weather-layout");

        yield* catalog.stageCandidate({
          ...candidate,
          packages: [extension("1.1.0")],
        });
        const snapshot = yield* catalog.snapshot;
        const nextApp = snapshot.entries.find(
          (entry) => entry.binding === "candidate" && entry.role === "app",
        );
        const nextShaper = snapshot.entries.find(
          (entry) => entry.binding === "candidate" && entry.role === "shaper",
        );
        assert.strictEqual(nextApp?.state, "conflict");
        assert.strictEqual(nextApp?.pinned, true);
        assert.deepStrictEqual(nextApp?.grantedCapabilities, [
          "interface:read",
        ]);
        assert.strictEqual(nextShaper?.state, "conflict");
        assert.strictEqual(nextShaper?.forkRevision, "local-weather-layout");
        assert.deepStrictEqual(nextShaper?.grantedCapabilities, []);
        const unresolvedFork = yield* catalog
          .resolveUpdate(key("app"), "fork")
          .pipe(Effect.flip);
        assert.strictEqual(unresolvedFork.reason, "invalid-transition");
        assert.strictEqual(
          (yield* catalog.snapshot).entries.find(
            (entry) => entry.binding === "candidate" && entry.role === "app",
          )?.state,
          "conflict",
        );
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "records bounded failure evidence, disables, removes, and rejects candidates",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        yield* catalog.stageCandidate(candidate);
        yield* catalog.enable(key("app"), ["interface:read"]);
        yield* catalog.recordFailure(key("app"), "execution");
        const failed = (yield* catalog.snapshot).entries.find(
          (entry) => entry.role === "app",
        );
        assert.strictEqual(failed?.state, "failed");
        assert.strictEqual(
          failed?.failure?.message,
          "The portable extension failed safely.",
        );
        assert.notProperty(failed?.failure ?? {}, "stack");
        assert.notProperty(failed?.failure ?? {}, "error");
        const failedPromotion = yield* catalog.promoteCandidate.pipe(
          Effect.flip,
        );
        assert.strictEqual(failedPromotion.reason, "untested-candidate");

        yield* catalog.disable(key("app"));
        const disabled = (yield* catalog.snapshot).entries.find(
          (entry) => entry.role === "app",
        );
        assert.strictEqual(disabled?.state, "disabled");
        assert.deepStrictEqual(disabled?.grantedCapabilities, []);
        yield* catalog.remove(key("app"));
        assert.lengthOf((yield* catalog.snapshot).entries, 1);
        yield* catalog.rejectCandidate;
        assert.lengthOf((yield* catalog.snapshot).entries, 0);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "persists strict records, emits reactive changes, and fails closed on corruption",
    () => {
      const harness = makeLayer();
      return Effect.gen(function* () {
        const catalog = yield* ExtensionCatalog;
        const observed = yield* catalog.changes.pipe(
          Stream.drop(1),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* catalog.stageCandidate(candidate);
        const changed = yield* Fiber.join(observed);
        assert.isTrue(Option.isSome(changed));
        if (Option.isSome(changed)) {
          assert.strictEqual(changed.value.entries.length, 2);
        }

        const persisted = yield* Ref.get(harness.storage.value);
        assert.isString(persisted);
        const restored = makeLayer(persisted);
        const restoredSnapshot = yield* Effect.scoped(
          Effect.gen(function* () {
            const services = yield* Layer.build(restored.layer);
            return yield* Context.get(services, ExtensionCatalog).snapshot;
          }),
        );
        assert.lengthOf(restoredSnapshot.entries, 2);

        const corrupt = makeLayer(
          '{"version":1,"entries":[{"token":"secret"}]}',
        );
        const corruptSnapshot = yield* Effect.scoped(
          Effect.gen(function* () {
            const services = yield* Layer.build(corrupt.layer);
            return yield* Context.get(services, ExtensionCatalog).snapshot;
          }),
        );
        assert.lengthOf(corruptSnapshot.entries, 0);
        assert.strictEqual(corruptSnapshot.warning, "invalid-record");
      }).pipe(Effect.provide(harness.layer));
    },
  );
});
