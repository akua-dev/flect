import { assert, describe, it } from "@effect/vitest";
import { MemoryVfs } from "@riftydev/vfs";
import { Effect, Layer, Ref } from "effect";
import { BrowserPackageRequest } from "../../shared/browser-package";
import { makeBunPackageMutationLayer } from "../execution/bun-package-mutation";
import {
  badIntegrityRegistryFetch,
  fixtureRegistryFetch,
} from "../execution/fixtures/package-registry";
import {
  BrowserPackageCache,
  makeBrowserPackageCacheLayer,
} from "./browser-package-cache";
import {
  BrowserPackageResolver,
  makeBrowserPackageResolverLayer,
} from "./browser-package-resolver";

const encoder = new TextEncoder();
const request = BrowserPackageRequest.make({
  version: 1,
  packageJson: encoder.encode(
    JSON.stringify({
      name: "fixture-app",
      version: "1.0.0",
      private: true,
      dependencies: { "flect-fixture": "1.0.0" },
    }),
  ),
});

describe("BrowserPackageResolver", () => {
  it.effect(
    "resolves once and reuses the integrity-bearing cache offline",
    () =>
      Effect.gen(function* () {
        const fetchCount = yield* Ref.make(0);
        const packages = makeBunPackageMutationLayer({
          fetch: (url, init) => {
            Effect.runSync(Ref.update(fetchCount, (count) => count + 1));
            return fixtureRegistryFetch(url, init);
          },
          registryBaseUrl: "https://registry.flect.invalid",
        });
        const cache = makeBrowserPackageCacheLayer(
          new MemoryVfs(),
          "/flect-packages/test",
        );
        const layer = makeBrowserPackageResolverLayer({
          registryOrigin: "https://registry.flect.invalid",
        }).pipe(Layer.provideMerge(Layer.mergeAll(packages, cache)));

        const [first, second] = yield* Effect.gen(function* () {
          const resolver = yield* BrowserPackageResolver;
          const initial = yield* resolver.resolve(request);
          const cached = yield* resolver.resolve(request);
          return [initial, cached] as const;
        }).pipe(Effect.provide(layer));

        assert.isFalse(first.cacheHit);
        assert.isTrue(second.cacheHit);
        assert.strictEqual(first.graphDigest, second.graphDigest);
        assert.strictEqual(yield* Ref.get(fetchCount), 2);
        assert.isTrue(
          second.files.some(
            (file) => file.path === "node_modules/flect-fixture/package.json",
          ),
        );
        const lock: unknown = JSON.parse(
          new TextDecoder().decode(second.lockfile),
        );
        assert.strictEqual(
          (lock as { lockfileVersion?: unknown }).lockfileVersion,
          3,
        );
      }),
  );

  it.effect("does not cache a package whose integrity check fails", () =>
    Effect.gen(function* () {
      const packages = makeBunPackageMutationLayer({
        fetch: badIntegrityRegistryFetch,
        registryBaseUrl: "https://registry.flect.invalid",
      });
      const cache = makeBrowserPackageCacheLayer(
        new MemoryVfs(),
        "/flect-packages/integrity",
      );
      const layer = makeBrowserPackageResolverLayer({
        registryOrigin: "https://registry.flect.invalid",
      }).pipe(Layer.provideMerge(Layer.mergeAll(packages, cache)));
      const error = yield* Effect.gen(function* () {
        const resolver = yield* BrowserPackageResolver;
        return yield* resolver.resolve(request);
      }).pipe(Effect.provide(layer), Effect.flip);

      assert.strictEqual(error.reason, "resolution");
      const cached = yield* Effect.gen(function* () {
        const store = yield* BrowserPackageCache;
        return yield* store.load(error.inputDigest);
      }).pipe(Effect.provide(cache));
      assert.isUndefined(cached);
    }),
  );
});
