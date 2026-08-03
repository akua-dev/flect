import {
  Context,
  type Duration,
  Effect,
  Layer,
  Option,
  Schema,
  type SchemaAST,
  Semaphore,
} from "effect";
import {
  type GitCheckpointed,
  GitCheckpointRequest,
  type GitCommandResult,
  type GitCommitInspected,
  GitDeleteRefRequest,
  type GitExported,
  GitExportRefRequest,
  GitExportRequest,
  GitImportObjectsRequest,
  GitImportRepositoryRequest,
  GitInspectCommitRequest,
  GitInspectShareRequest,
  GitMergeRefRequest,
  GitMoveRefRequest,
  type GitObjectsImported,
  type GitOpened,
  GitOpenRequest,
  type GitRead,
  type GitReadAtRef,
  GitReadAtRefRequest,
  GitReadRequest,
  type GitRefDeleted,
  type GitRefMergeConflict,
  type GitRefMerged,
  type GitRefMoved,
  type GitRefSnapshot,
  type GitRemoved,
  GitRemoveRequest,
  type GitRepositoryImported,
  type GitRepositoryStatus,
  GitRunRequest,
  type GitShareInspected,
  GitSnapshotRefRequest,
  GitStatusRequest,
  GitWorkerRequest,
  GitWorkerResponse,
  GitWorkspaceFailure,
  type GitWorkspaceOperation,
  type GitWorkspaceResult,
  GitWriteRequest,
  type GitWritten,
} from "../../shared/git-workspace";

export type GitWorkspaceWorker = Pick<
  Worker,
  "addEventListener" | "removeEventListener" | "postMessage" | "terminate"
>;

export interface GitWorkspaceLockManager {
  readonly request: <A>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<A>,
  ) => Promise<Awaited<A>>;
}

