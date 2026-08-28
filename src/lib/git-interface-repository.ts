import { Effect, Layer, Option, Ref, Schema, type SchemaAST } from 'effect';
import { defaultInterfaceDocument } from '../../shared/interface-document';
import {
	InterfaceRevision,
	RevisionId,
	ShapingEvent,
	ShapingSnapshot,
	validateShapingSnapshot
} from '../../shared/revisions';
import { GitWorkspace } from '../git/git-workspace';
import {
	decodeRecoveryMarker,
	InterfaceRepository,
	InterfaceRepositoryLoad,
	REVISION_JOURNAL_KEY,
	RecoveryMarker
} from './interface-repository';
import { InterfaceStorage, InterfaceStorageError } from './interface-store';

const ACTIVATION_RECEIPT_KEY = 'flect.git-activation.v1';
const SNAPSHOT_PATH = '.flect/snapshot.json';
const INTERFACE_PATH = 'flect.json';
const sourcePath = (path: string) => path !== SNAPSHOT_PATH && path !== INTERFACE_PATH;
const ACCEPTED_BRANCH = 'flect/accepted';
const LAST_KNOWN_GOOD_BRANCH = 'flect/last-known-good';
const RECOVERY_BRANCH = 'flect/shared/recovery';
const RECOVERY_PATH = '.flect/recovery.json';
const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const BranchName = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(180),
	Schema.isPattern(/^flect\/[a-z0-9][a-z0-9/-]*$/)
);
const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export class GitProposalReceipt extends Schema.Class<GitProposalReceipt>('GitProposalReceipt')({
	revisionId: RevisionId,
	branch: BranchName,
	commit: ObjectId
}) {}

export class GitActivationReceipt extends Schema.Class<GitActivationReceipt>(
	'GitActivationReceipt'
)({
	version: Schema.Literal(1),
	acceptedBranch: Schema.Literal(ACCEPTED_BRANCH),
	acceptedCommit: ObjectId,
	lastKnownGoodCommit: ObjectId,
	proposal: Schema.optionalKey(GitProposalReceipt)
}) {}

const decodeReceipt = Schema.decodeUnknownEffect(GitActivationReceipt, strictOptions);

const storageFailure = () =>
	InterfaceStorageError.make({
		message: 'Interface storage is unavailable.'
	});

const parseJson = (source: string) =>
	Effect.try({
		try: (): unknown => JSON.parse(source),
		catch: storageFailure
	});

const commitMessage = (snapshot: ShapingSnapshot) => {
	const revisionId = snapshot.lastEvent.revisionId;
	return revisionId === undefined
		? `Flect ${snapshot.lastEvent.type}`
		: `Flect ${snapshot.lastEvent.type}: ${revisionId}`;
};

const initialBuiltInSnapshot = () => {
	const builtIn = InterfaceRevision.make({
		version: 1,
		id: RevisionId.make('built-in'),
		status: 'accepted',
		source: 'built-in',
		document: defaultInterfaceDocument,
		createdAt: 0
	});
	return ShapingSnapshot.make({
		version: 1,
		active: builtIn,
		lastKnownGood: builtIn,
		safeMode: false,
		disabledExtensions: [],
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: 0,
			type: 'initialized',
			revisionId: builtIn.id
		})
	});
};

const safeRecoverySnapshot = (snapshot: ShapingSnapshot) =>
	ShapingSnapshot.make({
		version: 1,
		active: snapshot.active,
		lastKnownGood: snapshot.active,
		safeMode: true,
		disabledExtensions: snapshot.disabledExtensions,
		lastEvent: ShapingEvent.make({
			version: 1,
			sequence: snapshot.lastEvent.sequence + 1,
			type: 'safe-mode-entered',
			revisionId: snapshot.active.id
		})
	});

const baseSnapshotFor = (snapshot: ShapingSnapshot) =>
	snapshot.active.id === 'built-in' ? initialBuiltInSnapshot() : snapshot;

