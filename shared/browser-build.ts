import { Schema } from "effect";

const RequestId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^request-[a-z0-9]+$/),
);
const BuildId = Schema.String.check(
  Schema.isMinLength(5),
  Schema.isMaxLength(80),
  Schema.isPattern(/^build-[a-z0-9-]+$/),
);
const SourceRevision = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-zA-Z0-9._:/-]+$/),
);
const BuildPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
);
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const GitObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const ProposalBranch = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(180),
  Schema.isPattern(/^flect\/proposal\/[a-z0-9][a-z0-9/-]*$/),
);

export class BrowserBuildFile extends Schema.Class<BrowserBuildFile>(
  "BrowserBuildFile",
)({
  path: BuildPath,
  contents: Schema.Uint8Array,
}) {}

export class BrowserBuildRequest extends Schema.Class<BrowserBuildRequest>(
  "BrowserBuildRequest",
)({
  version: Schema.Literal(1),
  buildId: BuildId,
  sourceRevision: SourceRevision,
  dependencyGraphDigest: Schema.optionalKey(Digest),
  entrypoint: BuildPath,
  files: Schema.Array(BrowserBuildFile).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2_048),
  ),
}) {}

export class ProposalBuildRequest extends Schema.Class<ProposalBuildRequest>(
  "ProposalBuildRequest",
)({
  proposalBranch: ProposalBranch,
  proposalCommit: GitObjectId,
  acceptedCommit: GitObjectId,
  lastKnownGoodCommit: GitObjectId,
  entrypoint: BuildPath,
}) {}

export class BrowserBuildOutput extends Schema.Class<BrowserBuildOutput>(
  "BrowserBuildOutput",
)({
  path: BuildPath,
  kind: Schema.Literals(["chunk", "asset"]),
  contents: Schema.Uint8Array,
}) {}

export class BrowserBuildArtifact extends Schema.Class<BrowserBuildArtifact>(
  "BrowserBuildArtifact",
)({
  version: Schema.Literal(1),
  buildId: BuildId,
  sourceRevision: SourceRevision,
  dependencyGraphDigest: Schema.optionalKey(Digest),
  inputDigest: Digest,
  artifactDigest: Digest,
  outputs: Schema.Array(BrowserBuildOutput).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
  ),
}) {}

const BrowserBuildFailureFields = {
  buildId: BuildId,
  reason: Schema.Literals([
    "unsupported",
    "invalid-input",
    "oversized",
    "worker",
    "deadline",
    "compile",
    "invalid-result",
    "storage",
  ]),
  message: Schema.String.check(Schema.isMaxLength(500)),
};

export class BrowserBuildFailure extends Schema.TaggedErrorClass<BrowserBuildFailure>()(
  "BrowserBuildFailure",
  BrowserBuildFailureFields,
) {}

export class BrowserBuildFailureFrame extends Schema.Class<BrowserBuildFailureFrame>(
  "BrowserBuildFailureFrame",
)(BrowserBuildFailureFields) {}

export class ProposalBuildFailure extends Schema.TaggedErrorClass<ProposalBuildFailure>()(
  "ProposalBuildFailure",
  {
    reason: Schema.Literals(["snapshot", "source", "package", "build"]),
    message: Schema.String.check(Schema.isMaxLength(500)),
  },
) {}

export class BrowserBuildWorkerRequest extends Schema.Class<BrowserBuildWorkerRequest>(
  "BrowserBuildWorkerRequest",
)({
  version: Schema.Literal(1),
  id: RequestId,
  request: BrowserBuildRequest,
}) {}

export class BrowserBuildWorkerSuccess extends Schema.Class<BrowserBuildWorkerSuccess>(
  "BrowserBuildWorkerSuccess",
)({
  type: Schema.Literal("success"),
  id: RequestId,
  artifact: BrowserBuildArtifact,
}) {}

export class BrowserBuildWorkerFailure extends Schema.Class<BrowserBuildWorkerFailure>(
  "BrowserBuildWorkerFailure",
)({
  type: Schema.Literal("failure"),
  id: RequestId,
  error: BrowserBuildFailureFrame,
}) {}

export const BrowserBuildWorkerResponse = Schema.Union([
  BrowserBuildWorkerSuccess,
  BrowserBuildWorkerFailure,
]);
export type BrowserBuildWorkerResponse = typeof BrowserBuildWorkerResponse.Type;
