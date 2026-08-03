import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer, Ref, Stream, SubscriptionRef } from "effect";
import {
  ShareEmbeddedRepository,
  ShareUrlSource,
} from "../../packages/product/src/share";
import { BrowserBuildArtifact } from "../../shared/browser-build";
import { encodeCapsule, hashCapsuleArchive } from "../../shared/capsule";
import {
  ExternalPiExtensionSelection,
  InterfaceEditRequested,
  ModelSelection,
  ModelSummary,
} from "../../shared/contracts";
import {
  AcceptProposal,
  ActivateShareCandidate,
  AgentCommandSource,
  AgentWorkspaceSnapshot,
  CancelRole,
  CapsuleCommandSource,
  CheckpointShareFork,
  ContinueShareFork,
  ControlCommandSource,
  DecideProductCapability,
  DeleteShareLocalData,
  DisableControl,
  EnableControl,
  EnterSafeMode,
  ExportShare,
  FlectCommandEnvelope,
  ForkShare,
  ImportCapsule,
  Inspect,
  InvokeInterfaceAction,
  InvokePortableExtension,
  InvokeProductOperation,
  OpenShareConflictInShape,
  OpenShareSource,
  PrepareShareUpdate,
  RejectProposal,
  RejectShareCandidate,
  RemovePortableExtension,
  RemoveShare,
  RequestShapeHandoff,
  ResolveShareConflict,
  RestoreSafeMode,
  RetainShareCandidate,
  RevokeProductCapability,
  RoleConversationSnapshot,
  RollbackRevision,
  SelectModel,
  SelectWorkbenchTarget,
  SetExternalExtensions,
  SetMode,
  SetModelFavorite,
  SetPortableExtensionEnabled,
  SetPortableExtensionPin,
  SetRailCollapsed,
  SetRailWidth,
  SubmitAppPrompt,
  SubmitShaperInstruction,
  TestPortableExtension,
  UserCommandSource,
  WorkbenchHandoff,
} from "../../shared/control";
import { PortableExtensionPackage } from "../../shared/extensions";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import {
  ProductCapabilityAllowChoice,
  ProductCapabilityProjection,
  ProductCapabilityReservation,
  ProductOperationExecution,
  ProductOperationFailure,
  ProductOperationInvocation,
  ProductOperationSummary,
} from "../../shared/product-capability";
import { RevisionId } from "../../shared/revisions";
import { RoleContinuityRecord } from "../../shared/role-continuity";
import { SandboxResult } from "../../shared/sandbox";
import {
  ShareInstallationSnapshot,
  shareInstallationPersistenceFailure,
} from "../../shared/share-installation";
import { ShareSignatureAssessment } from "../../shared/share-review";
import type { ShellPreferencesValue } from "../../shared/shell-preferences";
import {
  ProposalBuild,
  type ProposalBuildShape,
} from "../build/proposal-build";
import {
  ProductCapabilityRegistry,
  type ProductCapabilityRegistryShape,
} from "../capabilities/product-capability-registry";
import { CapsuleStore, type CapsuleStoreShape } from "../capsule/capsule-store";
import {
  ExtensionCatalog,
  makeExtensionCatalogLayer,
} from "../extensions/extension-catalog";
import {
  PortableExtensionHost,
  type PortableExtensionHostShape,
} from "../extensions/portable-extension-host";
import { GitWorkspace, type GitWorkspaceShape } from "../git/git-workspace";
import { decodeShareArchive } from "../sharing/share-archive";
import {
  ShareCandidateStore,
  type ShareCandidateStoreShape,
} from "../sharing/share-candidate-store";
import {
  ShareInstallationStore,
  type ShareInstallationStoreShape,
} from "../sharing/share-installation-store";
import type { ShareCandidateMaterial } from "../sharing/share-quarantine";
import {
  ShareConflictUpdate,
  ShareFastForwardUpdate,
  ShareMergedUpdate,
  ShareRepository,
  type ShareRepositoryShape,
} from "../sharing/share-repository";
import {
  ShareSignatureVerifier,
  type ShareSignatureVerifierShape,
} from "../sharing/share-signature-verifier";
import {
  ShareSourceResolver,
  type ShareSourceResolverShape,
} from "../sharing/share-source-resolver";
import { SandboxedShell } from "../shell/sandboxed-shell";
import {
  AgentPromptOutcome,
  AgentWorkspace,
  type AgentWorkspaceShape,
} from "./agent-workspace";
import { InterfaceStorage } from "./interface-store";
import {
  OperationJournal,
  OperationJournalLive,
  OperationQuery,
} from "./operation-journal";
import { RoleContinuityRepository } from "./role-continuity-repository";
import { makeShapingKernelTestLayer } from "./shaping-kernel";
import { defaultShellPreferences, ShellPreferences } from "./shell-preferences";
import { importWebProject } from "./web-project-import";
import {
  type CapsulePresentationState,
  FlectWorkspaceController,
  FlectWorkspaceControllerLive,
} from "./workspace-controller";

const model = ModelSummary.make({
  provider: "openai-codex",
  id: "gpt-5.6",
  name: "GPT-5.6",
  reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
});

const role = (name: "app" | "shaper") =>
  RoleConversationSnapshot.make({
    role: name,
    status: "ready",
    messages: [],
    activities: [],
    lastPrompt: "",
  });

const initialAgent = AgentWorkspaceSnapshot.make({
  models: [model],
  favoriteModels: [],
  externalExtensions: ExternalPiExtensionSelection.make({
    app: false,
    shaper: false,
  }),
  app: role("app"),
  previewApp: role("app"),
  shaper: role("shaper"),
});

const makeLayer = (options?: {
  readonly capsuleStore?: CapsuleStoreShape;
  readonly git?: GitWorkspaceShape;
  readonly productRegistry?: ProductCapabilityRegistryShape;
  readonly proposalBuild?: ProposalBuildShape;
  readonly extensionServices?: Layer.Layer<
    ExtensionCatalog | PortableExtensionHost
  >;
  readonly sharingServices?: Layer.Layer<
    | ShareInstallationStore
    | ShareCandidateStore
    | ShareRepository
    | ShareSignatureVerifier
    | ShareSourceResolver
  >;
}) => {
  const selectModel = vi.fn(
    (_selection: ModelSelection | undefined) => Effect.void,
  );
  const setExternalExtensions = vi.fn(
    (_role: "app" | "shaper", _enabled: boolean) => Effect.void,
  );
  const submitPreviewPrompt = vi.fn<AgentWorkspaceShape["submitPreviewPrompt"]>(
    () => Effect.succeed(AgentPromptOutcome.make({})),
  );
  const submitAppPrompt = vi.fn<AgentWorkspaceShape["submitAppPrompt"]>(() =>
    Effect.succeed(AgentPromptOutcome.make({})),
  );
  const submitShaperInstruction = vi.fn<
    AgentWorkspaceShape["submitShaperInstruction"]
  >((_operation, _instruction, document) =>
    Effect.succeed(
      InterfaceDocument.make({
        ...document,
        name: "Controller proposal",
      }),
    ),
  );
  const agentLayer = Layer.effect(
    AgentWorkspace,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(initialAgent);
      return {
        snapshot: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        providerAuth: Effect.succeed({ providers: [] }),
        providerAuthChanges: Stream.empty,
        restoreContinuity: () => Effect.void,
        refresh: Effect.void,
        selectModel,
        selectReasoning: () => Effect.void,
        loginProvider: () => Effect.void,
        replyProviderAuth: () => Effect.void,
        cancelProviderAuth: () => Effect.void,
        refreshProviderAuth: Effect.void,
        logoutProvider: () => Effect.void,
        setModelFavorite: () => Effect.void,
        setExternalExtensions,
        proposeShaperInterface: (_source, document) =>
          Effect.succeed({ status: "proposed", document }),
        submitAppPrompt,
        submitPreviewPrompt,
        submitShaperInstruction,
        cancel: () => Effect.void,
        cancelPreview: Effect.void,
        releasePreview: Effect.void,
        diagnoseRecovery: () =>
          Effect.succeed({
            version: 1,
            message: "The protected launcher remains available.",
          }),
        close: Effect.void,
      } satisfies AgentWorkspaceShape;
    }),
  );
  const saved: Array<ShellPreferencesValue> = [];
  const preferences = Layer.succeed(ShellPreferences)({
    load: Effect.succeed(defaultShellPreferences),
    save: (value) =>
      Effect.sync(() => {
        saved.push(value);
      }),
  });
  const continuity = Layer.succeed(RoleContinuityRepository)({
    load: Effect.succeed({ status: "empty" as const }),
    save: (expectedGeneration, record) =>
      Effect.succeed(
        RoleContinuityRecord.make({
          ...record,
          generation: expectedGeneration + 1,
        }),
      ),
    discard: Effect.void,
    export: Effect.succeed("{}"),
  });
  const baseDependencies = Layer.mergeAll(
    agentLayer,
    makeShapingKernelTestLayer(),
    preferences,
    continuity,
    OperationJournalLive,
  );
  const dependencies = Layer.mergeAll(
    baseDependencies,
    ...(options?.git === undefined
      ? []
      : [Layer.succeed(GitWorkspace)(options.git)]),
    ...(options?.proposalBuild === undefined
      ? []
      : [Layer.succeed(ProposalBuild)(options.proposalBuild)]),
    ...(options?.capsuleStore === undefined
      ? []
      : [Layer.succeed(CapsuleStore)(options.capsuleStore)]),
    ...(options?.productRegistry === undefined
      ? []
      : [Layer.succeed(ProductCapabilityRegistry)(options.productRegistry)]),
    ...(options?.extensionServices === undefined
      ? []
      : [options.extensionServices]),
    ...(options?.sharingServices === undefined
      ? []
      : [options.sharingServices]),
  );
  return {
    layer: FlectWorkspaceControllerLive.pipe(Layer.provideMerge(dependencies)),
    saved,
    selectModel,
    setExternalExtensions,
    submitPreviewPrompt,
    submitAppPrompt,
    submitShaperInstruction,
  };
};

const makePortableExtensionServices = (capsuleId = "dev.akua.portable") => {
  const stored = Ref.makeUnsafe<string | null>(null);
  const storage = Layer.succeed(InterfaceStorage)({
    read: () => Ref.get(stored),
    write: (_key, value) => Ref.set(stored, value),
    remove: () => Ref.set(stored, null),
  });
  const catalog = makeExtensionCatalogLayer().pipe(Layer.provide(storage));
  const host = Layer.effect(
    PortableExtensionHost,
    Effect.gen(function* () {
      const extensionCatalog = yield* ExtensionCatalog;
      const shape: PortableExtensionHostShape = {
        list: () => Effect.succeed([]),
        describe: () => Effect.die("unused"),
        call: (source, extensionId) =>
          extensionCatalog
            .recordSuccess({
              capsuleId,
              extensionId,
              role: source.role,
              binding: source.binding,
            })
            .pipe(
              Effect.as(
                SandboxResult.make({
                  version: 1,
                  intents: [],
                }),
              ),
            ),
      };
      return shape;
    }),
  ).pipe(Layer.provide(catalog));
  return Layer.merge(catalog, host);
};

