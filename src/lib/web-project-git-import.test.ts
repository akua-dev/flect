import { Effect, Ref } from "effect";
import { describe, expect, it } from "vitest";
import {
  GitOpened,
  GitRemoved,
  GitShareInspected,
} from "../../shared/git-workspace";
import type { GitWorkspaceShape } from "../git/git-workspace";
import { importWebProjectFromGit } from "./web-project-git-import";

const encoder = new TextEncoder();
const commit = "a".repeat(40);

describe("web project Git import", () => {
  it("binds an isolated clone to an exact commit and preserves attribution", async () => {
    const requests = Ref.makeUnsafe<
      ReadonlyArray<{ url?: string; commit: string }>
    >([]);
    const removals = Ref.makeUnsafe(0);
    const unused = Effect.die("unused");
    const workspace: GitWorkspaceShape = {
      open: () =>
        Effect.succeed(
          GitOpened.make({
            type: "opened",
            variant: "asyncify",
            existed: false,
          }),
        ),
      write: () => unused,
      read: () => unused,
      run: () => unused,
      exportRepository: unused,
      remove: Ref.update(removals, (count) => count + 1).pipe(
        Effect.as(GitRemoved.make({ type: "removed" })),
      ),
      checkpoint: () => unused,
      readAtRef: () => unused,
      moveRef: () => unused,
      snapshotRef: () => unused,
      status: () => unused,
      importRepository: () => unused,
      importObjects: () => unused,
      deleteRef: () => unused,
      inspectCommit: () => unused,
      mergeRef: () => unused,
      inspectShare: (request) =>
        Ref.update(requests, (items) => [...items, request]).pipe(
          Effect.as(
            GitShareInspected.make({
              type: "share-inspected",
              commit,
              repository: new Uint8Array(1_536),
              files: [
                {
                  path: "project/index.html",
                  contents: encoder.encode("<main>Git app</main>"),
                },
                {
                  path: "project/.env",
                  contents: encoder.encode("TOKEN=secret"),
                },
              ],
            }),
          ),
        ),
    };

    const result = await Effect.runPromise(
      importWebProjectFromGit("https://example.test/project.git", commit, {
        createWorkspace: Effect.succeed(workspace),
        workspaceId: () => "project-test",
      }),
    );

    expect(await Effect.runPromise(Ref.get(requests))).toEqual([
      {
        url: "https://example.test/project.git",
        commit,
        manifestRequired: false,
      },
    ]);
    expect(await Effect.runPromise(Ref.get(removals))).toBe(1);
    expect(result.report).toMatchObject({
      source: "git",
      revision: commit,
      ignoredFiles: [".env"],
    });
  });

  it("rejects credentials and branch names before a worker starts", async () => {
    const invalid = await Effect.runPromise(
      importWebProjectFromGit(
        "https://token@example.test/project.git",
        "main",
      ).pipe(Effect.flip),
    );
    expect(invalid.message).toContain("credential-free HTTPS Git URL");
    expect(invalid.message).toContain("40-character commit ID");
  });
});
