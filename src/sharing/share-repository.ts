import { Context, Effect, Layer, Schema } from "effect";
import type { GitWorkspaceFailure } from "../../shared/git-workspace";
import type { ShareInstallationRefs } from "../../shared/share-installation";
import { GitWorkspace, type GitWorkspaceShape } from "../git/git-workspace";

const ShareId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
);
const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(
    /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
  ),
);

export class ShareRepositoryRefs extends Schema.Class<ShareRepositoryRefs>(
  "ShareRepositoryRefs",
)({
  base: Schema.String,
  upstream: Schema.String,
  fork: Schema.String,
  candidate: Schema.String,
}) {}

export class ShareFastForwardUpdate extends Schema.TaggedClass<ShareFastForwardUpdate>()(
  "fast-forward",
  { upstream: ObjectId, fork: ObjectId, candidate: ObjectId },
) {}

export class ShareMergedUpdate extends Schema.TaggedClass<ShareMergedUpdate>()(
  "merged",
  {
    upstream: ObjectId,
    fork: ObjectId,
    candidate: ObjectId,
    parents: Schema.Tuple([ObjectId, ObjectId]),
  },
) {}

export class ShareConflictUpdate extends Schema.TaggedClass<ShareConflictUpdate>()(
  "conflict",
  {
    upstream: ObjectId,
    fork: ObjectId,
    conflictPaths: Schema.Array(Path).check(Schema.isMaxLength(100)),
  },
) {}

export class ShareReplacementUpdate extends Schema.TaggedClass<ShareReplacementUpdate>()(
  "replacement",
  { upstream: ObjectId, fork: ObjectId, candidate: ObjectId },
) {}

export const ShareUpdateResult = Schema.Union([
  ShareFastForwardUpdate,
  ShareMergedUpdate,
  ShareConflictUpdate,
  ShareReplacementUpdate,
]);
export type ShareUpdateResult = typeof ShareUpdateResult.Type;

export class ShareRepositoryFailure extends Schema.TaggedErrorClass<ShareRepositoryFailure>()(
  "ShareRepositoryFailure",
  {
    reason: Schema.Literals([
      "invalid-input",
      "repository",
      "stale-ref",
      "installed",
      "unavailable",
    ]),
    message: Schema.String,
  },
) {}

const failure = (reason: ShareRepositoryFailure["reason"]) =>
  ShareRepositoryFailure.make({
    reason,
    message:
      reason === "installed"
        ? "Remove the shared installation before deleting its local data."
        : "The shared Git history could not be updated safely.",
  });

const mapGitFailure = (error: GitWorkspaceFailure) =>
  ShareRepositoryFailure.make({
    reason: error.reason === "stale-ref" ? "stale-ref" : "repository",
    message: error.message,
  });

const sha256 = (value: string) =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    catch: () => failure("unavailable"),
  });

const sameBytes = (
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
) =>
  left === undefined
    ? right === undefined
    : right !== undefined &&
      left.byteLength === right.byteLength &&
      left.every((byte, index) => byte === right[index]);

const findThreeWayConflicts = (
  base: ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
  fork: ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
  upstream: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  const before = new Map(base.map((file) => [file.path, file.contents]));
  const personal = new Map(fork.map((file) => [file.path, file.contents]));
  const incoming = new Map(upstream.map((file) => [file.path, file.contents]));
  return [
    ...new Set([...before.keys(), ...personal.keys(), ...incoming.keys()]),
  ]
    .filter((path) => {
      const original = before.get(path);
      const personalized = personal.get(path);
      const updated = incoming.get(path);
      return (
        !sameBytes(original, personalized) &&
        !sameBytes(original, updated) &&
        !sameBytes(personalized, updated)
      );
    })
    .toSorted()
    .slice(0, 100);
};

