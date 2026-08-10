import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import {
  GitCheckpointed,
  GitCommandResult,
  GitExported,
  GitOpened,
  GitRead,
  GitReadAtRef,
  GitRefMoved,
  GitRefSnapshot,
  GitRemoved,
  GitRepositoryStatus,
  GitWorkspaceFailure,
  GitWritten,
} from "../../shared/git-workspace";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import {
  InterfaceRevision,
  RevisionId,
  ShapingEvent,
  ShapingSnapshot,
} from "../../shared/revisions";
import { GitWorkspace, type GitWorkspaceShape } from "../git/git-workspace";
import {
  GitActivationReceipt,
  makeGitInterfaceRepositoryLayer,
} from "./git-interface-repository";
import { InterfaceRepository } from "./interface-repository";
import { InterfaceStorage } from "./interface-store";

const proposal = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("revision-1"),
  parentId: RevisionId.make("built-in"),
  status: "previewed",
  source: "shaper",
  document: InterfaceDocument.make({
    ...defaultInterfaceDocument,
    name: "Git candidate",
  }),
  createdAt: 1,
});

const proposalSnapshot = ShapingSnapshot.make({
  version: 1,
  active: InterfaceRevision.make({
    version: 1,
    id: RevisionId.make("built-in"),
    status: "accepted",
    source: "built-in",
    document: defaultInterfaceDocument,
    createdAt: 0,
  }),
  lastKnownGood: InterfaceRevision.make({
    version: 1,
    id: RevisionId.make("built-in"),
    status: "accepted",
    source: "built-in",
    document: defaultInterfaceDocument,
    createdAt: 0,
  }),
  proposal,
  safeMode: false,
  disabledExtensions: [],
  lastEvent: ShapingEvent.make({
    version: 1,
    sequence: 2,
    type: "revision-previewed",
    revisionId: proposal.id,
  }),
});

const acceptedSnapshot = ShapingSnapshot.make({
  version: 1,
  active: InterfaceRevision.make({
    ...proposal,
    status: "accepted",
    createdAt: 2,
  }),
  lastKnownGood: proposalSnapshot.active,
  safeMode: false,
  disabledExtensions: [],
  lastEvent: ShapingEvent.make({
    version: 1,
    sequence: 3,
    type: "revision-accepted",
    revisionId: proposal.id,
  }),
});

const makeStorage = () => {
  const values = Ref.makeUnsafe(new Map<string, string>());
  return {
    values,
    layer: Layer.succeed(InterfaceStorage)({
      read: (key) =>
        Ref.get(values).pipe(Effect.map((items) => items.get(key) ?? null)),
      write: (key, value) =>
        Ref.update(values, (items) => new Map(items).set(key, value)),
      remove: (key) =>
        Ref.update(values, (items) => {
          const next = new Map(items);
          next.delete(key);
          return next;
        }),
    }),
  };
};

