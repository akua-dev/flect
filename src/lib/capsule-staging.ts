import { Effect, SubscriptionRef } from 'effect';
import { type DecodedCapsule, decodeCapsule } from '../../packages/product/src/capsule';
import { ProposalBuildRequest } from '../../shared/browser-build';
import {
	CommandRejected,
	type FlectCommandEnvelope,
	type FlectCommandError,
	type FlectWorkspaceEvent,
	WorkspaceBuildSnapshot
} from '../../shared/control';
import { GitWorkspaceFailure } from '../../shared/git-workspace';
import { InterfaceDocument, validateInterfaceDocument } from '../../shared/interface-document';
import type { RevisionId, ShapingSnapshot } from '../../shared/revisions';
import type { ProposalBuildShape } from '../build/proposal-build-service';
import type { ExtensionCatalogShape } from '../extensions/extension-catalog';
import type { GitWorkspaceShape } from '../git/git-workspace';
import type { ShapingKernelShape } from './shaping-kernel';
import type {
	CapsulePresentationState,
	CapsuleReview,
	CompiledCapsulePresentation
} from './workspace-controller';

const commandRejected = (message: string) => CommandRejected.make({ message });

const capsulePlaceholderDocument = (name: string) =>
	InterfaceDocument.make({
		version: 2,
		name,
		root: {
			id: 'root',
			type: 'stack',
			direction: 'column',
			gap: 'lg',
			children: [
				{
					id: 'capsule-title',
					type: 'text',
					text: name,
					style: 'headline'
				},
				{
					id: 'capsule-agent',
					type: 'agent-panel',
					title: 'App Agent'
				}
			]
		}
	});

// The framework-capsule packager is needed only while staging an imported or
// authored app; loading it on demand keeps it out of the protected pre-tool
// workspace budget.
const loadFrameworkCapsulePackager = Effect.tryPromise({
	try: () => import('../build/framework-capsule'),
	catch: () =>
		CommandRejected.make({
			message: 'The capsule packager could not load safely.'
		})
});

export interface CapsuleStagingDeps {
	readonly kernel: ShapingKernelShape;
	readonly git: GitWorkspaceShape | undefined;
	readonly proposalBuild: ProposalBuildShape | undefined;
	readonly extensionCatalog: ExtensionCatalogShape | undefined;
	readonly capsulePresentation: SubscriptionRef.SubscriptionRef<CapsulePresentationState>;
	readonly flectVersion: string;
	readonly currentCapsulePlatform: () => 'browser' | 'macos' | 'windows' | 'linux';
	readonly reviewDecodedCapsule: (
		capsule: DecodedCapsule,
		archive: Uint8Array
	) => Effect.Effect<CapsuleReview, unknown>;
	readonly compiledCapsulePresentation: (
		archive: Uint8Array
	) => Effect.Effect<CompiledCapsulePresentation | undefined>;
	readonly updateCapsulePresentation: (
		update: (current: CapsulePresentationState) => CapsulePresentationState
	) => Effect.Effect<void, unknown>;
	readonly restoreCapsulePresentation: (
		presentation: CapsulePresentationState
	) => Effect.Effect<void, unknown>;
	readonly reportBuild: (
		envelope: FlectCommandEnvelope,
		operationId: string,
		build: WorkspaceBuildSnapshot
	) => Effect.Effect<void, unknown>;
	readonly transitionShaping: (
		envelope: FlectCommandEnvelope,
		operationId: string,
		type: FlectWorkspaceEvent['type'],
		shaping: ShapingSnapshot,
		revisionId?: RevisionId
	) => Effect.Effect<void, unknown>;
	readonly acceptProposal: (
		envelope: FlectCommandEnvelope,
		operationId: string
	) => Effect.Effect<void, unknown>;
	readonly syncExtensionSnapshot: () => Effect.Effect<void, unknown>;
	readonly releasePreview: Effect.Effect<void>;
}

