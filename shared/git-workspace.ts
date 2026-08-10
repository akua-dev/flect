import { Schema } from "effect";

const RequestId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^request-[a-z0-9]+$/),
);
const WorkspaceId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
const RepositoryPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
);
const GitArgument = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
);
const OutputText = Schema.String.check(Schema.isMaxLength(1_048_576));
const GitRemoteUrl = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.isPattern(/^https:\/\/(?!(?:[^/]*@))[^\s]+$/),
);
export const GitObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/),
);
export const GitBranchName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(180),
  Schema.isPattern(/^flect\/[a-z0-9][a-z0-9/-]*$/),
);
const CommitMessage = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.isPattern(/^[^\0\r\n]+$/),
);

const GitFailureReason = Schema.Literals([
  "unsupported",
  "unavailable",
  "invalid-input",
  "invalid-path",
  "invalid-ref",
  "conflict",
  "corrupt",
  "quota",
  "stale-ref",
  "oversized",
  "interrupted",
  "worker",
  "command",
  "invalid-result",
]);
const GitOperationName = Schema.Literals([
  "open",
  "remove",
  "write",
  "read",
  "run",
  "export",
  "export-ref",
  "checkpoint",
  "read-at-ref",
  "snapshot-ref",
  "move-ref",
  "status",
  "import-repository",
  "import-objects",
  "delete-ref",
  "inspect-commit",
  "merge-ref",
  "inspect-share",
]);
const GitFailureFields = {
  reason: GitFailureReason,
  operation: GitOperationName,
  message: Schema.String.check(Schema.isMaxLength(500)),
};

export class GitWorkspaceFailure extends Schema.TaggedErrorClass<GitWorkspaceFailure>()(
  "GitWorkspaceFailure",
  GitFailureFields,
) {}

export class GitWorkspaceFailureFrame extends Schema.Class<GitWorkspaceFailureFrame>(
  "GitWorkspaceFailureFrame",
)(GitFailureFields) {}

export class GitOpenRequest extends Schema.Class<GitOpenRequest>(
  "GitOpenRequest",
)({
  type: Schema.Literal("open"),
  workspaceId: WorkspaceId,
  reset: Schema.Boolean,
}) {}

export class GitWriteRequest extends Schema.Class<GitWriteRequest>(
  "GitWriteRequest",
)({
  type: Schema.Literal("write"),
  path: RepositoryPath,
  contents: Schema.Uint8Array,
}) {}

export class GitReadRequest extends Schema.Class<GitReadRequest>(
  "GitReadRequest",
)({
  type: Schema.Literal("read"),
  path: RepositoryPath,
}) {}

export class GitRunRequest extends Schema.Class<GitRunRequest>("GitRunRequest")(
  {
    type: Schema.Literal("run"),
    args: Schema.Array(GitArgument).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
    ),
  },
) {}

export class GitExportRequest extends Schema.Class<GitExportRequest>(
  "GitExportRequest",
)({
  type: Schema.Literal("export"),
}) {}

export class GitRemoveRequest extends Schema.Class<GitRemoveRequest>(
  "GitRemoveRequest",
)({
  type: Schema.Literal("remove"),
}) {}

export class GitImportRepositoryRequest extends Schema.Class<GitImportRepositoryRequest>(
  "GitImportRepositoryRequest",
)({
  type: Schema.Literal("import-repository"),
  archive: Schema.Uint8Array.check(Schema.isMaxLength(32 * 1024 * 1024)),
  commit: GitObjectId,
}) {}

export class GitInspectShareRequest extends Schema.Class<GitInspectShareRequest>(
  "GitInspectShareRequest",
)({
  type: Schema.Literal("inspect-share"),
  commit: GitObjectId,
  url: Schema.optionalKey(GitRemoteUrl),
  manifestRequired: Schema.Boolean,
}) {}

export class GitCheckpointFile extends Schema.Class<GitCheckpointFile>(
  "GitCheckpointFile",
)({
  path: RepositoryPath,
  contents: Schema.Uint8Array,
}) {}

export class GitRefGuard extends Schema.Class<GitRefGuard>("GitRefGuard")({
  branch: GitBranchName,
  commit: GitObjectId,
}) {}

