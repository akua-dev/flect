import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { validateProductQualityCoverage } from "./product-quality-coverage";

const PlatformLive = Layer.merge(BunFileSystem.layer, BunPath.layer);

it.effect(
  "classifies every canonical product-quality criterion exactly once",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const contractPath = yield* path.fromFileUrl(
        new URL("../docs/product-quality.md", import.meta.url),
      );
      const baselinePath = yield* path.fromFileUrl(
        new URL(
          "../docs/verification/2026-08-01-product-quality-baseline.md",
          import.meta.url,
        ),
      );
      const contract = yield* fs.readFileString(contractPath);
      const baseline = yield* fs.readFileString(baselinePath);
      yield* validateProductQualityCoverage(contract, baseline);
    }).pipe(Effect.provide(PlatformLive)),
);

it.effect("reports missing, duplicate, and unexpected classifications", () =>
  Effect.gen(function* () {
    const contract = [
      "- **FQ-01.1:** First outcome.",
      "- **FQ-01.2:** Second outcome.",
    ].join("\n");
    const baseline = [
      "| FQ-01.1 | proven | Evidence. |",
      "| FQ-01.1 | partial | Duplicate. |",
      "| FQ-99.1 | implemented | Unexpected. |",
    ].join("\n");
    const result = yield* Effect.result(
      validateProductQualityCoverage(contract, baseline),
    );

    assert.isTrue(Result.isFailure(result));
    if (
      Result.isFailure(result) &&
      result.failure._tag === "ProductQualityCoverageError"
    ) {
      assert.deepStrictEqual(result.failure.missing, ["FQ-01.2"]);
      assert.deepStrictEqual(result.failure.duplicates, ["FQ-01.1"]);
      assert.deepStrictEqual(result.failure.unexpected, ["FQ-99.1"]);
    }
  }),
);

it.effect("rejects a maturity classification without evidence", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      validateProductQualityCoverage(
        "- **FQ-01.1:** First outcome.",
        "| FQ-01.1 | proven | |",
      ),
    );

    assert.isTrue(Result.isFailure(result));
    if (
      Result.isFailure(result) &&
      result.failure._tag === "ProductQualityCoverageError"
    ) {
      assert.deepStrictEqual(result.failure.emptyEvidence, ["FQ-01.1"]);
    }
  }),
);
