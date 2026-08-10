import { assert, describe, it } from "@effect/vitest";
import { MemoryVfs } from "@riftydev/vfs";
import { Effect } from "effect";
import { BrowserBuildArtifact } from "../../shared/browser-build";
import { digestBuildEntries } from "./browser-build-digest";
import {
  BrowserBuildStore,
  makeBrowserBuildStoreLayer,
} from "./browser-build-store";

const encoder = new TextEncoder();

const makeArtifact = async () => {
  const inputs = [
    { path: "src/main.ts", contents: encoder.encode("export const n = 42") },
  ];
  const outputs = [
    {
      path: "app.js",
      kind: "chunk" as const,
      contents: encoder.encode("var n=42;"),
    },
    {
      path: "app.css",
      kind: "asset" as const,
      contents: encoder.encode("body{}"),
    },
  ];
  return BrowserBuildArtifact.make({
    version: 1,
    buildId: "build-store-test",
    sourceRevision: "flect/proposal/store-test",
    inputDigest: await digestBuildEntries(inputs),
    artifactDigest: await digestBuildEntries(outputs),
    outputs,
  });
};

describe("BrowserBuildStore", () => {
  it("reopens the exact content-addressed last successful artifact", () =>
    Effect.gen(function* () {
      const artifact = yield* Effect.promise(makeArtifact);
      const vfs = new MemoryVfs();
      const layer = makeBrowserBuildStoreLayer(vfs, "/flect-builds/test");

      yield* Effect.gen(function* () {
        const store = yield* BrowserBuildStore;
        assert.isUndefined(yield* store.load);
        yield* store.save(artifact);
      }).pipe(Effect.provide(layer));

      const reopened = yield* Effect.gen(function* () {
        const store = yield* BrowserBuildStore;
        return yield* store.load;
      }).pipe(Effect.provide(layer));
      assert.deepStrictEqual(reopened, artifact);
    }));

  it("fails closed when a stored output no longer matches its digest", () =>
    Effect.gen(function* () {
      const artifact = yield* Effect.promise(makeArtifact);
      const vfs = new MemoryVfs();
      const root = "/flect-builds/corrupt";
      const layer = makeBrowserBuildStoreLayer(vfs, root);
      yield* Effect.gen(function* () {
        const store = yield* BrowserBuildStore;
        yield* store.save(artifact);
      }).pipe(Effect.provide(layer));

      yield* Effect.promise(() =>
        vfs.writeFile(
          `${root}/objects/${artifact.artifactDigest}/files/0.bin`,
          encoder.encode("tampered"),
        ),
      );
      const error = yield* Effect.gen(function* () {
        const store = yield* BrowserBuildStore;
        return yield* store.load;
      }).pipe(Effect.provide(layer), Effect.flip);
      assert.strictEqual(
        error.message,
        "Browser build storage is unavailable.",
      );
    }));
});