export class GitExportRefRequest extends Schema.Class<GitExportRefRequest>(
  "GitExportRefRequest",
)({
  type: Schema.Literal("export-ref"),
  branch: GitBranchName.check(
    Schema.isPattern(
      /^flect\/shared\/[a-z0-9][a-z0-9/-]*\/(?:fork|candidate)$/,
    ),
  ),
  expectedCommit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
}) {}

export class GitImportObjectsRequest extends Schema.Class<GitImportObjectsRequest>(
  "GitImportObjectsRequest",
)({
  type: Schema.Literal("import-objects"),
  archive: Schema.Uint8Array.check(Schema.isMaxLength(32 * 1024 * 1024)),
  commit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
}) {}

export class GitDeleteRefRequest extends Schema.Class<GitDeleteRefRequest>(
  "GitDeleteRefRequest",
)({
  type: Schema.Literal("delete-ref"),
  branch: GitBranchName.check(
    Schema.isPattern(/^flect\/shared\/[a-z0-9][a-z0-9/-]*$/),
  ),
  expectedCommit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
}) {}

export class GitInspectCommitRequest extends Schema.Class<GitInspectCommitRequest>(
  "GitInspectCommitRequest",
)({
  type: Schema.Literal("inspect-commit"),
  commit: GitObjectId,
}) {}

export class GitMergeRefRequest extends Schema.Class<GitMergeRefRequest>(
  "GitMergeRefRequest",
)({
  type: Schema.Literal("merge-ref"),
  branch: GitBranchName,
  expectedCommit: GitObjectId,
  upstreamBranch: GitBranchName,
  expectedUpstreamCommit: GitObjectId,
  files: Schema.Array(GitCheckpointFile).check(Schema.isMaxLength(4_096)),
  conflictPaths: Schema.optionalKey(
    Schema.Array(RepositoryPath).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100),
    ),
  ),
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
  message: CommitMessage,
}) {}

export class GitCheckpointRequest extends Schema.Class<GitCheckpointRequest>(
  "GitCheckpointRequest",
)({
  type: Schema.Literal("checkpoint"),
  branch: GitBranchName,
  expectedCommit: Schema.optionalKey(GitObjectId),
  baseCommit: Schema.optionalKey(GitObjectId),
  files: Schema.Array(GitCheckpointFile).check(Schema.isMaxLength(4_096)),
  removals: Schema.Array(RepositoryPath).check(Schema.isMaxLength(4_096)),
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
  message: CommitMessage,
}) {}

export class GitReadAtRefRequest extends Schema.Class<GitReadAtRefRequest>(
  "GitReadAtRefRequest",
)({
  type: Schema.Literal("read-at-ref"),
  branch: GitBranchName,
  expectedCommit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
  paths: Schema.Array(RepositoryPath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
}) {}

export class GitMoveRefRequest extends Schema.Class<GitMoveRefRequest>(
  "GitMoveRefRequest",
)({
  type: Schema.Literal("move-ref"),
  branch: GitBranchName,
  expectedCommit: Schema.optionalKey(GitObjectId),
  targetCommit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
}) {}

export class GitSnapshotRefRequest extends Schema.Class<GitSnapshotRefRequest>(
  "GitSnapshotRefRequest",
)({
  type: Schema.Literal("snapshot-ref"),
  branch: GitBranchName,
  expectedCommit: GitObjectId,
  guards: Schema.Array(GitRefGuard).check(Schema.isMaxLength(8)),
}) {}

export class GitStatusRequest extends Schema.Class<GitStatusRequest>(
  "GitStatusRequest",
)({
  type: Schema.Literal("status"),
  proposalBranch: Schema.optionalKey(GitBranchName),
}) {}

export const GitWorkspaceOperation = Schema.Union([
  GitOpenRequest,
  GitWriteRequest,
  GitReadRequest,
  GitRunRequest,
  GitExportRequest,
  GitExportRefRequest,
  GitRemoveRequest,
  GitCheckpointRequest,
  GitReadAtRefRequest,
  GitSnapshotRefRequest,
  GitMoveRefRequest,
  GitStatusRequest,
  GitImportRepositoryRequest,
  GitImportObjectsRequest,
  GitDeleteRefRequest,
  GitInspectCommitRequest,
  GitMergeRefRequest,
  GitInspectShareRequest,
]);
export type GitWorkspaceOperation = typeof GitWorkspaceOperation.Type;

export class GitWorkerRequest extends Schema.Class<GitWorkerRequest>(
  "GitWorkerRequest",
)({
  version: Schema.Literal(1),
  id: RequestId,
  operation: GitWorkspaceOperation,
}) {}

export class GitOpened extends Schema.Class<GitOpened>("GitOpened")({
  type: Schema.Literal("opened"),
  variant: Schema.Literals(["pthreads", "jspi", "asyncify"]),
  existed: Schema.Boolean,
}) {}

export class GitWritten extends Schema.Class<GitWritten>("GitWritten")({
  type: Schema.Literal("written"),
  path: RepositoryPath,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8_388_608 })),
}) {}