const makeGit = () => {
  const commands = Ref.makeUnsafe<Array<ReadonlyArray<string>>>([]);
  const checkpoints = Ref.makeUnsafe<
    Array<{
      readonly branch: string;
      readonly expectedCommit?: string;
      readonly baseCommit?: string;
    }>
  >([]);
  const branches = new Map<string, Map<string, Uint8Array>>([
    ["master", new Map()],
  ]);
  const heads = new Map<string, string>();
  let current = "master";
  let commits = 0;
  const commandResult = (stdout = "") =>
    GitCommandResult.make({
      type: "command",
      exitCode: 0,
      stdout,
      stderr: "",
    });
  const service: GitWorkspaceShape = {
    open: () =>
      Effect.succeed(
        GitOpened.make({ type: "opened", variant: "asyncify", existed: false }),
      ),
    write: (path, contents) =>
      Effect.sync(() => {
        branches.get(current)?.set(path, contents.slice());
        return GitWritten.make({
          type: "written",
          path,
          bytes: contents.byteLength,
        });
      }),
    read: (path) => {
      const contents = branches.get(current)?.get(path);
      return contents === undefined
        ? Effect.fail(
            GitWorkspaceFailure.make({
              operation: "read",
              reason: "corrupt",
              message: "Missing test file.",
            }),
          )
        : Effect.succeed(GitRead.make({ type: "read", path, contents }));
    },
    run: (args) =>
      Ref.update(commands, (items) => [...items, args]).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const [command, first, second] = args;
            if (
              command === "checkout" &&
              first === "-b" &&
              second !== undefined
            ) {
              const source = branches.get(current) ?? new Map();
              branches.set(
                second,
                new Map(
                  [...source].map(([path, contents]) => [
                    path,
                    contents.slice(),
                  ]),
                ),
              );
              const head = heads.get(current);
              if (head !== undefined) {
                heads.set(second, head);
              }
              current = second;
              return commandResult();
            }
            if (command === "checkout" && first !== undefined) {
              current = first;
              return commandResult();
            }
            if (command === "commit") {
              commits += 1;
              heads.set(current, commits.toString(16).padStart(40, "0"));
              return commandResult();
            }
            if (command === "rev-parse") {
              const ref =
                first === undefined || first === "HEAD" ? current : first;
              return commandResult(`${heads.get(ref) ?? ""}\n`);
            }
            return commandResult();
          }),
        ),
      ),
    exportRepository: Effect.succeed(
      GitExported.make({
        type: "exported",
        archive: new Uint8Array([1]),
        fileCount: 1,
      }),
    ),
    remove: Effect.succeed(GitRemoved.make({ type: "removed" })),
    checkpoint: (options) =>
      Ref.update(checkpoints, (items) => [
        ...items,
        {
          branch: options.branch,
          ...(options.expectedCommit === undefined
            ? {}
            : { expectedCommit: options.expectedCommit }),
          ...(options.baseCommit === undefined
            ? {}
            : { baseCommit: options.baseCommit }),
        },
      ]).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            for (const guard of options.guards ?? []) {
              if (heads.get(guard.branch) !== guard.commit) {
                return Effect.fail(
                  GitWorkspaceFailure.make({
                    operation: "checkpoint",
                    reason: "stale-ref",
                    message: "Protected branch changed.",
                  }),
                );
              }
            }
            const actual = heads.get(options.branch);
            if (
              (options.expectedCommit !== undefined &&
                actual !== options.expectedCommit) ||
              (options.expectedCommit === undefined &&
                options.baseCommit !== undefined &&
                actual !== undefined &&
                actual !== options.baseCommit)
            ) {
              return Effect.fail(
                GitWorkspaceFailure.make({
                  operation: "checkpoint",
                  reason: "stale-ref",
                  message: "Target branch changed.",
                }),
              );
            }
            const sourceBranch =
              options.baseCommit === undefined
                ? undefined
                : [...heads].find(
                    ([, commit]) => commit === options.baseCommit,
                  )?.[0];
            const files = new Map(
              branches.get(options.branch) ??
                (sourceBranch === undefined
                  ? []
                  : (branches.get(sourceBranch) ?? new Map())),
            );
            for (const file of options.files) {
              files.set(file.path, file.contents.slice());
            }
            for (const path of options.removals ?? []) {
              files.delete(path);
            }
            branches.set(options.branch, files);
            commits += 1;
            const commit = commits.toString(16).padStart(40, "0");
            heads.set(options.branch, commit);
            current = options.branch;
            return Effect.succeed(
              GitCheckpointed.make({
                type: "checkpointed",
                branch: options.branch,
                commit,
              }),
            );
          }),
        ),
      ),
    readAtRef: (options) =>
      Effect.suspend(() => {
        for (const guard of options.guards ?? []) {
          if (heads.get(guard.branch) !== guard.commit) {
            return Effect.fail(
              GitWorkspaceFailure.make({
                operation: "read-at-ref",
                reason: "stale-ref",
                message: "Protected branch changed.",
              }),
            );
          }
        }
        if (heads.get(options.branch) !== options.expectedCommit) {
          return Effect.fail(
            GitWorkspaceFailure.make({
              operation: "read-at-ref",
              reason: "stale-ref",
              message: "Target branch changed.",
            }),
          );
        }
        const branch = branches.get(options.branch) ?? new Map();
        const files = options.paths.flatMap((path) => {
          const contents = branch.get(path);
          return contents === undefined ? [] : [{ path, contents }];
        });
        if (files.length !== options.paths.length) {
          return Effect.fail(
            GitWorkspaceFailure.make({
              operation: "read-at-ref",
              reason: "corrupt",
              message: "A requested protected file is missing.",
            }),
          );
        }
        return Effect.succeed(
          GitReadAtRef.make({
            type: "read-at-ref",
            branch: options.branch,
            commit: options.expectedCommit,
            files,
          }),
        );
      }),
    snapshotRef: (options) =>
      Effect.suspend(() => {
        if (
          heads.get(options.branch) !== options.expectedCommit ||
          (options.guards ?? []).some(
            (guard) => heads.get(guard.branch) !== guard.commit,
          )
        ) {
          return Effect.fail(
            GitWorkspaceFailure.make({
              operation: "snapshot-ref",
              reason: "stale-ref",
              message: "Protected branch changed.",
            }),
          );
        }
        return Effect.succeed(
          GitRefSnapshot.make({
            type: "ref-snapshot",
            branch: options.branch,
            commit: options.expectedCommit,
            files: [...(branches.get(options.branch) ?? new Map())].map(
              ([path, contents]) => ({ path, contents }),
            ),
          }),
        );
      }),
    moveRef: (options) =>
      Effect.suspend(() => {
        for (const guard of options.guards ?? []) {
          if (heads.get(guard.branch) !== guard.commit) {
            return Effect.fail(
              GitWorkspaceFailure.make({
                operation: "move-ref",
                reason: "stale-ref",
                message: "Protected branch changed.",
              }),
            );
          }
        }
        const actual = heads.get(options.branch);
        if (
          (options.expectedCommit === undefined && actual !== undefined) ||
          (options.expectedCommit !== undefined &&
            actual !== options.expectedCommit)
        ) {
          return Effect.fail(
            GitWorkspaceFailure.make({
              operation: "move-ref",
              reason: "stale-ref",
              message: "Target branch changed.",
            }),
          );
        }
        heads.set(options.branch, options.targetCommit);
        const sourceBranch = [...heads].find(
          ([branch, commit]) =>
            branch !== options.branch && commit === options.targetCommit,
        )?.[0];
        branches.set(
          options.branch,
          new Map(
            sourceBranch === undefined
              ? []
              : (branches.get(sourceBranch) ?? new Map()),
          ),
        );
        return Effect.succeed(
          GitRefMoved.make({
            type: "ref-moved",
            branch: options.branch,
            commit: options.targetCommit,
          }),
        );
      }),
    status: (options = {}) =>
      Effect.succeed(
        GitRepositoryStatus.make({
          type: "status",
          ...(heads.get("flect/accepted") === undefined
            ? {}
            : { acceptedCommit: heads.get("flect/accepted") }),
          ...(heads.get("flect/last-known-good") === undefined
            ? {}
            : { lastKnownGoodCommit: heads.get("flect/last-known-good") }),
          ...(options.proposalBranch === undefined
            ? {}
            : { proposalBranch: options.proposalBranch }),
          ...(options.proposalBranch === undefined ||
          heads.get(options.proposalBranch) === undefined
            ? {}
            : { proposalCommit: heads.get(options.proposalBranch) }),
          ...(heads.get("flect/authoring") === undefined
            ? {}
            : { authoringCommit: heads.get("flect/authoring") }),
          dirty: false,
          conflictPaths: [],
        }),
      ),
    importRepository: () => Effect.die("unused"),
    importObjects: () => Effect.die("unused"),
    deleteRef: () => Effect.die("unused"),
    inspectCommit: () => Effect.die("unused"),
    mergeRef: () => Effect.die("unused"),
    inspectShare: () => Effect.die("unused"),
  };
  return { branches, checkpoints, commands, heads, service };
};

