import { MemoryVfs } from "@riftydev/vfs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CapsuleStore, makeCapsuleStoreLayer } from "./capsule-store";

describe("CapsuleStore", () => {
  it("identifies explicitly injected memory storage as session-only", async () => {
    const persistence = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* CapsuleStore).persistence;
      }).pipe(
        Effect.provide(makeCapsuleStoreLayer(new MemoryVfs(), "session")),
      ),
    );

    expect(persistence).toBe("session");
  });

  it("restores content-addressed bindings through a fresh service", async () => {
    const vfs = new MemoryVfs();
    const first = makeCapsuleStoreLayer(vfs);
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* CapsuleStore;
        yield* store.save({ accepted: new Uint8Array([1, 2, 3]) });
      }).pipe(Effect.provide(first)),
    );
    const restored = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* CapsuleStore).load;
      }).pipe(Effect.provide(makeCapsuleStoreLayer(vfs))),
    );
    expect(restored.accepted).toEqual(new Uint8Array([1, 2, 3]));
  });
});