export class GitRead extends Schema.Class<GitRead>("GitRead")({
  type: Schema.Literal("read"),
  path: RepositoryPath,
  contents: Schema.Uint8Array,
}) {}

export class GitCommandResult extends Schema.Class<GitCommandResult>(
  "GitCommandResult",
)({
  type: Schema.Literal("command"),
  exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  stdout: OutputText,
  stderr: OutputText,
}) {}

export class GitExported extends Schema.Class<GitExported>("GitExported")({
  type: Schema.Literal("exported"),
  archive: Schema.Uint8Array,
  fileCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 20_000 }),
  ),
}) {}

export class GitRemoved extends Schema.Class<GitRemoved>("GitRemoved")({
  type: Schema.Literal("removed"),
}) {}

export class GitCheckpointed extends Schema.Class<GitCheckpointed>(
  "GitCheckpointed",
)({
  type: Schema.Literal("checkpointed"),
  branch: GitBranchName,
  commit: GitObjectId,
}) {}

export class GitRefFile extends Schema.Class<GitRefFile>("GitRefFile")({
  path: RepositoryPath,
  contents: Schema.Uint8Array,
}) {}

export class GitRepositoryImported extends Schema.Class<GitRepositoryImported>(
  "GitRepositoryImported",
)({
  type: Schema.Literal("repository-imported"),
  commit: GitObjectId,
  fileCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 20_000 }),
  ),
}) {}

export class GitShareInspected extends Schema.Class<GitShareInspected>(
  "GitShareInspected",
)({
  type: Schema.Literal("share-inspected"),
  commit: GitObjectId,
  manifest: Schema.optionalKey(
    Schema.Uint8Array.check(Schema.isMaxLength(1_048_576)),
  ),
  repository: Schema.Uint8Array.check(Schema.isMaxLength(32 * 1024 * 1024)),
  files: Schema.Array(GitRefFile).check(Schema.isMaxLength(4_096)),
}) {}

export class GitObjectsImported extends Schema.Class<GitObjectsImported>(
  "GitObjectsImported",
)({
  type: Schema.Literal("objects-imported"),
  commit: GitObjectId,
  objectCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 20_000 }),
  ),
}) {}

export class GitRefDeleted extends Schema.Class<GitRefDeleted>("GitRefDeleted")(
  {
    type: Schema.Literal("ref-deleted"),
    branch: GitBranchName,
  },
) {}

export class GitCommitInspected extends Schema.Class<GitCommitInspected>(
  "GitCommitInspected",
)({
  type: Schema.Literal("commit-inspected"),
  commit: GitObjectId,
  parents: Schema.Array(GitObjectId).check(Schema.isMaxLength(16)),
}) {}

export class GitRefMerged extends Schema.Class<GitRefMerged>("GitRefMerged")({
  type: Schema.Literal("ref-merged"),
  branch: GitBranchName,
  commit: GitObjectId,
  parents: Schema.Tuple([GitObjectId, GitObjectId]),
}) {}

export class GitRefMergeConflict extends Schema.Class<GitRefMergeConflict>(
  "GitRefMergeConflict",
)({
  type: Schema.Literal("ref-merge-conflict"),
  branch: GitBranchName,
  commit: GitObjectId,
  conflictPaths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(100)),
}) {}

export class GitReadAtRef extends Schema.Class<GitReadAtRef>("GitReadAtRef")({
  type: Schema.Literal("read-at-ref"),
  branch: GitBranchName,
  commit: GitObjectId,
  files: Schema.Array(GitRefFile).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
}) {}

export class GitRefMoved extends Schema.Class<GitRefMoved>("GitRefMoved")({
  type: Schema.Literal("ref-moved"),
  branch: GitBranchName,
  commit: GitObjectId,
}) {}

