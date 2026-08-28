import {
	Context,
	Effect,
	Layer,
	Schema,
	type SchemaAST,
	type Stream,
	SubscriptionRef
} from 'effect';
import {
	assessPortableExtensionUpdate,
	type ExtensionCapability,
	intersectPortableExtensionGrants,
	PortableExtensionCatalogRecord,
	PortableExtensionCatalogSnapshot,
	PortableExtensionFailure,
	type PortableExtensionPackage,
	type PortableExtensionRole,
	PortableExtensionRoleState
} from '../../packages/product/src/extensions';
import { InterfaceStorage, type InterfaceStorageError } from '../lib/interface-store';
import { satisfiesVersion } from '../lib/semver-compatibility';

const STORAGE_KEY = 'flect.portable-extension-catalog.v1';
const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export interface PortableExtensionKey {
	readonly capsuleId: string;
	readonly extensionId: string;
	readonly role: PortableExtensionRole;
	readonly binding: 'accepted' | 'candidate';
}

export interface StagePortableExtensions {
	readonly capsuleId: string;
	readonly packages: ReadonlyArray<PortableExtensionPackage>;
	readonly flectVersion: string;
	readonly platform: 'browser' | 'macos' | 'windows' | 'linux';
}

export class ExtensionCatalogFailure extends Schema.TaggedErrorClass<ExtensionCatalogFailure>()(
	'ExtensionCatalogFailure',
	{
		reason: Schema.Literals([
			'missing',
			'invalid-transition',
			'required-capability',
			'untested-candidate',
			'persistence-failed'
		]),
		message: Schema.Literals([
			'The portable extension is unavailable.',
			'The portable extension transition is unavailable.',
			'A required portable extension capability is not granted.',
			'An enabled candidate extension must pass its test before activation.',
			'Portable extension state could not be saved.'
		])
	}
) {}

const failure = (reason: ExtensionCatalogFailure['reason']): ExtensionCatalogFailure =>
	ExtensionCatalogFailure.make({
		reason,
		message:
			reason === 'missing'
				? 'The portable extension is unavailable.'
				: reason === 'invalid-transition'
					? 'The portable extension transition is unavailable.'
					: reason === 'required-capability'
						? 'A required portable extension capability is not granted.'
						: reason === 'untested-candidate'
							? 'An enabled candidate extension must pass its test before activation.'
							: 'Portable extension state could not be saved.'
	});

const sortEntries = (
	entries: ReadonlyArray<PortableExtensionRoleState>
): ReadonlyArray<PortableExtensionRoleState> =>
	[...entries].sort((left, right) => {
		const leftKey = `${left.capsuleId}\u0000${left.extensionId}\u0000${left.binding}\u0000${left.role}`;
		const rightKey = `${right.capsuleId}\u0000${right.extensionId}\u0000${right.binding}\u0000${right.role}`;
		return leftKey.localeCompare(rightKey);
	});

const sameKey = (entry: PortableExtensionRoleState, key: PortableExtensionKey) =>
	entry.capsuleId === key.capsuleId &&
	entry.extensionId === key.extensionId &&
	entry.role === key.role &&
	entry.binding === key.binding;

const withoutFailure = (entry: PortableExtensionRoleState) => {
	const { failure: _failure, ...rest } = entry;
	return rest;
};

const withoutForkRevision = (entry: PortableExtensionRoleState) => {
	const { forkRevision: _forkRevision, ...rest } = entry;
	return rest;
};

const emptySnapshot = (warning?: PortableExtensionCatalogSnapshot['warning']) =>
	PortableExtensionCatalogSnapshot.make({
		version: 1,
		entries: [],
		...(warning === undefined ? {} : { warning })
	});

const decodeStored = Effect.fn('ExtensionCatalog.decodeStored')((raw: string) =>
	Effect.try({
		try: (): unknown => JSON.parse(raw),
		catch: () => undefined
	}).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(PortableExtensionCatalogRecord, strict)),
		Effect.map((record) =>
			PortableExtensionCatalogSnapshot.make({
				version: 1,
				entries: sortEntries(record.entries)
			})
		)
	)
);

