import { Context, type Effect } from "effect";
import type {
  BrowserBuildArtifact,
  ProposalBuildFailure,
  ProposalBuildRequest,
} from "../../shared/browser-build";

export interface ProposalBuildShape {
  readonly resolvePackageLock: (request: ProposalBuildRequest) => Effect.Effect<
    | {
        readonly contents: Uint8Array;
        readonly needsCheckpoint: boolean;
      }
    | undefined,
    ProposalBuildFailure
  >;
  readonly compile: (
    request: ProposalBuildRequest,
  ) => Effect.Effect<BrowserBuildArtifact, ProposalBuildFailure>;
}

export class ProposalBuild extends Context.Service<
  ProposalBuild,
  ProposalBuildShape
>()("flect/ProposalBuild") {}
