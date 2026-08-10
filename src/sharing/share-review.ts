import { Effect, Schema } from "effect";
import type { ShareManifest } from "../../packages/product/src/share";
import type { ShareInstallationSource } from "../../shared/share-installation";
import {
  ShareReview,
  ShareReviewArtifact,
  ShareReviewChange,
  type ShareSignatureAssessment,
} from "../../shared/share-review";
import { satisfiesVersion } from "../lib/semver-compatibility";

export {
  ShareReview,
  ShareReviewArtifact,
  ShareReviewChange,
} from "../../shared/share-review";

export class ShareReviewFailure extends Schema.TaggedErrorClass<ShareReviewFailure>()(
  "ShareReviewFailure",
  {
    message: Schema.Literal("The shared candidate review could not be built."),
  },
) {}

export interface ShareReviewFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface BuildShareReviewInput {
  readonly lineage: ShareReview["lineage"];
  readonly origin: ShareInstallationSource;
  readonly manifest: ShareManifest;
  readonly previousManifest?: ShareManifest;
  readonly files: ReadonlyArray<ShareReviewFile>;
  readonly previousFiles: ReadonlyArray<ShareReviewFile>;
  readonly conflictPaths: ReadonlyArray<string>;
  readonly flectVersion: string;
  readonly platform: "browser" | "macos" | "windows" | "linux";
  readonly signature: ShareSignatureAssessment;
}

const failure = () =>
  ShareReviewFailure.make({
    message: "The shared candidate review could not be built.",
  });

const digest = (contents: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const value = await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(contents),
      );
      return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    catch: failure,
  });

const category = (path: string): ShareReviewChange["category"] => {
  const lower = path.toLowerCase();
  if (
    lower === "agents.md" ||
    lower.includes("instruction") ||
    lower.endsWith("prompt.md")
  ) {
    return "instructions";
  }
  if (lower.startsWith("extensions/") || lower.includes("/extensions/")) {
    return "extension";
  }
  if (lower.includes("capabilit")) return "capability";
  if (
    lower.endsWith("package-lock.json") ||
    lower.endsWith("bun.lock") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("yarn.lock")
  ) {
    return "dependency";
  }
  if (lower.endsWith("flect.json") || lower.includes("interface")) {
    return "interface";
  }
  return "source";
};

const isAuthorityAffecting = (value: ShareReviewChange["category"]) =>
  value === "instructions" ||
  value === "extension" ||
  value === "capability" ||
  value === "migration";

const actions = (lineage: ShareReview["lineage"]): ShareReview["actions"] =>
  lineage === "new"
    ? ["install", "fork", "reject"]
    : lineage === "update" || lineage === "fork"
      ? ["merge-update", "reject"]
      : lineage === "replacement"
        ? ["keep-replacement", "reject"]
        : ["continue-fork", "shape-conflict", "reject"];

export const buildShareReview = Effect.fn("Flect.ShareReview.build")(function* (
  input: BuildShareReviewInput,
) {
  const current = new Map<string, string>();
  const previous = new Map<string, string>();
  for (const file of input.files)
    current.set(file.path, yield* digest(file.contents));
  for (const file of input.previousFiles)
    previous.set(file.path, yield* digest(file.contents));
  const paths = new Set([
    ...current.keys(),
    ...previous.keys(),
    ...input.conflictPaths,
  ]);
  const conflicts = new Set(input.conflictPaths);
  const changes = [...paths].toSorted().flatMap((path) => {
    const before = previous.get(path);
    const after = current.get(path);
    if (!conflicts.has(path) && before === after) return [];
    const changeCategory = category(path);
    return [
      ShareReviewChange.make({
        category: changeCategory,
        kind: conflicts.has(path)
          ? "conflict"
          : before === undefined
            ? "added"
            : after === undefined
              ? "removed"
              : "modified",
        path,
        authorityAffecting: isAuthorityAffecting(changeCategory),
      }),
    ];
  });

  const previousMigrations = JSON.stringify(
    input.previousManifest?.migrations ?? [],
  );
  const currentMigrations = JSON.stringify(input.manifest.migrations);
  if (previousMigrations !== currentMigrations) {
    changes.push(
      ShareReviewChange.make({
        category: "migration",
        kind: input.previousManifest === undefined ? "added" : "modified",
        path: ".flect/migrations",
        authorityAffecting: true,
      }),
    );
    changes.sort((left, right) => left.path.localeCompare(right.path));
  }

  const compatible =
    (yield* satisfiesVersion(
      input.flectVersion,
      input.manifest.compatibility.flect,
    )) && input.manifest.compatibility.platforms.includes(input.platform);
  const previousExtensionIds = new Set(
    (input.previousManifest?.artifacts ?? [])
      .filter((artifact) => artifact.kind === "extension")
      .map((artifact) => artifact.id),
  );
  const extensionChanged = input.manifest.artifacts.some(
    (artifact) =>
      artifact.kind === "extension" && !previousExtensionIds.has(artifact.id),
  );
  const blockers: Array<ShareReview["blockers"][number]> = [];
  if (input.signature.status === "invalid") blockers.push("invalid-signature");
  if (!compatible) blockers.push("incompatible");
  if (input.conflictPaths.length > 0 || input.lineage === "conflict")
    blockers.push("conflict");
  if (previousMigrations !== currentMigrations)
    blockers.push("migration-review-required");
  if (extensionChanged) blockers.push("extension-test-required");
  if (changes.some((change) => change.authorityAffecting))
    blockers.push("grant-review-required");

  return ShareReview.make({
    formatVersion: 1,
    shareId: input.manifest.id,
    name: input.manifest.name,
    version: input.manifest.version,
    lineage: input.lineage,
    origin: input.origin,
    publisher: input.manifest.provenance.publisher,
    source: input.manifest.provenance.source,
    revision: input.manifest.provenance.revision,
    compatible,
    signature: input.signature,
    artifacts: input.manifest.artifacts
      .map((artifact) =>
        ShareReviewArtifact.make({
          id: artifact.id,
          kind: artifact.kind,
          version: artifact.version,
          sourceRoot: artifact.sourceRoot,
        }),
      )
      .toSorted(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.id.localeCompare(right.id),
      ),
    changes,
    blockers,
    actions: actions(input.lineage),
    inactive: true,
  });
});