export const makeGitInterfaceRepositoryLayer = ({
	safeMode,
	workspaceId
}: {
	readonly safeMode: boolean;
	readonly workspaceId: string;
}) =>
	Layer.effect(
		InterfaceRepository,
		Effect.gen(function* () {
			const git = yield* GitWorkspace;
			const storage = yield* InterfaceStorage;
			const receiptRef = yield* Ref.make<GitActivationReceipt | undefined>(undefined);
			const openedRef = yield* Ref.make(false);
			const existedRef = yield* Ref.make(false);

			const ensureOpen = Effect.fn('GitInterfaceRepository.open')(function* () {
				if (yield* Ref.get(openedRef)) {
					return yield* Ref.get(existedRef);
				}
				const opened = yield* git.open({ workspaceId }).pipe(Effect.mapError(storageFailure));
				yield* Ref.set(openedRef, true);
				yield* Ref.set(existedRef, opened.existed);
				return opened.existed;
			});

			const persistReceipt = Effect.fn('GitInterfaceRepository.persistReceipt')(function* (
				receipt: GitActivationReceipt
			) {
				yield* storage.write(ACTIVATION_RECEIPT_KEY, JSON.stringify(receipt));
				yield* Ref.set(receiptRef, receipt);
			});

			const checkpointSnapshot = Effect.fn('GitInterfaceRepository.checkpointSnapshot')(function* (
				snapshot: ShapingSnapshot,
				options: {
					readonly branch: string;
					readonly expectedCommit?: string;
					readonly baseCommit?: string;
					readonly guards?: ReadonlyArray<{
						readonly branch: string;
						readonly commit: string;
					}>;
					readonly source?: {
						readonly files: ReadonlyArray<{
							readonly path: string;
							readonly contents: Uint8Array;
						}>;
						readonly removals: ReadonlyArray<string>;
					};
				}
			) {
				const document = snapshot.proposal?.document ?? snapshot.active.document;
				const snapshotBytes = new TextEncoder().encode(`${JSON.stringify(snapshot, null, 2)}\n`);
				const interfaceBytes = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
				const result = yield* git
					.checkpoint({
						...options,
						files: [
							...(options.source?.files ?? []),
							{ path: SNAPSHOT_PATH, contents: snapshotBytes },
							{ path: INTERFACE_PATH, contents: interfaceBytes }
						],
						removals: options.source?.removals ?? [],
						message: commitMessage(snapshot)
					})
					.pipe(Effect.mapError(storageFailure));
				return result.commit;
			});

			const sourceDelta = Effect.fn('GitInterfaceRepository.sourceDelta')(function* (options: {
				readonly base: { readonly branch: string; readonly commit: string };
				readonly source: { readonly branch: string; readonly commit: string };
				readonly guards?: ReadonlyArray<{
					readonly branch: string;
					readonly commit: string;
				}>;
			}) {
				const guards = options.guards ?? [];
				const [base, source] = yield* Effect.all([
					git.snapshotRef({
						branch: options.base.branch,
						expectedCommit: options.base.commit,
						guards: [options.source, ...guards]
					}),
					git.snapshotRef({
						branch: options.source.branch,
						expectedCommit: options.source.commit,
						guards: [options.base, ...guards]
					})
				]).pipe(Effect.mapError(storageFailure));
				const before = new Map(
					base.files
						.filter((file) => sourcePath(file.path))
						.map((file) => [file.path, file.contents] as const)
				);
				const after = new Map(
					source.files
						.filter((file) => sourcePath(file.path))
						.map((file) => [file.path, file.contents] as const)
				);
				return {
					files: [...after].flatMap(([path, contents]) => {
						const previous = before.get(path);
						return previous !== undefined &&
							previous.byteLength === contents.byteLength &&
							previous.every((value, index) => value === contents[index])
							? []
							: [{ path, contents }];
					}),
					removals: [...before.keys()].filter((path) => !after.has(path))
				};
			});

			const initialize = Effect.fn('GitInterfaceRepository.initialize')(function* (
				snapshot: ShapingSnapshot
			) {
				const commit = yield* checkpointSnapshot(snapshot, {
					branch: ACCEPTED_BRANCH
				});
				yield* git
					.moveRef({
						branch: LAST_KNOWN_GOOD_BRANCH,
						targetCommit: commit,
						guards: [{ branch: ACCEPTED_BRANCH, commit }]
					})
					.pipe(Effect.mapError(storageFailure));
				const receipt = GitActivationReceipt.make({
					version: 1,
					acceptedBranch: ACCEPTED_BRANCH,
					acceptedCommit: commit,
					lastKnownGoodCommit: commit
				});
				yield* persistReceipt(receipt);
				return receipt;
			});

			const readSnapshot = Effect.fn('GitInterfaceRepository.readSnapshot')(function* (
				branch: string,
				expectedCommit: string,
				guards: ReadonlyArray<{
					readonly branch: string;
					readonly commit: string;
				}> = []
			) {
				const result = yield* git
					.readAtRef({
						branch,
						expectedCommit,
						paths: [SNAPSHOT_PATH],
						guards
					})
					.pipe(Effect.mapError(storageFailure));
				const file = result.files[0];
				if (file === undefined || file.path !== SNAPSHOT_PATH) {
					return yield* Effect.fail(storageFailure());
				}
				const source = new TextDecoder().decode(file.contents);
				const input = yield* parseJson(source);
				return yield* validateShapingSnapshot(input).pipe(Effect.mapError(storageFailure));
			});

			const loadReceipt = Effect.fn('GitInterfaceRepository.loadReceipt')(function* () {
				const raw = yield* storage.read(ACTIVATION_RECEIPT_KEY);
				if (raw === null) {
					return undefined;
				}
				const input = yield* parseJson(raw);
				return yield* decodeReceipt(input).pipe(Effect.mapError(storageFailure));
			});

			const loadRecoveryMarker = Effect.fn('GitInterfaceRepository.loadRecoveryMarker')(
				function* () {
					const status = yield* git
						.status({ proposalBranch: RECOVERY_BRANCH })
						.pipe(Effect.mapError(storageFailure));
					const commit = status.proposalCommit;
					if (commit === undefined) return false;
					const read = yield* git
						.readAtRef({
							branch: RECOVERY_BRANCH,
							expectedCommit: commit,
							paths: [RECOVERY_PATH]
						})
						.pipe(Effect.option);
					if (Option.isNone(read)) return true;
					const file = read.value.files[0];
					if (file === undefined) return true;
					const marker = yield* parseJson(new TextDecoder().decode(file.contents)).pipe(
						Effect.flatMap(decodeRecoveryMarker),
						Effect.option
					);
					return Option.isNone(marker) || marker.value.status === 'pending';
				}
			);

			const markRecovery = Effect.fn('GitInterfaceRepository.markRecovery')(function* () {
				const status = yield* git
					.status({ proposalBranch: RECOVERY_BRANCH })
					.pipe(Effect.mapError(storageFailure));
				const commit = status.proposalCommit;
				const baseCommit = status.acceptedCommit ?? status.lastKnownGoodCommit;
				if (commit === undefined && baseCommit === undefined) {
					return yield* Effect.fail(storageFailure());
				}
				yield* git
					.checkpoint({
						branch: RECOVERY_BRANCH,
						...(commit === undefined ? { baseCommit } : { expectedCommit: commit }),
						files: [
							{
								path: RECOVERY_PATH,
								contents: new TextEncoder().encode(
									JSON.stringify(RecoveryMarker.make({ version: 1, status: 'pending' }))
								)
							}
						],
						message: 'Flect deterministic recovery requested'
					})
					.pipe(Effect.mapError(storageFailure));
			});

			const clearRecovery = Effect.fn('GitInterfaceRepository.clearRecovery')(function* () {
				const status = yield* git
					.status({ proposalBranch: RECOVERY_BRANCH })
					.pipe(Effect.mapError(storageFailure));
				const commit = status.proposalCommit;
				if (commit === undefined) {
					return;
				}
				yield* git
					.checkpoint({
						branch: RECOVERY_BRANCH,
						expectedCommit: commit,
						files: [
							{
								path: RECOVERY_PATH,
								contents: new TextEncoder().encode(
									JSON.stringify(RecoveryMarker.make({ version: 1, status: 'clear' }))
								)
							}
						],
						message: 'Flect deterministic recovery cleared'
					})
					.pipe(Effect.mapError(storageFailure));
			});

			const recoverActivation = Effect.fn('GitInterfaceRepository.recoverActivation')(function* () {
				const status = yield* git.status().pipe(Effect.mapError(storageFailure));
				if (status.acceptedCommit === undefined || status.lastKnownGoodCommit === undefined) {
					return yield* Effect.fail(storageFailure());
				}
				const snapshot = yield* readSnapshot(LAST_KNOWN_GOOD_BRANCH, status.lastKnownGoodCommit, [
					{
						branch: ACCEPTED_BRANCH,
						commit: status.acceptedCommit
					}
				]);
				yield* persistReceipt(
					GitActivationReceipt.make({
						version: 1,
						acceptedBranch: ACCEPTED_BRANCH,
						acceptedCommit: status.acceptedCommit,
						lastKnownGoodCommit: status.lastKnownGoodCommit
					})
				);
				return safeRecoverySnapshot(snapshot);
			});

			const repairExisting = Effect.fn('GitInterfaceRepository.repairExisting')(function* (
				snapshot: ShapingSnapshot
			) {
				const status = yield* git.status().pipe(Effect.mapError(storageFailure));
				if (status.acceptedCommit === undefined) {
					return false;
				}
				const acceptedCommit = yield* checkpointSnapshot(snapshot, {
					branch: ACCEPTED_BRANCH,
					expectedCommit: status.acceptedCommit,
					guards:
						status.lastKnownGoodCommit === undefined
							? []
							: [
									{
										branch: LAST_KNOWN_GOOD_BRANCH,
										commit: status.lastKnownGoodCommit
									}
								]
				});
				yield* git
					.moveRef({
						branch: LAST_KNOWN_GOOD_BRANCH,
						...(status.lastKnownGoodCommit === undefined
							? {}
							: { expectedCommit: status.lastKnownGoodCommit }),
						targetCommit: acceptedCommit,
						guards: [{ branch: ACCEPTED_BRANCH, commit: acceptedCommit }]
					})
					.pipe(Effect.mapError(storageFailure));
				if (status.authoringCommit !== undefined) {
					yield* git
						.moveRef({
							branch: 'flect/authoring',
							expectedCommit: status.authoringCommit,
							targetCommit: acceptedCommit,
							guards: [
								{ branch: ACCEPTED_BRANCH, commit: acceptedCommit },
								{
									branch: LAST_KNOWN_GOOD_BRANCH,
									commit: acceptedCommit
								}
							]
						})
						.pipe(Effect.mapError(storageFailure));
				}
				yield* persistReceipt(
					GitActivationReceipt.make({
						version: 1,
						acceptedBranch: ACCEPTED_BRANCH,
						acceptedCommit,
						lastKnownGoodCommit: acceptedCommit
					})
				);
				return true;
			});

			const load = Effect.fn('GitInterfaceRepository.load')(function* () {
				const existed = yield* ensureOpen();
				const recovery = yield* loadRecoveryMarker().pipe(Effect.orElseSucceed(() => true));
				const withRecovery = (load: InterfaceRepositoryLoad) =>
					recovery ? InterfaceRepositoryLoad.make({ ...load, recovery: true }) : load;
				const receipt = yield* loadReceipt().pipe(Effect.option);
				const activation = Option.getOrUndefined(receipt);
				if (activation === undefined) {
					const legacyRaw = yield* storage
						.read(REVISION_JOURNAL_KEY)
						.pipe(Effect.orElseSucceed(() => null));
					if (legacyRaw !== null) {
						const legacy = yield* parseJson(legacyRaw).pipe(
							Effect.flatMap(validateShapingSnapshot),
							Effect.option
						);
						if (legacy._tag === 'Some') {
							yield* initialize(legacy.value);
							yield* storage.remove(REVISION_JOURNAL_KEY).pipe(Effect.catch(() => Effect.void));
							return withRecovery(
								InterfaceRepositoryLoad.make({
									snapshot: safeMode ? safeRecoverySnapshot(legacy.value) : legacy.value,
									recovered: safeMode
								})
							);
						}
					}
					if (!existed) {
						const initial = initialBuiltInSnapshot();
						yield* initialize(initial);
						return withRecovery(
							InterfaceRepositoryLoad.make({
								snapshot: safeMode ? safeRecoverySnapshot(initial) : initial,
								recovered: safeMode
							})
						);
					}
					return yield* recoverActivation().pipe(
						Effect.map((snapshot) =>
							withRecovery(
								InterfaceRepositoryLoad.make({
									snapshot,
									recovered: true
								})
							)
						),
						Effect.catch(() =>
							Effect.succeed(withRecovery(InterfaceRepositoryLoad.make({ recovered: true })))
						)
					);
				}

				const loaded = yield* Effect.gen(function* () {
					const lastKnownGoodExists = yield* git
						.readAtRef({
							branch: LAST_KNOWN_GOOD_BRANCH,
							expectedCommit: activation.lastKnownGoodCommit,
							paths: [SNAPSHOT_PATH],
							guards: [
								{
									branch: activation.acceptedBranch,
									commit: activation.acceptedCommit
								}
							]
						})
						.pipe(Effect.option);
					if (Option.isNone(lastKnownGoodExists)) {
						yield* git
							.moveRef({
								branch: LAST_KNOWN_GOOD_BRANCH,
								targetCommit: activation.lastKnownGoodCommit,
								guards: [
									{
										branch: activation.acceptedBranch,
										commit: activation.acceptedCommit
									}
								]
							})
							.pipe(Effect.mapError(storageFailure));
					}
					const branch = activation.proposal?.branch ?? activation.acceptedBranch;
					const expectedCommit = activation.proposal?.commit ?? activation.acceptedCommit;
					const snapshot = yield* readSnapshot(
						branch,
						expectedCommit,
						activation.proposal === undefined
							? [
									{
										branch: LAST_KNOWN_GOOD_BRANCH,
										commit: activation.lastKnownGoodCommit
									}
								]
							: [
									{
										branch: activation.acceptedBranch,
										commit: activation.acceptedCommit
									},
									{
										branch: LAST_KNOWN_GOOD_BRANCH,
										commit: activation.lastKnownGoodCommit
									}
								]
					);
					if (
						(activation.proposal === undefined && snapshot.proposal !== undefined) ||
						(activation.proposal !== undefined &&
							snapshot.proposal?.id !== activation.proposal.revisionId)
					) {
						return yield* Effect.fail(storageFailure());
					}
					yield* Ref.set(receiptRef, activation);
					return snapshot;
				}).pipe(Effect.option);

				if (loaded._tag === 'Some') {
					return withRecovery(
						InterfaceRepositoryLoad.make({
							snapshot:
								safeMode && !loaded.value.safeMode
									? safeRecoverySnapshot(loaded.value)
									: loaded.value,
							recovered: safeMode
						})
					);
				}
				return yield* recoverActivation().pipe(
					Effect.map((snapshot) =>
						withRecovery(
							InterfaceRepositoryLoad.make({
								snapshot,
								recovered: true
							})
						)
					),
					Effect.catch(() =>
						Effect.succeed(withRecovery(InterfaceRepositoryLoad.make({ recovered: true })))
					)
				);
			});

			const save = Effect.fn('GitInterfaceRepository.save')(function* (snapshot: ShapingSnapshot) {
				const existed = yield* ensureOpen();
				let receipt = yield* Ref.get(receiptRef);
				if (receipt === undefined) {
					if (existed && (yield* repairExisting(baseSnapshotFor(snapshot)))) {
						return;
					}
					receipt = yield* initialize(baseSnapshotFor(snapshot));
				}

				if (snapshot.proposal !== undefined) {
					const existingProposal = receipt.proposal;
					const branch = existingProposal?.branch ?? `flect/proposal/${snapshot.proposal.id}`;
					const repositoryStatus = yield* git
						.status(
							existingProposal === undefined ? {} : { proposalBranch: existingProposal.branch }
						)
						.pipe(Effect.mapError(storageFailure));
					const authoringCommit = repositoryStatus.authoringCommit;
					if (existingProposal === undefined) {
						const source =
							authoringCommit === undefined
								? undefined
								: yield* sourceDelta({
										base: {
											branch: receipt.acceptedBranch,
											commit: receipt.acceptedCommit
										},
										source: {
											branch: 'flect/authoring',
											commit: authoringCommit
										},
										guards: [
											{
												branch: LAST_KNOWN_GOOD_BRANCH,
												commit: receipt.lastKnownGoodCommit
											}
										]
									});
						const proposalCommit = yield* checkpointSnapshot(snapshot, {
							branch,
							baseCommit: receipt.acceptedCommit,
							...(source === undefined ? {} : { source }),
							guards: [
								{
									branch: receipt.acceptedBranch,
									commit: receipt.acceptedCommit
								},
								{
									branch: LAST_KNOWN_GOOD_BRANCH,
									commit: receipt.lastKnownGoodCommit
								},
								...(authoringCommit === undefined
									? []
									: [
											{
												branch: 'flect/authoring',
												commit: authoringCommit
											}
										])
							]
						});
						yield* persistReceipt(
							GitActivationReceipt.make({
								...receipt,
								proposal: GitProposalReceipt.make({
									revisionId: snapshot.proposal.id,
									branch,
									commit: proposalCommit
								})
							})
						);
						return;
					}
					const source =
						authoringCommit === undefined
							? undefined
							: yield* sourceDelta({
									base: {
										branch: existingProposal.branch,
										commit: existingProposal.commit
									},
									source: {
										branch: 'flect/authoring',
										commit: authoringCommit
									},
									guards: [
										{
											branch: receipt.acceptedBranch,
											commit: receipt.acceptedCommit
										},
										{
											branch: LAST_KNOWN_GOOD_BRANCH,
											commit: receipt.lastKnownGoodCommit
										}
									]
								});
					const proposalCommit = yield* checkpointSnapshot(snapshot, {
						branch: existingProposal.branch,
						expectedCommit: existingProposal.commit,
						...(source === undefined ? {} : { source }),
						guards: [
							{
								branch: receipt.acceptedBranch,
								commit: receipt.acceptedCommit
							},
							{
								branch: LAST_KNOWN_GOOD_BRANCH,
								commit: receipt.lastKnownGoodCommit
							},
							...(authoringCommit === undefined
								? []
								: [
										{
											branch: 'flect/authoring',
											commit: authoringCommit
										}
									])
						]
					});
					yield* persistReceipt(
						GitActivationReceipt.make({
							...receipt,
							proposal: GitProposalReceipt.make({
								revisionId: snapshot.proposal.id,
								branch,
								commit: proposalCommit
							})
						})
					);
					return;
				}

				// Safe mode is represented by the guarded recovery marker. Keeping
				// that state off flect/accepted preserves the last accepted product
				// and lets restoration make the only deliberate product transition.
				if (snapshot.safeMode && snapshot.lastEvent.type === 'safe-mode-entered') {
					return;
				}

				const repositoryStatus = yield* git
					.status(receipt.proposal === undefined ? {} : { proposalBranch: receipt.proposal.branch })
					.pipe(Effect.mapError(storageFailure));
				const sourceRef =
					snapshot.lastEvent.type === 'revision-accepted'
						? receipt.proposal !== undefined
							? {
									branch: receipt.proposal.branch,
									commit: receipt.proposal.commit
								}
							: repositoryStatus.authoringCommit === undefined
								? undefined
								: {
										branch: 'flect/authoring',
										commit: repositoryStatus.authoringCommit
									}
						: snapshot.lastEvent.type === 'revision-rolled-back'
							? {
									branch: LAST_KNOWN_GOOD_BRANCH,
									commit: receipt.lastKnownGoodCommit
								}
							: undefined;
				const source =
					sourceRef === undefined
						? undefined
						: yield* sourceDelta({
								base: {
									branch: receipt.acceptedBranch,
									commit: receipt.acceptedCommit
								},
								source: sourceRef,
								guards: [
									{
										branch: LAST_KNOWN_GOOD_BRANCH,
										commit: receipt.lastKnownGoodCommit
									}
								]
							});
				const acceptedCommit = yield* checkpointSnapshot(snapshot, {
					branch: receipt.acceptedBranch,
					expectedCommit: receipt.acceptedCommit,
					...(source === undefined ? {} : { source }),
					guards: [
						{
							branch: LAST_KNOWN_GOOD_BRANCH,
							commit: receipt.lastKnownGoodCommit
						},
						...(sourceRef === undefined || sourceRef.branch === LAST_KNOWN_GOOD_BRANCH
							? []
							: [sourceRef])
					]
				});
				const lastKnownGoodCommit =
					snapshot.lastEvent.type === 'revision-accepted'
						? receipt.acceptedCommit
						: snapshot.lastEvent.type === 'revision-rolled-back'
							? acceptedCommit
							: receipt.lastKnownGoodCommit;
				yield* git
					.moveRef({
						branch: LAST_KNOWN_GOOD_BRANCH,
						expectedCommit: receipt.lastKnownGoodCommit,
						targetCommit: lastKnownGoodCommit,
						guards: [
							{
								branch: receipt.acceptedBranch,
								commit: acceptedCommit
							}
						]
					})
					.pipe(Effect.mapError(storageFailure));
				if (repositoryStatus.authoringCommit !== undefined) {
					yield* git
						.moveRef({
							branch: 'flect/authoring',
							expectedCommit: repositoryStatus.authoringCommit,
							targetCommit: acceptedCommit,
							guards: [
								{
									branch: receipt.acceptedBranch,
									commit: acceptedCommit
								},
								{
									branch: LAST_KNOWN_GOOD_BRANCH,
									commit: lastKnownGoodCommit
								}
							]
						})
						.pipe(Effect.mapError(storageFailure));
				}
				yield* persistReceipt(
					GitActivationReceipt.make({
						version: 1,
						acceptedBranch: receipt.acceptedBranch,
						acceptedCommit,
						lastKnownGoodCommit
					})
				);
			});

			return {
				load: load().pipe(
					Effect.catch(() => Effect.succeed(InterfaceRepositoryLoad.make({ recovered: true })))
				),
				save,
				markRecovery: markRecovery(),
				clearRecovery: clearRecovery()
			};
		})
	);