export interface ExtensionCatalogShape {
	readonly snapshot: Effect.Effect<PortableExtensionCatalogSnapshot>;
	readonly restore: (
		snapshot: PortableExtensionCatalogSnapshot
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly changes: Stream.Stream<PortableExtensionCatalogSnapshot>;
	readonly stageCandidate: (
		input: StagePortableExtensions
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly promoteCandidate: Effect.Effect<void, ExtensionCatalogFailure>;
	readonly rejectCandidate: Effect.Effect<void, ExtensionCatalogFailure>;
	readonly enable: (
		key: PortableExtensionKey,
		grants: ReadonlyArray<ExtensionCapability>
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly disable: (key: PortableExtensionKey) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly pin: (
		key: PortableExtensionKey,
		pinned: boolean
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly fork: (
		key: PortableExtensionKey,
		revision: string
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly resolveUpdate: (
		key: PortableExtensionKey,
		choice: 'upstream' | 'fork'
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly remove: (key: PortableExtensionKey) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly recordSuccess: (
		key: PortableExtensionKey
	) => Effect.Effect<void, ExtensionCatalogFailure>;
	readonly recordFailure: (
		key: PortableExtensionKey,
		reason: PortableExtensionFailure['reason']
	) => Effect.Effect<void, ExtensionCatalogFailure>;
}

export class ExtensionCatalog extends Context.Service<ExtensionCatalog, ExtensionCatalogShape>()(
	'flect/ExtensionCatalog'
) {}

const storageFailure = (_error: InterfaceStorageError) => failure('persistence-failed');

export const makeExtensionCatalogLayer = () =>
	Layer.effect(
		ExtensionCatalog,
		Effect.gen(function* () {
			const storage = yield* InterfaceStorage;
			const stored = yield* storage.read(STORAGE_KEY).pipe(Effect.result);
			const initial =
				stored._tag === 'Failure'
					? emptySnapshot('storage-unavailable')
					: stored.success === null
						? emptySnapshot()
						: yield* decodeStored(stored.success).pipe(
								Effect.orElseSucceed(() => emptySnapshot('invalid-record'))
							);
			const state = yield* SubscriptionRef.make(initial);

			const persist = Effect.fn('ExtensionCatalog.persist')(
				(next: PortableExtensionCatalogSnapshot) =>
					storage
						.write(
							STORAGE_KEY,
							JSON.stringify(
								PortableExtensionCatalogRecord.make({
									version: 1,
									entries: sortEntries(next.entries)
								})
							)
						)
						.pipe(Effect.mapError(storageFailure))
			);

			const mutate = Effect.fn('ExtensionCatalog.mutate')(
				<A>(
					change: (
						current: PortableExtensionCatalogSnapshot
					) => Effect.Effect<
						readonly [A, PortableExtensionCatalogSnapshot],
						ExtensionCatalogFailure
					>
				) =>
					SubscriptionRef.modifyEffect(state, (current) =>
						change(current).pipe(Effect.tap(([, next]) => persist(next)))
					)
			);

			const updateEntry = Effect.fn('ExtensionCatalog.updateEntry')(
				<A>(
					key: PortableExtensionKey,
					change: (
						entry: PortableExtensionRoleState
					) => Effect.Effect<readonly [A, PortableExtensionRoleState], ExtensionCatalogFailure>
				) =>
					mutate((current) => {
						const index = current.entries.findIndex((entry) => sameKey(entry, key));
						const entry = current.entries[index];
						if (index < 0 || entry === undefined) return Effect.fail(failure('missing'));
						return change(entry).pipe(
							Effect.map(([value, nextEntry]) => {
								const entries = [...current.entries];
								entries[index] = nextEntry;
								return [
									value,
									PortableExtensionCatalogSnapshot.make({
										version: 1,
										entries: sortEntries(entries)
									})
								] as const;
							})
						);
					})
			);

			const stageCandidate = Effect.fn('ExtensionCatalog.stageCandidate')(
				(input: StagePortableExtensions) =>
					Effect.gen(function* () {
						const compatibility = new Map(
							yield* Effect.forEach(input.packages, (extension) =>
								satisfiesVersion(input.flectVersion, extension.compatibility.flect).pipe(
									Effect.map(
										(compatible) =>
											[
												extension,
												compatible && extension.compatibility.platforms.includes(input.platform)
											] as const
									)
								)
							)
						);
						return yield* mutate((current) => {
							const accepted = current.entries.filter((entry) => entry.binding === 'accepted');
							const entries = current.entries.filter((entry) => entry.binding !== 'candidate');
							for (const extension of input.packages) {
								for (const role of extension.roles) {
									const previous = accepted.find(
										(entry) =>
											entry.capsuleId === input.capsuleId &&
											entry.extensionId === extension.id &&
											entry.role === role
									);
									const compatible = compatibility.get(extension) === true;
									const assessment =
										previous === undefined
											? { status: 'compatible' as const }
											: assessPortableExtensionUpdate(
													{
														id: previous.extensionId,
														version: previous.packageVersion,
														roles: [previous.role],
														capabilities: previous.requestedCapabilities.map((id) => ({
															id,
															required: previous.requiredCapabilities.includes(id)
														}))
													},
													extension,
													{
														pinned: previous.pinned,
														...(previous.forkRevision === undefined
															? {}
															: { forkRevision: previous.forkRevision })
													}
												);
									const requestedCapabilities = extension.capabilities.map(
										(capability) => capability.id
									);
									const requiredCapabilities = extension.capabilities
										.filter((capability) => capability.required)
										.map((capability) => capability.id);
									entries.push(
										PortableExtensionRoleState.make({
											version: 1,
											capsuleId: input.capsuleId,
											extensionId: extension.id,
											packageVersion: extension.version,
											bundleSha256: extension.provenance.bundleSha256,
											provenanceRevision: extension.provenance.revision,
											role,
											binding: 'candidate',
											state: !compatible
												? 'incompatible'
												: assessment.status === 'pinned' || assessment.status === 'conflict'
													? 'conflict'
													: 'available',
											requestedCapabilities,
											requiredCapabilities,
											grantedCapabilities:
												previous === undefined
													? []
													: intersectPortableExtensionGrants(
															extension,
															role,
															previous.grantedCapabilities
														),
											pinned: previous?.pinned ?? false,
											...(previous?.forkRevision === undefined
												? {}
												: { forkRevision: previous.forkRevision }),
											tested: false,
											failureCount: 0
										})
									);
								}
							}
							return Effect.succeed([
								undefined,
								PortableExtensionCatalogSnapshot.make({
									version: 1,
									entries: sortEntries(entries)
								})
							] as const);
						});
					})
			);

			const enable = Effect.fn('ExtensionCatalog.enable')(
				(key: PortableExtensionKey, grants: ReadonlyArray<ExtensionCapability>) =>
					updateEntry(key, (entry) => {
						if (entry.state === 'incompatible' || entry.state === 'conflict')
							return Effect.fail(failure('invalid-transition'));
						const grantedCapabilities = intersectPortableExtensionGrants(
							{
								roles: [entry.role],
								capabilities: entry.requestedCapabilities.map((id) => ({ id }))
							},
							entry.role,
							grants
						);
						if (
							entry.requiredCapabilities.some(
								(capability) => !grantedCapabilities.includes(capability)
							)
						)
							return Effect.fail(failure('required-capability'));
						return Effect.succeed([
							undefined,
							PortableExtensionRoleState.make({
								...withoutFailure(entry),
								state: 'enabled',
								grantedCapabilities,
								failureCount: 0
							})
						] as const);
					})
			);

			const disable = Effect.fn('ExtensionCatalog.disable')((key: PortableExtensionKey) =>
				updateEntry(key, (entry) =>
					Effect.succeed([
						undefined,
						PortableExtensionRoleState.make({
							...withoutFailure(entry),
							state: 'disabled',
							grantedCapabilities: []
						})
					] as const)
				)
			);

			const pin = Effect.fn('ExtensionCatalog.pin')((key: PortableExtensionKey, pinned: boolean) =>
				updateEntry(key, (entry) =>
					Effect.succeed([
						undefined,
						PortableExtensionRoleState.make({ ...entry, pinned })
					] as const)
				)
			);

			const fork = Effect.fn('ExtensionCatalog.fork')(
				(key: PortableExtensionKey, revision: string) =>
					updateEntry(key, (entry) =>
						Effect.succeed([
							undefined,
							PortableExtensionRoleState.make({
								...entry,
								forkRevision: revision
							})
						] as const)
					)
			);

			const resolveUpdate = Effect.fn('ExtensionCatalog.resolveUpdate')(
				(key: PortableExtensionKey, choice: 'upstream' | 'fork') =>
					choice === 'fork'
						? Effect.fail(failure('invalid-transition'))
						: updateEntry(key, (entry) =>
								entry.state !== 'conflict'
									? Effect.fail(failure('invalid-transition'))
									: Effect.succeed([
											undefined,
											PortableExtensionRoleState.make({
												...withoutForkRevision(entry),
												state: 'available',
												pinned: false
											})
										] as const)
							)
			);

			const remove = Effect.fn('ExtensionCatalog.remove')((key: PortableExtensionKey) =>
				mutate((current) => {
					const entries = current.entries.filter((entry) => !sameKey(entry, key));
					return entries.length === current.entries.length
						? Effect.fail(failure('missing'))
						: Effect.succeed([
								undefined,
								PortableExtensionCatalogSnapshot.make({
									version: 1,
									entries: sortEntries(entries)
								})
							] as const);
				})
			);

			const recordSuccess = Effect.fn('ExtensionCatalog.recordSuccess')(
				(key: PortableExtensionKey) =>
					updateEntry(key, (entry) =>
						Effect.succeed([
							undefined,
							PortableExtensionRoleState.make({
								...withoutFailure(entry),
								state: 'enabled',
								tested: true,
								failureCount: 0
							})
						] as const)
					)
			);

			const recordFailure = Effect.fn('ExtensionCatalog.recordFailure')(
				(key: PortableExtensionKey, reason: PortableExtensionFailure['reason']) =>
					updateEntry(key, (entry) =>
						Effect.succeed([
							undefined,
							PortableExtensionRoleState.make({
								...entry,
								state: 'failed',
								tested: false,
								failureCount: Math.min(3, entry.failureCount + 1),
								failure: PortableExtensionFailure.make({
									version: 1,
									reason,
									message: 'The portable extension failed safely.',
									recovery: 'Disable the extension or ask Flect to fix it.'
								})
							})
						] as const)
					)
			);

			const promoteCandidate = mutate((current) => {
				if (
					current.entries.some(
						(entry) =>
							entry.binding === 'candidate' &&
							(entry.state === 'failed' || (entry.state === 'enabled' && !entry.tested))
					)
				)
					return Effect.fail(failure('untested-candidate'));
				const candidates = current.entries.filter((entry) => entry.binding === 'candidate');
				const acceptedKeys = new Set(
					candidates.map(
						(entry) => `${entry.capsuleId}\u0000${entry.extensionId}\u0000${entry.role}`
					)
				);
				const entries = [
					...current.entries.filter(
						(entry) =>
							entry.binding !== 'candidate' &&
							!acceptedKeys.has(`${entry.capsuleId}\u0000${entry.extensionId}\u0000${entry.role}`)
					),
					...candidates.map((entry) =>
						PortableExtensionRoleState.make({ ...entry, binding: 'accepted' })
					)
				];
				return Effect.succeed([
					undefined,
					PortableExtensionCatalogSnapshot.make({
						version: 1,
						entries: sortEntries(entries)
					})
				] as const);
			});

			const rejectCandidate = mutate((current) =>
				Effect.succeed([
					undefined,
					PortableExtensionCatalogSnapshot.make({
						version: 1,
						entries: current.entries.filter((entry) => entry.binding !== 'candidate')
					})
				] as const)
			);

			const restore = Effect.fn('ExtensionCatalog.restore')(
				(snapshot: PortableExtensionCatalogSnapshot) =>
					mutate(() => Effect.succeed([undefined, snapshot] as const))
			);

			return {
				snapshot: SubscriptionRef.get(state),
				restore,
				changes: SubscriptionRef.changes(state),
				stageCandidate,
				promoteCandidate,
				rejectCandidate,
				enable,
				disable,
				pin,
				fork,
				resolveUpdate,
				remove,
				recordSuccess,
				recordFailure
			};
		})
	);