export interface GitWorkspaceShape {
  readonly open: (options: {
    readonly workspaceId: string;
    readonly reset?: boolean;
  }) => Effect.Effect<GitOpened, GitWorkspaceFailure>;
  readonly write: (
    path: string,
    contents: Uint8Array,
  ) => Effect.Effect<GitWritten, GitWorkspaceFailure>;
  readonly read: (path: string) => Effect.Effect<GitRead, GitWorkspaceFailure>;
  readonly run: (
    args: ReadonlyArray<string>,
  ) => Effect.Effect<GitCommandResult, GitWorkspaceFailure>;
  readonly exportRepository: Effect.Effect<GitExported, GitWorkspaceFailure>;
  readonly exportRef?: (options: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitExported, GitWorkspaceFailure>;
  readonly remove: Effect.Effect<GitRemoved, GitWorkspaceFailure>;
  readonly checkpoint: (options: {
    readonly branch: string;
    readonly expectedCommit?: string;
    readonly baseCommit?: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>;
    readonly removals?: ReadonlyArray<string>;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
    readonly message: string;
  }) => Effect.Effect<GitCheckpointed, GitWorkspaceFailure>;
  readonly readAtRef: (options: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly paths: ReadonlyArray<string>;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitReadAtRef, GitWorkspaceFailure>;
  readonly moveRef: (options: {
    readonly branch: string;
    readonly expectedCommit?: string;
    readonly targetCommit: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitRefMoved, GitWorkspaceFailure>;
  readonly snapshotRef: (options: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitRefSnapshot, GitWorkspaceFailure>;
  readonly status: (options?: {
    readonly proposalBranch?: string;
  }) => Effect.Effect<GitRepositoryStatus, GitWorkspaceFailure>;
  readonly importRepository: (options: {
    readonly archive: Uint8Array;
    readonly commit: string;
  }) => Effect.Effect<GitRepositoryImported, GitWorkspaceFailure>;
  readonly importObjects: (options: {
    readonly archive: Uint8Array;
    readonly commit: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitObjectsImported, GitWorkspaceFailure>;
  readonly deleteRef: (options: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<GitRefDeleted, GitWorkspaceFailure>;
  readonly inspectCommit: (
    commit: string,
  ) => Effect.Effect<GitCommitInspected, GitWorkspaceFailure>;
  readonly mergeRef: (options: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly upstreamBranch: string;
    readonly expectedUpstreamCommit: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>;
    readonly conflictPaths?: ReadonlyArray<string>;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
    readonly message: string;
  }) => Effect.Effect<GitRefMerged | GitRefMergeConflict, GitWorkspaceFailure>;
  readonly inspectShare: (options: {
    readonly commit: string;
    readonly url?: string;
    readonly manifestRequired: boolean;
  }) => Effect.Effect<GitShareInspected, GitWorkspaceFailure>;
}

export class GitWorkspace extends Context.Service<
  GitWorkspace,
  GitWorkspaceShape
>()("flect/GitWorkspace") {}

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const decodeResponse = Schema.decodeUnknownEffect(
  GitWorkerResponse,
  strictOptions,
);

const failure = (
  operation: GitWorkspaceFailure["operation"],
  reason: GitWorkspaceFailure["reason"],
  message: string,
) => GitWorkspaceFailure.make({ operation, reason, message });

const operationName = (
  operation: GitWorkspaceOperation,
): GitWorkspaceFailure["operation"] => operation.type;

const withCrossContextLock = <A>(
  locks: GitWorkspaceLockManager | undefined,
  lockName: string,
  operation: GitWorkspaceOperation,
  effect: Effect.Effect<A, GitWorkspaceFailure>,
) => {
  if (locks === undefined) {
    return Effect.fail(
      failure(
        operationName(operation),
        "unsupported",
        "This browser does not provide the lock required for safe Git workspace access.",
      ),
    );
  }
  return Effect.tryPromise({
    try: (signal) =>
      locks.request(lockName, { mode: "exclusive", signal }, () =>
        Effect.runPromise(effect, { signal }),
      ),
    catch: (error) =>
      Schema.is(GitWorkspaceFailure)(error)
        ? error
        : failure(
            operationName(operation),
            "interrupted",
            "The embedded Git workspace lock was interrupted.",
          ),
  });
};

const makeWorkerRequest = (
  worker: GitWorkspaceWorker,
  operation: GitWorkspaceOperation,
  onInterrupt: () => void,
): Effect.Effect<GitWorkspaceResult, GitWorkspaceFailure> =>
  Effect.callback<GitWorkspaceResult, GitWorkspaceFailure>((resume) => {
    const id = `request-${crypto.randomUUID().replaceAll("-", "")}`;
    let completed = false;
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const settle = (
      effect: Effect.Effect<GitWorkspaceResult, GitWorkspaceFailure>,
    ) => {
      if (completed) {
        return;
      }
      completed = true;
      cleanup();
      resume(effect);
    };
    const onError = () => {
      settle(
        Effect.fail(
          failure(
            operationName(operation),
            "worker",
            "The embedded Git Worker failed safely.",
          ),
        ),
      );
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      void Effect.runPromise(decodeResponse(event.data))
        .then((response) => {
          if (response.id !== id) {
            return;
          }
          settle(
            response.type === "success"
              ? Effect.succeed(response.result)
              : Effect.fail(GitWorkspaceFailure.make(response.error)),
          );
        })
        .catch(() => {
          settle(
            Effect.fail(
              failure(
                operationName(operation),
                "invalid-result",
                "The embedded Git Worker returned an invalid result.",
              ),
            ),
          );
        });
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    try {
      worker.postMessage(GitWorkerRequest.make({ version: 1, id, operation }));
    } catch {
      settle(
        Effect.fail(
          failure(
            operationName(operation),
            "worker",
            "The embedded Git request could not be sent.",
          ),
        ),
      );
    }
    return Effect.sync(() => {
      cleanup();
      worker.terminate();
      onInterrupt();
    });
  });

const unexpectedResult = (operation: GitWorkspaceFailure["operation"]) =>
  Effect.fail(
    failure(
      operation,
      "invalid-result",
      "The embedded Git Worker returned an unexpected result.",
    ),
  );

export const makeGitWorkspace = (options?: {
  readonly defaultWorkspaceId?: string;
  readonly deadline?: Duration.Input;
  readonly lockManager?: GitWorkspaceLockManager;
  readonly makeWorker?: () => GitWorkspaceWorker;
}) =>
  Effect.gen(function* () {
    const makeWorker =
      options?.makeWorker ??
      (() =>
        new Worker(new URL("./git-workspace-worker.ts", import.meta.url), {
          type: "module",
          name: "flect-git-workspace",
        }));
    const liveWorkers = new Set<GitWorkspaceWorker>();
    let activeWorker: GitWorkspaceWorker | undefined;
    yield* Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        for (const worker of liveWorkers) {
          worker.terminate();
        }
        liveWorkers.clear();
        activeWorker = undefined;
      }),
    );
    const createWorker = (operation: GitWorkspaceOperation) =>
      Effect.try({
        try: () => {
          const worker = makeWorker();
          liveWorkers.add(worker);
          activeWorker = worker;
          return worker;
        },
        catch: () =>
          failure(
            operationName(operation),
            "worker",
            "The embedded Git Worker could not start.",
          ),
      });
    activeWorker = Option.getOrUndefined(
      yield* createWorker(
        GitOpenRequest.make({
          type: "open",
          workspaceId: options?.defaultWorkspaceId ?? "default",
          reset: false,
        }),
      ).pipe(Effect.option),
    );
    const semaphore = yield* Semaphore.make(1);
    let activeWorkspaceId: string | undefined;
    let workerWorkspaceId: string | undefined;
    const locks = options?.lockManager ?? globalThis.navigator?.locks;
    const invalidateWorkerSync = (worker: GitWorkspaceWorker) => {
      worker.terminate();
      liveWorkers.delete(worker);
      if (activeWorker === worker) {
        activeWorker = undefined;
      }
      workerWorkspaceId = undefined;
    };
    const invalidateWorker = (worker: GitWorkspaceWorker) =>
      Effect.sync(() => invalidateWorkerSync(worker));
    const request = Effect.fn("Flect.GitWorkspace.request")(
      (operation: GitWorkspaceOperation) =>
        Effect.gen(function* () {
          const worker = activeWorker ?? (yield* createWorker(operation));
          const lockName = `flect-git-${
            operation.type === "open"
              ? operation.workspaceId
              : (activeWorkspaceId ?? "unopened")
          }`;
          const operationEffect = Effect.gen(function* () {
            const workspaceId = activeWorkspaceId;
            if (
              operation.type !== "open" &&
              workspaceId !== undefined &&
              workerWorkspaceId !== workspaceId
            ) {
              const reopened = yield* makeWorkerRequest(
                worker,
                GitOpenRequest.make({
                  type: "open",
                  workspaceId,
                  reset: false,
                }),
                () => invalidateWorkerSync(worker),
              );
              if (reopened.type !== "opened") {
                return yield* unexpectedResult("open");
              }
              workerWorkspaceId = workspaceId;
            }
            const result = yield* makeWorkerRequest(worker, operation, () =>
              invalidateWorkerSync(worker),
            );
            if (operation.type === "open" && result.type === "opened") {
              workerWorkspaceId = operation.workspaceId;
            }
            return result;
          }).pipe(
            Effect.timeoutOrElse({
              duration: options?.deadline ?? "60 seconds",
              orElse: () =>
                Effect.fail(
                  failure(
                    operationName(operation),
                    "interrupted",
                    "The embedded Git operation exceeded its deadline.",
                  ),
                ),
            }),
            Effect.tapError((error) =>
              error.reason === "interrupted" || error.reason === "worker"
                ? invalidateWorker(worker)
                : Effect.void,
            ),
          );
          return yield* semaphore.withPermits(1)(
            withCrossContextLock(locks, lockName, operation, operationEffect),
          );
        }),
    );

    return {
      open: Effect.fn("Flect.GitWorkspace.open")(({ workspaceId, reset }) => {
        const resolvedWorkspaceId =
          workspaceId === "default"
            ? (options?.defaultWorkspaceId ?? workspaceId)
            : workspaceId;
        return request(
          GitOpenRequest.make({
            type: "open",
            workspaceId: resolvedWorkspaceId,
            reset: reset ?? false,
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "opened"
              ? Effect.sync(() => {
                  activeWorkspaceId = resolvedWorkspaceId;
                  return result;
                })
              : unexpectedResult("open"),
          ),
        );
      }),
      write: Effect.fn("Flect.GitWorkspace.write")((path, contents) =>
        request(GitWriteRequest.make({ type: "write", path, contents })).pipe(
          Effect.flatMap((result) =>
            result.type === "written"
              ? Effect.succeed(result)
              : unexpectedResult("write"),
          ),
        ),
      ),
      read: Effect.fn("Flect.GitWorkspace.read")((path) =>
        request(GitReadRequest.make({ type: "read", path })).pipe(
          Effect.flatMap((result) =>
            result.type === "read"
              ? Effect.succeed(result)
              : unexpectedResult("read"),
          ),
        ),
      ),
      run: Effect.fn("Flect.GitWorkspace.run")((args) =>
        request(GitRunRequest.make({ type: "run", args: [...args] })).pipe(
          Effect.flatMap((result) =>
            result.type === "command"
              ? Effect.succeed(result)
              : unexpectedResult("run"),
          ),
        ),
      ),
      exportRepository: request(GitExportRequest.make({ type: "export" })).pipe(
        Effect.flatMap((result) =>
          result.type === "exported"
            ? Effect.succeed(result)
            : unexpectedResult("export"),
        ),
      ),
      exportRef: Effect.fn("Flect.GitWorkspace.exportRef")((options) =>
        request(
          GitExportRefRequest.make({
            type: "export-ref",
            branch: options.branch,
            expectedCommit: options.expectedCommit,
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "exported"
              ? Effect.succeed(result)
              : unexpectedResult("export-ref"),
          ),
        ),
      ),
      remove: request(GitRemoveRequest.make({ type: "remove" })).pipe(
        Effect.flatMap((result) =>
          result.type === "removed"
            ? Effect.succeed(result)
            : unexpectedResult("remove"),
        ),
      ),
      checkpoint: Effect.fn("Flect.GitWorkspace.checkpoint")((options) =>
        request(
          GitCheckpointRequest.make({
            type: "checkpoint",
            branch: options.branch,
            ...(options.expectedCommit === undefined
              ? {}
              : { expectedCommit: options.expectedCommit }),
            ...(options.baseCommit === undefined
              ? {}
              : { baseCommit: options.baseCommit }),
            files: options.files.map((file) => ({
              path: file.path,
              contents: file.contents,
            })),
            removals: [...(options.removals ?? [])],
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
            message: options.message,
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "checkpointed"
              ? Effect.succeed(result)
              : unexpectedResult("checkpoint"),
          ),
        ),
      ),
      readAtRef: Effect.fn("Flect.GitWorkspace.readAtRef")((options) =>
        request(
          GitReadAtRefRequest.make({
            type: "read-at-ref",
            branch: options.branch,
            expectedCommit: options.expectedCommit,
            paths: [...options.paths],
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "read-at-ref"
              ? Effect.succeed(result)
              : unexpectedResult("read-at-ref"),
          ),
        ),
      ),
      moveRef: Effect.fn("Flect.GitWorkspace.moveRef")((options) =>
        request(
          GitMoveRefRequest.make({
            type: "move-ref",
            branch: options.branch,
            ...(options.expectedCommit === undefined
              ? {}
              : { expectedCommit: options.expectedCommit }),
            targetCommit: options.targetCommit,
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "ref-moved"
              ? Effect.succeed(result)
              : unexpectedResult("move-ref"),
          ),
        ),
      ),
      snapshotRef: Effect.fn("Flect.GitWorkspace.snapshotRef")((options) =>
        request(
          GitSnapshotRefRequest.make({
            type: "snapshot-ref",
            branch: options.branch,
            expectedCommit: options.expectedCommit,
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "ref-snapshot"
              ? Effect.succeed(result)
              : unexpectedResult("snapshot-ref"),
          ),
        ),
      ),
      status: Effect.fn("Flect.GitWorkspace.status")((options = {}) =>
        request(
          GitStatusRequest.make({
            type: "status",
            ...(options.proposalBranch === undefined
              ? {}
              : { proposalBranch: options.proposalBranch }),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "status"
              ? Effect.succeed(result)
              : unexpectedResult("status"),
          ),
        ),
      ),
      importRepository: Effect.fn("Flect.GitWorkspace.importRepository")(
        (options) =>
          request(
            GitImportRepositoryRequest.make({
              type: "import-repository",
              archive: options.archive,
              commit: options.commit,
            }),
          ).pipe(
            Effect.flatMap((result) =>
              result.type === "repository-imported"
                ? Effect.succeed(result)
                : unexpectedResult("import-repository"),
            ),
          ),
      ),
      importObjects: Effect.fn("Flect.GitWorkspace.importObjects")((options) =>
        request(
          GitImportObjectsRequest.make({
            type: "import-objects",
            archive: options.archive,
            commit: options.commit,
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "objects-imported"
              ? Effect.succeed(result)
              : unexpectedResult("import-objects"),
          ),
        ),
      ),
      deleteRef: Effect.fn("Flect.GitWorkspace.deleteRef")((options) =>
        request(
          GitDeleteRefRequest.make({
            type: "delete-ref",
            branch: options.branch,
            expectedCommit: options.expectedCommit,
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "ref-deleted"
              ? Effect.succeed(result)
              : unexpectedResult("delete-ref"),
          ),
        ),
      ),
      inspectCommit: Effect.fn("Flect.GitWorkspace.inspectCommit")((commit) =>
        request(
          GitInspectCommitRequest.make({ type: "inspect-commit", commit }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "commit-inspected"
              ? Effect.succeed(result)
              : unexpectedResult("inspect-commit"),
          ),
        ),
      ),
      mergeRef: Effect.fn("Flect.GitWorkspace.mergeRef")((options) =>
        request(
          GitMergeRefRequest.make({
            type: "merge-ref",
            branch: options.branch,
            expectedCommit: options.expectedCommit,
            upstreamBranch: options.upstreamBranch,
            expectedUpstreamCommit: options.expectedUpstreamCommit,
            files: options.files,
            ...(options.conflictPaths === undefined
              ? {}
              : { conflictPaths: options.conflictPaths }),
            guards: (options.guards ?? []).map((guard) => ({ ...guard })),
            message: options.message,
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "ref-merged" || result.type === "ref-merge-conflict"
              ? Effect.succeed(result)
              : unexpectedResult("merge-ref"),
          ),
        ),
      ),
      inspectShare: Effect.fn("Flect.GitWorkspace.inspectShare")((options) =>
        request(
          GitInspectShareRequest.make({
            type: "inspect-share",
            commit: options.commit,
            manifestRequired: options.manifestRequired,
            ...(options.url === undefined ? {} : { url: options.url }),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.type === "share-inspected"
              ? Effect.succeed(result)
              : unexpectedResult("inspect-share"),
          ),
        ),
      ),
    } satisfies GitWorkspaceShape;
  });

export const makeGitWorkspaceLayer = (options?: {
  readonly defaultWorkspaceId?: string;
}) => Layer.effect(GitWorkspace, makeGitWorkspace(options));

export const GitWorkspaceLive = makeGitWorkspaceLayer();
