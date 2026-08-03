import {
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Ref,
  Result,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { satisfies } from "semver";
import packageMetadata from "../../package.json";
import type { PrivateShareSourceSummary } from "../../packages/product/src/host/share-source";
import {
  ShareGitRepository,
  ShareLocalSource,
  type ShareSource,
} from "../../packages/product/src/share";
import { ProposalBuildRequest } from "../../shared/browser-build";
import {
  type DecodedCapsule,
  decodeCapsule,
  encodeCapsule,
  hashCapsuleArchive,
  type InvalidCapsule,
} from "../../shared/capsule";
import type {
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  InteractiveAgentRole,
  ReasoningLevel,
} from "../../shared/contracts";
import {
  CommandConflict,
  CommandRejected,
  type ControlClientSummary,
  ControlStateSnapshot,
  ControlUnauthorized,
  FlectCommandEnvelope,
  FlectCommandError,
  FlectCommandReceipt,
  type FlectCommandSource,
  FlectWorkspaceEvent,
  FlectWorkspaceSnapshot,
  ImportCapsule,
  OperationRecord,
  OperationFailed,
  RailStateSnapshot,
  UserCommandSource,
  WorkbenchHandoff,
  WorkbenchSnapshot,
  WorkspaceBuildSnapshot,
  WorkspacePersistenceSnapshot,
} from "../../shared/control";
import type { PortableExtensionPackage } from "../../shared/extensions";
import { GitWorkspaceFailure } from "../../shared/git-workspace";
import {
  findInterfaceAction,
  projectInterfaceActions,
} from "../../shared/interface-actions";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
  type InterfaceNode,
  validateInterfaceDocument,
} from "../../shared/interface-document";
import {
  ProductCapabilityProjection,
  ProductCapabilityReceipt,
  ProductCapabilityRequestContext,
  ProductCapabilityRequestEntry,
  ProductOperationInvocation,
} from "../../shared/product-capability";
import {
  PROJECT_IMPORT_REPORT_PATH,
  ProjectImportReport,
} from "../../shared/project-import";
import type { RevisionId, ShapingSnapshot } from "../../shared/revisions";
import {
  ContinuityDrafts,
  type ContinuityRecoveryReason,
  emptyRoleContinuityRecord,
} from "../../shared/role-continuity";
import {
  ShareGitInstallationSource,
  ShareInstallationRecord,
  ShareInstallationRefs,
  type ShareInstallationSource,
  ShareInstalledArtifact,
  type ShareLineage,
  ShareLocalInstallationSource,
  SharePendingCandidate,
  SharePrivateInstallationSource,
  ShareUrlInstallationSource,
} from "../../shared/share-installation";
import { ShellPreferencesValue } from "../../shared/shell-preferences";
import { buildFrameworkCapsule } from "../build/framework-capsule";
import { ProposalBuild } from "../build/proposal-build";
import { ProductCapabilityRegistry } from "../capabilities/product-capability-registry";
import {
  type CapsuleArchiveBindings,
  CapsuleStore,
} from "../capsule/capsule-store";
import {
  ExtensionCatalog,
  type PortableExtensionKey,
} from "../extensions/extension-catalog";
import { PortableExtensionHost } from "../extensions/portable-extension-host";
import { GitWorkspace } from "../git/git-workspace";
import {
  PrivateShareSourceRegistry,
  type PrivateShareSourceRegistryShape,
} from "../sharing/private-share-source-registry";
import {
  decodeShareArchive,
  encodeShareArchive,
} from "../sharing/share-archive";
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
  ShareRepository,
  type ShareRepositoryShape,
  type ShareUpdateResult,
} from "../sharing/share-repository";
import { buildShareReview } from "../sharing/share-review";
import {
  ShareSignatureVerifier,
  type ShareSignatureVerifierShape,
} from "../sharing/share-signature-verifier";
import {
  ShareSourceResolver,
  type ShareSourceResolverShape,
} from "../sharing/share-source-resolver";
import { SandboxedShell } from "../shell/sandboxed-shell-service";
import {
  AgentWorkspace,
  OperationContext,
  type ProviderAuthUiState,
} from "./agent-workspace";
import {
  OperationJournal,
  OperationJournalInput,
  OperationQuery,
} from "./operation-journal";
import { projectAgentContinuity } from "./role-continuity";
import { RoleContinuityRepository } from "./role-continuity-repository";
import { ShapingKernel } from "./shaping-kernel";
import { ShellPreferences } from "./shell-preferences";
import {
  initialWorkbenchState,
  selectWorkbenchTarget,
  synchronizeWorkbenchState,
} from "./workbench-state";

export interface FlectWorkspaceControllerShape {
  readonly snapshot: Effect.Effect<FlectWorkspaceSnapshot>;
  readonly changes: Stream.Stream<FlectWorkspaceSnapshot>;
  readonly events: Stream.Stream<FlectWorkspaceEvent>;
  readonly providerAuth: Effect.Effect<ProviderAuthUiState>;
  readonly providerAuthChanges: Stream.Stream<ProviderAuthUiState>;
  readonly privateShareSources?: Effect.Effect<
    ReadonlyArray<PrivateShareSourceSummary>
  >;
  readonly continuity: Effect.Effect<RoleContinuityUiState>;
  readonly continuityChanges: Stream.Stream<RoleContinuityUiState>;
  readonly capsulePresentation?: Effect.Effect<CapsulePresentationState>;
  readonly capsulePresentationChanges?: Stream.Stream<CapsulePresentationState>;
  readonly setDraft: (
    key: keyof ContinuityDrafts,
    value: string,
  ) => Effect.Effect<void>;
  readonly exportContinuity: Effect.Effect<string, unknown>;
  readonly exportRepository: Effect.Effect<Uint8Array, GitWorkspaceFailure>;
  readonly exportCapsule?: Effect.Effect<Uint8Array, InvalidCapsule>;
  readonly readShareExport: (
    shareId: string,
  ) => Effect.Effect<Uint8Array, CommandRejected>;
  readonly discardContinuity: Effect.Effect<void, unknown>;
  readonly retryContinuity: Effect.Effect<void>;
  readonly dispatch: (
    envelope: FlectCommandEnvelope,
  ) => Effect.Effect<FlectCommandReceipt, FlectCommandError>;
  readonly selectReasoning: (
    reasoningLevel: ReasoningLevel | undefined,
  ) => Effect.Effect<void>;
  readonly loginProvider: (
    request: AuthLoginRequest,
  ) => Effect.Effect<void, unknown>;
  readonly replyProviderAuth: (
    reply: AuthSelectionReply,
  ) => Effect.Effect<void, unknown>;
  readonly cancelProviderAuth: (
    reference: AuthLoginReference,
  ) => Effect.Effect<void, unknown>;
  readonly refreshProviderAuth: Effect.Effect<void, unknown>;
  readonly logoutProvider: (providerId: string) => Effect.Effect<void, unknown>;
  readonly connectClient: (client: ControlClientSummary) => Effect.Effect<void>;
  readonly disconnectClient: (clientId: string) => Effect.Effect<void>;
}

interface ShareCandidateState {
  readonly material: ShareCandidateMaterial;
  readonly origin: ShareInstallationSource;
  readonly lineage: ShareLineage;
  readonly update?: ShareUpdateResult;
}

interface ShareActivationState {
  readonly shareId: string;
  readonly artifactIds: ReadonlyArray<string>;
}

interface FinalizedShareActivation {
  readonly before: ShareInstallationRecord;
  readonly beforeRefs?: ShareInstallationRefs & { readonly candidate: string };
  readonly afterRefs: Omit<ShareInstallationRefs, "candidate">;
  readonly candidateArchive: Uint8Array;
  readonly candidateArchiveSha256: string;
}

interface DiscardedShareActivation {
  readonly before: ShareInstallationRecord;
  readonly after: ShareInstallationRecord;
}

interface PreparedShareExport {
  readonly shareId: string;
  readonly archive: Uint8Array;
}

export interface CompiledCapsulePresentation {
  readonly id: string;
  readonly name: string;
  readonly html: string;
  readonly entrypointPath: string;
  readonly assets: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>;
  readonly archive: Uint8Array;
}

export interface CapsulePresentationState {
  readonly accepted?: CompiledCapsulePresentation;
  readonly candidate?: CompiledCapsulePresentation;
  readonly lastKnownGood?: CompiledCapsulePresentation;
  readonly acceptedReview?: CapsuleReview;
  readonly candidateReview?: CapsuleReview;
  readonly lastKnownGoodReview?: CapsuleReview;
}

export interface CapsuleReview {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly source: string;
  readonly revision: string;
  readonly builder: string;
  readonly platforms: ReadonlyArray<"browser" | "macos" | "windows" | "linux">;
  readonly currentPlatform: "browser" | "macos" | "windows" | "linux";
  readonly flectRange: string;
  readonly flectCompatible: boolean;
  readonly platformCompatible: boolean;
  readonly capabilities: ReadonlyArray<ProductCapabilityProjection>;
  readonly extensions: ReadonlyArray<PortableExtensionPackage>;
  readonly permissionContext: ProductCapabilityRequestContext;
  readonly signatureCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly build?: {
    readonly sourceRevision: string;
    readonly inputDigest: string;
    readonly artifactDigest: string;
    readonly dependencyGraphDigest?: string;
  };
  readonly importReport?: ProjectImportReport;
  readonly activationBlocked: boolean;
  readonly archive: Uint8Array;
}

const currentCapsulePlatform = () => {
  if (!("__TAURI_INTERNALS__" in globalThis)) return "browser" as const;
  const platform = globalThis.navigator?.platform.toLowerCase() ?? "";
  if (platform.includes("mac")) return "macos" as const;
  if (platform.includes("win")) return "windows" as const;
  return "linux" as const;
};

const projectImportReport = (capsule: DecodedCapsule) => {
  const file = capsule.files.find(
    (candidate) => candidate.path === PROJECT_IMPORT_REPORT_PATH,
  );
  if (file === undefined) return undefined;
  try {
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(ProjectImportReport)(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(file.contents),
        ),
      ),
    );
  } catch {
    return undefined;
  }
};

const reviewCapsule = (
  capsule: DecodedCapsule,
  archive: Uint8Array,
  permissionContext: ProductCapabilityRequestContext,
  capabilities: ReadonlyArray<ProductCapabilityProjection>,
): CapsuleReview => ({
  id: capsule.manifest.id,
  name: capsule.manifest.name,
  version: capsule.manifest.version,
  publisher: capsule.manifest.provenance.publisher,
  source: capsule.manifest.provenance.source,
  revision: capsule.manifest.provenance.revision,
  builder: capsule.manifest.provenance.builder,
  platforms: [...capsule.manifest.compatibility.platforms],
  currentPlatform: currentCapsulePlatform(),
  flectRange: capsule.manifest.compatibility.flect,
  flectCompatible: satisfies(
    packageMetadata.version,
    capsule.manifest.compatibility.flect,
    { includePrerelease: true },
  ),
  platformCompatible: capsule.manifest.compatibility.platforms.includes(
    currentCapsulePlatform(),
  ),
  capabilities,
  extensions: [...(capsule.manifest.extensions ?? [])],
  permissionContext,
  signatureCount: capsule.manifest.signatures.length,
  fileCount: capsule.files.length,
  totalBytes: capsule.files.reduce(
    (total, file) => total + file.contents.byteLength,
    0,
  ),
  ...(capsule.manifest.build === undefined
    ? {}
    : {
        build: {
          sourceRevision: capsule.manifest.build.sourceRevision,
          inputDigest: capsule.manifest.build.inputDigest,
          artifactDigest: capsule.manifest.build.artifactDigest,
          ...(capsule.manifest.build.dependencyGraphDigest === undefined
            ? {}
            : {
                dependencyGraphDigest:
                  capsule.manifest.build.dependencyGraphDigest,
              }),
        },
      }),
  ...(() => {
    const importReport = projectImportReport(capsule);
    return importReport === undefined ? {} : { importReport };
  })(),
  activationBlocked:
    !satisfies(packageMetadata.version, capsule.manifest.compatibility.flect, {
      includePrerelease: true,
    }) ||
    !capsule.manifest.compatibility.platforms.includes(
      currentCapsulePlatform(),
    ) ||
    capsule.manifest.capabilities.some(
      (capability) =>
        capability.required &&
        !capabilities.some(
          (projection) =>
            projection.capabilityId === capability.id &&
            projection.state === "granted",
        ),
    ),
  archive: archive.slice(),
});

