import { Cause, Context, Effect, Layer, Schema } from 'effect';
import { MAX_SHARE_ARCHIVE_BYTES, type SharePrivateSource } from '../share.js';

const AdapterId = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(80),
	Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)
);
const AdapterName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));

export class PrivateShareSourceSummary extends Schema.Class<PrivateShareSourceSummary>(
	'PrivateShareSourceSummary'
)({ id: AdapterId, name: AdapterName }) {}

export class ShareSourceFailure extends Schema.TaggedErrorClass<ShareSourceFailure>()(
	'ShareSourceFailure',
	{
		reason: Schema.Literals([
			'invalid-adapter',
			'missing-adapter',
			'adapter',
			'oversized',
			'invalid-result',
			'invalid-source',
			'download',
			'timeout',
			'quarantine'
		]),
		message: Schema.String
	}
) {}

/**
 * A named private source adapter. `open` receives only the opaque
 * `reference` from a `SharePrivateSource` descriptor; keep the actual
 * credential inside this closure - it must never appear in the public
 * descriptor, metadata, prompts, or logs. The returned bytes still pass
 * through Flect's ordinary capsule quarantine and inactive review before
 * any retain or activation decision.
 */
export interface PrivateShareSourceDefinition {
	readonly id: string;
	readonly name: string;
	readonly open: (reference: string) => Effect.Effect<Uint8Array, ShareSourceFailure>;
}

export interface PrivateShareSourcesShape {
	readonly list: Effect.Effect<ReadonlyArray<PrivateShareSourceSummary>>;
	readonly open: (source: SharePrivateSource) => Effect.Effect<Uint8Array, ShareSourceFailure>;
}

export class PrivateShareSources extends Context.Service<
	PrivateShareSources,
	PrivateShareSourcesShape
>()('flect/PrivateShareSources') {}

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

/**
 * Compose a {@link PrivateShareSources} Layer from named source adapters.
 * Rejects duplicate or invalid adapter IDs at Layer construction; at
 * runtime, `open` dispatches by `SharePrivateSource.adapterId`, sanitizes
 * adapter defects, and enforces `MAX_SHARE_ARCHIVE_BYTES` before returning
 * bytes to the caller.
 */
export const makePrivateShareSourcesLayer = (options: {
	readonly sources: ReadonlyArray<PrivateShareSourceDefinition>;
}) =>
	Layer.effect(
		PrivateShareSources,
		Effect.gen(function* () {
			const sources = new Map<string, PrivateShareSourceDefinition>();
			for (const candidate of options.sources) {
				const summary = yield* Schema.decodeUnknownEffect(PrivateShareSourceSummary, {
					errors: 'all',
					onExcessProperty: 'error'
				})({ id: candidate.id, name: candidate.name }).pipe(
					Effect.mapError(() => failure('invalid-adapter'))
				);
				if (sources.has(summary.id)) {
					return yield* Effect.fail(failure('invalid-adapter'));
				}
				sources.set(summary.id, candidate);
			}
			const summaries = [...sources.values()]
				.map((source) =>
					PrivateShareSourceSummary.make({
						id: source.id,
						name: source.name
					})
				)
				.toSorted((left, right) => left.id.localeCompare(right.id));

			const open = Effect.fn('PrivateShareSources.open')(function* (
				source: SharePrivateSource
			): Effect.fn.Return<Uint8Array, ShareSourceFailure> {
				const definition = sources.get(source.adapterId);
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

			return {
				list: Effect.succeed(summaries),
				open
			};
		})
	);
