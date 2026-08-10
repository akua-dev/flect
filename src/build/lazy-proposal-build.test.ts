import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserBuildArtifact,
  type ProposalBuildRequest,
} from "../../shared/browser-build";
import { GitWorkspace, type GitWorkspaceShape } from "../git/git-workspace";
import { makeLazyProposalBuildLayer } from "./lazy-proposal-build";
import {
  ProposalBuild,
  type ProposalBuildShape,
} from "./proposal-build-service";

const request: ProposalBuildRequest = {
  proposalBranch: "flect/proposal/test",
  proposalCommit: "a".repeat(40),
  acceptedCommit: "b".repeat(40),
  lastKnownGoodCommit: "c".repeat(40),
  entrypoint: "src/main.tsx",
};

describe("LazyProposalBuildLive", () => {
  it("loads and disposes the build runtime only after a build operation", async () => {
    const compile = vi.fn<ProposalBuildShape["compile"]>(() =>
      Effect.succeed(
        BrowserBuildArtifact.make({
          version: 1,
          buildId: "build-test",
          sourceRevision: request.proposalCommit,
          inputDigest: "d".repeat(64),
          artifactDigest: "e".repeat(64),
          outputs: [
            {
              path: "app.js",
              kind: "chunk",
              contents: new TextEncoder().encode("export {}"),
            },
          ],
        }),
      ),
    );
    const dispose = vi.fn(() => Promise.resolve());
    const load = vi.fn(() =>
      Promise.resolve({
        service: {
          compile,
          resolvePackageLock: () => Effect.succeed(undefined),
        } satisfies ProposalBuildShape,
        dispose,
      }),
    );
    const layer = makeLazyProposalBuildLayer({ load }).pipe(
      Layer.provide(Layer.succeed(GitWorkspace)({} as GitWorkspaceShape)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const build = yield* ProposalBuild;
        expect(load).not.toHaveBeenCalled();
        yield* build.compile(request);
        yield* build.compile(request);
        expect(load).toHaveBeenCalledOnce();
      }).pipe(Effect.provide(layer)),
    );

    expect(compile).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
