import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

const contractPattern = /\*\*(FQ-\d{2}\.\d+):\*\*/g;
const classificationPattern =
  /^\| (FQ-\d{2}\.\d+) \| (?:unimplemented|partial|implemented|proven|regressed) \| ?(.*?) ?\|$/gm;

export class ProductQualityCoverageError extends Schema.TaggedErrorClass<ProductQualityCoverageError>()(
  "ProductQualityCoverageError",
  {
    message: Schema.Literal("Product-quality coverage is incomplete."),
    missing: Schema.Array(Schema.String),
    duplicates: Schema.Array(Schema.String),
    unexpected: Schema.Array(Schema.String),
    emptyEvidence: Schema.Array(Schema.String),
  },
) {}

const matchedIds = (source: string, pattern: RegExp) =>
  Array.from(source.matchAll(pattern), (match) => match.at(1))
    .filter((id): id is string => id !== undefined)
    .sort();

const duplicateIds = (ids: ReadonlyArray<string>) => {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts)
    .filter((entry) => entry[1] > 1)
    .map((entry) => entry[0])
    .sort();
};

const classificationRows = (source: string) =>
  Array.from(source.matchAll(classificationPattern)).flatMap((match) => {
    const id = match.at(1);
    const evidence = match.at(2);
    return id === undefined || evidence === undefined ? [] : [{ id, evidence }];
  });

export const validateProductQualityCoverage = Effect.fn(
  "Flect.ProductQuality.validateCoverage",
)(function* (contract: string, baseline: string) {
  const contractIds = matchedIds(contract, contractPattern);
  const classifications = classificationRows(baseline);
  const classificationIds = classifications.map((entry) => entry.id).sort();
  const expected = new Set(contractIds);
  const actual = new Set(classificationIds);
  const missing = contractIds.filter((id) => !actual.has(id));
  const duplicates = duplicateIds(classificationIds);
  const unexpected = classificationIds.filter((id) => !expected.has(id));
  const contractDuplicates = duplicateIds(contractIds);
  const emptyEvidence = classifications
    .filter((entry) => entry.evidence.trim().length === 0)
    .map((entry) => entry.id)
    .sort();

  if (
    missing.length > 0 ||
    duplicates.length > 0 ||
    unexpected.length > 0 ||
    contractDuplicates.length > 0 ||
    emptyEvidence.length > 0
  ) {
    return yield* ProductQualityCoverageError.make({
      message: "Product-quality coverage is incomplete.",
      missing,
      duplicates: [...contractDuplicates, ...duplicates].sort(),
      unexpected,
      emptyEvidence,
    });
  }
});

export const validateCheckedInProductQualityCoverage = Effect.fn(
  "Flect.ProductQuality.validateCheckedInCoverage",
)(function* () {
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
});

if (import.meta.main) {
  validateCheckedInProductQualityCoverage().pipe(
    Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)),
    BunRuntime.runMain,
  );
}