describe("GitInterfaceRepository", () => {
  it.effect(
    "carries guarded authoring source through proposal and acceptance",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const layer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(git.service),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          yield* repository.load;
          const acceptedCommit = git.heads.get("flect/accepted");
          assert.isDefined(acceptedCommit);
          git.branches
            .get("flect/accepted")
            ?.set("src/obsolete.ts", new TextEncoder().encode("old\n"));
          git.heads.set("flect/authoring", "e".repeat(40));
          git.branches.set(
            "flect/authoring",
            new Map(git.branches.get("flect/accepted")),
          );
          git.branches
            .get("flect/authoring")
            ?.set("src/shaped.ts", new TextEncoder().encode("export {};\n"));
          git.branches.get("flect/authoring")?.delete("src/obsolete.ts");

          yield* repository.save(proposalSnapshot);
          assert.strictEqual(
            new TextDecoder().decode(
              git.branches
                .get("flect/proposal/revision-1")
                ?.get("src/shaped.ts"),
            ),
            "export {};\n",
          );
          assert.isFalse(
            git.branches
              .get("flect/proposal/revision-1")
              ?.has("src/obsolete.ts") ?? true,
          );

          yield* repository.save(acceptedSnapshot);
          assert.strictEqual(
            new TextDecoder().decode(
              git.branches.get("flect/accepted")?.get("src/shaped.ts"),
            ),
            "export {};\n",
          );
          assert.isFalse(
            git.branches.get("flect/accepted")?.has("src/obsolete.ts") ?? true,
          );
          assert.strictEqual(
            git.heads.get("flect/authoring"),
            git.heads.get("flect/accepted"),
          );
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("carries authoring source through an atomic local acceptance", () =>
    Effect.gen(function* () {
      const storage = makeStorage();
      const git = makeGit();
      const layer = makeGitInterfaceRepositoryLayer({
        safeMode: false,
        workspaceId: "default",
      }).pipe(
        Layer.provide(
          Layer.merge(storage.layer, Layer.succeed(GitWorkspace)(git.service)),
        ),
      );

      yield* Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        yield* repository.load;
        git.heads.set("flect/authoring", "e".repeat(40));
        git.branches.set(
          "flect/authoring",
          new Map(git.branches.get("flect/accepted")),
        );
        git.branches
          .get("flect/authoring")
          ?.set("src/shaped.ts", new TextEncoder().encode("export {};\n"));

        yield* repository.save(acceptedSnapshot);

        assert.strictEqual(
          new TextDecoder().decode(
            git.branches.get("flect/accepted")?.get("src/shaped.ts"),
          ),
          "export {};\n",
        );
        assert.strictEqual(
          git.heads.get("flect/authoring"),
          git.heads.get("flect/accepted"),
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "keeps the accepted commit protected while a proposal branch advances",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const layer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(git.service),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const initial = yield* repository.load;
          assert.strictEqual(initial.snapshot?.active.id, "built-in");
          assert.strictEqual(initial.recovered, false);
          yield* repository.save(proposalSnapshot);
        }).pipe(Effect.provide(layer));

        const values = yield* Ref.get(storage.values);
        const receipt = yield* Schema.decodeUnknownEffect(GitActivationReceipt)(
          JSON.parse(values.get("flect.git-activation.v1") ?? "{}"),
        );
        assert.match(receipt.acceptedCommit, /^[0-9a-f]{40}$/);
        assert.match(receipt.proposal?.commit ?? "", /^[0-9a-f]{40}$/);
        assert.notStrictEqual(receipt.acceptedCommit, receipt.proposal?.commit);
        assert.strictEqual(
          receipt.proposal?.branch,
          "flect/proposal/revision-1",
        );

        const checkpoints = yield* Ref.get(git.checkpoints);
        assert.deepStrictEqual(checkpoints, [
          { branch: "flect/accepted" },
          {
            branch: "flect/proposal/revision-1",
            baseCommit: receipt.acceptedCommit,
          },
        ]);
      }),
  );

  it.effect("fails closed when a protected ref changes between saves", () =>
    Effect.gen(function* () {
      const storage = makeStorage();
      const git = makeGit();
      const layer = makeGitInterfaceRepositoryLayer({
        safeMode: false,
        workspaceId: "default",
      }).pipe(
        Layer.provide(
          Layer.merge(storage.layer, Layer.succeed(GitWorkspace)(git.service)),
        ),
      );

      yield* Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        yield* repository.load;
        yield* repository.save(proposalSnapshot);
        git.heads.set("flect/accepted", "f".repeat(40));
        const error = yield* repository
          .save(proposalSnapshot)
          .pipe(Effect.flip);
        assert.strictEqual(error.message, "Interface storage is unavailable.");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "repairs missing activation metadata from protected refs before safe-mode restore",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const dependencies = Layer.merge(
          storage.layer,
          Layer.succeed(GitWorkspace)(git.service),
        );
        const initialLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(Layer.provide(dependencies));

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          yield* repository.load;
        }).pipe(Effect.provide(initialLayer));
        yield* Ref.update(storage.values, (items) => {
          const next = new Map(items);
          next.delete("flect.git-activation.v1");
          return next;
        });

        const reopenedGit: GitWorkspaceShape = {
          ...git.service,
          open: () =>
            Effect.succeed(
              GitOpened.make({
                type: "opened",
                variant: "asyncify",
                existed: true,
              }),
            ),
        };
        const recoveredLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const recovered = yield* repository.load;
          assert.strictEqual(recovered.recovered, true);
          assert.strictEqual(recovered.snapshot?.safeMode, true);
          assert.strictEqual(recovered.snapshot?.lastKnownGood.id, "built-in");

          const snapshot = recovered.snapshot;
          assert.isDefined(snapshot);
          const restored = ShapingSnapshot.make({
            ...snapshot,
            active: snapshot.lastKnownGood,
            safeMode: false,
            lastEvent: ShapingEvent.make({
              version: 1,
              sequence: snapshot.lastEvent.sequence + 1,
              type: "revision-rolled-back",
              revisionId: snapshot.lastKnownGood.id,
            }),
          });
          yield* repository.save(restored);
        }).pipe(Effect.provide(recoveredLayer));

        const values = yield* Ref.get(storage.values);
        const receipt = yield* Schema.decodeUnknownEffect(GitActivationReceipt)(
          JSON.parse(values.get("flect.git-activation.v1") ?? "{}"),
        );
        assert.strictEqual(
          receipt.acceptedCommit,
          git.heads.get("flect/accepted"),
        );
        assert.strictEqual(
          receipt.lastKnownGoodCommit,
          git.heads.get("flect/last-known-good"),
        );
      }),
  );

  it.effect(
    "repairs an existing legacy ref set when recovery metadata cannot be read",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const dependencies = Layer.merge(
          storage.layer,
          Layer.succeed(GitWorkspace)(git.service),
        );
        const initialLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(Layer.provide(dependencies));

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          yield* repository.load;
        }).pipe(Effect.provide(initialLayer));
        yield* Ref.update(storage.values, (items) => {
          const next = new Map(items);
          next.delete("flect.git-activation.v1");
          return next;
        });
        git.branches.get("flect/accepted")?.delete(".flect/snapshot.json");
        git.branches
          .get("flect/last-known-good")
          ?.delete(".flect/snapshot.json");

        const reopenedGit: GitWorkspaceShape = {
          ...git.service,
          open: () =>
            Effect.succeed(
              GitOpened.make({
                type: "opened",
                variant: "asyncify",
                existed: true,
              }),
            ),
        };
        const recoveredLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const recovered = yield* repository.load;
          assert.strictEqual(recovered.recovered, true);
          assert.strictEqual(recovered.snapshot, undefined);
          const fallback = ShapingSnapshot.make({
            version: 1,
            active: proposalSnapshot.lastKnownGood,
            lastKnownGood: proposalSnapshot.lastKnownGood,
            safeMode: false,
            disabledExtensions: proposalSnapshot.disabledExtensions,
            lastEvent: ShapingEvent.make({
              version: 1,
              sequence: proposalSnapshot.lastEvent.sequence + 1,
              type: "revision-rolled-back",
              revisionId: proposalSnapshot.lastKnownGood.id,
            }),
          });
          yield* repository.save(fallback);
        }).pipe(Effect.provide(recoveredLayer));

        assert.isDefined(
          git.branches.get("flect/accepted")?.get(".flect/snapshot.json"),
        );
        const values = yield* Ref.get(storage.values);
        yield* Schema.decodeUnknownEffect(GitActivationReceipt)(
          JSON.parse(values.get("flect.git-activation.v1") ?? "{}"),
        );
      }),
  );

  it.effect(
    "loads protected refs in a one-shot safe launcher and persists restoration",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const initialLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(git.service),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          yield* repository.load;
        }).pipe(Effect.provide(initialLayer));

        const reopenedGit: GitWorkspaceShape = {
          ...git.service,
          open: () =>
            Effect.succeed(
              GitOpened.make({
                type: "opened",
                variant: "asyncify",
                existed: true,
              }),
            ),
        };
        const safeLayer = makeGitInterfaceRepositoryLayer({
          safeMode: true,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const opened = yield* repository.load;
          assert.strictEqual(opened.snapshot?.safeMode, true);
          const snapshot = opened.snapshot;
          assert.isDefined(snapshot);
          const restoredRevision = InterfaceRevision.make({
            ...snapshot.lastKnownGood,
            source: "recovery",
            status: "accepted",
          });
          yield* repository.save(
            ShapingSnapshot.make({
              version: 1,
              active: restoredRevision,
              lastKnownGood: restoredRevision,
              safeMode: false,
              disabledExtensions: snapshot.disabledExtensions,
              lastEvent: ShapingEvent.make({
                version: 1,
                sequence: snapshot.lastEvent.sequence + 1,
                type: "revision-rolled-back",
                revisionId: restoredRevision.id,
              }),
            }),
          );
        }).pipe(Effect.provide(safeLayer));

        const normalLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const reopened = yield* repository.load;
          assert.strictEqual(reopened.recovered, false);
          assert.strictEqual(reopened.snapshot?.safeMode, false);
        }).pipe(Effect.provide(normalLayer));
      }),
  );

  it.effect("records safe mode without rewriting the accepted product", () =>
    Effect.gen(function* () {
      const storage = makeStorage();
      const git = makeGit();
      const layer = makeGitInterfaceRepositoryLayer({
        safeMode: false,
        workspaceId: "default",
      }).pipe(
        Layer.provide(
          Layer.merge(storage.layer, Layer.succeed(GitWorkspace)(git.service)),
        ),
      );

      yield* Effect.gen(function* () {
        const repository = yield* InterfaceRepository;
        const opened = yield* repository.load;
        const snapshot = opened.snapshot;
        assert.isDefined(snapshot);
        const before = yield* git.service.status();

        yield* repository.markRecovery ?? Effect.void;
        yield* repository.save(
          ShapingSnapshot.make({
            ...snapshot,
            safeMode: true,
            lastEvent: ShapingEvent.make({
              version: 1,
              sequence: snapshot.lastEvent.sequence + 1,
              type: "safe-mode-entered",
              revisionId: snapshot.active.id,
            }),
          }),
        );

        const after = yield* git.service.status({
          proposalBranch: "flect/shared/recovery",
        });
        assert.strictEqual(after.acceptedCommit, before.acceptedCommit);
        assert.notStrictEqual(after.proposalCommit, undefined);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "repairs an activation receipt that disagrees with protected proposal state",
    () =>
      Effect.gen(function* () {
        const storage = makeStorage();
        const git = makeGit();
        const dependencies = Layer.merge(
          storage.layer,
          Layer.succeed(GitWorkspace)(git.service),
        );
        const initialLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(Layer.provide(dependencies));

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          yield* repository.load;
        }).pipe(Effect.provide(initialLayer));

        const encodedProposal = new TextEncoder().encode(
          `${JSON.stringify(proposalSnapshot, null, 2)}\n`,
        );
        git.branches
          .get("flect/accepted")
          ?.set(".flect/snapshot.json", encodedProposal);
        git.branches
          .get("flect/last-known-good")
          ?.set(".flect/snapshot.json", encodedProposal);

        const reopenedGit: GitWorkspaceShape = {
          ...git.service,
          open: () =>
            Effect.succeed(
              GitOpened.make({
                type: "opened",
                variant: "asyncify",
                existed: true,
              }),
            ),
        };
        const safeLayer = makeGitInterfaceRepositoryLayer({
          safeMode: true,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const opened = yield* repository.load;
          assert.strictEqual(opened.recovered, true);
          assert.strictEqual(opened.snapshot?.safeMode, true);
          assert.strictEqual(opened.snapshot?.lastKnownGood.id, "built-in");
          assert.strictEqual(opened.snapshot?.proposal, undefined);

          const snapshot = opened.snapshot;
          assert.isDefined(snapshot);
          const restoredRevision = InterfaceRevision.make({
            ...snapshot.lastKnownGood,
            source: "recovery",
            status: "accepted",
          });
          yield* repository.save(
            ShapingSnapshot.make({
              version: 1,
              active: restoredRevision,
              lastKnownGood: restoredRevision,
              safeMode: false,
              disabledExtensions: snapshot.disabledExtensions,
              lastEvent: ShapingEvent.make({
                version: 1,
                sequence: snapshot.lastEvent.sequence + 1,
                type: "revision-rolled-back",
                revisionId: restoredRevision.id,
              }),
            }),
          );
        }).pipe(Effect.provide(safeLayer));

        const normalLayer = makeGitInterfaceRepositoryLayer({
          safeMode: false,
          workspaceId: "default",
        }).pipe(
          Layer.provide(
            Layer.merge(
              storage.layer,
              Layer.succeed(GitWorkspace)(reopenedGit),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const repository = yield* InterfaceRepository;
          const reopened = yield* repository.load;
          assert.strictEqual(reopened.recovered, false);
          assert.strictEqual(reopened.snapshot?.safeMode, false);
          assert.strictEqual(reopened.snapshot?.active.id, "built-in");
          assert.strictEqual(reopened.snapshot?.proposal, undefined);
        }).pipe(Effect.provide(normalLayer));
      }),
  );
});