const mergeThreeWayFiles = (
  base: ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
  fork: ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
  upstream: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  const before = new Map(base.map((file) => [file.path, file.contents]));
  const personal = new Map(fork.map((file) => [file.path, file.contents]));
  const incoming = new Map(upstream.map((file) => [file.path, file.contents]));
  return [
    ...new Set([...before.keys(), ...personal.keys(), ...incoming.keys()]),
  ]
    .toSorted()
    .flatMap((path) => {
      const original = before.get(path);
      const personalized = personal.get(path);
      const updated = incoming.get(path);
      const contents = sameBytes(personalized, original)
        ? updated
        : sameBytes(updated, original) || sameBytes(personalized, updated)
          ? personalized
          : undefined;
      return contents === undefined ? [] : [{ path, contents }];
    });
};

export const deriveShareRefs = Effect.fn("Flect.ShareRepository.refs")(
  function* (shareId: string) {
    yield* Schema.decodeUnknownEffect(ShareId)(shareId).pipe(
      Effect.mapError(() => failure("invalid-input")),
    );
    const key = yield* sha256(shareId);
    const root = `flect/shared/${key}`;
    return ShareRepositoryRefs.make({
      base: `${root}/base`,
      upstream: `${root}/upstream`,
      fork: `${root}/fork`,
      candidate: `${root}/candidate`,
    });
  },
);