const compiledCapsulePresentation = (
  archive: Uint8Array,
): Effect.Effect<CompiledCapsulePresentation | undefined> =>
  decodeCapsule(archive).pipe(
    Effect.flatMap((capsule) => {
      const entrypoint = capsule.manifest.entrypoints.find((candidate) =>
        candidate.path.endsWith(".html"),
      );
      const file = capsule.files.find(
        (candidate) => candidate.path === entrypoint?.path,
      );
      if (entrypoint === undefined || file === undefined)
        return Effect.succeed(undefined);
      return Effect.try({
        try: () => ({
          id: capsule.manifest.id,
          name: capsule.manifest.name,
          html: new TextDecoder("utf-8", { fatal: true }).decode(file.contents),
          entrypointPath: entrypoint.path,
          assets: capsule.files
            .filter((candidate) => candidate.path !== entrypoint.path)
            .map((candidate) => ({
              path: candidate.path,
              contents: candidate.contents.slice(),
            })),
          archive: archive.slice(),
        }),
        catch: () => undefined,
      });
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  );

export interface RoleContinuityUiState {
  readonly drafts: ContinuityDrafts;
  readonly generation: number;
  readonly revisionSequence: number;
  readonly recovery?: ContinuityRecoveryReason;
}

export class FlectWorkspaceController extends Context.Service<
  FlectWorkspaceController,
  FlectWorkspaceControllerShape
>()("flect/FlectWorkspaceController") {}

type ReceiptCache = {
  readonly receipts: ReadonlyMap<string, FlectCommandReceipt>;
  readonly order: ReadonlyArray<string>;
};

type Claim =
  | {
      readonly status: "duplicate";
      readonly receipt: FlectCommandReceipt;
    }
  | {
      readonly status: "accepted";
      readonly operationId: string;
      readonly receipt: FlectCommandReceipt;
    };

const systemSource = UserCommandSource.make({ kind: "user" });

const phaseFrom = (shaping: ShapingSnapshot) =>
  shaping.safeMode
    ? "safe-mode"
    : shaping.proposal?.status === "previewed"
      ? "preview"
      : "ready";

const documentFrom = (shaping: ShapingSnapshot): InterfaceDocument =>
  shaping.safeMode
    ? defaultInterfaceDocument
    : (shaping.proposal?.document ?? shaping.active.document);

const documentHasNode = (document: InterfaceDocument, nodeId: string) => {
  const pending: Array<InterfaceNode> = [document.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node.id === nodeId) {
      return true;
    }
    if (node.type === "stack") {
      pending.push(...node.children);
    }
  }
  return false;
};

const commandRejected = (message: string) => CommandRejected.make({ message });

const modeFromWorkbench = (
  workbench: WorkbenchSnapshot,
  shaping: ShapingSnapshot,
) =>
  workbench.target === "use" && shaping.proposal === undefined
    ? ("run" as const)
    : ("edit" as const);

const boundedHandoffInstruction = (handoff: WorkbenchHandoff) =>
  [
    handoff.instruction,
    "",
    "Flect workbench handoff:",
    `Revision: ${handoff.revisionId}`,
    ...(handoff.selectedNodeId === undefined
      ? []
      : [`Selected interface node: ${handoff.selectedNodeId}`]),
    ...(handoff.failureOperationId === undefined
      ? []
      : [`Failed operation: ${handoff.failureOperationId}`]),
    ...(handoff.failureSummary === undefined
      ? []
      : [`Redacted failure summary: ${handoff.failureSummary}`]),
  ].join("\n");

export const FlectWorkspaceControllerLive = Layer.effect(
  FlectWorkspaceController,
  Effect.gen(function* () {
    const agent = yield* AgentWorkspace;
    const kernel = yield* ShapingKernel;
    const preferences = yield* ShellPreferences;
    const journal = yield* OperationJournal;
    const continuityRepository = yield* RoleContinuityRepository;
    const git = Option.getOrUndefined(
      yield* Effect.serviceOption(GitWorkspace),
    );
    const capsuleStore = Option.getOrUndefined(
      yield* Effect.serviceOption(CapsuleStore),
    );
    const proposalBuild = Option.getOrUndefined(
      yield* Effect.serviceOption(ProposalBuild),
    );
    const productRegistry = Option.getOrUndefined(
      yield* Effect.serviceOption(ProductCapabilityRegistry),
    );
    const extensionCatalog = Option.getOrUndefined(
      yield* Effect.serviceOption(ExtensionCatalog),
    );
    const portableExtensionHost = Option.getOrUndefined(
      yield* Effect.serviceOption(PortableExtensionHost),
    );
    const shareSourceResolver: ShareSourceResolverShape | undefined =
      Option.getOrUndefined(yield* Effect.serviceOption(ShareSourceResolver));
    const privateShareSourceRegistry:
      | PrivateShareSourceRegistryShape
      | undefined = Option.getOrUndefined(
      yield* Effect.serviceOption(PrivateShareSourceRegistry),
    );
    const shareCandidateStore: ShareCandidateStoreShape | undefined =
      Option.getOrUndefined(yield* Effect.serviceOption(ShareCandidateStore));
    const shareInstallationStore: ShareInstallationStoreShape | undefined =
      Option.getOrUndefined(
        yield* Effect.serviceOption(ShareInstallationStore),
      );
    const shareRepository: ShareRepositoryShape | undefined =
      Option.getOrUndefined(yield* Effect.serviceOption(ShareRepository));
    const shareSignatureVerifier: ShareSignatureVerifierShape | undefined =
      Option.getOrUndefined(
        yield* Effect.serviceOption(ShareSignatureVerifier),
      );
    const sandboxedShell = Option.getOrUndefined(
      yield* Effect.serviceOption(SandboxedShell),
    );
    const workspaceId = "workspace-local-default";
    const permissionContextFor = Effect.fn(
      "Flect.Workspace.permissionContextFor",
    )(function* (capsule: DecodedCapsule, archive: Uint8Array) {
      return ProductCapabilityRequestContext.make({
        version: 1,
        scopeId: capsule.manifest.id,
        workspaceId,
        requestDigest: yield* hashCapsuleArchive(archive),
        revision: capsule.manifest.provenance.revision,
        capabilities: capsule.manifest.capabilities.map((capability) =>
          ProductCapabilityRequestEntry.make({
            capabilityId: capability.id,
            required: capability.required,
          }),
        ),
      });
    });
    const permissionsFor = (context: ProductCapabilityRequestContext) =>
      productRegistry === undefined
        ? Effect.succeed(
            context.capabilities.map((capability) =>
              ProductCapabilityProjection.make({
                version: 1,
                scopeId: context.scopeId,
                workspaceId: context.workspaceId,
                requestDigest: context.requestDigest,
                revision: context.revision,
                capabilityId: capability.capabilityId,
                state: "requested",
                availability: "unavailable",
                requested: true,
                required: capability.required,
                confirmationPolicies: [],
                operationIds: [],
                resourceIds: [],
                dataClassIds: [],
              }),
            ),
          )
        : productRegistry.permissions(context);
    const reviewDecodedCapsule = Effect.fn(
      "Flect.Workspace.reviewDecodedCapsule",
    )(function* (capsule: DecodedCapsule, archive: Uint8Array) {
      const context = yield* permissionContextFor(capsule, archive);
      return reviewCapsule(
        capsule,
        archive,
        context,
        yield* permissionsFor(context),
      );
    });
    const reviewWithProductPermissions = (
      archive: Uint8Array,
    ): Effect.Effect<CapsuleReview | undefined> =>
      Effect.gen(function* () {
        const capsule = yield* decodeCapsule(archive);
        return yield* reviewDecodedCapsule(capsule, archive);
      }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    const shapingSnapshot = yield* kernel.snapshot;
    const continuityLoad = yield* continuityRepository.load;
    if (continuityLoad.status === "ready" && !shapingSnapshot.safeMode) {
      yield* agent.restoreContinuity(continuityLoad.record, shapingSnapshot);
    }
    yield* agent.refresh;
    const [
      agentSnapshot,
      shellPreferences,
      operations,
      initialExtensions,
      initialShares,
    ] = yield* Effect.all([
      agent.snapshot,
      preferences.load,
      journal.snapshot,
      extensionCatalog === undefined
        ? Effect.succeed(undefined)
        : extensionCatalog.snapshot,
      shareInstallationStore === undefined
        ? Effect.succeed(undefined)
        : shareInstallationStore.snapshot,
    ]);
    const initialRepository =
      git === undefined
        ? Option.none()
        : yield* git
            .status(
              shapingSnapshot.proposal === undefined
                ? {}
                : {
                    proposalBranch: `flect/proposal/${shapingSnapshot.proposal.id}`,
                  },
            )
            .pipe(Effect.option);
    const initial = FlectWorkspaceSnapshot.make({
      version: 1,
      workspaceId,
      sequence: 0,
      phase: phaseFrom(shapingSnapshot),
      mode:
        shapingSnapshot.active.source === "built-in" ||
        shapingSnapshot.proposal !== undefined
          ? "edit"
          : "run",
      document: documentFrom(shapingSnapshot),
      shaping: shapingSnapshot,
      workbench: initialWorkbenchState(shapingSnapshot),
      agent: agentSnapshot,
      rail: RailStateSnapshot.make({
        collapsed: shellPreferences.railCollapsed,
        width: shellPreferences.railWidth,
      }),
      control: ControlStateSnapshot.make({
        enabled: false,
        clients: [],
      }),
      persistence: WorkspacePersistenceSnapshot.make({
        source: Option.isSome(initialRepository) ? "durable" : "unavailable",
        capsule: capsuleStore?.persistence ?? "unavailable",
      }),
      permissions: [],
      operations,
      ...(initialExtensions === undefined
        ? {}
        : { extensions: initialExtensions }),
      ...(Option.isSome(initialRepository)
        ? { repository: initialRepository.value }
        : {}),
      ...(initialShares === undefined ? {} : { shares: initialShares }),
    });
    const state = yield* SubscriptionRef.make(initial);
    const appendCapabilityWarnings = Effect.fn(
      "Flect.Workspace.appendCapabilityWarnings",
    )(function* () {
      if (productRegistry?.warnings === undefined) return;
      const warnings = yield* productRegistry.warnings;
      if (warnings.length === 0) return;
      const existing = yield* journal.snapshot;
      const appended: Array<OperationRecord> = [];
      for (const warning of warnings) {
        const marker = `Product capability storage warning [${warning.reason}]`;
        if (existing.some((record) => record.summary.startsWith(marker))) {
          continue;
        }
        appended.push(
          yield* journal.append(
            OperationJournalInput.make({
              version: 1,
              operationId: `operation-capability-warning-${warning.reason}`,
              workspaceId,
              source: systemSource,
              category: "capability",
              phase: "failed",
              summary: `${marker}: ${warning.message}`,
            }),
          ),
        );
      }
      if (appended.length > 0) {
        yield* SubscriptionRef.update(state, (current) =>
          FlectWorkspaceSnapshot.make({
            ...current,
            operations: [...current.operations, ...appended].slice(-500),
          }),
        );
      }
    });
    yield* appendCapabilityWarnings();
    const shareCandidate = yield* Ref.make<ShareCandidateState | undefined>(
      undefined,
    );
    const shareActivation = yield* Ref.make<ShareActivationState | undefined>(
      undefined,
    );
    const preparedShareExport = yield* Ref.make<
      PreparedShareExport | undefined
    >(undefined);
    const syncExtensionSnapshot = Effect.fn(
      "Flect.Workspace.syncExtensionSnapshot",
    )(function* () {
      if (extensionCatalog === undefined) return;
      const extensions = yield* extensionCatalog.snapshot;
      yield* SubscriptionRef.update(state, (current) =>
        FlectWorkspaceSnapshot.make({ ...current, extensions }),
      );
    });
    const capsuleLoad =
      capsuleStore === undefined
        ? undefined
        : yield* capsuleStore.load.pipe(Effect.result);
    if (capsuleLoad !== undefined && Result.isFailure(capsuleLoad)) {
      yield* SubscriptionRef.update(state, (current) =>
        FlectWorkspaceSnapshot.make({
          ...current,
          persistence: WorkspacePersistenceSnapshot.make({
            ...current.persistence,
            capsule: "unavailable",
          }),
        }),
      );
    }
    const restoredCapsuleArchives: CapsuleArchiveBindings =
      capsuleLoad === undefined || Result.isFailure(capsuleLoad)
        ? {}
        : capsuleLoad.success;
    const [
      restoredAccepted,
      restoredCandidate,
      restoredLastKnownGood,
      restoredAcceptedReview,
      restoredCandidateReview,
      restoredLastKnownGoodReview,
    ] = yield* Effect.all([
      restoredCapsuleArchives.accepted === undefined
        ? Effect.succeed(undefined)
        : compiledCapsulePresentation(restoredCapsuleArchives.accepted),
      restoredCapsuleArchives.candidate === undefined ||
      shapingSnapshot.proposal === undefined
        ? Effect.succeed(undefined)
        : compiledCapsulePresentation(restoredCapsuleArchives.candidate),
      restoredCapsuleArchives.lastKnownGood === undefined
        ? Effect.succeed(undefined)
        : compiledCapsulePresentation(restoredCapsuleArchives.lastKnownGood),
      restoredCapsuleArchives.accepted === undefined
        ? Effect.succeed(undefined)
        : reviewWithProductPermissions(restoredCapsuleArchives.accepted),
      restoredCapsuleArchives.candidate === undefined ||
      shapingSnapshot.proposal === undefined
        ? Effect.succeed(undefined)
        : reviewWithProductPermissions(restoredCapsuleArchives.candidate),
      restoredCapsuleArchives.lastKnownGood === undefined
        ? Effect.succeed(undefined)
        : reviewWithProductPermissions(restoredCapsuleArchives.lastKnownGood),
    ]);
    const initialCapsulePresentation: CapsulePresentationState = {
      ...(restoredAccepted === undefined ? {} : { accepted: restoredAccepted }),
      ...(restoredCandidate === undefined
        ? {}
        : { candidate: restoredCandidate }),
      ...(restoredLastKnownGood === undefined
        ? {}
        : { lastKnownGood: restoredLastKnownGood }),
      ...(restoredAcceptedReview === undefined
        ? {}
        : { acceptedReview: restoredAcceptedReview }),
      ...(restoredCandidateReview === undefined
        ? {}
        : { candidateReview: restoredCandidateReview }),
      ...(restoredLastKnownGoodReview === undefined
        ? {}
        : { lastKnownGoodReview: restoredLastKnownGoodReview }),
    };
    const capsulePresentation =
      yield* SubscriptionRef.make<CapsulePresentationState>(
        initialCapsulePresentation,
      );
    const permissionsFromPresentation = (
      presentation: CapsulePresentationState,
    ) =>
      [presentation.acceptedReview, presentation.candidateReview].flatMap(
        (review) => review?.capabilities ?? [],
      );
    yield* SubscriptionRef.update(state, (current) =>
      FlectWorkspaceSnapshot.make({
        ...current,
        permissions: permissionsFromPresentation(initialCapsulePresentation),
      }),
    );
    const persistCapsulePresentation = (
      next: CapsulePresentationState,
    ): Effect.Effect<void> =>
      capsuleStore === undefined
        ? Effect.void
        : capsuleStore
            .save({
              ...(next.acceptedReview === undefined &&
              next.accepted === undefined
                ? {}
                : {
                    accepted:
                      next.acceptedReview?.archive ?? next.accepted?.archive,
                  }),
              ...(next.candidateReview === undefined &&
              next.candidate === undefined
                ? {}
                : {
                    candidate:
                      next.candidateReview?.archive ?? next.candidate?.archive,
                  }),
              ...(next.lastKnownGoodReview === undefined &&
              next.lastKnownGood === undefined
                ? {}
                : {
                    lastKnownGood:
                      next.lastKnownGoodReview?.archive ??
                      next.lastKnownGood?.archive,
                  }),
            });
    const updateCapsulePresentation = Effect.fn(
      "Flect.Workspace.updateCapsulePresentation",
    )(function* (
      update: (current: CapsulePresentationState) => CapsulePresentationState,
    ) {
      const current = yield* SubscriptionRef.get(capsulePresentation);
      const next = update(current);
      yield* persistCapsulePresentation(next).pipe(
        Effect.catchTag("CapsuleStoreError", (error) =>
          SubscriptionRef.update(state, (snapshot) =>
            FlectWorkspaceSnapshot.make({
              ...snapshot,
              persistence: WorkspacePersistenceSnapshot.make({
                ...snapshot.persistence,
                capsule: "unavailable",
              }),
            }),
          ).pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      yield* SubscriptionRef.set(capsulePresentation, next);
      yield* SubscriptionRef.update(state, (snapshot) =>
        FlectWorkspaceSnapshot.make({
          ...snapshot,
          permissions: permissionsFromPresentation(next),
        }),
      );
    });
    const restoreCapsulePresentation = Effect.fn(
      "Flect.Workspace.restoreCapsulePresentation",
    )((presentation: CapsulePresentationState) =>
      persistCapsulePresentation(presentation).pipe(
        Effect.mapError(() =>
          commandRejected("The capsule presentation could not be restored."),
        ),
        Effect.andThen(SubscriptionRef.set(capsulePresentation, presentation)),
        Effect.andThen(
          SubscriptionRef.update(state, (snapshot) =>
            FlectWorkspaceSnapshot.make({
              ...snapshot,
              permissions: permissionsFromPresentation(presentation),
            }),
          ),
        ),
      ),
    );
    const refreshCapabilityReviews = Effect.fn(
      "Flect.Workspace.refreshCapabilityReviews",
    )(function* () {
      const presentation = yield* SubscriptionRef.get(capsulePresentation);
      const [acceptedReview, candidateReview, lastKnownGoodReview] =
        yield* Effect.all([
          presentation.acceptedReview === undefined
            ? Effect.succeed(undefined)
            : reviewWithProductPermissions(presentation.acceptedReview.archive),
          presentation.candidateReview === undefined
            ? Effect.succeed(undefined)
            : reviewWithProductPermissions(
                presentation.candidateReview.archive,
              ),
          presentation.lastKnownGoodReview === undefined
            ? Effect.succeed(undefined)
            : reviewWithProductPermissions(
                presentation.lastKnownGoodReview.archive,
              ),
        ]);
      yield* updateCapsulePresentation(() => ({
        ...presentation,
        ...(acceptedReview === undefined ? {} : { acceptedReview }),
        ...(candidateReview === undefined ? {} : { candidateReview }),
        ...(lastKnownGoodReview === undefined ? {} : { lastKnownGoodReview }),
      }));
      yield* appendCapabilityWarnings();
    });
    if (
      restoredCapsuleArchives.candidate !== undefined &&
      restoredCandidate === undefined
    ) {
      yield* persistCapsulePresentation(initialCapsulePresentation);
    }
    const preferenceState = yield* Ref.make(shellPreferences);
    const cache = yield* Ref.make<ReceiptCache>({
      receipts: new Map(),
      order: [],
    });
    const commandPermit = yield* Semaphore.make(1);
    const activeAgentParentOperations = yield* Ref.make<ReadonlySet<string>>(
      new Set(),
    );
    const continuityPermit = yield* Semaphore.make(1);
    const initialContinuity =
      continuityLoad.status === "ready"
        ? shapingSnapshot.safeMode
          ? continuityLoad.record
          : projectAgentContinuity(
              agentSnapshot,
              shapingSnapshot,
              continuityLoad.record,
            )
        : emptyRoleContinuityRecord(shapingSnapshot.lastEvent.sequence);
    const continuityState = yield* Ref.make(initialContinuity);
    const continuityBlocked = yield* Ref.make(
      continuityLoad.status === "recovery",
    );
    const continuityUi = yield* SubscriptionRef.make<RoleContinuityUiState>({
      drafts: shapingSnapshot.safeMode
        ? ContinuityDrafts.make({
            acceptedUse: "",
            candidateUse: "",
            shape: "",
          })
        : initialContinuity.drafts,
      generation: initialContinuity.generation,
      revisionSequence: initialContinuity.revisionSequence,
      ...(continuityLoad.status === "recovery"
        ? { recovery: continuityLoad.reason }
        : {}),
    });
    const events = yield* PubSub.sliding<FlectWorkspaceEvent>({
      capacity: 256,
      replay: 64,
    });

    const persistContinuity = Effect.fn("Flect.Workspace.persistContinuity")(
      (nextAgent: typeof initial.agent, shaping: ShapingSnapshot) =>
        continuityPermit.withPermits(1)(
          Effect.gen(function* () {
            if (shaping.safeMode || (yield* Ref.get(continuityBlocked))) {
              return;
            }
            const current = yield* Ref.get(continuityState);
            const next = projectAgentContinuity(nextAgent, shaping, current);
            if (JSON.stringify(next) === JSON.stringify(current)) {
              return;
            }
            const saved = yield* continuityRepository.save(
              current.generation,
              next,
            );
            yield* Ref.set(continuityState, saved);
            yield* SubscriptionRef.update(continuityUi, (current) => ({
              ...current,
              generation: saved.generation,
              revisionSequence: saved.revisionSequence,
            }));
          }).pipe(
            Effect.catch((error) =>
              Effect.all(
                [
                  Ref.set(continuityBlocked, true),
                  SubscriptionRef.update(continuityUi, (current) => ({
                    ...current,
                    recovery:
                      error._tag === "ContinuityConflict"
                        ? ("stale-write" as const)
                        : ("storage-unavailable" as const),
                  })),
                ],
                { discard: true },
              ),
            ),
          ),
        ),
    );

    const setDraft = Effect.fn("Flect.Workspace.setDraft")(
      (key: keyof ContinuityDrafts, value: string) =>
        continuityPermit.withPermits(1)(
          Effect.gen(function* () {
            const bounded = value.slice(0, key === "shape" ? 4_000 : 100_000);
            const ui = yield* SubscriptionRef.get(continuityUi);
            const drafts = ContinuityDrafts.make({
              ...ui.drafts,
              [key]: bounded,
            });
            yield* SubscriptionRef.set(continuityUi, { ...ui, drafts });
            if (yield* Ref.get(continuityBlocked)) {
              return;
            }
            const current = yield* Ref.get(continuityState);
            const next = { ...current, drafts };
            const saved = yield* continuityRepository.save(
              current.generation,
              next,
            );
            yield* Ref.set(continuityState, saved);
            yield* SubscriptionRef.set(continuityUi, {
              drafts: saved.drafts,
              generation: saved.generation,
              revisionSequence: saved.revisionSequence,
            });
          }).pipe(
            Effect.catch((error) =>
              Effect.all(
                [
                  Ref.set(continuityBlocked, true),
                  SubscriptionRef.update(continuityUi, (current) => ({
                    ...current,
                    recovery:
                      error._tag === "ContinuityConflict"
                        ? ("stale-write" as const)
                        : ("storage-unavailable" as const),
                  })),
                ],
                { discard: true },
              ),
            ),
          ),
        ),
    );

    const discardContinuity = Effect.fn("Flect.Workspace.discardContinuity")(
      function* () {
        yield* continuityRepository.discard;
        const shaping = (yield* SubscriptionRef.get(state)).shaping;
        const empty = emptyRoleContinuityRecord(shaping.lastEvent.sequence);
        yield* Effect.all(
          [
            Ref.set(continuityState, empty),
            Ref.set(continuityBlocked, false),
            SubscriptionRef.set(continuityUi, {
              drafts: empty.drafts,
              generation: empty.generation,
              revisionSequence: empty.revisionSequence,
            }),
          ],
          { discard: true },
        );
      },
    );

    const retryContinuity = Effect.fn("Flect.Workspace.retryContinuity")(
      function* () {
        const loaded = yield* continuityRepository.load;
        if (loaded.status === "recovery") {
          yield* Effect.all(
            [
              Ref.set(continuityBlocked, true),
              SubscriptionRef.update(continuityUi, (current) => ({
                ...current,
                recovery: loaded.reason,
              })),
            ],
            { discard: true },
          );
          return;
        }
        const shaping = (yield* SubscriptionRef.get(state)).shaping;
        const record =
          loaded.status === "ready"
            ? loaded.record
            : emptyRoleContinuityRecord(shaping.lastEvent.sequence);
        yield* Effect.all(
          [
            Ref.set(continuityState, record),
            Ref.set(continuityBlocked, false),
            SubscriptionRef.set(continuityUi, {
              drafts: shaping.safeMode
                ? ContinuityDrafts.make({
                    acceptedUse: "",
                    candidateUse: "",
                    shape: "",
                  })
                : record.drafts,
              generation: record.generation,
              revisionSequence: record.revisionSequence,
            }),
          ],
          { discard: true },
        );
      },
    );

    const transition = Effect.fn("Flect.Workspace.transition")(function* (
      source: FlectCommandSource,
      type: FlectWorkspaceEvent["type"],
      update: (current: FlectWorkspaceSnapshot) => FlectWorkspaceSnapshot,
      fields: {
        readonly operationId?: string;
        readonly commandId?: string;
        readonly role?: InteractiveAgentRole;
        readonly revisionId?: RevisionId;
        readonly message?: string;
      } = {},
    ) {
      const timestamp = Date.now();
      const event = yield* SubscriptionRef.modify(state, (current) => {
        const sequence = current.sequence + 1;
        const updated = update(current);
        const next = FlectWorkspaceSnapshot.make({
          ...updated,
          sequence,
        });
        return [
          FlectWorkspaceEvent.make({
            version: 1,
            id: `event-${crypto.randomUUID()}`,
            sequence,
            timestamp,
            workspaceId,
            source,
            type,
            ...fields,
          }),
          next,
        ];
      });
      yield* PubSub.publish(events, event);
      return event;
    });

    const unchanged = (current: FlectWorkspaceSnapshot) => current;

    const reportBuild = (
      envelope: FlectCommandEnvelope,
      operationId: string,
      build: WorkspaceBuildSnapshot,
    ) =>
      transition(
        envelope.source,
        "build-progress",
        (current) => FlectWorkspaceSnapshot.make({ ...current, build }),
        {
          operationId,
          commandId: envelope.commandId,
          message: build.message,
        },
      ).pipe(Effect.asVoid);

    const operationContext = (
      envelope: FlectCommandEnvelope,
      operationId: string,
    ) =>
      OperationContext.make({
        operationId,
        commandId: envelope.commandId,
        workspaceId,
        source: envelope.source,
      });

    const withNestedAgentCommands = <A, E, R>(
      operationId: string,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Ref.update(activeAgentParentOperations, (current) =>
        new Set(current).add(operationId),
      ).pipe(
        Effect.andThen(effect),
        Effect.ensuring(
          Ref.update(activeAgentParentOperations, (current) => {
            const next = new Set(current);
            next.delete(operationId);
            return next;
          }),
        ),
      );

    const appendCommandRecord = (
      envelope: FlectCommandEnvelope,
      operationId: string,
      phase: "accepted" | "succeeded" | "failed",
      summary: string,
    ) =>
      journal
        .append(
          OperationJournalInput.make({
            version: 1,
            operationId,
            commandId: envelope.commandId,
            workspaceId,
            source: envelope.source,
            category: "command",
            phase,
            summary,
            ...(envelope.source.kind === "control"
              ? { clientId: envelope.source.clientId }
              : envelope.source.kind === "agent"
                ? {
                    role: envelope.source.role,
                    sessionId: envelope.source.sessionId,
                    toolCallId: envelope.source.requestId,
                  }
                : {}),
          }),
        )
        .pipe(Effect.asVoid);

    const authorize = Effect.fn("Flect.Workspace.authorize")(function* (
      envelope: FlectCommandEnvelope,
    ) {
      switch (envelope.source.kind) {
        case "user":
          return;
        case "control":
          if (
            envelope.command.type !== "enable-control" &&
            envelope.command.type !== "decide-product-capability" &&
            envelope.command.type !== "set-portable-extension-enabled" &&
            envelope.command.type !== "set-portable-extension-pin" &&
            envelope.command.type !== "fork-portable-extension" &&
            envelope.command.type !== "resolve-portable-extension-update" &&
            envelope.command.type !== "remove-portable-extension"
          ) {
            return;
          }
          return yield* Effect.fail(
            ControlUnauthorized.make({
              message:
                envelope.command.type === "enable-control"
                  ? "Outside clients cannot enable control."
                  : envelope.command.type === "decide-product-capability"
                    ? "Outside clients cannot grant product capabilities."
                    : "Outside clients cannot change portable extension trust decisions.",
            }),
          );
        case "agent": {
          const binding =
            envelope.source.binding ??
            (envelope.source.role === "app" ? "accepted" : "candidate");
          const allowed =
            envelope.command.type === "inspect" ||
            (envelope.source.role === "shaper" &&
              (envelope.command.type === "import-capsule" ||
                envelope.command.type === "checkpoint-share-fork" ||
                envelope.command.type === "resolve-share-conflict")) ||
            (envelope.command.type === "invoke-portable-extension" &&
              envelope.command.role === envelope.source.role &&
              envelope.command.binding === binding) ||
            (envelope.source.role === "app" &&
              (envelope.command.type === "invoke-interface-action" ||
                envelope.command.type === "invoke-product-operation" ||
                envelope.command.type === "request-shape-handoff"));
          if (allowed) {
            return;
          }
          return yield* Effect.fail(
            ControlUnauthorized.make({
              message: `${envelope.source.role === "app" ? "App Agent" : "Shaper"} cannot run ${envelope.command.type}.`,
            }),
          );
        }
        case "capsule":
          if (envelope.command.type === "invoke-product-operation") {
            return;
          }
          return yield* Effect.fail(
            ControlUnauthorized.make({
              message: `Capsule cannot run ${envelope.command.type}.`,
            }),
          );
      }
    });

    const remember = (commandId: string, receipt: FlectCommandReceipt) =>
      Ref.update(cache, (current) => {
        const alreadyKnown = current.receipts.has(commandId);
        const order = alreadyKnown
          ? current.order
          : [...current.order, commandId];
        const boundedOrder = order.slice(-256);
        const receipts = new Map(current.receipts);
        receipts.set(commandId, receipt);
        for (const key of receipts.keys()) {
          if (!boundedOrder.includes(key)) {
            receipts.delete(key);
          }
        }
        return { receipts, order: boundedOrder };
      });

    const claim = Effect.fn("Flect.Workspace.claimCommand")(
      (envelope: FlectCommandEnvelope) =>
        Effect.gen(function* () {
          yield* authorize(envelope);
          const existing = (yield* Ref.get(cache)).receipts.get(
            envelope.commandId,
          );
          if (existing !== undefined) {
            return {
              status: "duplicate",
              receipt: FlectCommandReceipt.make({
                ...existing,
                status: "duplicate",
              }),
            } satisfies Claim;
          }
          const current = yield* SubscriptionRef.get(state);
          if (
            envelope.workspaceId !== current.workspaceId ||
            (envelope.expectedSequence !== undefined &&
              envelope.expectedSequence !== current.sequence)
          ) {
            return yield* Effect.fail(
              CommandConflict.make({
                message: "The workspace changed before the command ran.",
                currentSequence: current.sequence,
              }),
            );
          }
          const operationId = `operation-${crypto.randomUUID()}`;
          const accepted = yield* transition(
            envelope.source,
            "command-accepted",
            unchanged,
            {
              operationId,
              commandId: envelope.commandId,
            },
          );
          const receipt = FlectCommandReceipt.make({
            version: 1,
            commandId: envelope.commandId,
            workspaceId,
            operationId,
            sequence: accepted.sequence,
            status: "accepted",
          });
          yield* remember(envelope.commandId, receipt);
          yield* appendCommandRecord(
            envelope,
            operationId,
            "accepted",
            `${envelope.command.type} accepted`,
          );
          return {
            status: "accepted",
            operationId,
            receipt,
          } satisfies Claim;
        }),
    );

    const applyShapingSnapshot = (
      current: FlectWorkspaceSnapshot,
      shaping: ShapingSnapshot,
    ) =>
      (() => {
        const workbench = synchronizeWorkbenchState(
          current.workbench ?? initialWorkbenchState(current.shaping),
          shaping,
        );
        return FlectWorkspaceSnapshot.make({
          ...current,
          phase: phaseFrom(shaping),
          mode: modeFromWorkbench(workbench, shaping),
          document: documentFrom(shaping),
          shaping,
          workbench,
        });
      })();

    const transitionShaping = (
      envelope: FlectCommandEnvelope,
      operationId: string,
      type: FlectWorkspaceEvent["type"],
      shaping: ShapingSnapshot,
      revisionId?: RevisionId,
    ) =>
      transition(
        envelope.source,
        type,
        (current) => applyShapingSnapshot(current, shaping),
        {
          operationId,
          commandId: envelope.commandId,
          ...(revisionId === undefined ? {} : { revisionId }),
        },
      );

    const hashShareBytes = Effect.fn("Flect.Workspace.hashShareBytes")(
      (value: Uint8Array) =>
        Effect.tryPromise({
          try: async () => {
            const digest = await crypto.subtle.digest(
              "SHA-256",
              Uint8Array.from(value),
            );
            return Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          },
          catch: () =>
            commandRejected("The shared source could not be reviewed."),
        }),
    );

    const validateShareActivation = Effect.fn(
      "Flect.Workspace.validateShareActivation",
    )(function* () {
      const activation = yield* Ref.get(shareActivation);
      if (activation === undefined) return;
      if (
        shareInstallationStore === undefined ||
        shareSignatureVerifier === undefined ||
        shareCandidateStore === undefined
      ) {
        return yield* Effect.fail(
          commandRejected("Shared activation is unavailable."),
        );
      }
      const candidate = yield* Ref.get(shareCandidate);
      const installation = yield* shareInstallationStore.get(
        activation.shareId,
      );
      const review = (yield* SubscriptionRef.get(state)).shareReview;
      const declaredIds =
        candidate?.material.manifest.artifacts.map((artifact) => artifact.id) ??
        [];
      if (
        candidate === undefined ||
        installation?.pending === undefined ||
        review?.shareId !== activation.shareId ||
        candidate.material.manifest.id !== activation.shareId ||
        !review.compatible ||
        review.lineage === "conflict" ||
        review.blockers.includes("migration-review-required") ||
        activation.artifactIds.length === 0 ||
        new Set(activation.artifactIds).size !==
          activation.artifactIds.length ||
        activation.artifactIds.some((id) => !declaredIds.includes(id)) ||
        (yield* shareCandidateStore.load(
          installation.pending.archiveSha256,
        )) === undefined
      ) {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
      const signature = yield* shareSignatureVerifier.verify(
        candidate.material.manifest,
        candidate.material.archiveSha256,
      );
      if (signature.status === "invalid") {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
    });

    const finalizeShareActivation = Effect.fn(
      "Flect.Workspace.finalizeShareActivation",
    )(function* (metadata?: Ref.Ref<FinalizedShareActivation | undefined>) {
      const activation = yield* Ref.get(shareActivation);
      if (activation === undefined) return undefined;
      if (
        shareInstallationStore === undefined ||
        shareRepository === undefined ||
        shareSignatureVerifier === undefined ||
        shareCandidateStore === undefined
      ) {
        return yield* Effect.fail(
          commandRejected("Shared activation is unavailable."),
        );
      }
      const candidate = yield* Ref.get(shareCandidate);
      const installation = yield* shareInstallationStore.get(
        activation.shareId,
      );
      const review = (yield* SubscriptionRef.get(state)).shareReview;
      if (
        candidate === undefined ||
        installation?.pending === undefined ||
        review?.shareId !== activation.shareId ||
        candidate.material.manifest.id !== activation.shareId ||
        !review.compatible ||
        review.lineage === "conflict" ||
        review.blockers.includes("migration-review-required")
      ) {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
      const declaredIds = candidate.material.manifest.artifacts.map(
        (artifact) => artifact.id,
      );
      if (
        activation.artifactIds.length === 0 ||
        new Set(activation.artifactIds).size !==
          activation.artifactIds.length ||
        activation.artifactIds.some((id) => !declaredIds.includes(id))
      ) {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
      const stored = yield* shareCandidateStore.load(
        installation.pending.archiveSha256,
      );
      if (stored === undefined) {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
      const signature = yield* shareSignatureVerifier.verify(
        candidate.material.manifest,
        candidate.material.archiveSha256,
      );
      if (signature.status === "invalid") {
        return yield* Effect.fail(
          commandRejected("Review the shared candidate again before Keep."),
        );
      }
      let refs = ShareInstallationRefs.make({
        base: installation.refs.base,
        upstream: installation.refs.upstream,
        fork: installation.refs.fork,
      });
      const beforeRefs =
        installation.refs.candidate === undefined
          ? undefined
          : ShareInstallationRefs.make({
              base: installation.refs.base,
              upstream: installation.refs.upstream,
              fork: installation.refs.fork,
              candidate: installation.refs.candidate,
            });
      const expectedAfterRefs =
        installation.refs.candidate === undefined
          ? refs
          : ShareInstallationRefs.make({
              base: installation.refs.upstream,
              upstream: installation.refs.upstream,
              fork: installation.refs.candidate,
            });
      const transaction = {
        before: installation,
        ...(beforeRefs === undefined ? {} : { beforeRefs }),
        afterRefs: expectedAfterRefs,
        candidateArchive: stored.slice(),
        candidateArchiveSha256: installation.pending.archiveSha256,
      } satisfies FinalizedShareActivation;
      if (metadata !== undefined) {
        yield* Ref.set(metadata, transaction);
      }
      if (installation.refs.candidate !== undefined) {
        const accepted = yield* shareRepository
          .acceptCandidate({
            shareId: installation.shareId,
            refs: {
              base: installation.refs.base,
              upstream: installation.refs.upstream,
              fork: installation.refs.fork,
              candidate: installation.refs.candidate,
            },
          })
          .pipe(
            Effect.mapError(() =>
              commandRejected("The shared candidate changed before Keep."),
            ),
          );
        refs = ShareInstallationRefs.make({ ...accepted.refs });
      }
      const timestamp = Date.now();
      const manifestSha256 = yield* hashShareBytes(
        new TextEncoder().encode(JSON.stringify(candidate.material.manifest)),
      );
      const repositorySha256 =
        candidate.material.manifest.repository._tag === "embedded"
          ? candidate.material.manifest.repository.sha256
          : yield* hashShareBytes(candidate.material.repository);
      const installedArtifactIds = [
        ...new Set([
          ...installation.installedArtifactIds.filter((id) =>
            declaredIds.includes(id),
          ),
          ...activation.artifactIds,
        ]),
      ];
      const { pending, ...retained } = installation;
      const acceptedInstallation = ShareInstallationRecord.make({
        ...retained,
        version: candidate.material.manifest.version,
        source: shareOriginWithArchive(candidate.origin, pending.archiveSha256),
        manifest: candidate.material.manifest,
        manifestSha256,
        repositorySha256,
        artifacts: candidate.material.manifest.artifacts.map((artifact) =>
          ShareInstalledArtifact.make({
            id: artifact.id,
            kind: artifact.kind,
            version: artifact.version,
            contentSha256: artifact.contentSha256,
            ...(artifact.capsule === undefined
              ? {}
              : { capsuleSha256: artifact.capsule.sha256 }),
          }),
        ),
        installedArtifactIds,
        refs,
        updatedAt: timestamp,
      });
      const restoreGit =
        beforeRefs === undefined
          ? Effect.void
          : shareRepository.restoreCandidate({
              shareId: installation.shareId,
              before: beforeRefs,
              after: refs,
            });
      const finalizedTransaction = {
        ...transaction,
        afterRefs: refs,
        candidateArchiveSha256: pending.archiveSha256,
      } satisfies FinalizedShareActivation;
      yield* shareInstallationStore.save(acceptedInstallation).pipe(
        Effect.mapError(() =>
          commandRejected("The shared Keep state could not be saved."),
        ),
        Effect.catch((error) =>
          restoreGit.pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      yield* Ref.set(shareCandidate, undefined);
      yield* Ref.set(shareActivation, undefined);
      const shares = yield* shareInstallationStore.snapshot;
      yield* SubscriptionRef.update(state, (current) => {
        const { shareReview: _shareReview, ...rest } = current;
        return FlectWorkspaceSnapshot.make({ ...rest, shares });
      });
      return finalizedTransaction;
    });

    const removeUnreferencedShareArchive = Effect.fn(
      "Flect.Workspace.removeUnreferencedShareArchive",
    )(function* (digest: string | undefined) {
      if (
        digest === undefined ||
        shareCandidateStore === undefined ||
        shareInstallationStore === undefined
      ) {
        return;
      }
      const shares = yield* shareInstallationStore.snapshot;
      if (
        shares.entries.some(
          (entry) =>
            entry.source.archiveSha256 === digest ||
            entry.pending?.archiveSha256 === digest,
        )
      ) {
        return;
      }
      yield* shareCandidateStore.remove(digest).pipe(Effect.ignore);
    });

    const discardShareActivation = Effect.fn(
      "Flect.Workspace.discardShareActivation",
    )(function* (metadata?: Ref.Ref<DiscardedShareActivation | undefined>) {
      const activation = yield* Ref.get(shareActivation);
      if (activation === undefined || shareInstallationStore === undefined) {
        return undefined;
      }
      const installation = yield* shareInstallationStore.get(
        activation.shareId,
      );
      if (installation?.pending === undefined) {
        yield* Ref.set(shareActivation, undefined);
        return undefined;
      }
      const { pending: _pending, ...retained } = installation;
      const restored = ShareInstallationRecord.make({
        ...retained,
        refs: ShareInstallationRefs.make({
          base: installation.refs.base,
          upstream: installation.refs.upstream,
          fork: installation.refs.fork,
        }),
        updatedAt: Date.now(),
      });
      const transaction = { before: installation, after: restored } satisfies
        DiscardedShareActivation;
      if (metadata !== undefined) {
        yield* Ref.set(metadata, transaction);
      }
      if (installation.refs.candidate !== undefined) {
        if (shareRepository === undefined) {
          return yield* Effect.fail(
            commandRejected("The shared candidate could not be rejected."),
          );
        }
        yield* shareRepository
          .rejectCandidate({
            shareId: installation.shareId,
            candidate: installation.refs.candidate,
            refs: {
              base: installation.refs.base,
              upstream: installation.refs.upstream,
              fork: installation.refs.fork,
            },
          })
          .pipe(
            Effect.mapError(() =>
              commandRejected("The shared candidate could not be rejected."),
            ),
          );
      }
      const restoreRef =
        installation.refs.candidate === undefined
          ? Effect.void
          : shareRepository === undefined
            ? Effect.fail(
                commandRejected(
                  "The shared candidate could not be restored.",
                ),
              )
            : shareRepository.restoreCandidateRef({
                shareId: installation.shareId,
                candidate: installation.refs.candidate,
                refs: {
                  base: installation.refs.base,
                  upstream: installation.refs.upstream,
                  fork: installation.refs.fork,
                },
              });
      yield* shareInstallationStore.save(restored).pipe(
        Effect.mapError(() =>
          commandRejected("The shared candidate state could not be saved."),
        ),
        Effect.catch((error) =>
          restoreRef.pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      yield* Ref.set(shareCandidate, undefined);
      yield* Ref.set(shareActivation, undefined);
      const shares = yield* shareInstallationStore.snapshot;
      yield* SubscriptionRef.update(state, (current) => {
        const { shareReview: _shareReview, ...rest } = current;
        return FlectWorkspaceSnapshot.make({ ...rest, shares });
      });
      return transaction;
    });

    const runCompensations = Effect.fn(
      "Flect.Workspace.runCompensations",
    )(function* (
      effects: ReadonlyArray<Effect.Effect<void, FlectCommandError>>,
    ) {
      const results = yield* Effect.all(
        effects.map((effect) => effect.pipe(Effect.result)),
        { concurrency: 1 },
      );
      return results.some((result) => result._tag === "Failure");
    });

    const enterDegradedRecovery = Effect.fn(
      "Flect.Workspace.enterDegradedRecovery",
    )(function* () {
      yield* kernel.enterSafeMode.pipe(Effect.result);
        const shaping = yield* kernel.snapshot;
        yield* SubscriptionRef.update(state, (current) =>
        FlectWorkspaceSnapshot.make({
          ...current,
          phase: shaping.safeMode ? "safe-mode" : "unavailable",
          mode: "edit",
          document: documentFrom(shaping),
          shaping,
          ...(current.persistence === undefined
            ? {}
            : {
                persistence: WorkspacePersistenceSnapshot.make({
                  ...current.persistence,
                  source: "unavailable",
                  capsule: "unavailable",
                }),
              }),
        }),
      );
      return yield* Effect.fail(
        commandRejected(
          "The workspace entered safe mode for deterministic recovery.",
        ),
      );
    });

    const acceptProposal = Effect.fn("Flect.Workspace.acceptProposal")(
      function* (envelope: FlectCommandEnvelope, operationId: string) {
        const shaping = yield* kernel.snapshot;
        const proposal = shaping.proposal;
        if (proposal === undefined) {
          return yield* Effect.fail(
            commandRejected("There is no proposal to accept."),
          );
        }
        yield* validateShareActivation();
        const presentation = yield* SubscriptionRef.get(capsulePresentation);
        if (presentation.candidateReview?.activationBlocked === true) {
          const incompatible =
            !presentation.candidateReview.flectCompatible ||
            !presentation.candidateReview.platformCompatible;
          return yield* Effect.fail(
            commandRejected(
              incompatible
                ? "This capsule is incompatible with this Flect version or host. Reject this candidate or use a compatible host."
                : "Required capsule capabilities are unavailable. Reject this candidate or install it in a host that can grant them.",
            ),
          );
        }
        const beforeWorkspace = yield* SubscriptionRef.get(state);
        const beforeCapsulePresentation =
          yield* SubscriptionRef.get(capsulePresentation);
        const beforeCandidate = yield* Ref.get(shareCandidate);
        const beforeActivation = yield* Ref.get(shareActivation);
        const beforeExtensions =
          extensionCatalog === undefined
            ? undefined
            : yield* extensionCatalog.snapshot;
        const finalizedShareMetadata = yield* Ref.make<
          FinalizedShareActivation | undefined
        >(undefined);
        const restoreAcceptance = (
          finalizedShare: FinalizedShareActivation | undefined,
        ) =>
          Effect.gen(function* () {
            const compensations: Array<
              Effect.Effect<void, FlectCommandError>
            > = [restoreCapsulePresentation(beforeCapsulePresentation)];
            if (
              extensionCatalog !== undefined &&
              beforeExtensions !== undefined
            ) {
              compensations.push(
                extensionCatalog.restore(beforeExtensions).pipe(
                  Effect.mapError(() =>
                    commandRejected(
                      "The accepted extension state could not be restored.",
                    ),
                  ),
                ),
              );
            }
            if (finalizedShare !== undefined) {
              if (finalizedShare.beforeRefs !== undefined) {
                if (shareRepository === undefined) {
                  compensations.push(
                    Effect.fail(
                      commandRejected(
                        "The shared candidate state could not be restored.",
                      ),
                    ),
                  );
                } else {
                  compensations.push(
                    shareRepository
                      .restoreCandidate({
                        shareId: finalizedShare.before.shareId,
                        before: finalizedShare.beforeRefs,
                        after: finalizedShare.afterRefs,
                      })
                      .pipe(
                        Effect.mapError(() =>
                          commandRejected(
                            "The shared candidate state could not be restored.",
                          ),
                        ),
                      ),
                  );
                }
              }
              if (shareInstallationStore !== undefined) {
                compensations.push(
                  shareInstallationStore.save(finalizedShare.before).pipe(
                    Effect.mapError(() =>
                      commandRejected(
                        "The shared installation state could not be restored.",
                      ),
                    ),
                  ),
                );
              }
              if (shareCandidateStore !== undefined) {
                compensations.push(
                  shareCandidateStore.save(finalizedShare.candidateArchive).pipe(
                    Effect.mapError(() =>
                      commandRejected(
                        "The shared candidate archive could not be restored.",
                      ),
                    ),
                  ),
                );
              }
            }
            const compensationFailed = yield* runCompensations(compensations);
            yield* Effect.all(
              [
                SubscriptionRef.set(
                  capsulePresentation,
                  beforeCapsulePresentation,
                ),
                Ref.set(shareCandidate, beforeCandidate),
                Ref.set(shareActivation, beforeActivation),
                SubscriptionRef.set(state, beforeWorkspace),
              ],
              { discard: true },
            );
            if (compensationFailed) {
              return yield* enterDegradedRecovery();
            }
          });
        let finalizedShare: FinalizedShareActivation | undefined;
        const acceptedResult = yield* Effect.gen(function* () {
          if (extensionCatalog !== undefined) {
            yield* extensionCatalog.promoteCandidate.pipe(
              Effect.mapError((error) => commandRejected(error.message)),
            );
            yield* syncExtensionSnapshot();
          }
          finalizedShare = yield* finalizeShareActivation(finalizedShareMetadata);
          yield* updateCapsulePresentation((current) => ({
            ...(current.candidate === undefined
              ? {}
              : { accepted: current.candidate }),
            ...(current.accepted === undefined
              ? {}
              : { lastKnownGood: current.accepted }),
            ...(current.candidateReview === undefined
              ? {}
              : { acceptedReview: current.candidateReview }),
            ...(current.acceptedReview === undefined
              ? {}
              : { lastKnownGoodReview: current.acceptedReview }),
          }));
          const accepted = yield* kernel.accept(proposal.id);
          return { accepted, finalizedShare };
        }).pipe(
          Effect.catch((error) =>
            Ref.get(finalizedShareMetadata).pipe(
              Effect.flatMap((metadata) => restoreAcceptance(metadata)),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        const accepted = acceptedResult.accepted;
        const committedShare = acceptedResult.finalizedShare;
        yield* removeUnreferencedShareArchive(
          committedShare !== undefined &&
            committedShare.before.source.archiveSha256 !==
              committedShare.candidateArchiveSha256
            ? committedShare.before.source.archiveSha256
            : undefined,
        );
        yield* agent.releasePreview;
        const next = yield* kernel.snapshot;
        yield* transitionShaping(
          envelope,
          operationId,
          "revision-accepted",
          next,
          accepted.id,
        );
      },
    );

    const rejectProposal = Effect.fn("Flect.Workspace.rejectProposal")(
      function* (envelope: FlectCommandEnvelope, operationId: string) {
        const shaping = yield* kernel.snapshot;
        const proposal = shaping.proposal;
        if (proposal === undefined) {
          return yield* Effect.fail(
            commandRejected("There is no proposal to reject."),
          );
        }
        const beforeWorkspace = yield* SubscriptionRef.get(state);
        const beforeCapsulePresentation =
          yield* SubscriptionRef.get(capsulePresentation);
        const beforeCandidate = yield* Ref.get(shareCandidate);
        const beforeActivation = yield* Ref.get(shareActivation);
        const beforeExtensions =
          extensionCatalog === undefined
            ? undefined
            : yield* extensionCatalog.snapshot;
        const discardedShareMetadata = yield* Ref.make<
          DiscardedShareActivation | undefined
        >(undefined);
        const restoreRejection = (
          discarded: DiscardedShareActivation | undefined,
        ) =>
          Effect.gen(function* () {
            const compensations: Array<
              Effect.Effect<void, FlectCommandError>
            > = [restoreCapsulePresentation(beforeCapsulePresentation)];
            if (
              extensionCatalog !== undefined &&
              beforeExtensions !== undefined
            ) {
              compensations.push(
                extensionCatalog.restore(beforeExtensions).pipe(
                  Effect.mapError(() =>
                    commandRejected(
                      "The rejected extension state could not be restored.",
                    ),
                  ),
                ),
              );
            }
            if (discarded !== undefined) {
              if (discarded.before.refs.candidate !== undefined) {
                if (shareRepository === undefined) {
                  compensations.push(
                    Effect.fail(
                      commandRejected(
                        "The shared candidate state could not be restored.",
                      ),
                    ),
                  );
                } else {
                  compensations.push(
                    shareRepository
                      .restoreCandidateRef({
                        shareId: discarded.before.shareId,
                        candidate: discarded.before.refs.candidate,
                        refs: {
                          base: discarded.after.refs.base,
                          upstream: discarded.after.refs.upstream,
                          fork: discarded.after.refs.fork,
                        },
                      })
                      .pipe(
                        Effect.mapError(() =>
                          commandRejected(
                            "The shared candidate state could not be restored.",
                          ),
                        ),
                      ),
                  );
                }
              }
              if (shareInstallationStore !== undefined) {
                compensations.push(
                  shareInstallationStore.save(discarded.before).pipe(
                    Effect.mapError(() =>
                      commandRejected(
                        "The shared installation state could not be restored.",
                      ),
                    ),
                  ),
                );
              }
            }
            const compensationFailed = yield* runCompensations(compensations);
            yield* Effect.all(
              [
                SubscriptionRef.set(
                  capsulePresentation,
                  beforeCapsulePresentation,
                ),
                Ref.set(shareCandidate, beforeCandidate),
                Ref.set(shareActivation, beforeActivation),
                SubscriptionRef.set(state, beforeWorkspace),
              ],
              { discard: true },
            );
            if (compensationFailed) {
              return yield* enterDegradedRecovery();
            }
          });
        let discarded: DiscardedShareActivation | undefined;
        const rejectedResult = yield* Effect.gen(function* () {
          if (extensionCatalog !== undefined) {
            yield* extensionCatalog.rejectCandidate.pipe(
              Effect.mapError((error) => commandRejected(error.message)),
            );
            yield* syncExtensionSnapshot();
          }
          yield* updateCapsulePresentation((current) => ({
            ...(current.accepted === undefined
              ? {}
              : { accepted: current.accepted }),
            ...(current.lastKnownGood === undefined
              ? {}
              : { lastKnownGood: current.lastKnownGood }),
            ...(current.acceptedReview === undefined
              ? {}
              : { acceptedReview: current.acceptedReview }),
            ...(current.lastKnownGoodReview === undefined
              ? {}
              : { lastKnownGoodReview: current.lastKnownGoodReview }),
          }));
          discarded = yield* discardShareActivation(discardedShareMetadata);
          const rejected = yield* kernel.reject(proposal.id);
          return { rejected, discarded };
        }).pipe(
          Effect.catch((error) =>
            Ref.get(discardedShareMetadata).pipe(
              Effect.flatMap((metadata) => restoreRejection(metadata)),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        const rejected = rejectedResult.rejected;
        yield* removeUnreferencedShareArchive(
          rejectedResult.discarded?.before.pending?.archiveSha256,
        );
        yield* agent.releasePreview;
        const next = yield* kernel.snapshot;
        yield* transitionShaping(
          envelope,
          operationId,
          "revision-rejected",
          next,
          rejected.id,
        );
      },
    );

    const rollback = Effect.fn("Flect.Workspace.rollback")(function* (
      envelope: FlectCommandEnvelope,
      operationId: string,
    ) {
      const beforeCapsulePresentation =
        yield* SubscriptionRef.get(capsulePresentation);
      yield* updateCapsulePresentation((current) => ({
        ...(current.lastKnownGood === undefined
          ? {}
          : { accepted: current.lastKnownGood }),
        ...(current.accepted === undefined
          ? {}
          : { lastKnownGood: current.accepted }),
        ...(current.lastKnownGoodReview === undefined
          ? {}
          : { acceptedReview: current.lastKnownGoodReview }),
        ...(current.acceptedReview === undefined
          ? {}
          : { lastKnownGoodReview: current.acceptedReview }),
      }));
      const revision = yield* kernel.rollback.pipe(
        Effect.catch((error) =>
          restoreCapsulePresentation(beforeCapsulePresentation).pipe(
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
      const next = yield* kernel.snapshot;
      yield* transitionShaping(
        envelope,
        operationId,
        "revision-rolled-back",
        next,
        revision.id,
      );
    });

    const enterSafeMode = Effect.fn("Flect.Workspace.enterSafeMode")(function* (
      envelope: FlectCommandEnvelope,
      operationId: string,
    ) {
      yield* kernel.enterSafeMode;
      const next = yield* kernel.snapshot;
      yield* transitionShaping(
        envelope,
        operationId,
        "safe-mode-entered",
        next,
      );
    });

    const shapeInstruction = Effect.fn("Flect.Workspace.shapeInstruction")(
      function* (
        envelope: FlectCommandEnvelope,
        operationId: string,
        instruction: string,
        handoff?: WorkbenchHandoff,
      ) {
        const shaping = yield* kernel.snapshot;
        if (shaping.safeMode) {
          return yield* Effect.fail(
            commandRejected("Leave safe mode before shaping."),
          );
        }
        const current = yield* SubscriptionRef.get(state);
        const previous =
          current.workbench ?? initialWorkbenchState(current.shaping);
        const selected = yield* selectWorkbenchTarget(
          previous,
          "shape",
          shaping,
          previous.transitionSequence,
        ).pipe(Effect.mapError((error) => commandRejected(error.message)));
        const workbench =
          handoff === undefined
            ? selected
            : WorkbenchSnapshot.make({ ...selected, handoff });
        yield* transition(
          envelope.source,
          "turn-started",
          (snapshot) =>
            FlectWorkspaceSnapshot.make({
              ...snapshot,
              phase: "shaping",
              mode: "edit",
              workbench,
            }),
          {
            operationId,
            commandId: envelope.commandId,
            role: "shaper",
          },
        );
        const candidate = yield* withNestedAgentCommands(
          operationId,
          agent.submitShaperInstruction(
            operationContext(envelope, operationId),
            handoff === undefined
              ? instruction
              : boundedHandoffInstruction(handoff),
            shaping.proposal?.document ?? shaping.active.document,
          ),
        );
        if (extensionCatalog !== undefined) {
          yield* extensionCatalog.rejectCandidate.pipe(
            Effect.mapError((error) => commandRejected(error.message)),
          );
          yield* syncExtensionSnapshot();
        }
        yield* updateCapsulePresentation((current) => ({
          ...(current.accepted === undefined
            ? {}
            : { accepted: current.accepted }),
          ...(current.lastKnownGood === undefined
            ? {}
            : { lastKnownGood: current.lastKnownGood }),
          ...(current.acceptedReview === undefined
            ? {}
            : { acceptedReview: current.acceptedReview }),
          ...(current.lastKnownGoodReview === undefined
            ? {}
            : { lastKnownGoodReview: current.lastKnownGoodReview }),
        }));
        const preview =
          shaping.proposal === undefined
            ? yield* kernel
                .propose(candidate, "shaper")
                .pipe(Effect.flatMap((proposal) => kernel.preview(proposal.id)))
            : yield* kernel.supersede(shaping.proposal.id, candidate, "shaper");
        const next = yield* kernel.snapshot;
        yield* transitionShaping(
          envelope,
          operationId,
          "revision-previewed",
          next,
          preview.id,
        );
      },
    );

    const runShareConflictShaper = Effect.fn(
      "Flect.Workspace.runShareConflictShaper",
    )(function* (
      envelope: FlectCommandEnvelope,
      operationId: string,
      instruction: string,
    ) {
      const shaping = yield* kernel.snapshot;
      if (shaping.safeMode) {
        return yield* Effect.fail(
          commandRejected("Leave safe mode before resolving the conflict."),
        );
      }
      const current = yield* SubscriptionRef.get(state);
      const previous =
        current.workbench ?? initialWorkbenchState(current.shaping);
      const workbench = yield* selectWorkbenchTarget(
        previous,
        "shape",
        shaping,
        previous.transitionSequence,
      ).pipe(Effect.mapError((error) => commandRejected(error.message)));
      yield* transition(
        envelope.source,
        "turn-started",
        (snapshot) =>
          FlectWorkspaceSnapshot.make({
            ...snapshot,
            phase: "shaping",
            mode: "edit",
            workbench,
          }),
        {
          operationId,
          commandId: envelope.commandId,
          role: "shaper",
        },
      );
      yield* withNestedAgentCommands(
        operationId,
        agent.submitShaperInstruction(
          operationContext(envelope, operationId),
          instruction,
          shaping.proposal?.document ?? shaping.active.document,
        ),
      );
      const latest = yield* kernel.snapshot;
      yield* transition(
        envelope.source,
        "turn-completed",
        (snapshot) =>
          FlectWorkspaceSnapshot.make({
            ...snapshot,
            phase: phaseFrom(latest),
            mode: "edit",
            workbench,
          }),
        {
          operationId,
          commandId: envelope.commandId,
          role: "shaper",
        },
      );
    });

    const hashShareReference = (value: string) =>
      hashShareBytes(new TextEncoder().encode(value));

    const shareOriginWithArchive = (
      source: ShareInstallationSource,
      archiveSha256: string,
    ): ShareInstallationSource => {
      switch (source._tag) {
        case "local":
          return ShareLocalInstallationSource.make({
            _tag: "local",
            archiveSha256,
          });
        case "url":
          return ShareUrlInstallationSource.make({
            ...source,
            archiveSha256,
          });
        case "git":
          return ShareGitInstallationSource.make({
            ...source,
            archiveSha256,
          });
        case "private":
          return SharePrivateInstallationSource.make({
            ...source,
            archiveSha256,
          });
      }
    };

    const shareOrigin = Effect.fn("Flect.Workspace.shareOrigin")(function* (
      source: ShareSource,
      material: ShareCandidateMaterial,
    ) {
      switch (source._tag) {
        case "local":
          return ShareLocalInstallationSource.make({
            _tag: "local",
            archiveSha256: material.archiveSha256,
          });
        case "url":
          return ShareUrlInstallationSource.make({
            _tag: "url",
            url: source.url,
            archiveSha256: material.archiveSha256,
          });
        case "git":
          return ShareGitInstallationSource.make({
            _tag: "git",
            url: source.url,
            descriptorCommit: source.commit,
            archiveSha256: material.archiveSha256,
          });
        case "private":
          return SharePrivateInstallationSource.make({
            _tag: "private",
            adapterId: source.adapterId,
            referenceSha256: yield* hashShareReference(source.reference),
            archiveSha256: material.archiveSha256,
          });
      }
    });

    const encodeCandidateArchive = Effect.fn(
      "Flect.Workspace.encodeShareCandidate",
    )((material: ShareCandidateMaterial) =>
      encodeShareArchive({
        manifest: {
          ...material.manifest,
          repository: ShareGitRepository.make({
            _tag: "git",
            commit: material.manifest.repository.commit,
          }),
        },
        repository: material.repository,
        artifacts: material.artifacts,
      }).pipe(
        Effect.mapError(() =>
          commandRejected("The shared candidate could not be retained."),
        ),
      ),
    );

    const persistShareCandidate = Effect.fn(
      "Flect.Workspace.persistShareCandidate",
    )(function* (material: ShareCandidateMaterial) {
      if (shareCandidateStore === undefined) {
        return yield* Effect.fail(
          commandRejected("Shared candidate storage is unavailable."),
        );
      }
      const archive = yield* encodeCandidateArchive(material);
      return yield* shareCandidateStore
        .save(archive)
        .pipe(Effect.mapError((error) => commandRejected(error.message)));
    });

    const snapshotShareArtifacts = Effect.fn(
      "Flect.Workspace.snapshotShareArtifacts",
    )(function* (
      installation: ShareInstallationRecord,
      artifacts: ShareCandidateMaterial["manifest"]["artifacts"],
      role: "base" | "upstream" | "fork" | "candidate",
      expectedCommit: string,
    ) {
      if (shareRepository === undefined) {
        return yield* Effect.fail(
          commandRejected("The retained shared source is unavailable."),
        );
      }
      return (yield* Effect.forEach(
        artifacts,
        (artifact) =>
          shareRepository
            .snapshotArtifact({
              shareId: installation.shareId,
              role,
              expectedCommit,
              sourceRoot: artifact.sourceRoot,
            })
            .pipe(
              Effect.mapError(() =>
                commandRejected(
                  "The retained shared source could not be inspected.",
                ),
              ),
            ),
        { concurrency: 1 },
      )).flat();
    });

    const snapshotInstalledShareArtifacts = Effect.fn(
      "Flect.Workspace.snapshotInstalledShareArtifacts",
    )(
      (
        installation: ShareInstallationRecord,
        artifacts: ShareCandidateMaterial["manifest"]["artifacts"],
      ) =>
        snapshotShareArtifacts(
          installation,
          artifacts,
          "fork",
          installation.refs.fork,
        ),
    );

    const completeShareConflict = Effect.fn(
      "Flect.Workspace.completeShareConflict",
    )(function* (
      envelope: FlectCommandEnvelope,
      operationId: string,
      installation: ShareInstallationRecord,
      candidate: ShareCandidateState,
      files: ReadonlyArray<{
        readonly path: string;
        readonly contents: Uint8Array;
      }>,
      removals: ReadonlyArray<string>,
      message: string,
    ) {
      if (
        shareRepository === undefined ||
        shareInstallationStore === undefined ||
        shareSignatureVerifier === undefined ||
        installation.pending?.lineage !== "conflict" ||
        candidate.update?._tag !== "conflict"
      ) {
        return yield* Effect.fail(
          commandRejected(
            "Open the retained shared conflict before resolving it.",
          ),
        );
      }
      const expectedPaths = installation.pending.conflictPaths.toSorted();
      const resolutionPaths = [
        ...files.map((file) => file.path),
        ...removals,
      ].toSorted();
      const totalBytes = files.reduce(
        (total, file) => total + file.contents.byteLength,
        0,
      );
      if (
        expectedPaths.length === 0 ||
        new Set(resolutionPaths).size !== resolutionPaths.length ||
        resolutionPaths.length !== expectedPaths.length ||
        resolutionPaths.some((path, index) => path !== expectedPaths[index]) ||
        totalBytes > 32 * 1024 * 1024
      ) {
        return yield* Effect.fail(
          commandRejected("Resolve every recorded conflict path exactly once."),
        );
      }
      const previousFiles = yield* snapshotInstalledShareArtifacts(
        installation,
        candidate.material.manifest.artifacts,
      );
      const update = yield* shareRepository
        .resolveConflict({
          shareId: installation.shareId,
          refs: {
            base: installation.refs.base,
            upstream: installation.refs.upstream,
            fork: installation.refs.fork,
          },
          conflictPaths: expectedPaths,
          files,
          removals,
          message,
        })
        .pipe(
          Effect.mapError((error) =>
            commandRejected(
              error.reason === "stale-ref"
                ? `${error.message} Open it in Shape again.`
                : "The shared conflict could not be resolved safely.",
            ),
          ),
        );
      const resolvedFiles = yield* snapshotShareArtifacts(
        installation,
        candidate.material.manifest.artifacts,
        "candidate",
        update.candidate,
      );
      const signature = yield* shareSignatureVerifier.verify(
        candidate.material.manifest,
        candidate.material.archiveSha256,
      );
      const review = yield* buildShareReview({
        lineage: "fork",
        origin: candidate.origin,
        manifest: candidate.material.manifest,
        files: resolvedFiles,
        previousFiles,
        conflictPaths: [],
        flectVersion: packageMetadata.version,
        platform: currentCapsulePlatform(),
        signature,
      }).pipe(
        Effect.mapError(() =>
          commandRejected(
            "The resolved shared candidate could not be reviewed.",
          ),
        ),
      );
      const updated = ShareInstallationRecord.make({
        ...installation,
        refs: ShareInstallationRefs.make({
          base: installation.refs.base,
          upstream: installation.refs.upstream,
          fork: installation.refs.fork,
          candidate: update.candidate,
        }),
        pending: SharePendingCandidate.make({
          ...installation.pending,
          lineage: "fork",
          conflictPaths: [],
        }),
        updatedAt: Date.now(),
      });
      const saved = yield* shareInstallationStore.save(updated).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (!saved) {
        yield* shareRepository
          .rejectCandidate({
            shareId: installation.shareId,
            candidate: update.candidate,
            refs: {
              base: installation.refs.base,
              upstream: installation.refs.upstream,
              fork: installation.refs.fork,
            },
          })
          .pipe(Effect.ignore);
        return yield* Effect.fail(
          commandRejected(
            "The resolved candidate was rolled back because its installation record could not be saved.",
          ),
        );
      }
      yield* Ref.set(shareCandidate, {
        ...candidate,
        lineage: "fork",
        update,
      });
      const shares = yield* shareInstallationStore.snapshot;
      yield* transition(
        envelope.source,
        "state-changed",
        (current) =>
          FlectWorkspaceSnapshot.make({
            ...current,
            shares,
            shareReview: review,
          }),
        { operationId, commandId: envelope.commandId },
      );
      return {
        status: "resolved",
        shareId: installation.shareId,
        candidateCommit: update.candidate,
      };
    });

    const pendingInstallation = initialShares?.entries
      .filter((entry) => entry.pending !== undefined)
      .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
    if (
      pendingInstallation?.pending !== undefined &&
      shareCandidateStore !== undefined &&
      shareSourceResolver !== undefined &&
      shareSignatureVerifier !== undefined &&
      shareRepository !== undefined
    ) {
      yield* Effect.gen(function* () {
        const pending = pendingInstallation.pending;
        if (pending === undefined) return;
        const archive = yield* shareCandidateStore.load(pending.archiveSha256);
        if (archive === undefined) return yield* Effect.fail("missing");
        const completed = yield* shareSourceResolver
          .open(
            ShareLocalSource.make({
              _tag: "local",
              name: `${pendingInstallation.shareId}.flect-share`,
              bytes: archive,
            }),
          )
          .pipe(Stream.runLast);
        if (
          Option.isNone(completed) ||
          completed.value.type !== "completed" ||
          completed.value.candidate.manifest.id !==
            pendingInstallation.shareId ||
          completed.value.candidate.manifest.repository.commit !==
            pendingInstallation.refs.upstream
        ) {
          return yield* Effect.fail("invalid");
        }
        const material = completed.value.candidate;
        const previousFiles =
          pending.lineage === "new"
            ? []
            : (yield* Effect.forEach(
                material.manifest.artifacts,
                (artifact) =>
                  shareRepository
                    .snapshotArtifact({
                      shareId: pendingInstallation.shareId,
                      role: "fork",
                      expectedCommit: pendingInstallation.refs.fork,
                      sourceRoot: artifact.sourceRoot,
                    })
                    .pipe(Effect.orElseSucceed(() => [])),
                { concurrency: 1 },
              )).flat();
        const signature = yield* shareSignatureVerifier.verify(
          material.manifest,
          material.archiveSha256,
        );
        const review = yield* buildShareReview({
          lineage: pending.lineage,
          origin: pending.origin,
          manifest: material.manifest,
          files: material.files,
          previousFiles,
          conflictPaths: pending.conflictPaths,
          flectVersion: packageMetadata.version,
          platform: currentCapsulePlatform(),
          signature,
        });
        yield* Ref.set(shareCandidate, {
          material,
          origin: pending.origin,
          lineage: pending.lineage,
        });
        yield* SubscriptionRef.update(state, (current) =>
          FlectWorkspaceSnapshot.make({ ...current, shareReview: review }),
        );
      }).pipe(Effect.catch(() => Effect.void));
    }

    const runCommand: (
      envelope: FlectCommandEnvelope,
      operationId: string,
    ) => Effect.Effect<unknown, unknown> = Effect.fn(
      "Flect.Workspace.runCommand",
    )(function* (envelope: FlectCommandEnvelope, operationId: string) {
      const command = envelope.command;
      const portableKey = (value: {
        readonly capsuleId: string;
        readonly extensionId: string;
        readonly role: "app" | "shaper";
        readonly binding: "accepted" | "candidate";
      }): PortableExtensionKey => ({
        capsuleId: value.capsuleId,
        extensionId: value.extensionId,
        role: value.role,
        binding: value.binding,
      });
      switch (command.type) {
        case "inspect":
          return;
        case "open-share-source": {
          if (
            shareSourceResolver === undefined ||
            shareInstallationStore === undefined ||
            shareSignatureVerifier === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared source review is unavailable."),
            );
          }
          const completed = yield* shareSourceResolver
            .open(command.source)
            .pipe(
              Stream.runLast,
              Effect.mapError((error) => commandRejected(error.message)),
            );
          if (
            Option.isNone(completed) ||
            completed.value.type !== "completed"
          ) {
            return yield* Effect.fail(
              commandRejected("The shared source could not be reviewed."),
            );
          }
          const material = completed.value.candidate;
          const origin = yield* shareOrigin(command.source, material);
          const installed = yield* shareInstallationStore.get(
            material.manifest.id,
          );
          const lineage: ShareLineage =
            installed === undefined ? "new" : "update";
          const signature = yield* shareSignatureVerifier.verify(
            material.manifest,
            material.archiveSha256,
          );
          const previousFiles =
            installed === undefined
              ? []
              : yield* snapshotInstalledShareArtifacts(
                  installed,
                  material.manifest.artifacts,
                );
          const review = yield* buildShareReview({
            lineage,
            origin,
            manifest: material.manifest,
            files: material.files,
            previousFiles,
            conflictPaths: [],
            flectVersion: packageMetadata.version,
            platform: currentCapsulePlatform(),
            signature,
          }).pipe(
            Effect.mapError(() =>
              commandRejected("The shared source could not be reviewed."),
            ),
          );
          yield* Ref.set(shareCandidate, { material, origin, lineage });
          yield* transition(
            envelope.source,
            "state-changed",
            (current) =>
              FlectWorkspaceSnapshot.make({ ...current, shareReview: review }),
            { operationId, commandId: envelope.commandId },
          );
          return {
            status: "review-ready",
            shareId: review.shareId,
            lineage: review.lineage,
          };
        }
        case "reject-share-candidate": {
          const candidate = yield* Ref.get(shareCandidate);
          if (candidate === undefined) {
            return yield* Effect.fail(
              commandRejected("There is no shared candidate to reject."),
            );
          }
          let shares =
            shareInstallationStore === undefined
              ? undefined
              : yield* shareInstallationStore.snapshot;
          if (
            shareRepository !== undefined &&
            shareInstallationStore !== undefined &&
            (yield* shareInstallationStore.get(candidate.material.manifest.id))
              ?.pending !== undefined
          ) {
            const installation = yield* shareInstallationStore.get(
              candidate.material.manifest.id,
            );
            if (
              installation !== undefined &&
              installation.pending !== undefined
            ) {
              if (installation.refs.candidate !== undefined) {
                yield* shareRepository
                  .rejectCandidate({
                    shareId: installation.shareId,
                    candidate: installation.refs.candidate,
                    refs: {
                      base: installation.refs.base,
                      upstream: installation.refs.upstream,
                      fork: installation.refs.fork,
                    },
                  })
                  .pipe(
                    Effect.mapError(() =>
                      commandRejected(
                        "The shared candidate could not be rejected.",
                      ),
                    ),
                  );
              }
              const { pending, ...retained } = installation;
              yield* shareInstallationStore
                .save(
                  ShareInstallationRecord.make({
                    ...retained,
                    refs: ShareInstallationRefs.make({
                      base: installation.refs.base,
                      upstream: installation.refs.upstream,
                      fork: installation.refs.fork,
                    }),
                    updatedAt: Date.now(),
                  }),
                )
                .pipe(
                  Effect.mapError(() =>
                    commandRejected(
                      "The shared candidate state could not be saved.",
                    ),
                  ),
                );
              yield* removeUnreferencedShareArchive(pending.archiveSha256);
              shares = yield* shareInstallationStore.snapshot;
            }
          }
          yield* Ref.set(shareCandidate, undefined);
          yield* Ref.set(shareActivation, undefined);
          yield* transition(
            envelope.source,
            "state-changed",
            (current) => {
              const { shareReview: _shareReview, ...rest } = current;
              return FlectWorkspaceSnapshot.make({
                ...rest,
                ...(shares === undefined ? {} : { shares }),
              });
            },
            { operationId, commandId: envelope.commandId },
          );
          return {
            status: "rejected",
            shareId: candidate.material.manifest.id,
          };
        }
        case "retain-share-candidate": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined ||
            shareSignatureVerifier === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared retention is unavailable."),
            );
          }
          const candidate = yield* Ref.get(shareCandidate);
          const review = (yield* SubscriptionRef.get(state)).shareReview;
          if (
            candidate === undefined ||
            review === undefined ||
            review.shareId !== candidate.material.manifest.id ||
            candidate.lineage !== "new"
          ) {
            return yield* Effect.fail(
              commandRejected(
                "Open a new shared candidate before retaining it.",
              ),
            );
          }
          const declaredIds = candidate.material.manifest.artifacts.map(
            (artifact) => artifact.id,
          );
          if (
            new Set(command.artifactIds).size !== command.artifactIds.length ||
            command.artifactIds.some((id) => !declaredIds.includes(id))
          ) {
            return yield* Effect.fail(
              commandRejected("The selected shared artifacts are invalid."),
            );
          }
          if (
            (yield* shareInstallationStore.get(
              candidate.material.manifest.id,
            )) !== undefined
          ) {
            return yield* Effect.fail(
              commandRejected("That shared source is already retained."),
            );
          }
          const signature = yield* shareSignatureVerifier.verify(
            candidate.material.manifest,
            candidate.material.archiveSha256,
          );
          if (signature.status === "invalid") {
            return yield* Effect.fail(
              commandRejected("The shared signature is invalid."),
            );
          }
          const candidateArchiveSha256 = yield* persistShareCandidate(
            candidate.material,
          );
          const retained = yield* shareRepository
            .retain({
              shareId: candidate.material.manifest.id,
              archive: candidate.material.repository,
              commit: candidate.material.manifest.repository.commit,
            })
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared history could not be retained."),
              ),
            );
          const refs = ShareInstallationRefs.make({ ...retained.refs });
          const timestamp = Date.now();
          const manifestSha256 = yield* hashShareBytes(
            new TextEncoder().encode(
              JSON.stringify(candidate.material.manifest),
            ),
          );
          const repositorySha256 =
            candidate.material.manifest.repository._tag === "embedded"
              ? candidate.material.manifest.repository.sha256
              : yield* hashShareBytes(candidate.material.repository);
          const record = ShareInstallationRecord.make({
            formatVersion: 1,
            shareId: candidate.material.manifest.id,
            version: candidate.material.manifest.version,
            source: shareOriginWithArchive(
              candidate.origin,
              candidateArchiveSha256,
            ),
            manifest: candidate.material.manifest,
            manifestSha256,
            repositorySha256,
            artifacts: candidate.material.manifest.artifacts.map((artifact) =>
              ShareInstalledArtifact.make({
                id: artifact.id,
                kind: artifact.kind,
                version: artifact.version,
                contentSha256: artifact.contentSha256,
                ...(artifact.capsule === undefined
                  ? {}
                  : { capsuleSha256: artifact.capsule.sha256 }),
              }),
            ),
            installedArtifactIds: [...command.artifactIds],
            refs,
            pending: SharePendingCandidate.make({
              archiveSha256: candidateArchiveSha256,
              lineage: "new",
              origin: shareOriginWithArchive(
                candidate.origin,
                candidateArchiveSha256,
              ),
              conflictPaths: [],
              retainedAt: timestamp,
            }),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          yield* shareInstallationStore
            .save(record)
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared installation could not be saved."),
              ),
            );
          const shares = yield* shareInstallationStore.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) => FlectWorkspaceSnapshot.make({ ...current, shares }),
            { operationId, commandId: envelope.commandId },
          );
          return {
            status: "retained",
            shareId: record.shareId,
            refs: {
              base: refs.base,
              upstream: refs.upstream,
              fork: refs.fork,
            },
          };
        }
        case "fork-share": {
          if (shareInstallationStore === undefined) {
            return yield* Effect.fail(
              commandRejected("Shared installation state is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          if (installation === undefined) {
            return yield* Effect.fail(
              commandRejected("That shared installation is unavailable."),
            );
          }
          return {
            status: "forked",
            shareId: installation.shareId,
            forkCommit: installation.refs.fork,
          };
        }
        case "checkpoint-share-fork": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared fork editing is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          if (installation === undefined) {
            return yield* Effect.fail(
              commandRejected("That retained shared fork is unavailable."),
            );
          }
          if (installation.pending !== undefined) {
            return yield* Effect.fail(
              commandRejected(
                "Finish or reject the current shared review before editing its fork.",
              ),
            );
          }
          if (installation.refs.fork !== command.expectedForkCommit) {
            return yield* Effect.fail(
              commandRejected(
                "The shared fork changed. Inspect it again before editing.",
              ),
            );
          }
          const paths = [
            ...command.files.map((file) => file.path),
            ...command.removals,
          ];
          const totalBytes = command.files.reduce(
            (total, file) => total + file.contents.byteLength,
            0,
          );
          if (
            paths.length === 0 ||
            new Set(paths).size !== paths.length ||
            totalBytes > 32 * 1024 * 1024
          ) {
            return yield* Effect.fail(
              commandRejected("The shared fork changes are invalid."),
            );
          }
          const checkpoint = yield* shareRepository
            .checkpointFork({
              shareId: installation.shareId,
              expectedForkCommit: command.expectedForkCommit,
              refs: installation.refs,
              files: command.files,
              removals: command.removals,
              message: command.message,
            })
            .pipe(
              Effect.mapError((error) =>
                commandRejected(
                  error.reason === "stale-ref"
                    ? "The shared fork changed. Inspect it again before editing."
                    : "The shared fork could not be edited safely.",
                ),
              ),
            );
          const updated = ShareInstallationRecord.make({
            ...installation,
            refs: ShareInstallationRefs.make({
              ...installation.refs,
              fork: checkpoint.fork,
            }),
            updatedAt: Date.now(),
          });
          const saved = yield* shareInstallationStore.save(updated).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          );
          if (!saved) {
            yield* shareRepository
              .restoreFork({
                shareId: installation.shareId,
                expectedForkCommit: checkpoint.fork,
                targetForkCommit: installation.refs.fork,
                refs: {
                  base: installation.refs.base,
                  upstream: installation.refs.upstream,
                },
              })
              .pipe(
                Effect.mapError(() =>
                  commandRejected(
                    "The shared fork requires recovery before it can be edited again.",
                  ),
                ),
              );
            return yield* Effect.fail(
              commandRejected(
                "The shared fork edit was rolled back because its installation record could not be saved.",
              ),
            );
          }
          const shares = yield* shareInstallationStore.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) => FlectWorkspaceSnapshot.make({ ...current, shares }),
            { operationId, commandId: envelope.commandId },
          );
          return {
            status: "checkpointed",
            shareId: installation.shareId,
            forkCommit: checkpoint.fork,
          };
        }
        case "prepare-share-update": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined ||
            shareSignatureVerifier === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared update preparation is unavailable."),
            );
          }
          const candidate = yield* Ref.get(shareCandidate);
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          if (
            candidate === undefined ||
            candidate.material.manifest.id !== command.shareId ||
            candidate.lineage !== "update" ||
            installation === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Open an update for that retained share first."),
            );
          }
          const signature = yield* shareSignatureVerifier.verify(
            candidate.material.manifest,
            candidate.material.archiveSha256,
          );
          const candidateArchiveSha256 = yield* persistShareCandidate(
            candidate.material,
          );
          const previousFiles = yield* snapshotInstalledShareArtifacts(
            installation,
            candidate.material.manifest.artifacts,
          );
          const update = yield* shareRepository
            .prepareUpdate({
              shareId: installation.shareId,
              archive: candidate.material.repository,
              commit: candidate.material.manifest.repository.commit,
              refs: {
                base: installation.refs.base,
                upstream: installation.refs.upstream,
                fork: installation.refs.fork,
              },
            })
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared update could not be prepared."),
              ),
            );
          const lineage: ShareLineage =
            update._tag === "replacement"
              ? "replacement"
              : update._tag === "conflict"
                ? "conflict"
                : installation.refs.fork === installation.refs.base
                  ? "update"
                  : "fork";
          const review = yield* buildShareReview({
            lineage,
            origin: candidate.origin,
            manifest: candidate.material.manifest,
            files: candidate.material.files,
            previousFiles,
            conflictPaths:
              update._tag === "conflict" ? update.conflictPaths : [],
            flectVersion: packageMetadata.version,
            platform: currentCapsulePlatform(),
            signature,
          }).pipe(
            Effect.mapError(() =>
              commandRejected("The shared update could not be reviewed."),
            ),
          );
          const refs = ShareInstallationRefs.make({
            base: installation.refs.base,
            upstream: update.upstream,
            fork: installation.refs.fork,
            ...(update._tag === "conflict"
              ? {}
              : { candidate: update.candidate }),
          });
          const timestamp = Date.now();
          const pending = ShareInstallationRecord.make({
            ...installation,
            refs,
            pending: SharePendingCandidate.make({
              archiveSha256: candidateArchiveSha256,
              lineage,
              origin: candidate.origin,
              conflictPaths:
                update._tag === "conflict" ? update.conflictPaths : [],
              retainedAt: timestamp,
            }),
            updatedAt: timestamp,
          });
          yield* shareInstallationStore
            .save(pending)
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared update state could not be saved."),
              ),
            );
          yield* Ref.set(shareCandidate, {
            ...candidate,
            lineage,
            update,
          });
          const shares = yield* shareInstallationStore.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) =>
              FlectWorkspaceSnapshot.make({
                ...current,
                shares,
                shareReview: review,
              }),
            { operationId, commandId: envelope.commandId },
          );
          return {
            status: update._tag,
            shareId: installation.shareId,
            ...(update._tag === "conflict"
              ? {}
              : { candidateCommit: update.candidate }),
          };
        }
        case "continue-share-fork": {
          if (
            shareInstallationStore === undefined ||
            shareRepository === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared conflict resolution is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          const candidate = yield* Ref.get(shareCandidate);
          if (
            installation?.pending?.lineage !== "conflict" ||
            candidate === undefined ||
            candidate.material.manifest.id !== command.shareId
          ) {
            return yield* Effect.fail(
              commandRejected("Open that retained shared conflict first."),
            );
          }
          const forkFiles = yield* snapshotInstalledShareArtifacts(
            installation,
            candidate.material.manifest.artifacts,
          );
          const byPath = new Map(
            forkFiles.map((file) => [file.path, file.contents]),
          );
          const files = installation.pending.conflictPaths.flatMap((path) => {
            const contents = byPath.get(path);
            return contents === undefined ? [] : [{ path, contents }];
          });
          const removals = installation.pending.conflictPaths.filter(
            (path) => !byPath.has(path),
          );
          return yield* completeShareConflict(
            envelope,
            operationId,
            installation,
            candidate,
            files,
            removals,
            `Continue shared fork: ${installation.shareId}`,
          );
        }
        case "open-share-conflict-in-shape": {
          if (
            shareInstallationStore === undefined ||
            shareRepository === undefined ||
            sandboxedShell === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shape conflict resolution is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          const candidate = yield* Ref.get(shareCandidate);
          if (
            installation?.pending?.lineage !== "conflict" ||
            installation.refs.candidate !== undefined ||
            candidate === undefined ||
            candidate.material.manifest.id !== command.shareId ||
            candidate.update?._tag !== "conflict"
          ) {
            return yield* Effect.fail(
              commandRejected("Open that retained shared conflict first."),
            );
          }
          const conflictPaths = installation.pending.conflictPaths.toSorted();
          const conflictSet = new Set(conflictPaths);
          const snapshots = yield* Effect.forEach(
            ["base", "fork", "upstream"] as const,
            (role) =>
              snapshotShareArtifacts(
                installation,
                candidate.material.manifest.artifacts,
                role,
                installation.refs[role],
              ).pipe(
                Effect.map((files) =>
                  files
                    .filter((file) => conflictSet.has(file.path))
                    .map((file) => ({
                      path: `${role}/${file.path}`,
                      contents: file.contents,
                    })),
                ),
              ),
            { concurrency: 1 },
          );
          const root = `/workspace/.flect/share-conflicts/${installation.shareId}`;
          const manifest = [
            `share=${installation.shareId}`,
            `base=${installation.refs.base}`,
            `upstream=${installation.refs.upstream}`,
            `fork=${installation.refs.fork}`,
            ...conflictPaths.map((path) => `conflict=${path}`),
            "",
          ].join("\n");
          yield* sandboxedShell
            .replaceTree("shaper", root, [
              {
                path: "conflicts.txt",
                contents: new TextEncoder().encode(manifest),
              },
              ...snapshots.flat(),
            ])
            .pipe(
              Effect.mapError(() =>
                commandRejected(
                  "The Shaper conflict workspace could not be prepared safely.",
                ),
              ),
            );
          const instruction = [
            "Resolve the shared Git conflict the user explicitly opened.",
            `Inspect ${root}/conflicts.txt and the base, fork, and upstream files below that directory. A missing version means that side deleted the file.`,
            `Write every final conflict path below ${root}/resolved, then run flect share resolve with the exact base, upstream, and fork commits from conflicts.txt, one --write <share-path> <workspace-path> or --remove <share-path> per conflict, and a short --message.`,
            "Do not Keep the result. Flect will present the inactive resolved candidate to the user.",
          ].join("\n");
          yield* runShareConflictShaper(envelope, operationId, instruction);
          return {
            status: "shape-opened",
            shareId: installation.shareId,
            conflictPaths,
          };
        }
        case "resolve-share-conflict": {
          if (shareInstallationStore === undefined) {
            return yield* Effect.fail(
              commandRejected("Shared conflict resolution is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          const candidate = yield* Ref.get(shareCandidate);
          if (
            installation === undefined ||
            candidate === undefined ||
            candidate.material.manifest.id !== command.shareId ||
            installation.refs.base !== command.expectedBaseCommit ||
            installation.refs.upstream !== command.expectedUpstreamCommit ||
            installation.refs.fork !== command.expectedForkCommit
          ) {
            return yield* Effect.fail(
              commandRejected(
                "The shared conflict references changed. Open it in Shape again.",
              ),
            );
          }
          return yield* completeShareConflict(
            envelope,
            operationId,
            installation,
            candidate,
            command.files,
            command.removals,
            command.message,
          );
        }
        case "activate-share-candidate": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined ||
            shareSignatureVerifier === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared source activation is unavailable."),
            );
          }
          const candidate = yield* Ref.get(shareCandidate);
          const current = yield* SubscriptionRef.get(state);
          const review = current.shareReview;
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          if (
            candidate === undefined ||
            review === undefined ||
            review.shareId !== command.shareId ||
            candidate.material.manifest.id !== command.shareId ||
            installation === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Open and retain that shared candidate first."),
            );
          }
          if (!review.compatible || review.lineage === "conflict") {
            return yield* Effect.fail(
              commandRejected(
                "Resolve the shared review blockers before activation.",
              ),
            );
          }
          const signature = yield* shareSignatureVerifier.verify(
            candidate.material.manifest,
            candidate.material.archiveSha256,
          );
          if (signature.status === "invalid") {
            return yield* Effect.fail(
              commandRejected(
                "Resolve the shared review blockers before activation.",
              ),
            );
          }
          if (
            new Set(command.artifactIds).size !== command.artifactIds.length
          ) {
            return yield* Effect.fail(
              commandRejected("The selected shared artifacts are invalid."),
            );
          }
          const descriptors = command.artifactIds.map((id) =>
            candidate.material.manifest.artifacts.find(
              (artifact) => artifact.id === id,
            ),
          );
          if (descriptors.some((descriptor) => descriptor === undefined)) {
            return yield* Effect.fail(
              commandRejected(
                "This shared artifact requires its dedicated activation path.",
              ),
            );
          }
          const kinds = new Set(
            descriptors.flatMap((descriptor) =>
              descriptor === undefined ? [] : [descriptor.kind],
            ),
          );
          if (
            kinds.size === 1 &&
            (kinds.has("experience") || kinds.has("extension"))
          ) {
            const kind = kinds.has("extension") ? "extension" : "experience";
            const descriptor = descriptors[0];
            if (
              descriptors.length !== 1 ||
              descriptor === undefined ||
              descriptor.capsule === undefined
            ) {
              return yield* Effect.fail(
                commandRejected(`The shared ${kind} selection is invalid.`),
              );
            }
            const capsule = candidate.material.artifacts.find(
              (artifact) => artifact.path === descriptor.capsule?.path,
            );
            if (
              capsule === undefined ||
              (yield* hashCapsuleArchive(capsule.contents).pipe(
                Effect.mapError(() =>
                  commandRejected(`The shared ${kind} capsule is invalid.`),
                ),
              )) !== descriptor.capsule.sha256
            ) {
              return yield* Effect.fail(
                commandRejected(`The shared ${kind} capsule is invalid.`),
              );
            }
            yield* runCommand(
              FlectCommandEnvelope.make({
                ...envelope,
                command: ImportCapsule.make({
                  type: "import-capsule",
                  archive: capsule.contents,
                }),
              }),
              operationId,
            );
            yield* Ref.set(shareActivation, {
              shareId: installation.shareId,
              artifactIds: [...command.artifactIds],
            });
            return {
              status: "activated",
              shareId: installation.shareId,
              artifactIds: [...command.artifactIds],
            };
          }
          if (kinds.has("experience") || kinds.has("extension")) {
            return yield* Effect.fail(
              commandRejected(
                "Activate shared experiences and extensions separately.",
              ),
            );
          }
          if (git === undefined) {
            return yield* Effect.fail(
              commandRejected("Shared source activation is unavailable."),
            );
          }
          const shaping = yield* kernel.snapshot;
          if (shaping.safeMode || shaping.proposal !== undefined) {
            return yield* Effect.fail(
              commandRejected(
                shaping.safeMode
                  ? "Restore the interface before activating shared source."
                  : "Keep or reject the current candidate before activating shared source.",
              ),
            );
          }
          const proposal = yield* kernel.propose(
            shaping.active.document,
            "user",
          );
          let preview = yield* kernel.preview(proposal.id);
          const role =
            installation.refs.candidate === undefined ? "fork" : "candidate";
          const expectedCommit =
            role === "candidate"
              ? installation.refs.candidate
              : installation.refs.fork;
          if (expectedCommit === undefined) {
            yield* kernel.reject(preview.id).pipe(Effect.ignore);
            return yield* Effect.fail(
              commandRejected("The exact shared source is unavailable."),
            );
          }
          const files = (yield* Effect.forEach(descriptors, (descriptor) => {
            if (descriptor === undefined) return Effect.succeed([]);
            return shareRepository
              .snapshotArtifact({
                shareId: installation.shareId,
                role,
                expectedCommit,
                sourceRoot: descriptor.sourceRoot,
              })
              .pipe(
                Effect.map((entries) =>
                  entries.map((file) => ({
                    path: `shared/${installation.shareId}/${descriptor.id}/${file.path.slice(descriptor.sourceRoot.length + 1)}`,
                    contents: file.contents,
                  })),
                ),
                Effect.mapError(() =>
                  commandRejected("The exact shared source is unavailable."),
                ),
              );
          })).flat();
          const stage = Effect.gen(function* () {
            yield* git.open({ workspaceId: "default" });
            const repository = yield* git.status({
              proposalBranch: `flect/proposal/${preview.id}`,
            });
            if (
              repository.acceptedCommit === undefined ||
              repository.lastKnownGoodCommit === undefined ||
              repository.proposalBranch === undefined ||
              repository.proposalCommit === undefined
            ) {
              return yield* Effect.fail(
                commandRejected("The guarded proposal roots are unavailable."),
              );
            }
            yield* git.checkpoint({
              branch: "flect/authoring",
              ...(repository.authoringCommit === undefined
                ? { baseCommit: repository.acceptedCommit }
                : { expectedCommit: repository.authoringCommit }),
              files,
              guards: [
                {
                  branch: "flect/accepted",
                  commit: repository.acceptedCommit,
                },
                {
                  branch: "flect/last-known-good",
                  commit: repository.lastKnownGoodCommit,
                },
                {
                  branch: repository.proposalBranch,
                  commit: repository.proposalCommit,
                },
              ],
              message: `Stage shared source: ${installation.shareId}`,
            });
            preview = yield* kernel.supersede(
              preview.id,
              shaping.active.document,
              "user",
            );
          }).pipe(
            Effect.tapError(() =>
              kernel.reject(preview.id).pipe(Effect.ignore),
            ),
            Effect.mapError(() =>
              commandRejected("The shared source could not be staged safely."),
            ),
          );
          yield* stage;
          const next = yield* kernel.snapshot;
          yield* transitionShaping(
            envelope,
            operationId,
            "revision-previewed",
            next,
            preview.id,
          );
          yield* Ref.set(shareActivation, {
            shareId: installation.shareId,
            artifactIds: [...command.artifactIds],
          });
          return {
            status: "activated",
            shareId: installation.shareId,
            artifactIds: [...command.artifactIds],
          };
        }
        case "export-share": {
          const candidate = yield* Ref.get(shareCandidate);
          const archive = yield* Effect.gen(function* () {
            const installation =
              shareInstallationStore === undefined
                ? undefined
                : yield* shareInstallationStore.get(command.shareId);
            if (
              candidate?.material.manifest.id === command.shareId &&
              installation?.refs.candidate !== undefined &&
              shareRepository !== undefined
            ) {
              const repository = yield* shareRepository
                .exportCandidate({
                  shareId: installation.shareId,
                  candidateCommit: installation.refs.candidate,
                  refs: {
                    base: installation.refs.base,
                    upstream: installation.refs.upstream,
                    fork: installation.refs.fork,
                  },
                })
                .pipe(
                  Effect.mapError(() =>
                    commandRejected(
                      "The reviewed shared candidate could not be exported.",
                    ),
                  ),
                );
              return yield* encodeShareArchive({
                manifest: {
                  ...candidate.material.manifest,
                  repository: ShareGitRepository.make({
                    _tag: "git",
                    commit: installation.refs.candidate,
                  }),
                  provenance: {
                    ...candidate.material.manifest.provenance,
                    revision: installation.refs.candidate,
                  },
                  signatures: [],
                },
                repository,
                artifacts: candidate.material.artifacts,
              });
            }
            if (
              candidate?.material.manifest.id === command.shareId &&
              (installation === undefined ||
                (installation.pending === undefined &&
                  candidate.lineage === "update"))
            ) {
              return yield* encodeShareArchive({
                manifest: {
                  ...candidate.material.manifest,
                  repository: ShareGitRepository.make({
                    _tag: "git",
                    commit: candidate.material.manifest.repository.commit,
                  }),
                  signatures: [],
                },
                repository: candidate.material.repository,
                artifacts: candidate.material.artifacts,
              });
            }
            if (
              shareRepository === undefined ||
              shareInstallationStore === undefined ||
              shareCandidateStore === undefined
            ) {
              return yield* Effect.fail(
                commandRejected("That retained shared source is unavailable."),
              );
            }
            if (installation?.manifest === undefined) {
              return yield* Effect.fail(
                commandRejected("That retained shared source is unavailable."),
              );
            }
            const stored = yield* shareCandidateStore
              .load(installation.source.archiveSha256)
              .pipe(
                Effect.mapError(() =>
                  commandRejected(
                    "That retained shared source is unavailable.",
                  ),
                ),
              );
            if (stored === undefined) {
              return yield* Effect.fail(
                commandRejected("That retained shared source is unavailable."),
              );
            }
            const original = yield* decodeShareArchive(stored).pipe(
              Effect.mapError(() =>
                commandRejected("That retained shared source is unavailable."),
              ),
            );
            const repository = yield* shareRepository
              .exportFork({
                shareId: installation.shareId,
                forkCommit: installation.refs.fork,
              })
              .pipe(
                Effect.mapError(() =>
                  commandRejected("The retained fork could not be exported."),
                ),
              );
            return yield* encodeShareArchive({
              manifest: {
                ...installation.manifest,
                repository: ShareGitRepository.make({
                  _tag: "git",
                  commit: installation.refs.fork,
                }),
                provenance: {
                  ...installation.manifest.provenance,
                  revision: installation.refs.fork,
                },
                signatures: [],
              },
              repository,
              artifacts: original.artifacts,
            });
          }).pipe(
            Effect.mapError(() =>
              commandRejected("The shared archive could not be exported."),
            ),
          );
          const archiveSha256 = yield* hashShareBytes(archive);
          yield* Ref.set(preparedShareExport, {
            shareId: command.shareId,
            archive: archive.slice(),
          });
          return {
            status: "exported",
            shareId: command.shareId,
            archiveSha256,
            bytes: archive.byteLength,
          };
        }
        case "remove-share": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared removal is unavailable."),
            );
          }
          const installation = yield* shareInstallationStore.get(
            command.shareId,
          );
          if (installation === undefined) {
            return yield* Effect.fail(
              commandRejected("That shared installation is unavailable."),
            );
          }
          yield* shareRepository
            .removeInstallation({
              shareId: installation.shareId,
              refs: installation.refs,
            })
            .pipe(
              Effect.mapError(() =>
                commandRejected(
                  "The shared installation could not be removed.",
                ),
              ),
            );
          const { candidate: _candidate, ...retainedRefs } = installation.refs;
          const { pending: _pending, ...inactiveInstallation } = installation;
          const retained = ShareInstallationRecord.make({
            ...inactiveInstallation,
            source:
              installation.pending === undefined
                ? installation.source
                : shareOriginWithArchive(
                    installation.source,
                    installation.pending.archiveSha256,
                  ),
            installedArtifactIds: [],
            refs: ShareInstallationRefs.make(retainedRefs),
            updatedAt: Date.now(),
          });
          yield* shareInstallationStore
            .save(retained)
            .pipe(
              Effect.mapError(() =>
                commandRejected(
                  "The shared installation could not be removed.",
                ),
              ),
            );
          const candidate = yield* Ref.get(shareCandidate);
          if (candidate?.material.manifest.id === installation.shareId) {
            yield* Ref.set(shareCandidate, undefined);
          }
          const shares = yield* shareInstallationStore.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) => {
              if (current.shareReview?.shareId !== installation.shareId) {
                return FlectWorkspaceSnapshot.make({ ...current, shares });
              }
              const { shareReview: _shareReview, ...rest } = current;
              return FlectWorkspaceSnapshot.make({ ...rest, shares });
            },
            { operationId, commandId: envelope.commandId },
          );
          return { status: "removed", shareId: installation.shareId };
        }
        case "delete-share-local-data": {
          if (
            shareRepository === undefined ||
            shareInstallationStore === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Shared deletion is unavailable."),
            );
          }
          const retained = yield* shareInstallationStore.get(command.shareId);
          if (
            retained === undefined ||
            retained.installedArtifactIds.length > 0 ||
            retained.refs.fork !== command.expectedForkCommit
          ) {
            return yield* Effect.fail(
              commandRejected(
                "Remove the shared installation and use its current fork before deleting local data.",
              ),
            );
          }
          yield* shareRepository
            .deleteLocalData({
              shareId: command.shareId,
              forkCommit: command.expectedForkCommit,
              installed: false,
            })
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared local data could not be deleted."),
              ),
            );
          yield* shareInstallationStore
            .remove(retained.shareId)
            .pipe(
              Effect.mapError(() =>
                commandRejected("The shared local data could not be deleted."),
              ),
            );
          yield* removeUnreferencedShareArchive(retained.source.archiveSha256);
          const shares = yield* shareInstallationStore.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) => FlectWorkspaceSnapshot.make({ ...current, shares }),
            { operationId, commandId: envelope.commandId },
          );
          return { status: "deleted", shareId: command.shareId };
        }
        case "set-mode": {
          const current = yield* SubscriptionRef.get(state);
          const workbench = yield* selectWorkbenchTarget(
            current.workbench ?? initialWorkbenchState(current.shaping),
            command.mode === "run" ? "use" : "shape",
            current.shaping,
            (current.workbench ?? initialWorkbenchState(current.shaping))
              .transitionSequence,
          ).pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* transition(
            envelope.source,
            "state-changed",
            (snapshot) =>
              FlectWorkspaceSnapshot.make({
                ...snapshot,
                mode: modeFromWorkbench(workbench, snapshot.shaping),
                workbench,
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "select-workbench-target": {
          const current = yield* SubscriptionRef.get(state);
          const previous =
            current.workbench ?? initialWorkbenchState(current.shaping);
          const workbench = yield* selectWorkbenchTarget(
            previous,
            command.target,
            current.shaping,
            previous.transitionSequence,
          ).pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* transition(
            envelope.source,
            "state-changed",
            (snapshot) =>
              FlectWorkspaceSnapshot.make({
                ...snapshot,
                mode: modeFromWorkbench(workbench, snapshot.shaping),
                workbench,
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "set-rail-collapsed": {
          const current = yield* Ref.get(preferenceState);
          const next = ShellPreferencesValue.make({
            ...current,
            railCollapsed: command.collapsed,
          });
          yield* preferences.save(next);
          yield* Ref.set(preferenceState, next);
          yield* transition(
            envelope.source,
            "state-changed",
            (snapshot) =>
              FlectWorkspaceSnapshot.make({
                ...snapshot,
                rail: RailStateSnapshot.make({
                  ...snapshot.rail,
                  collapsed: command.collapsed,
                }),
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "set-rail-width": {
          const current = yield* Ref.get(preferenceState);
          const next = ShellPreferencesValue.make({
            ...current,
            railWidth: command.width,
          });
          yield* preferences.save(next);
          yield* Ref.set(preferenceState, next);
          yield* transition(
            envelope.source,
            "state-changed",
            (snapshot) =>
              FlectWorkspaceSnapshot.make({
                ...snapshot,
                rail: RailStateSnapshot.make({
                  ...snapshot.rail,
                  width: command.width,
                }),
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "refresh-runtime": {
          yield* agent.refresh;
          const next = yield* agent.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) =>
              FlectWorkspaceSnapshot.make({ ...current, agent: next }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "select-model": {
          yield* agent.selectModel(command.model);
          const next = yield* agent.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) =>
              FlectWorkspaceSnapshot.make({ ...current, agent: next }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "set-model-favorite": {
          yield* agent.setModelFavorite(command.model, command.favorite);
          const current = yield* Ref.get(preferenceState);
          const key = `${command.model.provider}/${command.model.id}`;
          const nextPreferences = ShellPreferencesValue.make({
            ...current,
            modelFavorites: command.favorite
              ? current.modelFavorites.includes(key)
                ? current.modelFavorites
                : [...current.modelFavorites, key].slice(-24)
              : current.modelFavorites.filter((candidate) => candidate !== key),
          });
          yield* preferences.save(nextPreferences);
          yield* Ref.set(preferenceState, nextPreferences);
          const next = yield* agent.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (snapshot) =>
              FlectWorkspaceSnapshot.make({ ...snapshot, agent: next }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        }
        case "set-external-extensions": {
          yield* agent.setExternalExtensions(command.role, command.enabled);
          const next = yield* agent.snapshot;
          yield* transition(
            envelope.source,
            "state-changed",
            (current) =>
              FlectWorkspaceSnapshot.make({ ...current, agent: next }),
            {
              operationId,
              commandId: envelope.commandId,
              role: command.role,
            },
          );
          return;
        }
        case "set-portable-extension-enabled": {
          if (extensionCatalog === undefined) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          yield* (
            command.enabled
              ? extensionCatalog.enable(portableKey(command), command.grants)
              : extensionCatalog.disable(portableKey(command))
          ).pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* syncExtensionSnapshot();
          return {
            extensionId: command.extensionId,
            role: command.role,
            binding: command.binding,
            state: command.enabled ? "enabled" : "disabled",
          };
        }
        case "test-portable-extension": {
          if (
            extensionCatalog === undefined ||
            portableExtensionHost === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          const entry = (yield* extensionCatalog.snapshot).entries.find(
            (candidate) =>
              candidate.capsuleId === command.capsuleId &&
              candidate.extensionId === command.extensionId &&
              candidate.role === command.role &&
              candidate.binding === command.binding,
          );
          if (entry === undefined) {
            return yield* Effect.fail(
              commandRejected("The portable extension is unavailable."),
            );
          }
          const result = yield* portableExtensionHost
            .call(
              {
                role: command.role,
                binding: command.binding,
                operationId,
              },
              command.extensionId,
              command.input,
            )
            .pipe(Effect.ensuring(syncExtensionSnapshot()))
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          return {
            extensionId: command.extensionId,
            status: "tested",
            intentCount: result.intents.length,
          };
        }
        case "set-portable-extension-pin": {
          if (extensionCatalog === undefined) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          yield* extensionCatalog
            .pin(portableKey(command), command.pinned)
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* syncExtensionSnapshot();
          return {
            extensionId: command.extensionId,
            pinned: command.pinned,
          };
        }
        case "fork-portable-extension": {
          if (extensionCatalog === undefined) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          yield* extensionCatalog
            .fork(portableKey(command), command.revision)
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* syncExtensionSnapshot();
          return {
            extensionId: command.extensionId,
            forkRevision: command.revision,
          };
        }
        case "resolve-portable-extension-update": {
          if (extensionCatalog === undefined) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          yield* extensionCatalog
            .resolveUpdate(portableKey(command), command.choice)
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* syncExtensionSnapshot();
          return {
            extensionId: command.extensionId,
            resolution: command.choice,
          };
        }
        case "remove-portable-extension": {
          if (extensionCatalog === undefined) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          yield* extensionCatalog
            .remove(portableKey(command))
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* syncExtensionSnapshot();
          return {
            extensionId: command.extensionId,
            state: "removed",
          };
        }
        case "invoke-portable-extension": {
          if (
            extensionCatalog === undefined ||
            portableExtensionHost === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Portable extension support is unavailable."),
            );
          }
          const entry = (yield* extensionCatalog.snapshot).entries.find(
            (candidate) =>
              candidate.capsuleId === command.capsuleId &&
              candidate.extensionId === command.extensionId &&
              candidate.role === command.role &&
              candidate.binding === command.binding,
          );
          if (entry === undefined) {
            return yield* Effect.fail(
              commandRejected("The portable extension is unavailable."),
            );
          }
          const result = yield* portableExtensionHost
            .call(
              {
                role: command.role,
                binding: command.binding,
                operationId,
              },
              command.extensionId,
              command.input,
            )
            .pipe(Effect.ensuring(syncExtensionSnapshot()))
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          return {
            extensionId: command.extensionId,
            intents: result.intents,
          };
        }
        case "submit-app-prompt": {
          const current = yield* SubscriptionRef.get(state);
          const workbench =
            current.workbench ?? initialWorkbenchState(current.shaping);
          if (current.shaping.safeMode || workbench.target !== "use") {
            return yield* Effect.fail(
              commandRejected(
                current.shaping.safeMode
                  ? "Leave safe mode before using the App Agent."
                  : "Select Use before sending an App Agent message.",
              ),
            );
          }
          const outcome = yield* withNestedAgentCommands(
            operationId,
            current.shaping.proposal === undefined
              ? agent.submitAppPrompt(
                  operationContext(envelope, operationId),
                  command.text,
                )
              : agent.submitPreviewPrompt(
                  operationContext(envelope, operationId),
                  command.text,
                  current.shaping.proposal.document,
                  current.shaping.proposal.id,
                ),
          );
          yield* transition(
            envelope.source,
            "turn-completed",
            (current) => current,
            {
              operationId,
              commandId: envelope.commandId,
              role: "app",
            },
          );
          if (outcome.editRequest !== undefined) {
            const latest = yield* SubscriptionRef.get(state);
            const revisionId =
              latest.shaping.proposal?.id ?? latest.shaping.active.id;
            const handoff = WorkbenchHandoff.make({
              version: 1,
              instruction: outcome.editRequest.instruction,
              revisionId,
            });
            yield* shapeInstruction(
              envelope,
              operationId,
              outcome.editRequest.instruction,
              handoff,
            );
          }
          return;
        }
        case "submit-shaper-instruction": {
          return yield* shapeInstruction(
            envelope,
            operationId,
            command.instruction,
          );
        }
        case "import-capsule": {
          const current = yield* kernel.snapshot;
          if (current.proposal !== undefined) {
            return yield* Effect.fail(
              commandRejected(
                "Keep or discard the current candidate before importing.",
              ),
            );
          }
          const capsule = yield* decodeCapsule(command.archive).pipe(
            Effect.mapError((error) => commandRejected(error.message)),
          );
          let candidateReview = yield* reviewDecodedCapsule(
            capsule,
            command.archive,
          );
          const plainWebSource = capsule.manifest.entrypoints.some(
            (entry) => entry.id === "plain-web",
          );
          const browserSource = capsule.manifest.entrypoints.find(
            (entry) => entry.id === "browser-source",
          );
          const entrypoint = capsule.manifest.entrypoints.find(
            (entry) => entry.id === "flect-interface",
          );
          const file = capsule.files.find(
            (candidate) => candidate.path === entrypoint?.path,
          );
          let document: InterfaceDocument;
          let compiledPresentation: CompiledCapsulePresentation | undefined;
          if (entrypoint !== undefined && file !== undefined) {
            const input = yield* Effect.try({
              try: (): unknown =>
                JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(
                    file.contents,
                  ),
                ),
              catch: () => commandRejected("The capsule interface is invalid."),
            });
            document = yield* validateInterfaceDocument(input).pipe(
              Effect.mapError(() =>
                commandRejected("The capsule interface is invalid."),
              ),
            );
          } else if (browserSource === undefined) {
            const compiledEntry = capsule.manifest.entrypoints.find(
              (candidate) => candidate.path.endsWith(".html"),
            );
            const compiledFile = capsule.files.find(
              (candidate) => candidate.path === compiledEntry?.path,
            );
            if (compiledEntry === undefined || compiledFile === undefined) {
              return yield* Effect.fail(
                commandRejected(
                  "This capsule has no supported interface entrypoint.",
                ),
              );
            }
            const html = yield* Effect.try({
              try: () =>
                new TextDecoder("utf-8", { fatal: true }).decode(
                  compiledFile.contents,
                ),
              catch: () =>
                commandRejected("The capsule entrypoint is invalid."),
            });
            document = InterfaceDocument.make({
              version: 2,
              name: capsule.manifest.name,
              root: {
                id: "root",
                type: "stack",
                direction: "column",
                gap: "lg",
                children: [
                  {
                    id: "capsule-title",
                    type: "text",
                    text: capsule.manifest.name,
                    style: "headline",
                  },
                  {
                    id: "capsule-agent",
                    type: "agent-panel",
                    title: "App Agent",
                  },
                ],
              },
            });
            compiledPresentation = {
              id: capsule.manifest.id,
              name: capsule.manifest.name,
              html,
              entrypointPath: compiledEntry.path,
              assets: capsule.files
                .filter((candidate) => candidate.path !== compiledEntry.path)
                .map((candidate) => ({
                  path: candidate.path,
                  contents: candidate.contents.slice(),
                })),
              archive: command.archive.slice(),
            };
          } else {
            document = InterfaceDocument.make({
              version: 2,
              name: capsule.manifest.name,
              root: {
                id: "root",
                type: "stack",
                direction: "column",
                gap: "lg",
                children: [
                  {
                    id: "capsule-title",
                    type: "text",
                    text: capsule.manifest.name,
                    style: "headline",
                  },
                  {
                    id: "capsule-agent",
                    type: "agent-panel",
                    title: "App Agent",
                  },
                ],
              },
            });
          }
          const proposal = yield* kernel.propose(document, "user");
          let preview = yield* kernel.preview(proposal.id);
          let sourceProposalBranch: string | undefined;
          if (
            (plainWebSource || browserSource !== undefined) &&
            git !== undefined
          ) {
            const checkpointSource = Effect.gen(function* () {
              yield* git.open({ workspaceId: "default" });
              const repository = yield* git.status({
                proposalBranch: `flect/proposal/${preview.id}`,
              });
              if (
                repository.acceptedCommit === undefined ||
                repository.lastKnownGoodCommit === undefined ||
                repository.proposalBranch === undefined ||
                repository.proposalCommit === undefined
              ) {
                return yield* Effect.fail(
                  GitWorkspaceFailure.make({
                    operation: "status",
                    reason: "invalid-ref",
                    message: "The imported project Git refs are unavailable.",
                  }),
                );
              }
              yield* git.checkpoint({
                branch: "flect/authoring",
                ...(repository.authoringCommit === undefined
                  ? { baseCommit: repository.acceptedCommit }
                  : { expectedCommit: repository.authoringCommit }),
                files: capsule.files.map((source) => ({
                  path: `project/${source.path}`,
                  contents: source.contents,
                })),
                guards: [
                  {
                    branch: "flect/accepted",
                    commit: repository.acceptedCommit,
                  },
                  {
                    branch: "flect/last-known-good",
                    commit: repository.lastKnownGoodCommit,
                  },
                  {
                    branch: repository.proposalBranch,
                    commit: repository.proposalCommit,
                  },
                ],
                message: `Import ${capsule.manifest.name} ${capsule.manifest.version}`,
              });
              return repository.proposalBranch;
            }).pipe(
              Effect.tapError(() =>
                kernel.reject(preview.id).pipe(Effect.ignore),
              ),
              Effect.mapError(() =>
                commandRejected(
                  "The imported project could not be checkpointed safely.",
                ),
              ),
            );
            sourceProposalBranch = yield* checkpointSource;
            preview = yield* kernel.supersede(preview.id, document, "user");
          }
          if (browserSource !== undefined) {
            if (git === undefined || proposalBuild === undefined) {
              yield* kernel.reject(preview.id).pipe(Effect.ignore);
              return yield* Effect.fail(
                commandRejected(
                  "Portable framework builds are unavailable in this host.",
                ),
              );
            }
            const builtArchive = yield* Effect.gen(function* () {
              let repository = yield* git.status({
                proposalBranch:
                  sourceProposalBranch ?? `flect/proposal/${preview.id}`,
              });
              const requestFor = (
                status: typeof repository,
              ): Effect.Effect<ProposalBuildRequest, FlectCommandError> =>
                status.acceptedCommit === undefined ||
                status.lastKnownGoodCommit === undefined ||
                status.proposalBranch === undefined ||
                status.proposalCommit === undefined
                  ? Effect.fail(
                      commandRejected(
                        "The exact imported project proposal is unavailable.",
                      ),
                    )
                  : Effect.succeed(
                      ProposalBuildRequest.make({
                        proposalBranch: status.proposalBranch,
                        proposalCommit: status.proposalCommit,
                        acceptedCommit: status.acceptedCommit,
                        lastKnownGoodCommit: status.lastKnownGoodCommit,
                        entrypoint: browserSource.path,
                      }),
                    );
              let buildRequest = yield* requestFor(repository);
              yield* reportBuild(
                envelope,
                operationId,
                WorkspaceBuildSnapshot.make({
                  version: 1,
                  phase: "resolving-dependencies",
                  message: "Resolving portable dependencies",
                  sourceRevision: buildRequest.proposalCommit,
                }),
              );
              const resolvedLock = yield* proposalBuild
                .resolvePackageLock(buildRequest)
                .pipe(
                  Effect.mapError((error) => commandRejected(error.message)),
                );
              if (resolvedLock?.needsCheckpoint === true) {
                if (repository.authoringCommit === undefined) {
                  return yield* Effect.fail(
                    commandRejected(
                      "The imported project authoring checkpoint is unavailable.",
                    ),
                  );
                }
                yield* reportBuild(
                  envelope,
                  operationId,
                  WorkspaceBuildSnapshot.make({
                    version: 1,
                    phase: "checkpointing-lock",
                    message: "Checkpointing dependency lock",
                    sourceRevision: buildRequest.proposalCommit,
                  }),
                );
                yield* git
                  .checkpoint({
                    branch: "flect/authoring",
                    expectedCommit: repository.authoringCommit,
                    files: [
                      {
                        path: "project/package-lock.json",
                        contents: resolvedLock.contents,
                      },
                    ],
                    guards: [
                      {
                        branch: "flect/accepted",
                        commit: buildRequest.acceptedCommit,
                      },
                      {
                        branch: "flect/last-known-good",
                        commit: buildRequest.lastKnownGoodCommit,
                      },
                      {
                        branch: buildRequest.proposalBranch,
                        commit: buildRequest.proposalCommit,
                      },
                    ],
                    message: "Lock portable browser dependencies",
                  })
                  .pipe(
                    Effect.mapError(() =>
                      commandRejected(
                        "The generated package lock could not be checkpointed safely.",
                      ),
                    ),
                  );
                preview = yield* kernel.supersede(preview.id, document, "user");
                repository = yield* git.status({
                  proposalBranch: buildRequest.proposalBranch,
                });
                buildRequest = yield* requestFor(repository);
              }
              yield* reportBuild(
                envelope,
                operationId,
                WorkspaceBuildSnapshot.make({
                  version: 1,
                  phase: "compiling",
                  message: "Compiling exact proposal",
                  sourceRevision: buildRequest.proposalCommit,
                }),
              );
              const artifact = yield* proposalBuild
                .compile(buildRequest)
                .pipe(
                  Effect.mapError((error) => commandRejected(error.message)),
                );
              yield* reportBuild(
                envelope,
                operationId,
                WorkspaceBuildSnapshot.make({
                  version: 1,
                  phase: "packaging",
                  message: "Packaging verified outputs",
                  buildId: artifact.buildId,
                  sourceRevision: artifact.sourceRevision,
                  artifactDigest: artifact.artifactDigest,
                }),
              );
              const archive = yield* buildFrameworkCapsule({
                sourceArchive: command.archive,
                artifact,
              }).pipe(
                Effect.mapError((error) => commandRejected(error.message)),
              );
              yield* reportBuild(
                envelope,
                operationId,
                WorkspaceBuildSnapshot.make({
                  version: 1,
                  phase: "succeeded",
                  message: "Portable browser build verified",
                  buildId: artifact.buildId,
                  sourceRevision: artifact.sourceRevision,
                  artifactDigest: artifact.artifactDigest,
                }),
              );
              return archive;
            }).pipe(
              Effect.tapError(() =>
                reportBuild(
                  envelope,
                  operationId,
                  WorkspaceBuildSnapshot.make({
                    version: 1,
                    phase: "failed",
                    message: "Portable browser build failed safely",
                  }),
                ),
              ),
              Effect.tapError(() =>
                kernel.reject(preview.id).pipe(Effect.ignore),
              ),
            );
            const builtCapsule = yield* decodeCapsule(builtArchive).pipe(
              Effect.mapError((error) => commandRejected(error.message)),
            );
            candidateReview = yield* reviewDecodedCapsule(
              builtCapsule,
              builtArchive,
            );
            compiledPresentation =
              yield* compiledCapsulePresentation(builtArchive);
            if (compiledPresentation === undefined) {
              yield* kernel.reject(preview.id).pipe(Effect.ignore);
              return yield* Effect.fail(
                commandRejected(
                  "The verified framework build has no portable preview.",
                ),
              );
            }
          }
          if (extensionCatalog !== undefined) {
            const reviewedCapsule = yield* decodeCapsule(
              candidateReview.archive,
            ).pipe(Effect.mapError((error) => commandRejected(error.message)));
            yield* extensionCatalog
              .stageCandidate({
                capsuleId: reviewedCapsule.manifest.id,
                packages: reviewedCapsule.manifest.extensions ?? [],
                flectVersion: packageMetadata.version,
                platform: currentCapsulePlatform(),
              })
              .pipe(
                Effect.tapError(() =>
                  kernel.reject(preview.id).pipe(Effect.ignore),
                ),
                Effect.mapError((error) => commandRejected(error.message)),
              );
            yield* syncExtensionSnapshot();
          }
          yield* updateCapsulePresentation((presentation) => ({
            ...(presentation.accepted === undefined
              ? {}
              : { accepted: presentation.accepted }),
            ...(presentation.lastKnownGood === undefined
              ? {}
              : { lastKnownGood: presentation.lastKnownGood }),
            ...(presentation.acceptedReview === undefined
              ? {}
              : { acceptedReview: presentation.acceptedReview }),
            ...(presentation.lastKnownGoodReview === undefined
              ? {}
              : {
                  lastKnownGoodReview: presentation.lastKnownGoodReview,
                }),
            candidateReview,
            ...(compiledPresentation === undefined
              ? {}
              : { candidate: compiledPresentation }),
          }));
          const next = yield* kernel.snapshot;
          yield* transitionShaping(
            envelope,
            operationId,
            "revision-previewed",
            next,
            preview.id,
          );
          return;
        }
        case "request-shape-handoff": {
          const current = yield* SubscriptionRef.get(state);
          const revisionId =
            current.shaping.proposal?.id ?? current.shaping.active.id;
          if (command.handoff.revisionId !== revisionId) {
            return yield* Effect.fail(
              commandRejected("The interface changed before the handoff ran."),
            );
          }
          if (
            command.handoff.selectedNodeId !== undefined &&
            !documentHasNode(current.document, command.handoff.selectedNodeId)
          ) {
            return yield* Effect.fail(
              commandRejected("The selected interface node is unavailable."),
            );
          }
          if (
            command.handoff.failureSummary !== undefined &&
            command.handoff.failureOperationId === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("Failure context requires a recorded failure."),
            );
          }
          const correlatedFailures =
            command.handoff.failureOperationId === undefined
              ? []
              : yield* journal.query(
                  OperationQuery.make({
                    operationId: command.handoff.failureOperationId,
                    failuresOnly: true,
                  }),
                );
          const correlatedFailure = correlatedFailures.at(-1);
          if (
            command.handoff.failureOperationId !== undefined &&
            correlatedFailure === undefined
          ) {
            return yield* Effect.fail(
              commandRejected("The selected failure is unavailable."),
            );
          }
          const trustedHandoff = WorkbenchHandoff.make({
            ...command.handoff,
            ...(correlatedFailure === undefined
              ? {}
              : {
                  failureSummary:
                    correlatedFailure.tool?.resultSummary ??
                    correlatedFailure.summary,
                }),
          });
          return yield* shapeInstruction(
            envelope,
            operationId,
            trustedHandoff.instruction,
            trustedHandoff,
          );
        }
        case "cancel-role":
          if (
            command.role === "app" &&
            (yield* SubscriptionRef.get(state)).shaping.proposal !== undefined
          ) {
            yield* agent.cancelPreview;
          } else {
            yield* agent.cancel(command.role);
          }
          yield* transition(envelope.source, "turn-completed", unchanged, {
            operationId,
            commandId: envelope.commandId,
            role: command.role,
            message: "Cancelled",
          });
          return;
        case "invoke-interface-action": {
          const current = yield* SubscriptionRef.get(state);
          const action = findInterfaceAction(
            projectInterfaceActions(current.document, current.shaping),
            command.nodeId,
          );
          if (action === undefined) {
            return yield* Effect.fail(
              commandRejected("The interface action is unavailable."),
            );
          }
          if (!action.available) {
            return yield* Effect.fail(
              commandRejected(
                action.unavailableReason ??
                  "The interface action is unavailable.",
              ),
            );
          }
          switch (action.action) {
            case "shape": {
              const previous =
                current.workbench ?? initialWorkbenchState(current.shaping);
              const workbench = yield* selectWorkbenchTarget(
                previous,
                "shape",
                current.shaping,
                previous.transitionSequence,
              ).pipe(
                Effect.mapError((error) => commandRejected(error.message)),
              );
              yield* transition(
                envelope.source,
                "state-changed",
                (snapshot) =>
                  FlectWorkspaceSnapshot.make({
                    ...snapshot,
                    mode: modeFromWorkbench(workbench, snapshot.shaping),
                    workbench,
                  }),
                { operationId, commandId: envelope.commandId },
              );
              return;
            }
            case "safe-mode":
              return yield* enterSafeMode(envelope, operationId);
            case "accept-revision":
              return yield* acceptProposal(envelope, operationId);
            case "reject-revision":
              return yield* rejectProposal(envelope, operationId);
            case "rollback-revision":
              return yield* rollback(envelope, operationId);
          }
          return yield* Effect.fail(
            commandRejected("The interface action is unavailable."),
          );
        }
        case "invoke-product-operation": {
          const presentation = yield* SubscriptionRef.get(capsulePresentation);
          const review =
            envelope.source.kind === "capsule"
              ? envelope.source.binding === "accepted"
                ? presentation.acceptedReview
                : presentation.candidateReview
              : envelope.source.kind === "agent" &&
                  envelope.source.role === "app" &&
                  envelope.source.binding === "candidate"
                ? presentation.candidateReview
                : presentation.acceptedReview;
          if (
            review === undefined ||
            (envelope.source.kind === "capsule" &&
              review.id !== envelope.source.capsuleId)
          ) {
            return yield* Effect.fail(
              commandRejected("The product operation was denied."),
            );
          }
          const productOperations =
            productRegistry === undefined
              ? []
              : yield* productRegistry.catalog(review.permissionContext);
          const registered = productOperations.find(
            (operation) => operation.id === command.operationId,
          );
          if (
            productRegistry === undefined ||
            registered === undefined ||
            registered.permission?.state !== "granted"
          ) {
            return yield* Effect.fail(
              commandRejected("The product operation was denied."),
            );
          }
          const projection = review.capabilities.find(
            (capability) => capability.capabilityId === registered.capabilityId,
          );
          const execution = yield* productRegistry
            .invokeDetailed(
              review.permissionContext,
              ProductOperationInvocation.make({
                version: 1,
                operationId: command.operationId,
                input: command.input,
              }),
            )
            .pipe(
              Effect.tapError((error) =>
                journal
                  .append(
                    OperationJournalInput.make({
                      version: 1,
                      operationId,
                      commandId: envelope.commandId,
                      workspaceId,
                      source: envelope.source,
                      category: "capability",
                      phase: "failed",
                      summary: `Product operation ${command.operationId} failed safely`,
                      capability: ProductCapabilityReceipt.make({
                        version: 1,
                        scopeId: review.permissionContext.scopeId,
                        workspaceId: review.permissionContext.workspaceId,
                        requestDigest: review.permissionContext.requestDigest,
                        revision: review.permissionContext.revision,
                        capabilityId: registered.capabilityId,
                        ...(projection?.decisionId === undefined
                          ? {}
                          : { decisionId: projection.decisionId }),
                        ...(projection?.confirmationPolicy === undefined
                          ? {}
                          : {
                              confirmationPolicy: projection.confirmationPolicy,
                            }),
                        operationId: command.operationId,
                        result: error.reason,
                      }),
                    }),
                  )
                  .pipe(Effect.asVoid),
              ),
              Effect.mapError((error) => commandRejected(error.message)),
            );
          yield* journal
            .append(
              OperationJournalInput.make({
                version: 1,
                operationId,
                commandId: envelope.commandId,
                workspaceId,
                source: envelope.source,
                category: "capability",
                phase: "succeeded",
                summary: `Product operation ${command.operationId} completed`,
                capability: ProductCapabilityReceipt.make({
                  version: 1,
                  scopeId: review.permissionContext.scopeId,
                  workspaceId: review.permissionContext.workspaceId,
                  requestDigest: review.permissionContext.requestDigest,
                  revision: review.permissionContext.revision,
                  capabilityId: execution.reservation.capabilityId,
                  decisionId: execution.reservation.decisionId,
                  confirmationPolicy: execution.reservation.confirmationPolicy,
                  operationId: execution.reservation.operationId,
                  result: "succeeded",
                }),
              }),
            )
            .pipe(Effect.asVoid);
          yield* refreshCapabilityReviews();
          return execution.output;
        }
        case "decide-product-capability": {
          if (productRegistry === undefined) {
            return yield* Effect.fail(
              commandRejected("The product capability is unavailable."),
            );
          }
          const presentation = yield* SubscriptionRef.get(capsulePresentation);
          const review = [
            presentation.candidateReview,
            presentation.acceptedReview,
          ].find((candidate) => candidate?.id === command.capsuleId);
          if (review === undefined) {
            return yield* Effect.fail(
              commandRejected("The product capability is unavailable."),
            );
          }
          yield* productRegistry
            .decide(
              review.permissionContext,
              command.capabilityId,
              command.choice,
            )
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* refreshCapabilityReviews();
          yield* transition(envelope.source, "state-changed", unchanged, {
            operationId,
            commandId: envelope.commandId,
            message: `${command.capabilityId} ${command.choice.type === "allow" ? "granted" : "denied"}`,
          });
          return;
        }
        case "revoke-product-capability": {
          if (productRegistry === undefined) {
            return yield* Effect.fail(
              commandRejected("The product capability is unavailable."),
            );
          }
          const presentation = yield* SubscriptionRef.get(capsulePresentation);
          const visible = [
            presentation.candidateReview,
            presentation.acceptedReview,
            presentation.lastKnownGoodReview,
          ].some((review) =>
            review?.capabilities.some(
              (capability) => capability.decisionId === command.decisionId,
            ),
          );
          if (!visible) {
            return yield* Effect.fail(
              commandRejected("The product capability is unavailable."),
            );
          }
          yield* productRegistry
            .revoke(command.decisionId)
            .pipe(Effect.mapError((error) => commandRejected(error.message)));
          yield* refreshCapabilityReviews();
          yield* transition(envelope.source, "state-changed", unchanged, {
            operationId,
            commandId: envelope.commandId,
            message: "Product capability revoked",
          });
          return;
        }
        case "accept-proposal":
          return yield* acceptProposal(envelope, operationId);
        case "reject-proposal":
          return yield* rejectProposal(envelope, operationId);
        case "rollback-revision":
          return yield* rollback(envelope, operationId);
        case "enter-safe-mode":
          return yield* enterSafeMode(envelope, operationId);
        case "restore-safe-mode": {
          const revision = yield* kernel.restoreLastKnownGood;
          const next = yield* kernel.snapshot;
          yield* transitionShaping(
            envelope,
            operationId,
            "safe-mode-restored",
            next,
            revision.id,
          );
          return;
        }
        case "enable-control":
          yield* transition(
            envelope.source,
            "control-enabled",
            (current) =>
              FlectWorkspaceSnapshot.make({
                ...current,
                control: ControlStateSnapshot.make({
                  enabled: true,
                  instanceId: `instance-${crypto.randomUUID()}`,
                  clients: current.control.clients,
                }),
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
        case "disable-control":
          yield* transition(
            envelope.source,
            "control-disabled",
            (current) =>
              FlectWorkspaceSnapshot.make({
                ...current,
                control: ControlStateSnapshot.make({
                  enabled: false,
                  clients: [],
                }),
              }),
            { operationId, commandId: envelope.commandId },
          );
          return;
      }
    });

    const dispatchCommand = Effect.fn("Flect.Workspace.dispatchCommand")(
      function* (envelope: FlectCommandEnvelope) {
        const claimed = yield* claim(envelope);
        if (claimed.status === "duplicate") {
          if (claimed.receipt.failure !== undefined) {
            return yield* Effect.fail(claimed.receipt.failure);
          }
          return claimed.receipt;
        }
        const operationId = claimed.operationId;
        const outcome = yield* runCommand(envelope, operationId).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                const failure = Schema.is(FlectCommandError)(error)
                  ? error
                  : commandRejected("The operation failed safely.");
                yield* transition(
                  envelope.source,
                  "command-failed",
                  unchanged,
                  {
                    operationId,
                    commandId: envelope.commandId,
                    message: failure.message,
                  },
                );
                yield* appendCommandRecord(
                  envelope,
                  operationId,
                  "failed",
                  `${envelope.command.type} failed (${failure._tag}): ${failure.message}`,
                );
                const failed = OperationFailed.make({
                  operationId,
                  message: failure.message,
                });
                const current = yield* SubscriptionRef.get(state);
                yield* remember(
                  envelope.commandId,
                  FlectCommandReceipt.make({
                    version: 1,
                    commandId: envelope.commandId,
                    workspaceId,
                    operationId,
                    sequence: current.sequence,
                    status: "failed",
                    failure: failed,
                  }),
                );
                return yield* Effect.fail(failed);
              }),
            onSuccess: (result) =>
              Effect.gen(function* () {
                const encodedResult =
                  result === undefined
                    ? undefined
                    : yield* Schema.decodeUnknownEffect(Schema.Json)(
                        result,
                      ).pipe(
                        Effect.mapError(() =>
                          OperationFailed.make({
                            operationId,
                            message: "The command result was invalid.",
                          }),
                        ),
                      );
                const completed = yield* transition(
                  envelope.source,
                  "command-completed",
                  unchanged,
                  {
                    operationId,
                    commandId: envelope.commandId,
                  },
                );
                const receipt = FlectCommandReceipt.make({
                  version: 1,
                  commandId: envelope.commandId,
                  workspaceId,
                  operationId,
                  sequence: completed.sequence,
                  status: "completed",
                  ...(encodedResult === undefined
                    ? {}
                    : { result: encodedResult }),
                });
                yield* remember(envelope.commandId, receipt);
                yield* appendCommandRecord(
                  envelope,
                  operationId,
                  "succeeded",
                  `${envelope.command.type} completed`,
                );
                return receipt;
              }),
          }),
        );
        return outcome;
      },
    );

    const dispatch = Effect.fn("Flect.Workspace.dispatch")(
      (envelope: FlectCommandEnvelope) =>
        Effect.gen(function* () {
          const nested =
            envelope.source.kind === "agent" &&
            (yield* Ref.get(activeAgentParentOperations)).has(
              envelope.source.parentOperationId,
            );
          if (nested) return yield* dispatchCommand(envelope);
          return yield* commandPermit.withPermits(1)(dispatchCommand(envelope));
        }),
    );

    const connectClient = Effect.fn("Flect.Workspace.connectClient")(function* (
      client: ControlClientSummary,
    ) {
      const current = yield* SubscriptionRef.get(state);
      if (!current.control.enabled) {
        return;
      }
      yield* transition(systemSource, "client-connected", (snapshot) =>
        FlectWorkspaceSnapshot.make({
          ...snapshot,
          control: ControlStateSnapshot.make({
            ...snapshot.control,
            clients: [
              ...snapshot.control.clients.filter(
                (candidate) => candidate.id !== client.id,
              ),
              client,
            ].slice(-50),
          }),
        }),
      );
    });

    const disconnectClient = Effect.fn("Flect.Workspace.disconnectClient")(
      (clientId: string) =>
        transition(systemSource, "client-disconnected", (snapshot) =>
          FlectWorkspaceSnapshot.make({
            ...snapshot,
            control: ControlStateSnapshot.make({
              ...snapshot.control,
              clients: snapshot.control.clients.filter(
                (candidate) => candidate.id !== clientId,
              ),
            }),
          }),
        ).pipe(Effect.asVoid),
    );

    if (shareInstallationStore !== undefined) {
      yield* shareInstallationStore.changes.pipe(
        Stream.drop(1),
        Stream.runForEach((shares) =>
          SubscriptionRef.update(state, (current) =>
            FlectWorkspaceSnapshot.make({ ...current, shares }),
          ),
        ),
        Effect.forkScoped,
      );
    }
    if (extensionCatalog !== undefined) {
      yield* extensionCatalog.changes.pipe(
        Stream.drop(1),
        Stream.runForEach((extensions) =>
          SubscriptionRef.update(state, (current) =>
            FlectWorkspaceSnapshot.make({ ...current, extensions }),
          ),
        ),
        Effect.forkScoped,
      );
    }
    yield* agent.changes.pipe(
      Stream.drop(1),
      Stream.runForEach((next) =>
        Effect.gen(function* () {
          yield* transition(systemSource, "state-changed", (current) =>
            FlectWorkspaceSnapshot.make({ ...current, agent: next }),
          );
          const current = yield* SubscriptionRef.get(state);
          yield* persistContinuity(next, current.shaping);
        }),
      ),
      Effect.forkScoped,
    );
    yield* kernel.changes.pipe(
      Stream.drop(1),
      Stream.runForEach((next) =>
        Effect.gen(function* () {
          yield* transition(systemSource, "state-changed", (current) =>
            next.lastEvent.sequence < current.shaping.lastEvent.sequence
              ? current
              : applyShapingSnapshot(current, next),
          );
          if (git !== undefined) {
            const repository = yield* git
              .status(
                next.proposal === undefined
                  ? {}
                  : {
                      proposalBranch: `flect/proposal/${next.proposal.id}`,
                    },
              )
              .pipe(Effect.option);
            if (Option.isSome(repository)) {
              yield* SubscriptionRef.update(state, (current) =>
                FlectWorkspaceSnapshot.make({
                  ...current,
                  repository: repository.value,
                }),
              );
            }
          }
          const current = yield* SubscriptionRef.get(state);
          yield* persistContinuity(current.agent, current.shaping);
        }),
      ),
      Effect.forkScoped,
    );
    yield* journal.changes.pipe(
      Stream.drop(1),
      Stream.runForEach((next) =>
        SubscriptionRef.update(state, (current) =>
          FlectWorkspaceSnapshot.make({
            ...current,
            operations: next,
          }),
        ),
      ),
      Effect.forkScoped,
    );

    return {
      snapshot: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      events: Stream.fromPubSub(events),
      providerAuth: agent.providerAuth,
      providerAuthChanges: agent.providerAuthChanges,
      privateShareSources:
        privateShareSourceRegistry?.list ?? Effect.succeed([]),
      continuity: SubscriptionRef.get(continuityUi),
      continuityChanges: SubscriptionRef.changes(continuityUi),
      capsulePresentation: SubscriptionRef.get(capsulePresentation),
      capsulePresentationChanges: SubscriptionRef.changes(capsulePresentation),
      setDraft,
      exportContinuity: continuityRepository.export,
      exportRepository: Effect.gen(function* () {
        if (git === undefined) {
          return yield* Effect.fail(
            GitWorkspaceFailure.make({
              operation: "export",
              reason: "unavailable",
              message: "The embedded Git workspace is unavailable.",
            }),
          );
        }
        yield* git.open({ workspaceId: "default" });
        return (yield* git.exportRepository).archive;
      }),
      readShareExport: (shareId) =>
        Ref.get(preparedShareExport).pipe(
          Effect.flatMap((prepared) =>
            prepared?.shareId === shareId
              ? Effect.succeed(prepared.archive.slice())
              : Effect.fail(
                  commandRejected(
                    "Prepare that shared archive before reading it.",
                  ),
                ),
          ),
        ),
      exportCapsule: Effect.gen(function* () {
        const presentation = yield* SubscriptionRef.get(capsulePresentation);
        if (presentation.acceptedReview !== undefined) {
          return presentation.acceptedReview.archive.slice();
        }
        if (presentation.accepted !== undefined) {
          return presentation.accepted.archive.slice();
        }
        const current = yield* SubscriptionRef.get(state);
        const document = current.shaping.active.document;
        const slug =
          document.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "interface";
        return yield* encodeCapsule({
          manifest: {
            formatVersion: 1,
            id: `local.flect.${slug}`,
            name: document.name,
            version: "1.0.0",
            entrypoints: [{ id: "flect-interface", path: "ui/interface.json" }],
            capabilities: [],
            compatibility: {
              flect: ">=0.2.0 <1.0.0",
              schemaVersion: 1,
              platforms: ["browser", "macos", "windows", "linux"],
            },
            provenance: {
              publisher: "local-user",
              source: "flect://workspace/default",
              revision:
                current.repository?.acceptedCommit ?? current.shaping.active.id,
              builder: "flect@0.2.0",
            },
            signatures: [],
          },
          files: [
            {
              path: "ui/interface.json",
              contents: new TextEncoder().encode(JSON.stringify(document)),
            },
          ],
        });
      }),
      discardContinuity: discardContinuity(),
      retryContinuity: retryContinuity(),
      dispatch,
      selectReasoning: agent.selectReasoning,
      loginProvider: agent.loginProvider,
      replyProviderAuth: agent.replyProviderAuth,
      cancelProviderAuth: agent.cancelProviderAuth,
      refreshProviderAuth: agent.refreshProviderAuth,
      logoutProvider: agent.logoutProvider,
      connectClient,
      disconnectClient,
    };
  }),
);
