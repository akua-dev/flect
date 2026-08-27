import { Cause, Context, Effect, Layer, Ref, Schema } from 'effect';
import {
	type PrivateShareSourceDefinition,
	PrivateShareSourceSummary,
	ShareSourceFailure
} from '../../packages/product/src/host/share-source';
import { MAX_SHARE_ARCHIVE_BYTES, type SharePrivateSource } from '../../packages/product/src/share';

export interface PrivateShareSourceRegistryShape {
	readonly register: (
		definition: PrivateShareSourceDefinition
	) => Effect.Effect<PrivateShareSourceSummary, ShareSourceFailure>;
	readonly list: Effect.Effect<ReadonlyArray<PrivateShareSourceSummary>>;
	readonly open: (source: SharePrivateSource) => Effect.Effect<Uint8Array, ShareSourceFailure>;
}

export class PrivateShareSourceRegistry extends Context.Service<
	PrivateShareSourceRegistry,
	PrivateShareSourceRegistryShape
>()('flect/PrivateShareSourceRegistry') {}

const failure = (reason: ShareSourceFailure['reason']) =>
	ShareSourceFailure.make({
		reason,
		message:
			reason === 'missing-adapter'
				? 'That private share source is unavailable.'
				: reason === 'oversized'
					? 'The private share source is too large.'
					: reason === 'invalid-adapter'
						? 'The private share source configuration is invalid.'
						: 'The private share source could not be opened.'
	});

export const makePrivateShareSourceRegistryLayer = (options: {
	readonly sources: ReadonlyArray<PrivateShareSourceDefinition>;
}) =>
	Layer.effect(
		PrivateShareSourceRegistry,
		Effect.gen(function* () {
			const definitions = yield* Ref.make(new Map<string, PrivateShareSourceDefinition>());

			const register = Effect.fn('Flect.PrivateShareRegistry.register')(function* (
				definition: PrivateShareSourceDefinition
			) {
				const summary = yield* Schema.decodeUnknownEffect(PrivateShareSourceSummary, {
					errors: 'all',
					onExcessProperty: 'error'
				})({ id: definition.id, name: definition.name }).pipe(
					Effect.mapError(() => failure('invalid-adapter'))
				);
				const inserted = yield* Ref.modify(definitions, (current) => {
					if (current.has(summary.id)) return [false, current];
					return [true, new Map(current).set(summary.id, definition)];
				});
				if (!inserted) {
					return yield* Effect.fail(failure('invalid-adapter'));
				}
				return summary;
			});

			for (const source of options.sources) {
				yield* register(source);
			}

			const list = Ref.get(definitions).pipe(
				Effect.map((current) =>
					[...current.values()]
						.map((definition) =>
							PrivateShareSourceSummary.make({
								id: definition.id,
								name: definition.name
							})
						)
						.toSorted((left, right) => left.id.localeCompare(right.id))
				)
			);

			const open = Effect.fn('Flect.PrivateShareRegistry.open')(function* (
				source: SharePrivateSource
			) {
				const definition = (yield* Ref.get(definitions)).get(source.adapterId);
				if (definition === undefined) {
					return yield* Effect.fail(failure('missing-adapter'));
				}
				const bytes = yield* definition
					.open(source.reference)
					.pipe(
						Effect.catchCause((cause) =>
							Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.fail(failure('adapter'))
						)
					);
				if (!Schema.is(Schema.Uint8Array)(bytes)) {
					return yield* Effect.fail(failure('invalid-result'));
				}
				if (bytes.byteLength > MAX_SHARE_ARCHIVE_BYTES) {
					return yield* Effect.fail(failure('oversized'));
				}
				return bytes;
			});

			return { register, list, open };
		})
	);

export const PrivateShareSourceRegistryLive = makePrivateShareSourceRegistryLayer({ sources: [] });
