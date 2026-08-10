import { Effect, Layer, ManagedRuntime } from "effect";
import { makeBunPackageMutationLayer } from "../execution/bun-package-mutation";
import {
  NPM_REGISTRY_ORIGIN,
  trustedNpmRegistryFetch,
} from "../execution/npm-registry";
import type { GitWorkspaceShape } from "../git/git-workspace";
import { GitWorkspace } from "../git/git-workspace";
import { BrowserBuild, BrowserBuildLive } from "./browser-build";
import { BrowserPackageCacheLive } from "./browser-package-cache";
import { BrowserPackageResolverLive } from "./browser-package-resolver";
import { ProposalBuildLive } from "./proposal-build";
import { ProposalBuild } from "./proposal-build-service";

export const makeLiveProposalBuild = async ({
  git,
}: {
  readonly git: GitWorkspaceShape;
}) => {
  const packageMutation = makeBunPackageMutationLayer({
    fetch: trustedNpmRegistryFetch,
    registryBaseUrl: NPM_REGISTRY_ORIGIN,
  });
  const packages = BrowserPackageResolverLive.pipe(
    Layer.provideMerge(Layer.merge(packageMutation, BrowserPackageCacheLive)),
  );
  const browserBuild = BrowserBuildLive.pipe(
    Layer.catch((error) =>
      Layer.succeed(BrowserBuild)({
        compile: () => Effect.fail(error),
        lastSuccessful: Effect.succeed(undefined),
      }),
    ),
  );
  const live = ProposalBuildLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(Layer.succeed(GitWorkspace)(git), browserBuild, packages),
    ),
  );
  const runtime = ManagedRuntime.make(live);
  return {
    service: await runtime.runPromise(ProposalBuild),
    dispose: () => runtime.dispose(),
  };
};