const portablePackage = PortableExtensionPackage.make({
  formatVersion: 1,
  id: "weather-card",
  name: "Weather card",
  description: "Adds a bounded weather projection.",
  version: "1.0.0",
  bundle: "extensions/weather-card/bundle.mjs",
  roles: ["app", "shaper"],
  compatibility: {
    flect: ">=0.2.0 <1.0.0",
    extensionApi: 1,
    platforms: ["browser", "macos"],
  },
  capabilities: [{ id: "interface:read", required: true }],
  publicInstructions: "Use only when weather context is useful.",
  commands: [],
  tools: [],
  resources: {
    deadlineMs: 100,
    memoryBytes: 16 * 1024 * 1024,
    inputBytes: 1024 * 1024,
    outputBytes: 1024 * 1024,
    maxIntents: 20,
  },
  provenance: {
    publisher: "akua-dev",
    source: "https://github.com/akua-dev/weather-card",
    revision: "v1.0.0",
    bundleSha256:
      "a4a348b6f4e91da9c77bf69cf56383647597fdf2b7a64d71ae214a0261892537",
  },
});

const user = UserCommandSource.make({ kind: "user" });
const outside = ControlCommandSource.make({
  kind: "control",
  clientId: "client-controller-1",
  clientName: "Outside agent",
});
const appAgent = AgentCommandSource.make({
  kind: "agent",
  role: "app",
  sessionId: "session-app-0001",
  parentOperationId: "operation-app-0001",
  requestId: "tool-app-1",
});
const shaperAgent = AgentCommandSource.make({
  kind: "agent",
  role: "shaper",
  sessionId: "session-shaper-0001",
  parentOperationId: "operation-shaper-0001",
  requestId: "tool-shaper-1",
});

const envelope = (
  index: number,
  command: FlectCommandEnvelope["command"],
  source: FlectCommandEnvelope["source"] = user,
  expectedSequence?: number,
) =>
  FlectCommandEnvelope.make({
    version: 1,
    commandId: `cmd-controller-${index}`,
    workspaceId: "workspace-local-default",
    source,
    ...(expectedSequence === undefined ? {} : { expectedSequence }),
    command,
  });

const makeSharingServices = () => {
  const commit = "a".repeat(40);
  const hash = "b".repeat(64);
  const installations = Ref.makeUnsafe(
    ShareInstallationSnapshot.make({ formatVersion: 1, entries: [] }),
  );
  const failNextInstallationSave = Ref.makeUnsafe(false);
  const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
  const openCount = Ref.makeUnsafe(0);
  const candidateOverride = Ref.makeUnsafe<ShareCandidateMaterial | undefined>(
    undefined,
  );
  const latestCandidate = Ref.makeUnsafe<ShareCandidateMaterial | undefined>(
    undefined,
  );
  const signatureStatus =
    Ref.makeUnsafe<ShareSignatureAssessment["status"]>("unsigned");
  const candidateArchives = Ref.makeUnsafe(new Map<string, Uint8Array>());
  const prepareConflict = Ref.makeUnsafe(false);
  const preparedTrees = Ref.makeUnsafe<
    ReadonlyArray<{
      readonly root: string;
      readonly paths: ReadonlyArray<string>;
    }>
  >([]);
  const candidateStore: ShareCandidateStoreShape = {
    persistence: "session",
    save: (archive) =>
      hashCapsuleArchive(archive).pipe(
        Effect.orDie,
        Effect.tap((digest) =>
          Ref.update(candidateArchives, (current) =>
            new Map(current).set(digest, archive.slice()),
          ),
        ),
      ),
    load: (digest) =>
      Ref.get(candidateArchives).pipe(
        Effect.map((current) => current.get(digest)?.slice()),
      ),
    remove: (digest) =>
      Ref.update(candidateArchives, (current) => {
        const next = new Map(current);
        next.delete(digest);
        return next;
      }),
  };
  const source: ShareSourceResolverShape = {
    open: (shareSource) =>
      Stream.fromEffect(Ref.getAndUpdate(openCount, (count) => count + 1)).pipe(
        Stream.flatMap((count) => {
          const candidateCommit = count === 0 ? commit : "c".repeat(40);
          const defaultCandidate: ShareCandidateMaterial = {
            manifest: {
              formatVersion: 1,
              id: "dev.flect.shared-card",
              name: "Shared card",
              version: count === 0 ? "1.0.0" : "1.1.0",
              repository: ShareEmbeddedRepository.make({
                _tag: "embedded",
                archivePath: "repository.tar",
                sha256: hash,
                commit: candidateCommit,
              }),
              artifacts: [
                {
                  id: "dev.flect.shared-card.component",
                  kind: "component" as const,
                  version: count === 0 ? "1.0.0" : "1.1.0",
                  sourceRoot: "components/card",
                  contentSha256: hash,
                },
              ],
              compatibility: {
                flect: ">=0.2.0 <1.0.0",
                platforms: ["browser" as const, "macos" as const],
              },
              provenance: {
                publisher: "akua-dev",
                source: "https://example.test/shared-card",
                revision: candidateCommit,
                builder: "@flect/product",
              },
              signatures: [],
              migrations: [],
            },
            repository: new Uint8Array([1, 2, 3]),
            artifacts: [],
            files: [
              {
                path: "components/card/index.tsx",
                contents: new TextEncoder().encode("export const Card = 1"),
              },
            ],
            archiveSha256: hash,
          };
          return Stream.fromEffect(
            Effect.gen(function* () {
              const override = yield* Ref.get(candidateOverride);
              const previous = yield* Ref.get(latestCandidate);
              const candidate =
                shareSource._tag === "local" && previous !== undefined
                  ? previous
                  : (override ?? defaultCandidate);
              yield* Ref.set(latestCandidate, candidate);
              return candidate;
            }),
          ).pipe(
            Stream.flatMap((candidate) =>
              Stream.fromIterable([
                { type: "started" as const, source: "url" as const },
                {
                  type: "completed" as const,
                  candidate,
                },
              ]),
            ),
          );
        }),
      ),
  };
  const store: ShareInstallationStoreShape = {
    snapshot: Ref.get(installations),
    changes: Stream.empty,
    get: (shareId) =>
      Ref.get(installations).pipe(
        Effect.map((snapshot) =>
          snapshot.entries.find((entry) => entry.shareId === shareId),
        ),
      ),
    save: (record) =>
      Effect.gen(function* () {
        if (yield* Ref.getAndSet(failNextInstallationSave, false)) {
          return yield* Effect.fail(shareInstallationPersistenceFailure());
        }
        yield* Ref.update(installations, (snapshot) =>
          ShareInstallationSnapshot.make({
            formatVersion: 1,
            entries: [
              ...snapshot.entries.filter(
                (entry) => entry.shareId !== record.shareId,
              ),
              record,
            ],
          }),
        );
      }),
    remove: (shareId) =>
      Ref.update(installations, (snapshot) =>
        ShareInstallationSnapshot.make({
          formatVersion: 1,
          entries: snapshot.entries.filter(
            (entry) => entry.shareId !== shareId,
          ),
        }),
      ),
  };
  const signature: ShareSignatureVerifierShape = {
    verify: () =>
      Ref.get(signatureStatus).pipe(
        Effect.map((status) =>
          ShareSignatureAssessment.make({
            status,
            keyIds: status === "unsigned" ? [] : ["akua:key"],
            authoritative: false,
          }),
        ),
      ),
  };
  const repository: ShareRepositoryShape = {
    retain: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `retain:${input.shareId}`,
      ]).pipe(
        Effect.as({
          refs: {
            base: input.commit,
            upstream: input.commit,
            fork: input.commit,
          },
        }),
      ),
    prepareUpdate: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `update:${input.shareId}`,
      ]).pipe(
        Effect.flatMap(() =>
          Ref.get(prepareConflict).pipe(
            Effect.map((conflict) =>
              conflict
                ? ShareConflictUpdate.make({
                    _tag: "conflict",
                    upstream: input.commit,
                    fork: input.refs.fork,
                    conflictPaths: ["components/card/index.tsx"],
                  })
                : ShareFastForwardUpdate.make({
                    _tag: "fast-forward",
                    upstream: input.commit,
                    fork: input.refs.fork,
                    candidate: input.commit,
                  }),
            ),
          ),
        ),
      ),
    resolveConflict: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `resolve:${input.shareId}:${input.files.length}:${input.removals.length}`,
      ]).pipe(
        Effect.as(
          ShareMergedUpdate.make({
            _tag: "merged",
            upstream: input.refs.upstream,
            fork: input.refs.fork,
            candidate: "e".repeat(40),
            parents: [input.refs.fork, input.refs.upstream],
          }),
        ),
      ),
    checkpointFork: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `checkpoint:${input.shareId}:${input.expectedForkCommit}`,
      ]).pipe(
        Effect.as({
          fork:
            input.expectedForkCommit === "a".repeat(40)
              ? "d".repeat(40)
              : "e".repeat(40),
        }),
      ),
    restoreFork: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `restore:${input.shareId}:${input.expectedForkCommit}:${input.targetForkCommit}`,
      ]),
    rejectCandidate: (input) =>
      Ref.update(calls, (entries) => [...entries, `reject:${input.shareId}`]),
    restoreCandidateRef: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `restore-candidate-ref:${input.shareId}`,
      ]),
    acceptCandidate: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `accept:${input.shareId}`,
      ]).pipe(
        Effect.as({
          refs: {
            base: input.refs.upstream,
            upstream: input.refs.upstream,
            fork: input.refs.candidate,
          },
        }),
      ),
    restoreCandidate: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `restore-candidate:${input.shareId}`,
      ]),
    snapshotArtifact: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `snapshot:${input.shareId}:${input.role}`,
      ]).pipe(
        Effect.as([
          {
            path: "components/card/index.tsx",
            contents: new TextEncoder().encode("export const Card = 1"),
          },
        ]),
      ),
    exportFork: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `export-fork:${input.shareId}`,
      ]).pipe(Effect.as(new Uint8Array([1, 2, 3]))),
    exportCandidate: (input) =>
      Ref.update(calls, (entries) => [
        ...entries,
        `export-candidate:${input.shareId}`,
      ]).pipe(Effect.as(new Uint8Array([1, 2, 3]))),
    removeInstallation: (input) =>
      Ref.update(calls, (entries) => [...entries, `remove:${input.shareId}`]),
    deleteLocalData: (input) =>
      Ref.update(calls, (entries) => [...entries, `delete:${input.shareId}`]),
  };
  return {
    calls,
    failNextInstallationSave,
    installations,
    candidateOverride,
    prepareConflict,
    preparedTrees,
    signatureStatus,
    layer: Layer.mergeAll(
      Layer.succeed(ShareSourceResolver)(source),
      Layer.succeed(ShareCandidateStore)(candidateStore),
      Layer.succeed(ShareInstallationStore)(store),
      Layer.succeed(ShareRepository)(repository),
      Layer.succeed(ShareSignatureVerifier)(signature),
      Layer.succeed(SandboxedShell)({
        replaceTree: (_workspace, root, files) =>
          Ref.update(preparedTrees, (entries) => [
            ...entries,
            { root, paths: files.map((file) => file.path) },
          ]),
        execute: () => Effect.die("unused"),
        stop: () => Effect.die("unused"),
      }),
    ),
  };
};

const makeIdleGit = (): GitWorkspaceShape => {
  const unexpected = Effect.die(new Error("Unexpected Git call"));
  return {
    open: () => unexpected,
    write: () => unexpected,
    read: () => unexpected,
    run: () => unexpected,
    exportRepository: unexpected,
    remove: unexpected,
    checkpoint: () => unexpected,
    readAtRef: () => unexpected,
    moveRef: () => unexpected,
    snapshotRef: () => unexpected,
    status: () =>
      Effect.succeed({
        type: "status",
        conflictPaths: [],
        dirty: false,
      }),
    importRepository: () => unexpected,
    importObjects: () => unexpected,
    deleteRef: () => unexpected,
    inspectCommit: () => unexpected,
    mergeRef: () => unexpected,
    inspectShare: () => unexpected,
  };
};

