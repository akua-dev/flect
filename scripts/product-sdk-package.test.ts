import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  packageProductSdk,
  verifyProductSdkConsumer,
} from "./package-product-sdk";

describe("@flect/product packaging", () => {
  it.effect(
    "packs only the public SDK and runs in a clean consumer",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const evidence = yield* packageProductSdk();

          assert.strictEqual(evidence.name, "@flect/product");
          assert.strictEqual(evidence.version, "0.1.0");
          assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
          assert.isAbove(evidence.bytes, 1_000);
          assert.deepStrictEqual(evidence.exports, [
            ".",
            "./contracts",
            "./host",
          ]);
          assert.isTrue(
            evidence.files.every(
              (path) =>
                path === "package/LICENSE" ||
                path === "package/README.md" ||
                path === "package/package.json" ||
                path.startsWith("package/dist/"),
            ),
          );
          assert.isFalse(
            evidence.files.some(
              (path) =>
                path.includes("/shared/") ||
                path.includes("/src/capabilities/") ||
                path.includes("../"),
            ),
          );

          const consumer = yield* verifyProductSdkConsumer(evidence.tarball);
          assert.strictEqual(consumer.output, "offline-ready");
          assert.strictEqual(consumer.typecheck, "passed");
        }),
      ),
    20_000,
  );
});