export interface ShareRepositoryShape {
  readonly retain: (input: {
    readonly shareId: string;
    readonly archive: Uint8Array;
    readonly commit: string;
  }) => Effect.Effect<
    { readonly refs: Omit<ShareInstallationRefs, "candidate"> },
    ShareRepositoryFailure
  >;
  readonly prepareUpdate: (input: {
    readonly shareId: string;
    readonly archive: Uint8Array;
    readonly commit: string;
    readonly refs: Omit<ShareInstallationRefs, "candidate">;
  }) => Effect.Effect<ShareUpdateResult, ShareRepositoryFailure>;
  readonly resolveConflict: (input: {
    readonly shareId: string;
    readonly refs: Omit<ShareInstallationRefs, "candidate">;
    readonly conflictPaths: ReadonlyArray<string>;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>;
    readonly removals: ReadonlyArray<string>;
    readonly message: string;
  }) => Effect.Effect<ShareMergedUpdate, ShareRepositoryFailure>;
  readonly checkpointFork: (input: {
    readonly shareId: string;
    readonly expectedForkCommit: string;
    readonly refs: ShareInstallationRefs;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly contents: Uint8Array;
    }>;
    readonly removals: ReadonlyArray<string>;
    readonly message: string;
  }) => Effect.Effect<{ readonly fork: string }, ShareRepositoryFailure>;
  readonly restoreFork: (input: {
    readonly shareId: string;
    readonly expectedForkCommit: string;
    readonly targetForkCommit: string;
    readonly refs: Pick<ShareInstallationRefs, "base" | "upstream">;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
  readonly rejectCandidate: (input: {
    readonly shareId: string;
    readonly candidate: string;
    readonly refs: Omit<ShareInstallationRefs, "candidate">;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
  readonly restoreCandidateRef: (input: {
    readonly shareId: string;
    readonly candidate: string;
    readonly refs: Omit<ShareInstallationRefs, "candidate">;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
  readonly acceptCandidate: (input: {
    readonly shareId: string;
    readonly refs: ShareInstallationRefs & { readonly candidate: string };
  }) => Effect.Effect<
    { readonly refs: Omit<ShareInstallationRefs, "candidate"> },
    ShareRepositoryFailure
  >;
  readonly restoreCandidate: (input: {
    readonly shareId: string;
    readonly before: ShareInstallationRefs & { readonly candidate: string };
    readonly after: Omit<ShareInstallationRefs, "candidate">;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
  readonly snapshotArtifact: (input: {
    readonly shareId: string;
    readonly role: "base" | "upstream" | "fork" | "candidate";
    readonly expectedCommit: string;
    readonly sourceRoot: string;
    readonly guards?: ReadonlyArray<{
      readonly branch: string;
      readonly commit: string;
    }>;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
    ShareRepositoryFailure
  >;
  readonly exportFork: (input: {
    readonly shareId: string;
    readonly forkCommit: string;
  }) => Effect.Effect<Uint8Array, ShareRepositoryFailure>;
  readonly exportCandidate: (input: {
    readonly shareId: string;
    readonly candidateCommit: string;
    readonly refs: Pick<ShareInstallationRefs, "base" | "upstream" | "fork">;
  }) => Effect.Effect<Uint8Array, ShareRepositoryFailure>;
  readonly removeInstallation: (input: {
    readonly shareId: string;
    readonly refs: ShareInstallationRefs;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
  readonly deleteLocalData: (input: {
    readonly shareId: string;
    readonly forkCommit: string;
    readonly installed: boolean;
  }) => Effect.Effect<void, ShareRepositoryFailure>;
}

export class ShareRepository extends Context.Service<
  ShareRepository,
  ShareRepositoryShape
>()("flect/ShareRepository") {}

export const makeShareRepositoryLayer = (options?: {
  readonly workspaceId?: string;
}) =>
  Layer.effect(
    ShareRepository,
    Effect.gen(function* () {
      const git = yield* GitWorkspace;
      const open = git
        .open({ workspaceId: options?.workspaceId ?? "default" })
        .pipe(Effect.mapError(mapGitFailure));
      const move = (input: Parameters<GitWorkspaceShape["moveRef"]>[0]) =>
        git.moveRef(input).pipe(Effect.mapError(mapGitFailure));
      const removeRef = (
        input: Parameters<GitWorkspaceShape["deleteRef"]>[0],
      ) =>
        git
          .deleteRef(input)
          .pipe(Effect.mapError(mapGitFailure), Effect.asVoid);
      const run = (args: ReadonlyArray<string>) =>
        git.run(args).pipe(Effect.mapError(mapGitFailure));
      const requireCommand = Effect.fn("Flect.ShareRepository.command")(
        function* (args: ReadonlyArray<string>) {
          const result = yield* run(args);
          if (result.exitCode !== 0) {
            return yield* Effect.fail(failure("repository"));
          }
          return result;
        },
      );

      const retain = Effect.fn("Flect.ShareRepository.retain")(
        function* (input: {
          readonly shareId: string;
          readonly archive: Uint8Array;
          readonly commit: string;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          yield* git
            .importObjects({
              archive: input.archive,
              commit: input.commit,
              guards: [],
            })
            .pipe(Effect.mapError(mapGitFailure));
          yield* move({
            branch: names.base,
            targetCommit: input.commit,
            guards: [],
          });
          yield* move({
            branch: names.upstream,
            targetCommit: input.commit,
            guards: [{ branch: names.base, commit: input.commit }],
          });
          yield* move({
            branch: names.fork,
            targetCommit: input.commit,
            guards: [
              { branch: names.base, commit: input.commit },
              { branch: names.upstream, commit: input.commit },
            ],
          });
          return {
            refs: {
              base: input.commit,
              upstream: input.commit,
              fork: input.commit,
            },
          };
        },
      );

      const rejectCandidate = Effect.fn("Flect.ShareRepository.reject")(
        function* (input: {
          readonly shareId: string;
          readonly candidate: string;
          readonly refs: Omit<ShareInstallationRefs, "candidate">;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          yield* removeRef({
            branch: names.candidate,
            expectedCommit: input.candidate,
            guards: [
              { branch: names.base, commit: input.refs.base },
              { branch: names.upstream, commit: input.refs.upstream },
              { branch: names.fork, commit: input.refs.fork },
            ],
          });
        },
      );

      const restoreCandidateRef = Effect.fn(
        "Flect.ShareRepository.restoreCandidateRef",
      )(
        function* (input: {
          readonly shareId: string;
          readonly candidate: string;
          readonly refs: Omit<ShareInstallationRefs, "candidate">;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          yield* move({
            branch: names.candidate,
            targetCommit: input.candidate,
            guards: [
              { branch: names.base, commit: input.refs.base },
              { branch: names.upstream, commit: input.refs.upstream },
              { branch: names.fork, commit: input.refs.fork },
            ],
          });
        },
      );

      const restoreCandidate = Effect.fn("Flect.ShareRepository.restore")(
        function* (input: {
          readonly shareId: string;
          readonly before: ShareInstallationRefs & { readonly candidate: string };
          readonly after: Omit<ShareInstallationRefs, "candidate">;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          let candidateCreated = false;
          let forkRestored = false;
          let baseRestored = false;
          const rollback = Effect.gen(function* () {
            if (baseRestored) {
              yield* move({
                branch: names.base,
                expectedCommit: input.before.base,
                targetCommit: input.after.base,
                guards: [
                  { branch: names.upstream, commit: input.after.upstream },
                  { branch: names.fork, commit: input.before.fork },
                  { branch: names.candidate, commit: input.before.candidate },
                ],
              });
            }
            if (forkRestored) {
              yield* move({
                branch: names.fork,
                expectedCommit: input.before.fork,
                targetCommit: input.after.fork,
                guards: [
                  { branch: names.base, commit: input.after.base },
                  { branch: names.upstream, commit: input.after.upstream },
                  { branch: names.candidate, commit: input.before.candidate },
                ],
              });
            }
            if (candidateCreated) {
              yield* removeRef({
                branch: names.candidate,
                expectedCommit: input.before.candidate,
                guards: [
                  { branch: names.base, commit: input.after.base },
                  { branch: names.upstream, commit: input.after.upstream },
                  { branch: names.fork, commit: input.after.fork },
                ],
              });
            }
          });
          const restored = Effect.gen(function* () {
            yield* move({
              branch: names.candidate,
              targetCommit: input.before.candidate,
              guards: [
                { branch: names.base, commit: input.after.base },
                { branch: names.upstream, commit: input.after.upstream },
                { branch: names.fork, commit: input.after.fork },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (candidateCreated = true))),
            );
            yield* move({
              branch: names.fork,
              expectedCommit: input.after.fork,
              targetCommit: input.before.fork,
              guards: [
                { branch: names.base, commit: input.after.base },
                { branch: names.upstream, commit: input.after.upstream },
                { branch: names.candidate, commit: input.before.candidate },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (forkRestored = true))),
            );
            yield* move({
              branch: names.base,
              expectedCommit: input.after.base,
              targetCommit: input.before.base,
              guards: [
                { branch: names.upstream, commit: input.before.upstream },
                { branch: names.fork, commit: input.before.fork },
                { branch: names.candidate, commit: input.before.candidate },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (baseRestored = true))),
            );
          });
          yield* restored.pipe(
            Effect.catch((error) =>
              rollback.pipe(Effect.andThen(Effect.fail(error))),
            ),
          );
        },
      );

      const acceptCandidate = Effect.fn("Flect.ShareRepository.accept")(
        function* (input: {
          readonly shareId: string;
          readonly refs: ShareInstallationRefs & {
            readonly candidate: string;
          };
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          let baseMoved = false;
          let forkMoved = false;
          let candidateRemoved = false;
          const rollback = Effect.gen(function* () {
            if (candidateRemoved) {
              yield* move({
                branch: names.candidate,
                targetCommit: input.refs.candidate,
                guards: [
                  { branch: names.base, commit: input.refs.upstream },
                  { branch: names.upstream, commit: input.refs.upstream },
                  { branch: names.fork, commit: input.refs.candidate },
                ],
              });
            }
            if (forkMoved) {
              yield* move({
                branch: names.fork,
                expectedCommit: input.refs.candidate,
                targetCommit: input.refs.fork,
                guards: [
                  { branch: names.base, commit: input.refs.upstream },
                  { branch: names.upstream, commit: input.refs.upstream },
                  { branch: names.candidate, commit: input.refs.candidate },
                ],
              });
            }
            if (baseMoved) {
              yield* move({
                branch: names.base,
                expectedCommit: input.refs.upstream,
                targetCommit: input.refs.base,
                guards: [
                  { branch: names.upstream, commit: input.refs.upstream },
                  { branch: names.fork, commit: input.refs.fork },
                  { branch: names.candidate, commit: input.refs.candidate },
                ],
              });
            }
          });
          const accepted = Effect.gen(function* () {
            yield* move({
              branch: names.base,
              expectedCommit: input.refs.base,
              targetCommit: input.refs.upstream,
              guards: [
                { branch: names.upstream, commit: input.refs.upstream },
                { branch: names.fork, commit: input.refs.fork },
                { branch: names.candidate, commit: input.refs.candidate },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (baseMoved = true))),
            );
            yield* move({
              branch: names.fork,
              expectedCommit: input.refs.fork,
              targetCommit: input.refs.candidate,
              guards: [
                { branch: names.base, commit: input.refs.upstream },
                { branch: names.upstream, commit: input.refs.upstream },
                { branch: names.candidate, commit: input.refs.candidate },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (forkMoved = true))),
            );
            yield* removeRef({
              branch: names.candidate,
              expectedCommit: input.refs.candidate,
              guards: [
                { branch: names.base, commit: input.refs.upstream },
                { branch: names.upstream, commit: input.refs.upstream },
                { branch: names.fork, commit: input.refs.candidate },
              ],
            }).pipe(
              Effect.tap(() => Effect.sync(() => (candidateRemoved = true))),
            );
            return {
              refs: {
                base: input.refs.upstream,
                upstream: input.refs.upstream,
                fork: input.refs.candidate,
              },
            };
          });
          return yield* accepted.pipe(
            Effect.catch((error) =>
              rollback.pipe(Effect.andThen(Effect.fail(error))),
            ),
          );
        },
      );

      const checkpointFork = Effect.fn("Flect.ShareRepository.checkpointFork")(
        function* (input: {
          readonly shareId: string;
          readonly expectedForkCommit: string;
          readonly refs: ShareInstallationRefs;
          readonly files: ReadonlyArray<{
            readonly path: string;
            readonly contents: Uint8Array;
          }>;
          readonly removals: ReadonlyArray<string>;
          readonly message: string;
        }) {
          yield* open;
          if (input.expectedForkCommit !== input.refs.fork) {
            return yield* Effect.fail(failure("stale-ref"));
          }
          const names = yield* deriveShareRefs(input.shareId);
          const checkpoint = yield* git
            .checkpoint({
              branch: names.fork,
              expectedCommit: input.expectedForkCommit,
              files: input.files,
              removals: input.removals,
              guards: [
                { branch: names.base, commit: input.refs.base },
                { branch: names.upstream, commit: input.refs.upstream },
                ...(input.refs.candidate === undefined
                  ? []
                  : [
                      {
                        branch: names.candidate,
                        commit: input.refs.candidate,
                      },
                    ]),
              ],
              message: input.message,
            })
            .pipe(Effect.mapError(mapGitFailure));
          return { fork: checkpoint.commit };
        },
      );

      const restoreFork = Effect.fn("Flect.ShareRepository.restoreFork")(
        function* (input: {
          readonly shareId: string;
          readonly expectedForkCommit: string;
          readonly targetForkCommit: string;
          readonly refs: Pick<ShareInstallationRefs, "base" | "upstream">;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          yield* move({
            branch: names.fork,
            expectedCommit: input.expectedForkCommit,
            targetCommit: input.targetForkCommit,
            guards: [
              { branch: names.base, commit: input.refs.base },
              { branch: names.upstream, commit: input.refs.upstream },
            ],
          });
        },
      );

      const prepareUpdate = Effect.fn("Flect.ShareRepository.prepareUpdate")(
        function* (input: {
          readonly shareId: string;
          readonly archive: Uint8Array;
          readonly commit: string;
          readonly refs: Omit<ShareInstallationRefs, "candidate">;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          const guards = [
            { branch: names.base, commit: input.refs.base },
            { branch: names.upstream, commit: input.refs.upstream },
            { branch: names.fork, commit: input.refs.fork },
          ];
          yield* git
            .importObjects({
              archive: input.archive,
              commit: input.commit,
              guards,
            })
            .pipe(Effect.mapError(mapGitFailure));
          yield* move({
            branch: names.upstream,
            expectedCommit: input.refs.upstream,
            targetCommit: input.commit,
            guards: [guards[0], guards[2]],
          });
          const currentGuards = [
            guards[0],
            { branch: names.upstream, commit: input.commit },
            guards[2],
          ];
          if (input.refs.fork === input.refs.base) {
            yield* move({
              branch: names.candidate,
              targetCommit: input.commit,
              guards: currentGuards,
            });
            return ShareFastForwardUpdate.make({
              _tag: "fast-forward",
              upstream: input.commit,
              fork: input.refs.fork,
              candidate: input.commit,
            });
          }

          const ancestry = yield* run([
            "log",
            "--format=%H",
            `${input.commit}..${input.refs.base}`,
          ]);
          if (ancestry.exitCode !== 0) {
            return yield* Effect.fail(failure("repository"));
          }
          if (ancestry.stdout.trim().length > 0) {
            yield* move({
              branch: names.candidate,
              targetCommit: input.commit,
              guards: currentGuards,
            });
            return ShareReplacementUpdate.make({
              _tag: "replacement",
              upstream: input.commit,
              fork: input.refs.fork,
              candidate: input.commit,
            });
          }
          const [baseSnapshot, forkSnapshot, upstreamSnapshot] =
            yield* Effect.all([
              git.snapshotRef({
                branch: names.base,
                expectedCommit: input.refs.base,
                guards: [currentGuards[1], currentGuards[2]],
              }),
              git.snapshotRef({
                branch: names.fork,
                expectedCommit: input.refs.fork,
                guards: [currentGuards[0], currentGuards[1]],
              }),
              git.snapshotRef({
                branch: names.upstream,
                expectedCommit: input.commit,
                guards: [currentGuards[0], currentGuards[2]],
              }),
            ]).pipe(Effect.mapError(mapGitFailure));
          const conflicts = findThreeWayConflicts(
            baseSnapshot.files,
            forkSnapshot.files,
            upstreamSnapshot.files,
          );
          if (conflicts.length > 0)
            return ShareConflictUpdate.make({
              _tag: "conflict",
              upstream: input.commit,
              fork: input.refs.fork,
              conflictPaths: conflicts,
            });
          yield* move({
            branch: names.candidate,
            targetCommit: input.refs.fork,
            guards: currentGuards,
          });
          const discard = Effect.gen(function* () {
            const resolved = yield* run(["rev-parse", names.candidate]).pipe(
              Effect.option,
            );
            if (
              resolved._tag === "None" ||
              resolved.value.exitCode !== 0 ||
              !/^[0-9a-f]{40}$/.test(resolved.value.stdout.trim())
            )
              return;
            const candidate = resolved.value.stdout.trim();
            yield* requireCommand(["reset", "--hard", input.refs.fork]).pipe(
              Effect.ignore,
            );
            yield* removeRef({
              branch: names.candidate,
              expectedCommit: candidate,
              guards: currentGuards,
            }).pipe(Effect.ignore);
          });
          const merge = Effect.gen(function* () {
            const result = yield* git
              .mergeRef({
                branch: names.candidate,
                expectedCommit: input.refs.fork,
                upstreamBranch: names.upstream,
                expectedUpstreamCommit: input.commit,
                files: mergeThreeWayFiles(
                  baseSnapshot.files,
                  forkSnapshot.files,
                  upstreamSnapshot.files,
                ),
                guards: currentGuards,
                message: `Merge shared update: ${input.shareId}`,
              })
              .pipe(Effect.mapError(mapGitFailure));
            if (result.type === "ref-merge-conflict") {
              yield* discard;
              return ShareConflictUpdate.make({
                _tag: "conflict",
                upstream: input.commit,
                fork: input.refs.fork,
                conflictPaths: result.conflictPaths,
              });
            }
            return ShareMergedUpdate.make({
              _tag: "merged",
              upstream: input.commit,
              fork: input.refs.fork,
              candidate: result.commit,
              parents: result.parents,
            });
          }).pipe(Effect.onError(() => discard));
          return yield* merge;
        },
      );

      const resolveConflict = Effect.fn(
        "Flect.ShareRepository.resolveConflict",
      )(function* (input: {
        readonly shareId: string;
        readonly refs: Omit<ShareInstallationRefs, "candidate">;
        readonly conflictPaths: ReadonlyArray<string>;
        readonly files: ReadonlyArray<{
          readonly path: string;
          readonly contents: Uint8Array;
        }>;
        readonly removals: ReadonlyArray<string>;
        readonly message: string;
      }) {
        yield* open;
        const names = yield* deriveShareRefs(input.shareId);
        const expectedConflicts = yield* Effect.forEach(
          input.conflictPaths,
          (path) =>
            Schema.decodeUnknownEffect(Path)(path).pipe(
              Effect.mapError(() => failure("invalid-input")),
            ),
        );
        const resolutionPaths = [
          ...input.files.map((file) => file.path),
          ...input.removals,
        ];
        if (
          expectedConflicts.length === 0 ||
          new Set(expectedConflicts).size !== expectedConflicts.length ||
          new Set(resolutionPaths).size !== resolutionPaths.length ||
          resolutionPaths.length !== expectedConflicts.length ||
          resolutionPaths
            .toSorted()
            .some((path, index) => path !== expectedConflicts.toSorted()[index])
        ) {
          return yield* Effect.fail(failure("invalid-input"));
        }
        const guards = [
          { branch: names.base, commit: input.refs.base },
          { branch: names.upstream, commit: input.refs.upstream },
          { branch: names.fork, commit: input.refs.fork },
        ];
        const [baseSnapshot, forkSnapshot, upstreamSnapshot] =
          yield* Effect.all([
            git.snapshotRef({
              branch: names.base,
              expectedCommit: input.refs.base,
              guards: [guards[1], guards[2]],
            }),
            git.snapshotRef({
              branch: names.fork,
              expectedCommit: input.refs.fork,
              guards: [guards[0], guards[1]],
            }),
            git.snapshotRef({
              branch: names.upstream,
              expectedCommit: input.refs.upstream,
              guards: [guards[0], guards[2]],
            }),
          ]).pipe(Effect.mapError(mapGitFailure));
        const actualConflicts = findThreeWayConflicts(
          baseSnapshot.files,
          forkSnapshot.files,
          upstreamSnapshot.files,
        );
        if (
          actualConflicts.length !== expectedConflicts.length ||
          actualConflicts.some(
            (path, index) => path !== expectedConflicts.toSorted()[index],
          )
        ) {
          return yield* Effect.fail(failure("stale-ref"));
        }
        const resolved = new Map(
          mergeThreeWayFiles(
            baseSnapshot.files,
            forkSnapshot.files,
            upstreamSnapshot.files,
          ).map((file) => [file.path, file.contents]),
        );
        for (const file of input.files) resolved.set(file.path, file.contents);
        for (const path of input.removals) resolved.delete(path);
        yield* move({
          branch: names.candidate,
          targetCommit: input.refs.fork,
          guards,
        });
        const discard = removeRef({
          branch: names.candidate,
          expectedCommit: input.refs.fork,
          guards,
        }).pipe(Effect.ignore);
        const merged = yield* git
          .mergeRef({
            branch: names.candidate,
            expectedCommit: input.refs.fork,
            upstreamBranch: names.upstream,
            expectedUpstreamCommit: input.refs.upstream,
            files: [...resolved]
              .toSorted(([left], [right]) => left.localeCompare(right))
              .map(([path, contents]) => ({ path, contents })),
            conflictPaths: expectedConflicts,
            guards,
            message: input.message,
          })
          .pipe(
            Effect.mapError(mapGitFailure),
            Effect.onError(() => discard),
          );
        if (merged.type === "ref-merge-conflict") {
          yield* discard;
          return yield* Effect.fail(failure("stale-ref"));
        }
        return ShareMergedUpdate.make({
          _tag: "merged",
          upstream: input.refs.upstream,
          fork: input.refs.fork,
          candidate: merged.commit,
          parents: merged.parents,
        });
      });

      const removeInstallation = Effect.fn("Flect.ShareRepository.remove")(
        function* (input: {
          readonly shareId: string;
          readonly refs: ShareInstallationRefs;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          if (input.refs.candidate !== undefined) {
            yield* removeRef({
              branch: names.candidate,
              expectedCommit: input.refs.candidate,
              guards: [
                { branch: names.base, commit: input.refs.base },
                { branch: names.upstream, commit: input.refs.upstream },
                { branch: names.fork, commit: input.refs.fork },
              ],
            });
          }
          yield* removeRef({
            branch: names.upstream,
            expectedCommit: input.refs.upstream,
            guards: [
              { branch: names.base, commit: input.refs.base },
              { branch: names.fork, commit: input.refs.fork },
            ],
          });
          yield* removeRef({
            branch: names.base,
            expectedCommit: input.refs.base,
            guards: [{ branch: names.fork, commit: input.refs.fork }],
          });
        },
      );

      const exportFork = Effect.fn("Flect.ShareRepository.exportFork")(
        function* (input: {
          readonly shareId: string;
          readonly forkCommit: string;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          if (git.exportRef === undefined) {
            return yield* Effect.fail(failure("unavailable"));
          }
          const exported = yield* git
            .exportRef({
              branch: names.fork,
              expectedCommit: input.forkCommit,
              guards: [],
            })
            .pipe(Effect.mapError(mapGitFailure));
          return exported.archive.slice();
        },
      );

      const exportCandidate = Effect.fn(
        "Flect.ShareRepository.exportCandidate",
      )(function* (input: {
        readonly shareId: string;
        readonly candidateCommit: string;
        readonly refs: Pick<
          ShareInstallationRefs,
          "base" | "upstream" | "fork"
        >;
      }) {
        yield* open;
        const names = yield* deriveShareRefs(input.shareId);
        if (git.exportRef === undefined) {
          return yield* Effect.fail(failure("unavailable"));
        }
        const exported = yield* git
          .exportRef({
            branch: names.candidate,
            expectedCommit: input.candidateCommit,
            guards: [
              { branch: names.base, commit: input.refs.base },
              { branch: names.upstream, commit: input.refs.upstream },
              { branch: names.fork, commit: input.refs.fork },
            ],
          })
          .pipe(Effect.mapError(mapGitFailure));
        return exported.archive.slice();
      });

      const deleteLocalData = Effect.fn("Flect.ShareRepository.delete")(
        function* (input: {
          readonly shareId: string;
          readonly forkCommit: string;
          readonly installed: boolean;
        }) {
          if (input.installed) return yield* Effect.fail(failure("installed"));
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          yield* removeRef({
            branch: names.fork,
            expectedCommit: input.forkCommit,
            guards: [],
          });
        },
      );

      const snapshotArtifact = Effect.fn("Flect.ShareRepository.snapshot")(
        function* (input: {
          readonly shareId: string;
          readonly role: "base" | "upstream" | "fork" | "candidate";
          readonly expectedCommit: string;
          readonly sourceRoot: string;
          readonly guards?: ReadonlyArray<{
            readonly branch: string;
            readonly commit: string;
          }>;
        }) {
          yield* open;
          const names = yield* deriveShareRefs(input.shareId);
          const root = yield* Schema.decodeUnknownEffect(Path)(
            input.sourceRoot,
          ).pipe(Effect.mapError(() => failure("invalid-input")));
          const snapshot = yield* git
            .snapshotRef({
              branch: names[input.role],
              expectedCommit: input.expectedCommit,
              guards: input.guards ?? [],
            })
            .pipe(Effect.mapError(mapGitFailure));
          const files = snapshot.files.filter(
            (file) => file.path === root || file.path.startsWith(`${root}/`),
          );
          if (files.length === 0)
            return yield* Effect.fail(failure("invalid-input"));
          return files;
        },
      );

      return {
        retain,
        checkpointFork,
        restoreFork,
        prepareUpdate,
        resolveConflict,
        rejectCandidate,
        restoreCandidateRef,
        acceptCandidate,
        restoreCandidate,
        snapshotArtifact,
        exportFork,
        exportCandidate,
        removeInstallation,
        deleteLocalData,
      } satisfies ShareRepositoryShape;
    }),
  );