export const stageCapsuleProposal = Effect.fn('Workspace.stageCapsuleProposalLive')(function* (
	deps: CapsuleStagingDeps,
	envelope: FlectCommandEnvelope,
	operationId: string,
	archive: Uint8Array,
	options: {
		readonly proposer: 'user' | 'shaper';
		readonly finalize: 'candidate' | 'local';
	}
) {
	const { kernel, git, proposalBuild, extensionCatalog } = deps;
	const current = yield* kernel.snapshot;
	if (current.proposal !== undefined) {
		return yield* Effect.fail(
			commandRejected('Activate or discard the current candidate before importing.')
		);
	}
	const capsule = yield* decodeCapsule(archive).pipe(
		Effect.mapError((error) => commandRejected(error.message))
	);
	let candidateReview = yield* deps.reviewDecodedCapsule(capsule, archive);
	const plainWebSource = capsule.manifest.entrypoints.some((entry) => entry.id === 'plain-web');
	const browserSource = capsule.manifest.entrypoints.find((entry) => entry.id === 'browser-source');
	const entrypoint = capsule.manifest.entrypoints.find((entry) => entry.id === 'flect-interface');
	const file = capsule.files.find((candidate) => candidate.path === entrypoint?.path);
	let document: InterfaceDocument;
	let compiledPresentation: CompiledCapsulePresentation | undefined;
	if (entrypoint !== undefined && file !== undefined) {
		const input = yield* Effect.try({
			try: (): unknown =>
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.contents)),
			catch: () => commandRejected('The capsule interface is invalid.')
		});
		document = yield* validateInterfaceDocument(input).pipe(
			Effect.mapError(() => commandRejected('The capsule interface is invalid.'))
		);
	} else if (browserSource === undefined) {
		const compiledEntry = capsule.manifest.entrypoints.find((candidate) =>
			candidate.path.endsWith('.html')
		);
		const compiledFile = capsule.files.find((candidate) => candidate.path === compiledEntry?.path);
		if (compiledEntry === undefined || compiledFile === undefined) {
			return yield* Effect.fail(
				commandRejected('This capsule has no supported interface entrypoint.')
			);
		}
		const html = yield* Effect.try({
			try: () => new TextDecoder('utf-8', { fatal: true }).decode(compiledFile.contents),
			catch: () => commandRejected('The capsule entrypoint is invalid.')
		});
		document = capsulePlaceholderDocument(capsule.manifest.name);
		compiledPresentation = {
			id: capsule.manifest.id,
			name: capsule.manifest.name,
			html,
			entrypointPath: compiledEntry.path,
			assets: capsule.files
				.filter((candidate) => candidate.path !== compiledEntry.path)
				.map((candidate) => ({
					path: candidate.path,
					contents: candidate.contents.slice()
				})),
			archive: archive.slice()
		};
	} else {
		document = capsulePlaceholderDocument(capsule.manifest.name);
	}
	if (
		options.finalize === 'local' &&
		browserSource === undefined &&
		compiledPresentation !== undefined &&
		candidateReview.activationBlocked !== true
	) {
		// A static authored app is one local edit. Checkpoint its source and
		// accept the revision directly so no candidate ceremony state ever
		// becomes visible; the accepted Git transition folds the authoring
		// delta exactly like any other local change.
		if (plainWebSource && git !== undefined) {
			yield* Effect.gen(function* () {
				yield* git.open({ workspaceId: 'default' });
				const repository = yield* git.status({});
				if (
					repository.acceptedCommit === undefined ||
					repository.lastKnownGoodCommit === undefined
				) {
					return yield* Effect.fail(
						GitWorkspaceFailure.make({
							operation: 'status',
							reason: 'invalid-ref',
							message: 'The authored project Git refs are unavailable.'
						})
					);
				}
				yield* git.checkpoint({
					branch: 'flect/authoring',
					...(repository.authoringCommit === undefined
						? { baseCommit: repository.acceptedCommit }
						: { expectedCommit: repository.authoringCommit }),
					files: capsule.files.map((source) => ({
						path: `project/${source.path}`,
						contents: source.contents
					})),
					guards: [
						{
							branch: 'flect/accepted',
							commit: repository.acceptedCommit
						},
						{
							branch: 'flect/last-known-good',
							commit: repository.lastKnownGoodCommit
						}
					],
					message: `Author ${capsule.manifest.name} ${capsule.manifest.version}`
				});
			}).pipe(
				Effect.mapError(() =>
					commandRejected('The authored project could not be checkpointed safely.')
				)
			);
		}
		const beforePresentation = yield* SubscriptionRef.get(deps.capsulePresentation);
		yield* deps.updateCapsulePresentation((current) => ({
			accepted: compiledPresentation,
			...(current.accepted === undefined ? {} : { lastKnownGood: current.accepted }),
			acceptedReview: candidateReview,
			...(current.acceptedReview === undefined
				? {}
				: { lastKnownGoodReview: current.acceptedReview })
		}));
		const accepted = yield* kernel
			.applyLocalRevision(document, 'shaper')
			.pipe(
				Effect.tapError(() =>
					deps.restoreCapsulePresentation(beforePresentation).pipe(Effect.ignore)
				)
			);
		yield* deps.releasePreview;
		const next = yield* kernel.snapshot;
		yield* deps.transitionShaping(envelope, operationId, 'revision-accepted', next, accepted.id);
		return;
	}
	const proposal = yield* kernel.propose(document, options.proposer);
	let preview = yield* kernel.preview(proposal.id);
	let sourceProposalBranch: string | undefined;
	if ((plainWebSource || browserSource !== undefined) && git !== undefined) {
		const checkpointSource = Effect.gen(function* () {
			yield* git.open({ workspaceId: 'default' });
			const repository = yield* git.status({
				proposalBranch: `flect/proposal/${preview.id}`
			});
			if (
				repository.acceptedCommit === undefined ||
				repository.lastKnownGoodCommit === undefined ||
				repository.proposalBranch === undefined ||
				repository.proposalCommit === undefined
			) {
				return yield* Effect.fail(
					GitWorkspaceFailure.make({
						operation: 'status',
						reason: 'invalid-ref',
						message: 'The imported project Git refs are unavailable.'
					})
				);
			}
			yield* git.checkpoint({
				branch: 'flect/authoring',
				...(repository.authoringCommit === undefined
					? { baseCommit: repository.acceptedCommit }
					: { expectedCommit: repository.authoringCommit }),
				files: capsule.files.map((source) => ({
					path: `project/${source.path}`,
					contents: source.contents
				})),
				guards: [
					{
						branch: 'flect/accepted',
						commit: repository.acceptedCommit
					},
					{
						branch: 'flect/last-known-good',
						commit: repository.lastKnownGoodCommit
					},
					{
						branch: repository.proposalBranch,
						commit: repository.proposalCommit
					}
				],
				message: `${options.proposer === 'user' ? 'Import' : 'Author'} ${capsule.manifest.name} ${capsule.manifest.version}`
			});
			return repository.proposalBranch;
		}).pipe(
			Effect.tapError(() => kernel.reject(preview.id).pipe(Effect.ignore)),
			Effect.mapError(() =>
				commandRejected('The imported project could not be checkpointed safely.')
			)
		);
		sourceProposalBranch = yield* checkpointSource;
		preview = yield* kernel.supersede(preview.id, document, options.proposer);
	}
	if (browserSource !== undefined) {
		if (git === undefined || proposalBuild === undefined) {
			yield* kernel.reject(preview.id).pipe(Effect.ignore);
			return yield* Effect.fail(
				commandRejected('Portable framework builds are unavailable in this host.')
			);
		}
		const builtArchive = yield* Effect.gen(function* () {
			let repository = yield* git.status({
				proposalBranch: sourceProposalBranch ?? `flect/proposal/${preview.id}`
			});
			const requestFor = (
				status: typeof repository
			): Effect.Effect<ProposalBuildRequest, FlectCommandError> =>
				status.acceptedCommit === undefined ||
				status.lastKnownGoodCommit === undefined ||
				status.proposalBranch === undefined ||
				status.proposalCommit === undefined
					? Effect.fail(commandRejected('The exact imported project proposal is unavailable.'))
					: Effect.succeed(
							ProposalBuildRequest.make({
								proposalBranch: status.proposalBranch,
								proposalCommit: status.proposalCommit,
								acceptedCommit: status.acceptedCommit,
								lastKnownGoodCommit: status.lastKnownGoodCommit,
								entrypoint: browserSource.path
							})
						);
			let buildRequest = yield* requestFor(repository);
			yield* deps.reportBuild(
				envelope,
				operationId,
				WorkspaceBuildSnapshot.make({
					version: 1,
					phase: 'resolving-dependencies',
					message: 'Resolving portable dependencies',
					sourceRevision: buildRequest.proposalCommit
				})
			);
			const resolvedLock = yield* proposalBuild
				.resolvePackageLock(buildRequest)
				.pipe(Effect.mapError((error) => commandRejected(error.message)));
			if (resolvedLock?.needsCheckpoint === true) {
				if (repository.authoringCommit === undefined) {
					return yield* Effect.fail(
						commandRejected('The imported project authoring checkpoint is unavailable.')
					);
				}
				yield* deps.reportBuild(
					envelope,
					operationId,
					WorkspaceBuildSnapshot.make({
						version: 1,
						phase: 'checkpointing-lock',
						message: 'Checkpointing dependency lock',
						sourceRevision: buildRequest.proposalCommit
					})
				);
				yield* git
					.checkpoint({
						branch: 'flect/authoring',
						expectedCommit: repository.authoringCommit,
						files: [
							{
								path: 'project/package-lock.json',
								contents: resolvedLock.contents
							}
						],
						guards: [
							{
								branch: 'flect/accepted',
								commit: buildRequest.acceptedCommit
							},
							{
								branch: 'flect/last-known-good',
								commit: buildRequest.lastKnownGoodCommit
							},
							{
								branch: buildRequest.proposalBranch,
								commit: buildRequest.proposalCommit
							}
						],
						message: 'Lock portable browser dependencies'
					})
					.pipe(
						Effect.mapError(() =>
							commandRejected('The generated package lock could not be checkpointed safely.')
						)
					);
				preview = yield* kernel.supersede(preview.id, document, options.proposer);
				repository = yield* git.status({
					proposalBranch: buildRequest.proposalBranch
				});
				buildRequest = yield* requestFor(repository);
			}
			yield* deps.reportBuild(
				envelope,
				operationId,
				WorkspaceBuildSnapshot.make({
					version: 1,
					phase: 'compiling',
					message: 'Compiling exact proposal',
					sourceRevision: buildRequest.proposalCommit
				})
			);
			const artifact = yield* proposalBuild
				.compile(buildRequest)
				.pipe(Effect.mapError((error) => commandRejected(error.message)));
			yield* deps.reportBuild(
				envelope,
				operationId,
				WorkspaceBuildSnapshot.make({
					version: 1,
					phase: 'packaging',
					message: 'Packaging verified outputs',
					buildId: artifact.buildId,
					sourceRevision: artifact.sourceRevision,
					artifactDigest: artifact.artifactDigest
				})
			);
			const packager = yield* loadFrameworkCapsulePackager;
			const packaged = yield* packager
				.buildFrameworkCapsule({
					sourceArchive: archive,
					artifact
				})
				.pipe(Effect.mapError((error) => commandRejected(error.message)));
			yield* deps.reportBuild(
				envelope,
				operationId,
				WorkspaceBuildSnapshot.make({
					version: 1,
					phase: 'succeeded',
					message: 'Portable browser build verified',
					buildId: artifact.buildId,
					sourceRevision: artifact.sourceRevision,
					artifactDigest: artifact.artifactDigest
				})
			);
			return packaged;
		}).pipe(
			Effect.tapError(() =>
				deps.reportBuild(
					envelope,
					operationId,
					WorkspaceBuildSnapshot.make({
						version: 1,
						phase: 'failed',
						message: 'Portable browser build failed safely'
					})
				)
			),
			Effect.tapError(() => kernel.reject(preview.id).pipe(Effect.ignore))
		);
		const builtCapsule = yield* decodeCapsule(builtArchive).pipe(
			Effect.mapError((error) => commandRejected(error.message))
		);
		candidateReview = yield* deps.reviewDecodedCapsule(builtCapsule, builtArchive);
		compiledPresentation = yield* deps.compiledCapsulePresentation(builtArchive);
		if (compiledPresentation === undefined) {
			yield* kernel.reject(preview.id).pipe(Effect.ignore);
			return yield* Effect.fail(
				commandRejected('The verified framework build has no portable preview.')
			);
		}
	}
	if (extensionCatalog !== undefined) {
		const reviewedCapsule = yield* decodeCapsule(candidateReview.archive).pipe(
			Effect.mapError((error) => commandRejected(error.message))
		);
		yield* extensionCatalog
			.stageCandidate({
				capsuleId: reviewedCapsule.manifest.id,
				packages: reviewedCapsule.manifest.extensions ?? [],
				flectVersion: deps.flectVersion,
				platform: deps.currentCapsulePlatform()
			})
			.pipe(
				Effect.tapError(() => kernel.reject(preview.id).pipe(Effect.ignore)),
				Effect.mapError((error) => commandRejected(error.message))
			);
		yield* deps.syncExtensionSnapshot();
	}
	yield* deps.updateCapsulePresentation((presentation) => ({
		...(presentation.accepted === undefined ? {} : { accepted: presentation.accepted }),
		...(presentation.lastKnownGood === undefined
			? {}
			: { lastKnownGood: presentation.lastKnownGood }),
		...(presentation.acceptedReview === undefined
			? {}
			: { acceptedReview: presentation.acceptedReview }),
		...(presentation.lastKnownGoodReview === undefined
			? {}
			: {
					lastKnownGoodReview: presentation.lastKnownGoodReview
				}),
		candidateReview,
		...(compiledPresentation === undefined ? {} : { candidate: compiledPresentation })
	}));
	if (options.finalize === 'local') {
		const staged = yield* SubscriptionRef.get(deps.capsulePresentation);
		if (staged.candidateReview?.activationBlocked !== true) {
			// A conversationally authored app is a local edit: it carries no
			// required authority, runs only inside the isolated frame, and
			// therefore accepts automatically like any other valid local
			// change. Blocked reviews fall back to the explicit candidate
			// ceremony below.
			return yield* deps.acceptProposal(envelope, operationId);
		}
	}
	const next = yield* kernel.snapshot;
	yield* deps.transitionShaping(envelope, operationId, 'revision-previewed', next, preview.id);
});