describe("FlectWorkspaceController", () => {
  it.effect(
    "opens an inactive share review without replacing accepted state and rejects it deterministically",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const before = yield* controller.snapshot;
        const opened = yield* controller.dispatch(
          envelope(
            400,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        const reviewing = yield* controller.snapshot;

        assert.deepStrictEqual(opened.result, {
          status: "review-ready",
          shareId: "dev.flect.shared-card",
          lineage: "new",
        });
        assert.strictEqual(reviewing.document.name, before.document.name);
        assert.strictEqual(
          reviewing.shaping.active.id,
          before.shaping.active.id,
        );
        assert.strictEqual(
          reviewing.shareReview?.shareId,
          "dev.flect.shared-card",
        );
        assert.isTrue(reviewing.shareReview?.inactive);
        assert.deepStrictEqual(reviewing.shares?.entries, []);

        yield* controller.dispatch(
          envelope(
            401,
            RejectShareCandidate.make({ type: "reject-share-candidate" }),
          ),
        );
        assert.strictEqual((yield* controller.snapshot).shareReview, undefined);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "rechecks selected artifacts before an outside source retains guarded share history",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            402,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
            outside,
          ),
        );

        const invalid = yield* controller
          .dispatch(
            envelope(
              403,
              RetainShareCandidate.make({
                type: "retain-share-candidate",
                artifactIds: ["dev.flect.undeclared"],
              }),
              outside,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(invalid._tag, "OperationFailed");
        assert.deepStrictEqual(yield* Ref.get(sharing.calls), []);

        const retained = yield* controller.dispatch(
          envelope(
            404,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
            outside,
          ),
        );
        const snapshot = yield* controller.snapshot;
        assert.deepStrictEqual(retained.result, {
          status: "retained",
          shareId: "dev.flect.shared-card",
          refs: {
            base: "a".repeat(40),
            upstream: "a".repeat(40),
            fork: "a".repeat(40),
          },
        });
        assert.deepStrictEqual(yield* Ref.get(sharing.calls), [
          "retain:dev.flect.shared-card",
        ]);
        assert.deepStrictEqual(
          snapshot.shares?.entries[0]?.installedArtifactIds,
          ["dev.flect.shared-card.component"],
        );
        assert.strictEqual(
          snapshot.shareReview?.shareId,
          "dev.flect.shared-card",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "restores a retained inactive share review after controller restart",
    () => {
      const sharing = makeSharingServices();
      return Effect.gen(function* () {
        const first = yield* FlectWorkspaceController.pipe(
          Effect.provide(makeLayer({ sharingServices: sharing.layer }).layer),
        );
        yield* first.dispatch(
          envelope(
            405,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* first.dispatch(
          envelope(
            406,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        assert.strictEqual(
          (yield* first.snapshot).shares?.entries[0]?.pending?.lineage,
          "new",
        );

        const restarted = yield* FlectWorkspaceController.pipe(
          Effect.provide(makeLayer({ sharingServices: sharing.layer }).layer),
        );
        const restored = yield* restarted.snapshot;

        assert.strictEqual(
          restored.shareReview?.shareId,
          "dev.flect.shared-card",
        );
        assert.strictEqual(restored.shareReview?.lineage, "new");
        assert.isTrue(restored.shareReview?.inactive);
        assert.strictEqual(
          restored.document.name,
          defaultInterfaceDocument.name,
        );
      });
    },
  );

  it.effect("denies protected share retention to App Agent and Shaper", () => {
    const sharing = makeSharingServices();
    const { layer } = makeLayer({ sharingServices: sharing.layer });
    return Effect.gen(function* () {
      const controller = yield* FlectWorkspaceController.pipe(
        Effect.provide(layer),
      );
      const protectedCommands = [
        RetainShareCandidate.make({
          type: "retain-share-candidate",
          artifactIds: ["dev.flect.shared-card.component"],
        }),
        ForkShare.make({
          type: "fork-share",
          shareId: "dev.flect.shared-card",
        }),
        ActivateShareCandidate.make({
          type: "activate-share-candidate",
          shareId: "dev.flect.shared-card",
          artifactIds: ["dev.flect.shared-card.component"],
        }),
        DeleteShareLocalData.make({
          type: "delete-share-local-data",
          shareId: "dev.flect.shared-card",
          expectedForkCommit: "a".repeat(40),
        }),
      ];
      for (const [index, command] of protectedCommands.entries()) {
        for (const source of [appAgent, shaperAgent]) {
          const failure = yield* controller
            .dispatch(
              envelope(
                410 + index * 2 + (source.role === "app" ? 0 : 1),
                command,
                source,
              ),
            )
            .pipe(Effect.flip);
          assert.strictEqual(failure._tag, "ControlUnauthorized");
        }
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "allows only Shaper or an authorized user to advance a retained fork optimistically",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            430,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            431,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            432,
            RejectShareCandidate.make({ type: "reject-share-candidate" }),
          ),
        );

        const checkpoint = CheckpointShareFork.make({
          type: "checkpoint-share-fork",
          shareId: "dev.flect.shared-card",
          expectedForkCommit: "a".repeat(40),
          files: [
            {
              path: "components/card/index.tsx",
              contents: new TextEncoder().encode("export const Card = 2"),
            },
          ],
          removals: [],
          message: "Personalize shared card",
        });
        const denied = yield* controller
          .dispatch(envelope(433, checkpoint, appAgent))
          .pipe(Effect.flip);
        assert.strictEqual(denied._tag, "ControlUnauthorized");

        const receipt = yield* controller.dispatch(
          envelope(434, checkpoint, shaperAgent),
        );
        assert.deepStrictEqual(receipt.result, {
          status: "checkpointed",
          shareId: "dev.flect.shared-card",
          forkCommit: "d".repeat(40),
        });
        const retained = (yield* controller.snapshot).shares?.entries[0];
        assert.strictEqual(retained?.refs.fork, "d".repeat(40));
        assert.isUndefined(retained?.pending);
        assert.include(
          yield* Ref.get(sharing.calls),
          `checkpoint:dev.flect.shared-card:${"a".repeat(40)}`,
        );

        yield* Ref.set(sharing.failNextInstallationSave, true);
        const rolledBack = yield* controller
          .dispatch(
            envelope(
              435,
              CheckpointShareFork.make({
                ...checkpoint,
                expectedForkCommit: "d".repeat(40),
                message: "This edit must roll back",
              }),
              shaperAgent,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(rolledBack._tag, "OperationFailed");
        assert.include(rolledBack.message, "rolled back");
        assert.strictEqual(
          (yield* controller.snapshot).shares?.entries[0]?.refs.fork,
          "d".repeat(40),
        );
        assert.include(
          yield* Ref.get(sharing.calls),
          `restore:dev.flect.shared-card:${"e".repeat(40)}:${"d".repeat(40)}`,
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "removes only installation bindings before separately deleting the guarded fork",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            430,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            431,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );

        const installedDelete = yield* controller
          .dispatch(
            envelope(
              432,
              DeleteShareLocalData.make({
                type: "delete-share-local-data",
                shareId: "dev.flect.shared-card",
                expectedForkCommit: "a".repeat(40),
              }),
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(installedDelete._tag, "OperationFailed");

        const removed = yield* controller.dispatch(
          envelope(
            433,
            RemoveShare.make({
              type: "remove-share",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.deepStrictEqual(removed.result, {
          status: "removed",
          shareId: "dev.flect.shared-card",
        });
        const retained = (yield* controller.snapshot).shares?.entries[0];
        assert.strictEqual(retained?.shareId, "dev.flect.shared-card");
        assert.deepStrictEqual(retained?.installedArtifactIds, []);
        assert.strictEqual(retained?.refs.fork, "a".repeat(40));

        const exported = yield* controller.dispatch(
          envelope(
            434,
            ExportShare.make({
              type: "export-share",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.strictEqual(
          typeof exported.result === "object" && exported.result !== null
            ? Reflect.get(exported.result, "status")
            : undefined,
          "exported",
        );
        assert.strictEqual(
          (yield* decodeShareArchive(
            yield* controller.readShareExport("dev.flect.shared-card"),
          )).manifest.repository.commit,
          "a".repeat(40),
        );

        const deleted = yield* controller.dispatch(
          envelope(
            435,
            DeleteShareLocalData.make({
              type: "delete-share-local-data",
              shareId: "dev.flect.shared-card",
              expectedForkCommit: "a".repeat(40),
            }),
          ),
        );
        assert.deepStrictEqual(deleted.result, {
          status: "deleted",
          shareId: "dev.flect.shared-card",
        });
        assert.deepStrictEqual(
          (yield* controller.snapshot).shares?.entries,
          [],
        );
        assert.deepStrictEqual(yield* Ref.get(sharing.calls), [
          "retain:dev.flect.shared-card",
          "remove:dev.flect.shared-card",
          "export-fork:dev.flect.shared-card",
          "delete:dev.flect.shared-card",
        ]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "prepares a guarded upstream update and rejects only its candidate ref",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const open = (index: number) =>
          controller.dispatch(
            envelope(
              index,
              OpenShareSource.make({
                type: "open-share-source",
                source: ShareUrlSource.make({
                  _tag: "url",
                  url: "https://example.test/shared-card.flect-share",
                }),
              }),
            ),
          );
        yield* open(440);
        yield* controller.dispatch(
          envelope(
            441,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* open(442);
        assert.strictEqual(
          (yield* controller.snapshot).shareReview?.lineage,
          "update",
        );
        assert.deepStrictEqual(
          (yield* controller.snapshot).shareReview?.changes,
          [],
        );

        const prepared = yield* controller.dispatch(
          envelope(
            443,
            PrepareShareUpdate.make({
              type: "prepare-share-update",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.deepStrictEqual(prepared.result, {
          status: "fast-forward",
          shareId: "dev.flect.shared-card",
          candidateCommit: "c".repeat(40),
        });
        const pending = (yield* controller.snapshot).shares?.entries[0];
        assert.strictEqual(pending?.refs.base, "a".repeat(40));
        assert.strictEqual(pending?.refs.upstream, "c".repeat(40));
        assert.strictEqual(pending?.refs.fork, "a".repeat(40));
        assert.strictEqual(pending?.refs.candidate, "c".repeat(40));
        yield* controller.dispatch(
          envelope(
            445,
            ExportShare.make({
              type: "export-share",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        const exportedCandidate = yield* decodeShareArchive(
          yield* controller.readShareExport("dev.flect.shared-card"),
        );
        assert.strictEqual(
          exportedCandidate.manifest.repository.commit,
          "c".repeat(40),
        );
        assert.deepStrictEqual(exportedCandidate.manifest.signatures, []);
        assert.include(
          yield* Ref.get(sharing.calls),
          "export-candidate:dev.flect.shared-card",
        );

        const restarted = yield* FlectWorkspaceController.pipe(
          Effect.provide(makeLayer({ sharingServices: sharing.layer }).layer),
        );
        assert.strictEqual(
          (yield* restarted.snapshot).shareReview?.lineage,
          "update",
        );

        yield* restarted.dispatch(
          envelope(
            444,
            RejectShareCandidate.make({ type: "reject-share-candidate" }),
          ),
        );
        const rejected = (yield* restarted.snapshot).shares?.entries[0];
        assert.strictEqual(rejected?.refs.candidate, undefined);
        assert.strictEqual((yield* restarted.snapshot).shareReview, undefined);
        assert.isUndefined(rejected?.pending);
        assert.deepStrictEqual(yield* Ref.get(sharing.calls), [
          "retain:dev.flect.shared-card",
          "snapshot:dev.flect.shared-card:fork",
          "snapshot:dev.flect.shared-card:fork",
          "update:dev.flect.shared-card",
          "export-candidate:dev.flect.shared-card",
          "reject:dev.flect.shared-card",
        ]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "stages reviewed component source under guarded proposal roots without accepting it",
    () => {
      const sharing = makeSharingServices();
      const checkpoints = Ref.makeUnsafe<ReadonlyArray<ReadonlyArray<string>>>(
        [],
      );
      const acceptedCommit = "d".repeat(40);
      const lastKnownGoodCommit = "e".repeat(40);
      const proposalCommit = "f".repeat(40);
      const unexpected = Effect.die(new Error("Unexpected Git call"));
      const git: GitWorkspaceShape = {
        open: () =>
          Effect.succeed({
            type: "opened",
            variant: "asyncify" as const,
            existed: true,
          }),
        write: () => unexpected,
        read: () => unexpected,
        run: () => unexpected,
        exportRepository: unexpected,
        remove: unexpected,
        checkpoint: (request) =>
          Ref.update(checkpoints, (entries) => [
            ...entries,
            request.files.map((file) => file.path),
          ]).pipe(
            Effect.as({
              type: "checkpointed" as const,
              branch: request.branch,
              commit: "1".repeat(40),
            }),
          ),
        readAtRef: () => unexpected,
        moveRef: () => unexpected,
        snapshotRef: () => unexpected,
        status: (request = {}) =>
          Effect.succeed({
            type: "status",
            acceptedCommit,
            lastKnownGoodCommit,
            authoringCommit: "2".repeat(40),
            ...(request.proposalBranch === undefined
              ? {}
              : {
                  proposalBranch: request.proposalBranch,
                  proposalCommit,
                }),
            conflictPaths: [],
            dirty: false,
          }),
        importRepository: () => unexpected,
        importObjects: () => unexpected,
        deleteRef: () => unexpected,
        inspectCommit: () => unexpected,
        mergeRef: () => unexpected,
        inspectShare: () => unexpected,
      };
      const { layer } = makeLayer({
        sharingServices: sharing.layer,
        git,
      });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const acceptedBefore = (yield* controller.snapshot).shaping.active.id;
        yield* controller.dispatch(
          envelope(
            450,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            451,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        const activated = yield* controller.dispatch(
          envelope(
            452,
            ActivateShareCandidate.make({
              type: "activate-share-candidate",
              shareId: "dev.flect.shared-card",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        const snapshot = yield* controller.snapshot;

        assert.deepStrictEqual(activated.result, {
          status: "activated",
          shareId: "dev.flect.shared-card",
          artifactIds: ["dev.flect.shared-card.component"],
        });
        assert.strictEqual(snapshot.shaping.active.id, acceptedBefore);
        assert.isDefined(snapshot.shaping.proposal);
        assert.deepStrictEqual(yield* Ref.get(checkpoints), [
          [
            "shared/dev.flect.shared-card/dev.flect.shared-card.component/index.tsx",
          ],
        ]);
        yield* controller.dispatch(
          envelope(453, AcceptProposal.make({ type: "accept-proposal" })),
        );
        const accepted = yield* controller.snapshot;
        assert.isUndefined(accepted.shareReview);
        assert.isUndefined(accepted.shares?.entries[0]?.pending);

        yield* controller.dispatch(
          envelope(
            454,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            455,
            PrepareShareUpdate.make({
              type: "prepare-share-update",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            456,
            ActivateShareCandidate.make({
              type: "activate-share-candidate",
              shareId: "dev.flect.shared-card",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(457, AcceptProposal.make({ type: "accept-proposal" })),
        );
        const updated = (yield* controller.snapshot).shares?.entries[0];
        assert.strictEqual(updated?.version, "1.1.0");
        assert.strictEqual(updated?.refs.base, "c".repeat(40));
        assert.strictEqual(updated?.refs.upstream, "c".repeat(40));
        assert.strictEqual(updated?.refs.fork, "c".repeat(40));
        assert.isUndefined(updated?.refs.candidate);
        assert.isUndefined(updated?.pending);
        assert.include(
          yield* Ref.get(sharing.calls),
          "accept:dev.flect.shared-card",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "opens an exact conflict in Shaper and accepts only a bounded resolution candidate",
    () => {
      const sharing = makeSharingServices();
      const { layer, submitShaperInstruction } = makeLayer({
        sharingServices: sharing.layer,
      });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const open = (index: number) =>
          controller.dispatch(
            envelope(
              index,
              OpenShareSource.make({
                type: "open-share-source",
                source: ShareUrlSource.make({
                  _tag: "url",
                  url: "https://example.test/shared-card.flect-share",
                }),
              }),
            ),
          );
        yield* open(460);
        yield* controller.dispatch(
          envelope(
            461,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* Ref.set(sharing.prepareConflict, true);
        yield* open(462);
        yield* controller.dispatch(
          envelope(
            463,
            PrepareShareUpdate.make({
              type: "prepare-share-update",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.strictEqual(
          (yield* controller.snapshot).shareReview?.lineage,
          "conflict",
        );

        yield* controller.dispatch(
          envelope(
            464,
            OpenShareConflictInShape.make({
              type: "open-share-conflict-in-shape",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.deepStrictEqual(yield* Ref.get(sharing.preparedTrees), [
          {
            root: "/workspace/.flect/share-conflicts/dev.flect.shared-card",
            paths: [
              "conflicts.txt",
              "base/components/card/index.tsx",
              "fork/components/card/index.tsx",
              "upstream/components/card/index.tsx",
            ],
          },
        ]);
        const instruction =
          submitShaperInstruction.mock.calls.at(-1)?.[1] ?? "";
        assert.include(instruction, "conflicts.txt");
        assert.include(instruction, "flect share resolve");
        assert.strictEqual(
          (yield* controller.snapshot).workbench?.target,
          "shape",
        );

        const appDenied = yield* controller
          .dispatch(
            envelope(
              465,
              ResolveShareConflict.make({
                type: "resolve-share-conflict",
                shareId: "dev.flect.shared-card",
                expectedBaseCommit: "a".repeat(40),
                expectedUpstreamCommit: "c".repeat(40),
                expectedForkCommit: "a".repeat(40),
                files: [
                  {
                    path: "components/card/index.tsx",
                    contents: new TextEncoder().encode("resolved"),
                  },
                ],
                removals: [],
                message: "Resolve shared card",
              }),
              appAgent,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(appDenied._tag, "ControlUnauthorized");

        const resolved = yield* controller.dispatch(
          envelope(
            466,
            ResolveShareConflict.make({
              type: "resolve-share-conflict",
              shareId: "dev.flect.shared-card",
              expectedBaseCommit: "a".repeat(40),
              expectedUpstreamCommit: "c".repeat(40),
              expectedForkCommit: "a".repeat(40),
              files: [
                {
                  path: "components/card/index.tsx",
                  contents: new TextEncoder().encode("resolved"),
                },
              ],
              removals: [],
              message: "Resolve shared card",
            }),
            shaperAgent,
          ),
        );
        assert.deepStrictEqual(resolved.result, {
          status: "resolved",
          shareId: "dev.flect.shared-card",
          candidateCommit: "e".repeat(40),
        });
        const snapshot = yield* controller.snapshot;
        assert.strictEqual(snapshot.shareReview?.lineage, "fork");
        assert.notInclude(snapshot.shareReview?.blockers ?? [], "conflict");
        assert.strictEqual(
          snapshot.shares?.entries[0]?.refs.candidate,
          "e".repeat(40),
        );

        const restarted = yield* FlectWorkspaceController.pipe(
          Effect.provide(makeLayer({ sharingServices: sharing.layer }).layer),
        );
        const restored = yield* restarted.snapshot;
        assert.strictEqual(restored.shareReview?.lineage, "fork");
        assert.notInclude(restored.shareReview?.blockers ?? [], "conflict");
        assert.strictEqual(
          restored.shares?.entries[0]?.refs.candidate,
          "e".repeat(40),
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "continues a reviewed conflict with the exact retained fork as an inactive candidate",
    () => {
      const sharing = makeSharingServices();
      const { layer, submitShaperInstruction } = makeLayer({
        sharingServices: sharing.layer,
      });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const open = (index: number) =>
          controller.dispatch(
            envelope(
              index,
              OpenShareSource.make({
                type: "open-share-source",
                source: ShareUrlSource.make({
                  _tag: "url",
                  url: "https://example.test/shared-card.flect-share",
                }),
              }),
            ),
          );
        yield* open(467);
        yield* controller.dispatch(
          envelope(
            468,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* Ref.set(sharing.prepareConflict, true);
        yield* open(469);
        yield* controller.dispatch(
          envelope(
            470,
            PrepareShareUpdate.make({
              type: "prepare-share-update",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );

        const continued = yield* controller.dispatch(
          envelope(
            471,
            ContinueShareFork.make({
              type: "continue-share-fork",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );

        assert.deepStrictEqual(continued.result, {
          status: "resolved",
          shareId: "dev.flect.shared-card",
          candidateCommit: "e".repeat(40),
        });
        assert.strictEqual(submitShaperInstruction.mock.calls.length, 0);
        assert.include(
          yield* Ref.get(sharing.calls),
          "resolve:dev.flect.shared-card:1:0",
        );
        const snapshot = yield* controller.snapshot;
        assert.strictEqual(snapshot.shareReview?.lineage, "fork");
        assert.notInclude(snapshot.shareReview?.blockers ?? [], "conflict");
        assert.strictEqual(
          snapshot.shares?.entries[0]?.refs.candidate,
          "e".repeat(40),
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "routes a shared experience through the existing capsule preview",
    () =>
      Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.flect.shared-experience.app",
            name: "Shared experience",
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://example.test/shared-experience",
              revision: "a".repeat(40),
              builder: "@flect/product",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(
                JSON.stringify(
                  InterfaceDocument.make({
                    version: 2,
                    name: "Shared experience UI",
                    root: {
                      id: "root",
                      type: "stack",
                      direction: "column",
                      gap: "md",
                      children: [],
                    },
                  }),
                ),
              ),
            },
          ],
        });
        const sharing = makeSharingServices();
        yield* Ref.set(sharing.candidateOverride, {
          manifest: {
            formatVersion: 1,
            id: "dev.flect.shared-experience",
            name: "Shared experience",
            version: "1.0.0",
            repository: ShareEmbeddedRepository.make({
              _tag: "embedded",
              archivePath: "repository.tar",
              sha256: "b".repeat(64),
              commit: "a".repeat(40),
            }),
            artifacts: [
              {
                id: "dev.flect.shared-experience.experience",
                kind: "experience",
                version: "1.0.0",
                sourceRoot: "experiences/app",
                contentSha256: "b".repeat(64),
                capsule: {
                  path: "artifacts/app.flect",
                  sha256: yield* hashCapsuleArchive(archive),
                },
              },
            ],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://example.test/shared-experience",
              revision: "a".repeat(40),
              builder: "@flect/product",
            },
            signatures: [],
            migrations: [],
          },
          repository: new Uint8Array([1, 2, 3]),
          artifacts: [{ path: "artifacts/app.flect", contents: archive }],
          files: [
            {
              path: "experiences/app/README.md",
              contents: new TextEncoder().encode("Shared experience"),
            },
          ],
          archiveSha256: "c".repeat(64),
        });
        const { layer } = makeLayer({
          sharingServices: sharing.layer,
          git: makeIdleGit(),
        });
        const controller = yield* FlectWorkspaceController.pipe(
          Effect.provide(layer),
        );
        yield* controller.dispatch(
          envelope(
            455,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-experience.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            456,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-experience.experience"],
            }),
          ),
        );
        const activated = yield* controller.dispatch(
          envelope(
            457,
            ActivateShareCandidate.make({
              type: "activate-share-candidate",
              shareId: "dev.flect.shared-experience",
              artifactIds: ["dev.flect.shared-experience.experience"],
            }),
          ),
        );
        const snapshot = yield* controller.snapshot;
        const presentation = yield* controller.capsulePresentation ??
          Effect.die("capsule presentation unavailable");

        assert.deepStrictEqual(activated.result, {
          status: "activated",
          shareId: "dev.flect.shared-experience",
          artifactIds: ["dev.flect.shared-experience.experience"],
        });
        assert.strictEqual(
          snapshot.shaping.proposal?.document.name,
          "Shared experience UI",
        );
        assert.strictEqual(
          presentation.candidateReview?.id,
          "dev.flect.shared-experience.app",
        );
      }),
  );

  it.effect(
    "routes a shared extension through candidate enable, test, and Keep gates",
    () =>
      Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.flect.shared-extension.package",
            name: "Shared extension",
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [],
            extensions: [portablePackage],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://example.test/shared-extension",
              revision: "a".repeat(40),
              builder: "@flect/product",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(
                JSON.stringify(defaultInterfaceDocument),
              ),
            },
            {
              path: portablePackage.bundle,
              contents: new TextEncoder().encode("() => []"),
            },
          ],
        });
        const sharing = makeSharingServices();
        yield* Ref.set(sharing.candidateOverride, {
          manifest: {
            formatVersion: 1,
            id: "dev.flect.shared-extension",
            name: "Shared extension",
            version: "1.0.0",
            repository: ShareEmbeddedRepository.make({
              _tag: "embedded",
              archivePath: "repository.tar",
              sha256: "b".repeat(64),
              commit: "a".repeat(40),
            }),
            artifacts: [
              {
                id: "dev.flect.shared-extension.extension",
                kind: "extension",
                version: "1.0.0",
                sourceRoot: "extensions/guide",
                contentSha256: "b".repeat(64),
                capsule: {
                  path: "artifacts/extension.flect",
                  sha256: yield* hashCapsuleArchive(archive),
                },
              },
            ],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://example.test/shared-extension",
              revision: "a".repeat(40),
              builder: "@flect/product",
            },
            signatures: [],
            migrations: [],
          },
          repository: new Uint8Array([1, 2, 3]),
          artifacts: [{ path: "artifacts/extension.flect", contents: archive }],
          files: [
            {
              path: "extensions/guide/README.md",
              contents: new TextEncoder().encode("Shared extension"),
            },
          ],
          archiveSha256: "c".repeat(64),
        });
        const { layer } = makeLayer({
          sharingServices: sharing.layer,
          extensionServices: makePortableExtensionServices(
            "dev.flect.shared-extension.package",
          ),
        });
        const controller = yield* FlectWorkspaceController.pipe(
          Effect.provide(layer),
        );
        yield* controller.dispatch(
          envelope(
            465,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-extension.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            466,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-extension.extension"],
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            467,
            ActivateShareCandidate.make({
              type: "activate-share-candidate",
              shareId: "dev.flect.shared-extension",
              artifactIds: ["dev.flect.shared-extension.extension"],
            }),
          ),
        );
        assert.deepStrictEqual(
          (yield* controller.snapshot).extensions?.entries.map((entry) => [
            entry.capsuleId,
            entry.extensionId,
            entry.role,
            entry.binding,
            entry.state,
          ]),
          [
            [
              "dev.flect.shared-extension.package",
              portablePackage.id,
              "app",
              "candidate",
              "available",
            ],
            [
              "dev.flect.shared-extension.package",
              portablePackage.id,
              "shaper",
              "candidate",
              "available",
            ],
          ],
        );

        yield* controller.dispatch(
          envelope(
            468,
            SetPortableExtensionEnabled.make({
              type: "set-portable-extension-enabled",
              capsuleId: "dev.flect.shared-extension.package",
              extensionId: portablePackage.id,
              role: "app",
              binding: "candidate",
              enabled: true,
              grants: ["interface:read"],
            }),
          ),
        );
        const blocked = yield* controller
          .dispatch(
            envelope(469, AcceptProposal.make({ type: "accept-proposal" })),
          )
          .pipe(Effect.flip);
        assert.strictEqual(blocked._tag, "OperationFailed");
        assert.deepStrictEqual(
          (yield* controller.snapshot).extensions?.entries.map((entry) => [
            entry.capsuleId,
            entry.extensionId,
            entry.role,
            entry.binding,
            entry.tested,
          ]),
          [
            [
              "dev.flect.shared-extension.package",
              portablePackage.id,
              "app",
              "candidate",
              false,
            ],
            [
              "dev.flect.shared-extension.package",
              portablePackage.id,
              "shaper",
              "candidate",
              false,
            ],
          ],
        );
        yield* controller.dispatch(
          envelope(
            470,
            TestPortableExtension.make({
              type: "test-portable-extension",
              capsuleId: "dev.flect.shared-extension.package",
              extensionId: portablePackage.id,
              role: "app",
              binding: "candidate",
              input: {},
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(471, AcceptProposal.make({ type: "accept-proposal" })),
        );
        const extensions = (yield* controller.snapshot).extensions;
        assert.isTrue(
          extensions?.entries.every((entry) => entry.binding === "accepted") ??
            false,
        );
        assert.strictEqual(
          extensions?.entries.find((entry) => entry.role === "app")?.tested,
          true,
        );
      }),
  );

  it.effect(
    "rechecks signature authority immediately before share activation",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({
        sharingServices: sharing.layer,
        git: makeIdleGit(),
      });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            460,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            461,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* Ref.set(sharing.signatureStatus, "invalid");

        const failure = yield* controller
          .dispatch(
            envelope(
              462,
              ActivateShareCandidate.make({
                type: "activate-share-candidate",
                shareId: "dev.flect.shared-card",
                artifactIds: ["dev.flect.shared-card.component"],
              }),
              outside,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(failure._tag, "OperationFailed");
        assert.strictEqual(
          failure.message,
          "Resolve the shared review blockers before activation.",
        );
        assert.strictEqual(
          (yield* controller.snapshot).shaping.proposal,
          undefined,
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "keeps a retained share inactive while the protected shell is in safe mode",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({
        sharingServices: sharing.layer,
        git: makeIdleGit(),
      });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            463,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            464,
            RetainShareCandidate.make({
              type: "retain-share-candidate",
              artifactIds: ["dev.flect.shared-card.component"],
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(465, EnterSafeMode.make({ type: "enter-safe-mode" })),
        );

        const failure = yield* controller
          .dispatch(
            envelope(
              466,
              ActivateShareCandidate.make({
                type: "activate-share-candidate",
                shareId: "dev.flect.shared-card",
                artifactIds: ["dev.flect.shared-card.component"],
              }),
            ),
          )
          .pipe(Effect.flip);
        const snapshot = yield* controller.snapshot;

        assert.strictEqual(failure._tag, "OperationFailed");
        assert.strictEqual(
          failure.message,
          "Restore the interface before activating shared source.",
        );
        assert.strictEqual(snapshot.phase, "safe-mode");
        assert.strictEqual(
          snapshot.shareReview?.shareId,
          "dev.flect.shared-card",
        );
        assert.strictEqual(
          snapshot.shares?.entries[0]?.pending?.lineage,
          "new",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "exports the exact reviewed candidate as a deterministic share archive",
    () => {
      const sharing = makeSharingServices();
      const { layer } = makeLayer({ sharingServices: sharing.layer });
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            470,
            OpenShareSource.make({
              type: "open-share-source",
              source: ShareUrlSource.make({
                _tag: "url",
                url: "https://example.test/shared-card.flect-share",
              }),
            }),
          ),
        );
        const receipt = yield* controller.dispatch(
          envelope(
            471,
            ExportShare.make({
              type: "export-share",
              shareId: "dev.flect.shared-card",
            }),
          ),
        );
        assert.match(
          String(
            typeof receipt.result === "object" && receipt.result !== null
              ? Reflect.get(receipt.result, "archiveSha256")
              : "",
          ),
          /^[0-9a-f]{64}$/,
        );
        const archive = yield* controller.readShareExport(
          "dev.flect.shared-card",
        );
        const decoded = yield* decodeShareArchive(archive);
        assert.strictEqual(decoded.manifest.id, "dev.flect.shared-card");
        assert.strictEqual(decoded.manifest.repository.commit, "a".repeat(40));
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("projects session-only capsule persistence into public state", () =>
    Effect.gen(function* () {
      const { layer } = makeLayer({
        capsuleStore: {
          persistence: "session",
          load: Effect.succeed({}),
          save: () => Effect.void,
        },
      });
      const controller = yield* FlectWorkspaceController.pipe(
        Effect.provide(layer),
      );

      const persistence = (yield* controller.snapshot).persistence;
      assert.strictEqual(persistence?.source, "unavailable");
      assert.strictEqual(persistence?.capsule, "session");
    }),
  );

  it.effect(
    "opens an imported declarative capsule as an isolated proposal",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.akua.imported",
            name: "Imported product",
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "fixture",
              source: "fixture",
              revision: "fixture",
              builder: "test",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(
                JSON.stringify(
                  InterfaceDocument.make({
                    version: 2,
                    name: "Imported product",
                    root: {
                      id: "root",
                      type: "stack",
                      direction: "column",
                      gap: "lg",
                      children: [
                        {
                          id: "title",
                          type: "text",
                          text: "Imported product",
                          style: "headline",
                        },
                      ],
                    },
                  }),
                ),
              ),
            },
          ],
        });
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(69, ImportCapsule.make({ type: "import-capsule", archive })),
        );
        const snapshot = yield* controller.snapshot;
        assert.strictEqual(
          snapshot.shaping.proposal?.document.name,
          "Imported product",
        );
        assert.strictEqual(snapshot.shaping.proposal?.status, "previewed");
        assert.strictEqual(snapshot.workbench?.binding, "candidate");
        const review = yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({});
        assert.strictEqual(review?.candidateReview?.id, "dev.akua.imported");
        assert.strictEqual(review?.candidateReview?.publisher, "fixture");
        assert.strictEqual(review?.candidateReview?.signatureCount, 0);
        assert.deepStrictEqual(review?.candidateReview?.platforms, [
          "browser",
          "macos",
        ]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "stages, enables, tests, promotes, invokes, pins, disables, and removes role-scoped extensions",
    () => {
      const { layer } = makeLayer({
        extensionServices: makePortableExtensionServices(),
      });
      return Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.akua.portable",
            name: "Portable product",
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [],
            extensions: [portablePackage],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser", "macos"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://github.com/akua-dev/portable",
              revision: "v1.0.0",
              builder: "test",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(
                JSON.stringify(
                  InterfaceDocument.make({
                    version: 2,
                    name: "Portable product",
                    root: {
                      id: "root",
                      type: "text",
                      text: "Portable product",
                      style: "headline",
                    },
                  }),
                ),
              ),
            },
            {
              path: portablePackage.bundle,
              contents: new TextEncoder().encode("() => []"),
            },
          ],
        });
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            720,
            ImportCapsule.make({ type: "import-capsule", archive }),
          ),
        );
        let extensions = (yield* controller.snapshot).extensions;
        assert.deepStrictEqual(
          extensions?.entries.map((entry) => [
            entry.role,
            entry.binding,
            entry.state,
          ]),
          [
            ["app", "candidate", "available"],
            ["shaper", "candidate", "available"],
          ],
        );

        const activation = SetPortableExtensionEnabled.make({
          type: "set-portable-extension-enabled",
          capsuleId: "dev.akua.portable",
          extensionId: "weather-card",
          role: "app",
          binding: "candidate",
          enabled: true,
          grants: ["interface:read"],
        });
        const unauthorized = yield* controller
          .dispatch(envelope(721, activation, appAgent))
          .pipe(Effect.flip);
        assert.strictEqual(unauthorized._tag, "ControlUnauthorized");

        yield* controller.dispatch(envelope(722, activation));
        const untested = yield* controller
          .dispatch(
            envelope(723, AcceptProposal.make({ type: "accept-proposal" })),
          )
          .pipe(Effect.flip);
        assert.strictEqual(untested._tag, "OperationFailed");
        assert.strictEqual(
          (yield* controller.snapshot).shaping.proposal?.status,
          "previewed",
        );

        yield* controller.dispatch(
          envelope(
            724,
            TestPortableExtension.make({
              type: "test-portable-extension",
              capsuleId: "dev.akua.portable",
              extensionId: "weather-card",
              role: "app",
              binding: "candidate",
              input: { city: "Berlin" },
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(725, AcceptProposal.make({ type: "accept-proposal" })),
        );
        extensions = (yield* controller.snapshot).extensions;
        assert.isTrue(
          extensions?.entries.every((entry) => entry.binding === "accepted") ??
            false,
        );
        assert.strictEqual(
          extensions?.entries.find((entry) => entry.role === "app")?.tested,
          true,
        );

        yield* controller.dispatch(
          envelope(
            726,
            InvokePortableExtension.make({
              type: "invoke-portable-extension",
              capsuleId: "dev.akua.portable",
              extensionId: "weather-card",
              role: "app",
              binding: "accepted",
              input: { city: "Berlin" },
            }),
            appAgent,
          ),
        );
        yield* controller.dispatch(
          envelope(
            727,
            SetPortableExtensionPin.make({
              type: "set-portable-extension-pin",
              capsuleId: "dev.akua.portable",
              extensionId: "weather-card",
              role: "app",
              binding: "accepted",
              pinned: true,
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            728,
            SetPortableExtensionEnabled.make({
              ...activation,
              binding: "accepted",
              enabled: false,
              grants: [],
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            729,
            RemovePortableExtension.make({
              type: "remove-portable-extension",
              capsuleId: "dev.akua.portable",
              extensionId: "weather-card",
              role: "app",
              binding: "accepted",
            }),
          ),
        );
        const final = (yield* controller.snapshot).extensions;
        assert.deepStrictEqual(
          final?.entries.map((entry) => entry.role),
          ["shaper"],
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "builds an imported Vite project from the exact Git proposal before review",
    () => {
      const acceptedCommit = "a".repeat(40);
      const lastKnownGoodCommit = "b".repeat(40);
      const proposalCommit = "c".repeat(40);
      const generatedLock = new TextEncoder().encode(
        '{"lockfileVersion":3,"packages":{}}',
      );
      const compile = vi.fn<ProposalBuildShape["compile"]>(() =>
        Effect.succeed(
          BrowserBuildArtifact.make({
            version: 1,
            buildId: "build-cccccccccccccccc",
            sourceRevision: proposalCommit,
            inputDigest: "d".repeat(64),
            artifactDigest: "e".repeat(64),
            outputs: [
              {
                path: "app.js",
                kind: "chunk",
                contents: new TextEncoder().encode(
                  "document.body.dataset.ready='true'",
                ),
              },
            ],
          }),
        ),
      );
      const checkpoint = vi.fn<GitWorkspaceShape["checkpoint"]>(() =>
        Effect.succeed({
          type: "checkpointed" as const,
          branch: "flect/authoring",
          commit: "f".repeat(40),
        }),
      );
      const unexpected = Effect.die(new Error("Unexpected Git call"));
      const git: GitWorkspaceShape = {
        open: () =>
          Effect.succeed({
            type: "opened",
            variant: "asyncify" as const,
            existed: true,
          }),
        write: () => unexpected,
        read: () => unexpected,
        run: () => unexpected,
        exportRepository: unexpected,
        remove: unexpected,
        checkpoint,
        readAtRef: () => unexpected,
        moveRef: () => unexpected,
        snapshotRef: () => unexpected,
        status: (request = {}) =>
          Effect.succeed({
            type: "status",
            acceptedCommit,
            lastKnownGoodCommit,
            authoringCommit: "f".repeat(40),
            ...(request.proposalBranch === undefined
              ? {}
              : {
                  proposalBranch: request.proposalBranch,
                  proposalCommit,
                }),
            conflictPaths: [],
            dirty: false,
          }),
        importRepository: () => unexpected,
        importObjects: () => unexpected,
        deleteRef: () => unexpected,
        inspectCommit: () => unexpected,
        mergeRef: () => unexpected,
        inspectShare: () => unexpected,
      };
      const { layer } = makeLayer({
        git,
        proposalBuild: {
          compile,
          resolvePackageLock: () =>
            Effect.succeed({
              contents: generatedLock,
              needsCheckpoint: true,
            }),
        },
      });
      return Effect.gen(function* () {
        const imported = yield* importWebProject([
          {
            path: "dashboard/index.html",
            contents: new TextEncoder().encode(
              '<div id="root"></div><script type="module" src="/src/main.ts"></script>',
            ),
          },
          {
            path: "dashboard/src/main.ts",
            contents: new TextEncoder().encode(
              "document.querySelector('#root')!.textContent='Built'",
            ),
          },
        ]);
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            703,
            ImportCapsule.make({
              type: "import-capsule",
              archive: imported.archive,
            }),
          ),
        );
        const presentation = yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({});
        const workspaceSnapshot = yield* controller.snapshot;

        assert.strictEqual(presentation.candidate?.name, "dashboard");
        assert.strictEqual(workspaceSnapshot.build?.phase, "succeeded");
        assert.strictEqual(
          workspaceSnapshot.build?.artifactDigest,
          "e".repeat(64),
        );
        assert.strictEqual(
          presentation.candidateReview?.revision,
          proposalCommit,
        );
        const buildRequest = compile.mock.calls[0]?.[0];
        assert.ok(buildRequest !== undefined);
        assert.match(buildRequest.proposalBranch, /^flect\/proposal\//);
        assert.strictEqual(buildRequest.proposalCommit, proposalCommit);
        assert.strictEqual(buildRequest.acceptedCommit, acceptedCommit);
        assert.strictEqual(
          buildRequest.lastKnownGoodCommit,
          lastKnownGoodCommit,
        );
        assert.strictEqual(buildRequest.entrypoint, "src/main.ts");
        assert.ok(
          checkpoint.mock.calls[0]?.[0].files.some(
            (file) => file.path === "project/src/main.ts",
          ),
        );
        assert.ok(
          checkpoint.mock.calls[1]?.[0].files.some(
            (file) =>
              file.path === "project/package-lock.json" &&
              file.contents === generatedLock,
          ),
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "keeps required capsule capabilities visible but blocks activation",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.akua.capability-review",
            name: "Capability review",
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [
              { id: "product:projects:read", required: true },
              { id: "product:projects:write", required: false },
            ],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://github.com/akua-dev/example",
              revision: "0123456789abcdef",
              builder: "flect-test",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(
                JSON.stringify(
                  InterfaceDocument.make({
                    version: 2,
                    name: "Capability review",
                    root: {
                      id: "root",
                      type: "text",
                      text: "Review me",
                      style: "body",
                    },
                  }),
                ),
              ),
            },
          ],
        });
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            211,
            ImportCapsule.make({ type: "import-capsule", archive }),
          ),
        );
        const review = (yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({})).candidateReview;
        assert.deepStrictEqual(
          review?.capabilities.map((capability) => ({
            id: capability.capabilityId,
            required: capability.required,
            availability: capability.availability,
            state: capability.state,
          })),
          [
            {
              id: "product:projects:read",
              required: true,
              availability: "unavailable",
              state: "requested",
            },
            {
              id: "product:projects:write",
              required: false,
              availability: "unavailable",
              state: "requested",
            },
          ],
        );
        assert.match(
          review?.permissionContext.requestDigest ?? "",
          /^[0-9a-f]{64}$/,
        );
        assert.strictEqual(review?.activationBlocked, true);

        const failure = yield* controller
          .dispatch(
            envelope(212, AcceptProposal.make({ type: "accept-proposal" })),
          )
          .pipe(Effect.flip);
        assert.strictEqual(failure._tag, "OperationFailed");
        assert.strictEqual(
          (yield* controller.snapshot).shaping.proposal?.status,
          "previewed",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "binds decisions to the capsule digest, routes approved operations, records receipts, and permits outside revocation only",
    () => {
      let state: "available" | "granted" | "revoked" = "available";
      const decisionId = "decision-capability-0001";
      const projection = (
        context: Parameters<ProductCapabilityRegistryShape["permissions"]>[0],
      ) =>
        ProductCapabilityProjection.make({
          version: 1,
          scopeId: context.scopeId,
          workspaceId: context.workspaceId,
          requestDigest: context.requestDigest,
          revision: context.revision,
          capabilityId: "product:projects:read",
          state,
          availability: "available",
          requested: true,
          required: true,
          confirmationPolicies: ["session"],
          operationIds: ["projects.list"],
          resourceIds: ["projects.workspace"],
          dataClassIds: ["projects.summary"],
          ...(state === "available"
            ? {}
            : {
                decisionId,
                confirmationPolicy: "session",
              }),
        });
      const decide = vi.fn<ProductCapabilityRegistryShape["decide"]>(
        (context, capabilityId, choice) =>
          Effect.sync(() => {
            assert.strictEqual(capabilityId, "product:projects:read");
            assert.strictEqual(choice.type, "allow");
            state = "granted";
            return projection(context);
          }),
      );
      const revoke = vi.fn<ProductCapabilityRegistryShape["revoke"]>((id) =>
        Effect.sync(() => {
          assert.strictEqual(id, decisionId);
          state = "revoked";
        }),
      );
      const invokeDetailed = vi.fn<
        ProductCapabilityRegistryShape["invokeDetailed"]
      >((_context, invocation) =>
        invocation.operationId === "projects.list" && state === "granted"
          ? Effect.succeed(
              ProductOperationExecution.make({
                version: 1,
                output: { projects: ["one"] },
                reservation: ProductCapabilityReservation.make({
                  version: 1,
                  decisionId,
                  capabilityId: "product:projects:read",
                  operationId: "projects.list",
                  confirmationPolicy: "session",
                  approvedResourceIds: ["projects.workspace"],
                  approvedDataClassIds: ["projects.summary"],
                }),
              }),
            )
          : Effect.fail(
              ProductOperationFailure.make({
                operationId: invocation.operationId,
                reason: "denied",
                message: "The product operation was denied.",
              }),
            ),
      );
      const { layer } = makeLayer({
        productRegistry: {
          catalog: (context) =>
            Effect.sync(() => [
              ProductOperationSummary.make({
                version: 1,
                id: "projects.list",
                capabilityId: "product:projects:read",
                permission: projection(context),
              }),
              ProductOperationSummary.make({
                version: 1,
                id: "projects.delete",
                capabilityId: "product:projects:write",
              }),
            ]),
          permissions: (context) => Effect.sync(() => [projection(context)]),
          decide,
          revoke,
          invoke: (context, invocation) =>
            invokeDetailed(context, invocation).pipe(
              Effect.map((execution) => execution.output),
            ),
          invokeDetailed,
        },
      });
      return Effect.gen(function* () {
        const archive = yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: "dev.akua.capability-runtime",
            name: "Capability runtime",
            version: "1.0.0",
            entrypoints: [{ id: "main", path: "ui/index.html" }],
            capabilities: [{ id: "product:projects:read", required: true }],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser"],
            },
            provenance: {
              publisher: "akua-dev",
              source: "fixture",
              revision: "fixture",
              builder: "test",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/index.html",
              contents: new TextEncoder().encode("<main>Projects</main>"),
            },
          ],
        });
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            213,
            ImportCapsule.make({ type: "import-capsule", archive }),
          ),
        );
        const candidateReview = (yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({})).candidateReview;
        assert.strictEqual(candidateReview?.activationBlocked, true);
        assert.strictEqual(
          candidateReview?.capabilities[0]?.state,
          "available",
        );
        assert.match(
          candidateReview?.permissionContext.requestDigest ?? "",
          /^[0-9a-f]{64}$/,
        );
        const unknownScopeGrant = yield* controller
          .dispatch(
            envelope(
              230,
              DecideProductCapability.make({
                type: "decide-product-capability",
                capsuleId: "dev.akua.other",
                capabilityId: "product:projects:read",
                choice: ProductCapabilityAllowChoice.make({
                  type: "allow",
                  confirmationPolicy: "session",
                }),
              }),
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(unknownScopeGrant._tag, "OperationFailed");
        assert.strictEqual(decide.mock.calls.length, 0);
        yield* controller.dispatch(
          envelope(
            214,
            DecideProductCapability.make({
              type: "decide-product-capability",
              capsuleId: "dev.akua.capability-runtime",
              capabilityId: "product:projects:read",
              choice: ProductCapabilityAllowChoice.make({
                type: "allow",
                confirmationPolicy: "session",
              }),
            }),
          ),
        );
        assert.strictEqual(
          decide.mock.calls[0]?.[0].requestDigest,
          candidateReview?.permissionContext.requestDigest,
        );
        const grantedReview = (yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({})).candidateReview;
        assert.strictEqual(grantedReview?.activationBlocked, false);
        assert.strictEqual(grantedReview?.capabilities[0]?.state, "granted");
        yield* controller.dispatch(
          envelope(215, AcceptProposal.make({ type: "accept-proposal" })),
        );

        const capsule = CapsuleCommandSource.make({
          kind: "capsule",
          capsuleId: "dev.akua.capability-runtime",
          binding: "accepted",
          intentId: "intent-projects1",
        });
        const capsuleReceipt = yield* controller.dispatch(
          envelope(
            216,
            InvokeProductOperation.make({
              type: "invoke-product-operation",
              operationId: "projects.list",
              input: { limit: 2 },
            }),
            capsule,
          ),
        );
        assert.deepStrictEqual(capsuleReceipt.result, { projects: ["one"] });

        const appReceipt = yield* controller.dispatch(
          envelope(
            217,
            InvokeProductOperation.make({
              type: "invoke-product-operation",
              operationId: "projects.list",
              input: null,
            }),
            appAgent,
          ),
        );
        assert.deepStrictEqual(appReceipt.result, { projects: ["one"] });

        const denied = yield* controller
          .dispatch(
            envelope(
              218,
              InvokeProductOperation.make({
                type: "invoke-product-operation",
                operationId: "projects.delete",
                input: null,
              }),
              capsule,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(denied._tag, "OperationFailed");
        assert.strictEqual(invokeDetailed.mock.calls.length, 2);
        assert.deepStrictEqual(
          invokeDetailed.mock.calls[0]?.[0],
          grantedReview?.permissionContext,
        );
        assert.deepStrictEqual(
          invokeDetailed.mock.calls[0]?.[1],
          ProductOperationInvocation.make({
            version: 1,
            operationId: "projects.list",
            input: { limit: 2 },
          }),
        );
        const outsideGrant = yield* controller
          .dispatch(
            envelope(
              219,
              DecideProductCapability.make({
                type: "decide-product-capability",
                capsuleId: "dev.akua.capability-runtime",
                capabilityId: "product:projects:read",
                choice: ProductCapabilityAllowChoice.make({
                  type: "allow",
                  confirmationPolicy: "session",
                }),
              }),
              outside,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(outsideGrant._tag, "ControlUnauthorized");
        yield* controller.dispatch(
          envelope(
            220,
            RevokeProductCapability.make({
              type: "revoke-product-capability",
              decisionId,
            }),
            outside,
          ),
        );
        const acceptedReview = (yield* controller.capsulePresentation ??
          Effect.succeed<CapsulePresentationState>({})).acceptedReview;
        assert.strictEqual(acceptedReview?.capabilities[0]?.state, "revoked");
        const capabilityRecords =
          (yield* controller.snapshot).operations.filter(
            (record) => record.capability !== undefined,
          );
        assert.strictEqual(capabilityRecords.length, 2);
        assert.strictEqual(
          capabilityRecords[0]?.capability?.decisionId,
          decisionId,
        );
        assert.notProperty(capabilityRecords[0]?.capability, "input");
        const revoked = yield* controller
          .dispatch(
            envelope(
              221,
              InvokeProductOperation.make({
                type: "invoke-product-operation",
                operationId: "projects.list",
                input: null,
              }),
              capsule,
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(revoked._tag, "OperationFailed");
        assert.strictEqual(invokeDetailed.mock.calls.length, 2);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "answers Use questions and applies only a typed edit-tool handoff",
    () => {
      const { layer, submitAppPrompt, submitShaperInstruction } = makeLayer();
      submitAppPrompt
        .mockReturnValueOnce(Effect.succeed(AgentPromptOutcome.make({})))
        .mockReturnValueOnce(
          Effect.succeed(
            AgentPromptOutcome.make({
              editRequest: InterfaceEditRequested.make({
                type: "interface_edit_requested",
                requestId: "tool-controller-edit-1",
                instruction: "Make the primary action blue",
              }),
            }),
          ),
        );
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            70,
            SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: "Create a product",
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(71, AcceptProposal.make({ type: "accept-proposal" })),
        );

        yield* controller.dispatch(
          envelope(
            72,
            SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text: "Can you see the UI?",
            }),
          ),
        );
        assert.strictEqual(
          (yield* controller.snapshot).shaping.proposal,
          undefined,
        );

        yield* controller.dispatch(
          envelope(
            73,
            SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text: "Change the primary action",
            }),
          ),
        );
        const preview = yield* controller.snapshot;
        assert.strictEqual(preview.shaping.proposal?.status, "previewed");
        assert.strictEqual(preview.workbench?.target, "use");
        assert.strictEqual(preview.workbench?.binding, "candidate");
        assert.strictEqual(
          preview.workbench?.handoff?.instruction,
          "Make the primary action blue",
        );
        assert.include(
          submitShaperInstruction.mock.calls.at(-1)?.[1] ?? "",
          "Revision:",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("uses an explicit warm Shape and candidate Use workbench", () => {
    const { layer, submitPreviewPrompt } = makeLayer();
    return Effect.gen(function* () {
      const controller = yield* FlectWorkspaceController;
      const initial = yield* controller.snapshot;

      assert.strictEqual(initial.workbench?.target, "shape");
      yield* controller.dispatch(
        envelope(
          60,
          SubmitShaperInstruction.make({
            type: "submit-shaper-instruction",
            instruction: "Create a focused product",
          }),
        ),
      );
      const preview = yield* controller.snapshot;
      assert.strictEqual(preview.workbench?.target, "use");
      assert.strictEqual(preview.workbench?.binding, "candidate");
      assert.strictEqual(preview.mode, "edit");

      yield* controller.dispatch(
        envelope(
          61,
          SubmitAppPrompt.make({
            type: "submit-app-prompt",
            text: "What can this candidate do?",
          }),
        ),
      );
      assert.strictEqual(submitPreviewPrompt.mock.calls.length, 1);
      assert.strictEqual(
        submitPreviewPrompt.mock.calls[0]?.[1],
        "What can this candidate do?",
      );

      yield* controller.dispatch(
        envelope(
          62,
          SelectWorkbenchTarget.make({
            type: "select-workbench-target",
            target: "shape",
          }),
        ),
      );
      assert.strictEqual(
        (yield* controller.snapshot).workbench?.target,
        "shape",
      );

      yield* controller.dispatch(
        envelope(
          63,
          SubmitShaperInstruction.make({
            type: "submit-shaper-instruction",
            instruction: "Correct the candidate",
          }),
        ),
      );
      const corrected = yield* controller.snapshot;
      assert.strictEqual(corrected.workbench?.target, "use");
      assert.strictEqual(corrected.shaping.proposal?.status, "previewed");
      assert.notStrictEqual(
        corrected.shaping.proposal?.id,
        preview.shaping.proposal?.id,
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "rejects stale failure handoffs and injects only correlated evidence",
    () => {
      const { layer, submitShaperInstruction } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const journal = yield* OperationJournal;
        yield* controller.dispatch(
          envelope(
            80,
            SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: "Create a product",
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(81, AcceptProposal.make({ type: "accept-proposal" })),
        );
        yield* controller
          .dispatch(
            envelope(
              82,
              InvokeInterfaceAction.make({
                type: "invoke-interface-action",
                nodeId: "missing-action",
              }),
            ),
          )
          .pipe(Effect.flip);
        const failed = (yield* journal.query(
          OperationQuery.make({ failuresOnly: true }),
        )).at(-1);
        assert.isDefined(failed);
        if (failed === undefined) {
          return;
        }
        const current = yield* controller.snapshot;
        const stale = yield* controller
          .dispatch(
            envelope(
              83,
              RequestShapeHandoff.make({
                type: "request-shape-handoff",
                handoff: WorkbenchHandoff.make({
                  version: 1,
                  instruction: "Fix the failed action",
                  revisionId: RevisionId.make("revision-stale-handoff"),
                  failureOperationId: failed.operationId,
                }),
              }),
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(stale._tag, "OperationFailed");

        const uncorrelated = yield* controller
          .dispatch(
            envelope(
              84,
              RequestShapeHandoff.make({
                type: "request-shape-handoff",
                handoff: WorkbenchHandoff.make({
                  version: 1,
                  instruction: "Fix an invented failure",
                  revisionId: current.shaping.active.id,
                  failureOperationId: "operation-invented-failure",
                }),
              }),
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(uncorrelated._tag, "OperationFailed");

        const unavailableNode = yield* controller
          .dispatch(
            envelope(
              85,
              RequestShapeHandoff.make({
                type: "request-shape-handoff",
                handoff: WorkbenchHandoff.make({
                  version: 1,
                  instruction: "Fix a selected element",
                  revisionId: current.shaping.active.id,
                  selectedNodeId: "invented-node",
                }),
              }),
            ),
          )
          .pipe(Effect.flip);
        assert.strictEqual(unavailableNode._tag, "OperationFailed");

        yield* controller.dispatch(
          envelope(
            86,
            RequestShapeHandoff.make({
              type: "request-shape-handoff",
              handoff: WorkbenchHandoff.make({
                version: 1,
                instruction: "Fix the failed action",
                revisionId: current.shaping.active.id,
                selectedNodeId: "shape-interface",
                failureOperationId: failed.operationId,
                failureSummary: "The product action failed safely.",
              }),
            }),
          ),
        );

        const instruction =
          submitShaperInstruction.mock.calls.at(-1)?.[1] ?? "";
        assert.include(instruction, `Revision: ${current.shaping.active.id}`);
        assert.include(instruction, "Selected interface node: shape-interface");
        assert.include(instruction, `Failed operation: ${failed.operationId}`);
        assert.include(
          instruction,
          "Redacted failure summary: invoke-interface-action failed (CommandRejected)",
        );
        assert.notInclude(instruction, "The product action failed safely.");
        assert.notInclude(instruction, "missing-action");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "routes user and outside commands through one idempotent state machine",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const first = yield* controller.dispatch(
          envelope(
            1,
            SetMode.make({ type: "set-mode", mode: "edit" }),
            outside,
          ),
        );
        const afterFirst = yield* controller.snapshot;
        const duplicate = yield* controller.dispatch(
          envelope(
            1,
            SetMode.make({ type: "set-mode", mode: "edit" }),
            outside,
          ),
        );
        const afterDuplicate = yield* controller.snapshot;
        const userReceipt = yield* controller.dispatch(
          envelope(2, SetMode.make({ type: "set-mode", mode: "edit" })),
        );

        assert.strictEqual(first.status, "completed");
        assert.strictEqual(duplicate.status, "duplicate");
        assert.strictEqual(afterFirst.mode, "edit");
        assert.strictEqual(afterDuplicate.sequence, afterFirst.sequence);
        assert.strictEqual(userReceipt.status, "completed");
        assert.strictEqual((yield* controller.snapshot).mode, "edit");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "rejects stale sequences and outside attempts to enable control",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const initial = yield* controller.snapshot;
        yield* controller.dispatch(
          envelope(1, Inspect.make({ type: "inspect" })),
        );
        const conflict = yield* controller
          .dispatch(
            envelope(
              2,
              SetMode.make({ type: "set-mode", mode: "run" }),
              user,
              initial.sequence,
            ),
          )
          .pipe(Effect.flip);
        const unauthorized = yield* controller
          .dispatch(
            envelope(
              3,
              EnableControl.make({ type: "enable-control" }),
              outside,
            ),
          )
          .pipe(Effect.flip);

        assert.strictEqual(conflict._tag, "CommandConflict");
        assert.strictEqual(unauthorized._tag, "ControlUnauthorized");
        assert.strictEqual((yield* controller.snapshot).control.enabled, false);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("invokes only actions present in the accepted interface", () => {
    const { layer } = makeLayer();
    return Effect.gen(function* () {
      const controller = yield* FlectWorkspaceController;
      yield* controller.dispatch(
        envelope(
          38,
          SubmitShaperInstruction.make({
            type: "submit-shaper-instruction",
            instruction: "Create an interface",
          }),
        ),
      );
      yield* controller.dispatch(
        envelope(39, AcceptProposal.make({ type: "accept-proposal" })),
      );
      assert.strictEqual((yield* controller.snapshot).workbench?.target, "use");
      const invoked = yield* controller.dispatch(
        envelope(
          40,
          InvokeInterfaceAction.make({
            type: "invoke-interface-action",
            nodeId: "shape-interface",
          }),
          appAgent,
        ),
      );
      const missing = yield* controller
        .dispatch(
          envelope(
            41,
            InvokeInterfaceAction.make({
              type: "invoke-interface-action",
              nodeId: "missing-action",
            }),
            appAgent,
          ),
        )
        .pipe(Effect.flip);

      assert.strictEqual(invoked.status, "completed");
      assert.strictEqual((yield* controller.snapshot).mode, "edit");
      assert.strictEqual(
        (yield* controller.snapshot).workbench?.target,
        "shape",
      );
      assert.strictEqual(missing._tag, "OperationFailed");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "enforces the role-scoped agent command policy before claim",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        const selection = ModelSelection.make({
          provider: model.provider,
          id: model.id,
        });
        const appDenied: ReadonlyArray<FlectCommandEnvelope["command"]> = [
          SetMode.make({ type: "set-mode", mode: "edit" }),
          SubmitShaperInstruction.make({
            type: "submit-shaper-instruction",
            instruction: "Change the interface",
          }),
          AcceptProposal.make({ type: "accept-proposal" }),
          RejectProposal.make({ type: "reject-proposal" }),
          RollbackRevision.make({ type: "rollback-revision" }),
          EnterSafeMode.make({ type: "enter-safe-mode" }),
          RestoreSafeMode.make({ type: "restore-safe-mode" }),
          SelectModel.make({ type: "select-model", model: selection }),
          SetModelFavorite.make({
            type: "set-model-favorite",
            model: selection,
            favorite: true,
          }),
          SetExternalExtensions.make({
            type: "set-external-extensions",
            role: "app",
            enabled: true,
          }),
          EnableControl.make({ type: "enable-control" }),
          DisableControl.make({ type: "disable-control" }),
          SetRailCollapsed.make({
            type: "set-rail-collapsed",
            collapsed: true,
          }),
          SetRailWidth.make({ type: "set-rail-width", width: 420 }),
          SubmitAppPrompt.make({ type: "submit-app-prompt", text: "Re-enter" }),
          CancelRole.make({ type: "cancel-role", role: "shaper" }),
        ];
        const shaperDenied: ReadonlyArray<FlectCommandEnvelope["command"]> = [
          SetMode.make({ type: "set-mode", mode: "run" }),
          SubmitAppPrompt.make({
            type: "submit-app-prompt",
            text: "Use the app",
          }),
          InvokeInterfaceAction.make({
            type: "invoke-interface-action",
            nodeId: "primary-action",
          }),
          AcceptProposal.make({ type: "accept-proposal" }),
          RejectProposal.make({ type: "reject-proposal" }),
          RollbackRevision.make({ type: "rollback-revision" }),
          EnterSafeMode.make({ type: "enter-safe-mode" }),
          RestoreSafeMode.make({ type: "restore-safe-mode" }),
          SelectModel.make({ type: "select-model", model: selection }),
          SetModelFavorite.make({
            type: "set-model-favorite",
            model: selection,
            favorite: true,
          }),
          SetExternalExtensions.make({
            type: "set-external-extensions",
            role: "shaper",
            enabled: true,
          }),
          EnableControl.make({ type: "enable-control" }),
          DisableControl.make({ type: "disable-control" }),
          SetRailCollapsed.make({
            type: "set-rail-collapsed",
            collapsed: true,
          }),
          SetRailWidth.make({ type: "set-rail-width", width: 420 }),
          CancelRole.make({ type: "cancel-role", role: "app" }),
        ];

        yield* Effect.forEach(
          [
            ...appDenied.map((command) => ({ command, source: appAgent })),
            ...shaperDenied.map((command) => ({
              command,
              source: shaperAgent,
            })),
          ],
          ({ command, source }, index) =>
            controller.dispatch(envelope(100 + index, command, source)).pipe(
              Effect.flip,
              Effect.tap((error) =>
                Effect.sync(() =>
                  assert.strictEqual(error._tag, "ControlUnauthorized"),
                ),
              ),
            ),
          { discard: true },
        );

        const appInspect = yield* controller.dispatch(
          envelope(200, Inspect.make({ type: "inspect" }), appAgent),
        );
        const shaperInspect = yield* controller.dispatch(
          envelope(201, Inspect.make({ type: "inspect" }), shaperAgent),
        );
        assert.strictEqual(appInspect.status, "completed");
        assert.strictEqual(shaperInspect.status, "completed");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "creates a preview from Shaper and accepts it through typed commands",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            1,
            SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: "Make it focused",
            }),
          ),
        );
        const preview = yield* controller.snapshot;
        yield* controller.dispatch(
          envelope(2, AcceptProposal.make({ type: "accept-proposal" })),
        );
        const accepted = yield* controller.snapshot;

        assert.strictEqual(preview.phase, "preview");
        assert.strictEqual(preview.document.name, "Controller proposal");
        assert.strictEqual(preview.shaping.proposal?.status, "previewed");
        assert.strictEqual(accepted.phase, "ready");
        assert.strictEqual(accepted.shaping.proposal, undefined);
        assert.strictEqual(
          accepted.shaping.active.document.name,
          "Controller proposal",
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "does not let a stale kernel event re-enter safe mode after restore",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(1, EnterSafeMode.make({ type: "enter-safe-mode" })),
        );
        yield* controller.dispatch(
          envelope(2, RestoreSafeMode.make({ type: "restore-safe-mode" })),
        );
        yield* Effect.yieldNow;
        const restored = yield* controller.snapshot;

        assert.strictEqual(restored.phase, "ready");
        assert.strictEqual(restored.shaping.safeMode, false);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "lets outside clients test a preview without bypassing its decision",
    () => {
      const { layer } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            1,
            SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: "Make it focused",
            }),
          ),
        );

        const previewMode = yield* controller.dispatch(
          envelope(2, SetMode.make({ type: "set-mode", mode: "run" }), outside),
        );
        const previewPrompt = yield* controller.dispatch(
          envelope(
            3,
            SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text: "Use the preview",
            }),
            outside,
          ),
        );
        const stillPreview = yield* controller.snapshot;
        yield* controller.dispatch(
          envelope(4, AcceptProposal.make({ type: "accept-proposal" })),
        );
        yield* controller.dispatch(
          envelope(5, EnterSafeMode.make({ type: "enter-safe-mode" })),
        );
        const safePrompt = yield* controller
          .dispatch(
            envelope(
              6,
              SubmitAppPrompt.make({
                type: "submit-app-prompt",
                text: "Bypass recovery",
              }),
              outside,
            ),
          )
          .pipe(Effect.flip);

        assert.strictEqual(previewMode.status, "completed");
        assert.strictEqual(previewPrompt.status, "completed");
        assert.strictEqual(stillPreview.shaping.proposal?.status, "previewed");
        assert.strictEqual(safePrompt._tag, "OperationFailed");
        const snapshot = yield* controller.snapshot;
        assert.strictEqual(snapshot.phase, "safe-mode");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "applies model, extension, and rail commands to the same reactive snapshot",
    () => {
      const { layer, saved, selectModel, setExternalExtensions } = makeLayer();
      return Effect.gen(function* () {
        const controller = yield* FlectWorkspaceController;
        yield* controller.dispatch(
          envelope(
            1,
            SelectModel.make({
              type: "select-model",
              model: ModelSelection.make({
                provider: model.provider,
                id: model.id,
              }),
            }),
            outside,
          ),
        );
        yield* controller.dispatch(
          envelope(
            2,
            SetExternalExtensions.make({
              type: "set-external-extensions",
              role: "shaper",
              enabled: true,
            }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            3,
            SetRailWidth.make({ type: "set-rail-width", width: 480 }),
          ),
        );
        yield* controller.dispatch(
          envelope(
            4,
            SetRailCollapsed.make({
              type: "set-rail-collapsed",
              collapsed: true,
            }),
          ),
        );
        const snapshot = yield* controller.snapshot;

        assert.strictEqual(selectModel.mock.calls.length, 1);
        assert.strictEqual(setExternalExtensions.mock.calls.length, 1);
        assert.strictEqual(snapshot.rail.width, 480);
        assert.strictEqual(snapshot.rail.collapsed, true);
        assert.strictEqual(saved.at(-1)?.railWidth, 480);
        assert.strictEqual(saved.at(-1)?.railCollapsed, true);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("keeps unsent drafts reactive and outside public snapshots", () => {
    const { layer } = makeLayer();
    return Effect.gen(function* () {
      const controller = yield* FlectWorkspaceController;
      yield* controller.setDraft("acceptedUse", "Private unsent question");
      yield* controller.setDraft("shape", "Private shape request");

      const continuity = yield* controller.continuity;
      const snapshot = yield* controller.snapshot;
      assert.strictEqual(
        continuity.drafts.acceptedUse,
        "Private unsent question",
      );
      assert.strictEqual(continuity.drafts.shape, "Private shape request");
      assert.strictEqual(
        JSON.stringify(snapshot).includes("Private unsent question"),
        false,
      );
      assert.strictEqual(
        JSON.stringify(snapshot).includes("Private shape request"),
        false,
      );
    }).pipe(Effect.provide(layer));
  });
});
