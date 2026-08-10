import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  GitCommitInspected,
  GitDeleteRefRequest,
  GitImportObjectsRequest,
  GitImportRepositoryRequest,
  GitInspectCommitRequest,
  GitInspectShareRequest,
  GitMergeRefRequest,
  GitObjectsImported,
  GitRefDeleted,
  GitRefMergeConflict,
  GitRefMerged,
  GitRepositoryImported,
  GitShareInspected,
  GitWorkspaceOperation,
  GitWorkspaceResult,
} from "../../shared/git-workspace";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const commit = "a".repeat(40);

describe("Git share quarantine operations", () => {
  it.effect(
    "strictly decodes bounded import and exact-commit inspection frames",
    () =>
      Effect.gen(function* () {
        const imported = GitImportRepositoryRequest.make({
          type: "import-repository",
          archive: new Uint8Array([1, 2, 3]),
          commit,
        });
        const inspect = GitInspectShareRequest.make({
          type: "inspect-share",
          commit,
          url: "https://github.com/akua-dev/flect-share-fixture.git",
          manifestRequired: true,
        });
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(imported);
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(inspect);
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(
          GitImportObjectsRequest.make({
            type: "import-objects",
            archive: new Uint8Array([1, 2, 3]),
            commit,
            guards: [],
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(
          GitInspectCommitRequest.make({
            type: "inspect-commit",
            commit,
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(
          GitMergeRefRequest.make({
            type: "merge-ref",
            branch: "flect/shared/abc/candidate",
            expectedCommit: commit,
            upstreamBranch: "flect/shared/abc/upstream",
            expectedUpstreamCommit: "b".repeat(40),
            files: [
              {
                path: "components/weather.ts",
                contents: new Uint8Array([1, 2, 3]),
              },
            ],
            guards: [],
            message: "Merge shared update",
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceOperation,
          strict,
        )(
          GitDeleteRefRequest.make({
            type: "delete-ref",
            branch: "flect/shared/abc/candidate",
            expectedCommit: commit,
            guards: [],
          }),
        );

        const importResult = GitRepositoryImported.make({
          type: "repository-imported",
          commit,
          fileCount: 2,
        });
        const inspectResult = GitShareInspected.make({
          type: "share-inspected",
          commit,
          manifest: new TextEncoder().encode("{}"),
          repository: new Uint8Array([1]),
          files: [],
        });
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(importResult);
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(inspectResult);
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(
          GitObjectsImported.make({
            type: "objects-imported",
            commit,
            objectCount: 1,
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(
          GitCommitInspected.make({
            type: "commit-inspected",
            commit,
            parents: [],
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(
          GitRefMerged.make({
            type: "ref-merged",
            branch: "flect/shared/abc/candidate",
            commit,
            parents: ["b".repeat(40), "c".repeat(40)],
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(
          GitRefMergeConflict.make({
            type: "ref-merge-conflict",
            branch: "flect/shared/abc/candidate",
            commit,
            conflictPaths: ["src/shared.ts"],
          }),
        );
        yield* Schema.decodeUnknownEffect(
          GitWorkspaceResult,
          strict,
        )(
          GitRefDeleted.make({
            type: "ref-deleted",
            branch: "flect/shared/abc/candidate",
          }),
        );
      }),
  );

  it.effect(
    "rejects floating revisions and excess authority-bearing fields",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<unknown> = [
          {
            type: "import-repository",
            archive: new Uint8Array(),
            commit: "main",
          },
          {
            type: "inspect-share",
            commit,
            manifestRequired: true,
            acceptedRef: "flect/accepted",
          },
          {
            type: "inspect-share",
            commit,
            url: "https://private-token@example.test/share.git",
            manifestRequired: true,
          },
          {
            type: "delete-ref",
            branch: "flect/accepted",
            expectedCommit: commit,
            guards: [],
          },
        ];
        for (const input of cases) {
          const result = yield* Schema.decodeUnknownEffect(
            GitWorkspaceOperation,
            strict,
          )(input).pipe(Effect.result);
          assert.strictEqual(result._tag, "Failure");
        }
      }),
  );
});