export class GitRefSnapshot extends Schema.Class<GitRefSnapshot>(
  "GitRefSnapshot",
)({
  type: Schema.Literal("ref-snapshot"),
  branch: GitBranchName,
  commit: GitObjectId,
  files: Schema.Array(GitRefFile).check(Schema.isMaxLength(4_096)),
}) {}

export class GitRepositoryStatus extends Schema.Class<GitRepositoryStatus>(
  "GitRepositoryStatus",
)({
  type: Schema.Literal("status"),
  acceptedCommit: Schema.optionalKey(GitObjectId),
  lastKnownGoodCommit: Schema.optionalKey(GitObjectId),
  proposalBranch: Schema.optionalKey(GitBranchName),
  proposalCommit: Schema.optionalKey(GitObjectId),
  authoringCommit: Schema.optionalKey(GitObjectId),
  dirty: Schema.Boolean,
  conflictPaths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(100)),
}) {}

export const GitWorkspaceResult = Schema.Union([
  GitOpened,
  GitWritten,
  GitRead,
  GitCommandResult,
  GitExported,
  GitRemoved,
  GitCheckpointed,
  GitReadAtRef,
  GitRefSnapshot,
  GitRefMoved,
  GitRepositoryStatus,
  GitRepositoryImported,
  GitObjectsImported,
  GitRefDeleted,
  GitCommitInspected,
  GitRefMerged,
  GitRefMergeConflict,
  GitShareInspected,
]);
export type GitWorkspaceResult = typeof GitWorkspaceResult.Type;

export class GitWorkerSuccess extends Schema.Class<GitWorkerSuccess>(
  "GitWorkerSuccess",
)({
  type: Schema.Literal("success"),
  id: RequestId,
  result: GitWorkspaceResult,
}) {}

export class GitWorkerFailure extends Schema.Class<GitWorkerFailure>(
  "GitWorkerFailure",
)({
  type: Schema.Literal("failure"),
  id: RequestId,
  error: GitWorkspaceFailureFrame,
}) {}

export const GitWorkerResponse = Schema.Union([
  GitWorkerSuccess,
  GitWorkerFailure,
]);
export type GitWorkerResponse = typeof GitWorkerResponse.Type;

export class GitWorkspaceDiagnosticResult extends Schema.Class<GitWorkspaceDiagnosticResult>(
  "GitWorkspaceDiagnosticResult",
)({
  variant: Schema.Literals(["pthreads", "jspi", "asyncify"]),
  initialCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  proposalCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  acceptedCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  reopenedCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  rollbackCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  conflictPaths: Schema.Array(RepositoryPath),
  diff: OutputText,
  status: OutputText,
}) {}

export class GitTransactionDiagnosticResult extends Schema.Class<GitTransactionDiagnosticResult>(
  "GitTransactionDiagnosticResult",
)({
  state: Schema.Literals(["success", "stale-ref", "failed"]),
  commit: Schema.optionalKey(GitObjectId),
  snapshotValue: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(1_024)),
  ),
  snapshotPaths: Schema.optionalKey(
    Schema.Array(RepositoryPath).check(Schema.isMaxLength(4_096)),
  ),
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
}) {}

export class GitShareImportDiagnosticResult extends Schema.Class<GitShareImportDiagnosticResult>(
  "GitShareImportDiagnosticResult",
)({
  descriptorCommit: GitObjectId,
  payloadCommit: GitObjectId,
  importedCommit: GitObjectId,
  fileCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 20_000 }),
  ),
  repositoryBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 32 * 1024 * 1024 }),
  ),
  manifestFound: Schema.Boolean,
  payloadFound: Schema.Boolean,
}) {}

export class GitShareLifecycleDiagnosticResult extends Schema.Class<GitShareLifecycleDiagnosticResult>(
  "GitShareLifecycleDiagnosticResult",
)({
  baseCommit: GitObjectId,
  forkCommit: GitObjectId,
  upstreamCommit: GitObjectId,
  mergedCommit: GitObjectId,
  mergeParents: Schema.Tuple([GitObjectId, GitObjectId]),
  conflictPaths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(100)),
  candidateRemoved: Schema.Boolean,
  forkRemoved: Schema.Boolean,
  unrelatedPreserved: Schema.Boolean,
}) {}
