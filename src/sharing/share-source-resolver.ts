import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';
import { ShareSourceFailure } from '../../packages/product/src/host/share-source';
import {
	MAX_SHARE_ARCHIVE_BYTES,
	ShareSource,
	type ShareSource as ShareSourceValue
} from '../../packages/product/src/share';
import {
	PrivateShareSourceRegistry,
	type PrivateShareSourceRegistryShape
} from './private-share-source-registry';
import {
	type ShareCandidateMaterial,
	ShareQuarantine,
	type ShareQuarantineShape
} from './share-quarantine';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export class ShareOpenStarted extends Schema.Class<ShareOpenStarted>('ShareOpenStarted')({
	type: Schema.Literal('started'),
	source: Schema.Literals(['local', 'url', 'git', 'private'])
}) {}

export class ShareOpenProgress extends Schema.Class<ShareOpenProgress>('ShareOpenProgress')({
	type: Schema.Literal('progress'),
	phase: Schema.Literals(['read', 'download', 'clone', 'private']),
	bytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 64 * 1024 * 1024 }))
}) {}

export interface ShareOpenCompleted {
	readonly type: 'completed';
	readonly candidate: ShareCandidateMaterial;
}

export type ShareOpenEvent = ShareOpenStarted | ShareOpenProgress | ShareOpenCompleted;

export interface ShareSourceResolverShape {
	readonly open: (source: ShareSourceValue) => Stream.Stream<ShareOpenEvent, ShareSourceFailure>;
}

export class ShareSourceResolver extends Context.Service<
	ShareSourceResolver,
	ShareSourceResolverShape
>()('flect/ShareSourceResolver') {}

const failure = (reason: ShareSourceFailure['reason']) =>
	ShareSourceFailure.make({
		reason,
		message:
			reason === 'oversized'
				? 'The shared source is too large.'
				: reason === 'timeout'
					? 'The shared source did not respond in time.'
					: reason === 'invalid-source'
						? 'The shared source is invalid.'
						: reason === 'quarantine'
							? 'The shared source failed safe inspection.'
							: 'The shared source could not be downloaded.'
	});

interface DownloadState {
	readonly chunks: ReadonlyArray<Uint8Array>;
	readonly total: number;
}

const assemble = (state: DownloadState) => {
	const bytes = new Uint8Array(state.total);
	let offset = 0;
	for (const chunk of state.chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};

export const makeShareSourceResolverLayer = (options?: { readonly maxArchiveBytes?: number }) =>
	Layer.effect(
		ShareSourceResolver,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const quarantine: ShareQuarantineShape = yield* ShareQuarantine;
			const privateSources: PrivateShareSourceRegistryShape = yield* PrivateShareSourceRegistry;
			const maxArchiveBytes = options?.maxArchiveBytes ?? MAX_SHARE_ARCHIVE_BYTES;

			const download = Effect.fn('ShareSourceResolver.download')((url: string) =>
				Effect.gen(function* () {
					const response = yield* HttpClientRequest.get(url).pipe(
						HttpClientRequest.setHeader(
							'accept',
							'application/vnd.flect.share+tar, application/octet-stream'
						),
						client.execute,
						Effect.flatMap(HttpClientResponse.filterStatusOk),
						Effect.mapError(() => failure('download'))
					);
					const declared = Number(response.headers['content-length']);
					if (Number.isFinite(declared) && declared > maxArchiveBytes) {
						return yield* Effect.fail(failure('oversized'));
					}
					const state = yield* response.stream.pipe(
						Stream.runFoldEffect(
							(): DownloadState => ({ chunks: [], total: 0 }),
							(current, chunk) => {
								const total = current.total + chunk.byteLength;
								return total > maxArchiveBytes
									? Effect.fail(failure('oversized'))
									: Effect.succeed({
											chunks: [...current.chunks, Uint8Array.from(chunk)],
											total
										});
							}
						),
						Effect.mapError((error) =>
							Schema.is(ShareSourceFailure)(error) ? error : failure('download')
						)
					);
					return assemble(state);
				}).pipe(
					Effect.timeoutOrElse({
						duration: '20 seconds',
						orElse: () => Effect.fail(failure('timeout'))
					})
				)
			);

			const resolve = Effect.fn('ShareSourceResolver.resolve')(function* (input: ShareSourceValue) {
				const source = yield* Schema.decodeUnknownEffect(
					ShareSource,
					strict
				)(input).pipe(Effect.mapError(() => failure('invalid-source')));
				switch (source._tag) {
					case 'local': {
						if (source.bytes.byteLength > maxArchiveBytes) {
							return yield* Effect.fail(failure('oversized'));
						}
						return {
							bytes: source.bytes.byteLength,
							phase: 'read' as const,
							candidate: yield* quarantine
								.inspect(source.bytes)
								.pipe(Effect.mapError(() => failure('quarantine')))
						};
					}
					case 'url': {
						const bytes = yield* download(source.url);
						return {
							bytes: bytes.byteLength,
							phase: 'download' as const,
							candidate: yield* quarantine
								.inspect(bytes)
								.pipe(Effect.mapError(() => failure('quarantine')))
						};
					}
					case 'git':
						return {
							bytes: 0,
							phase: 'clone' as const,
							candidate: yield* quarantine
								.inspectGit(source.url, source.commit)
								.pipe(Effect.mapError(() => failure('quarantine')))
						};
					case 'private': {
						const bytes = yield* privateSources.open(source);
						return {
							bytes: bytes.byteLength,
							phase: 'private' as const,
							candidate: yield* quarantine
								.inspect(bytes)
								.pipe(Effect.mapError(() => failure('quarantine')))
						};
					}
				}
			});

			const open = (source: ShareSourceValue) =>
				Stream.fromIterable<ShareOpenEvent>([
					ShareOpenStarted.make({ type: 'started', source: source._tag })
				]).pipe(
					Stream.concat(
						Stream.fromEffect(resolve(source)).pipe(
							Stream.flatMap((resolved) =>
								Stream.fromIterable<ShareOpenEvent>([
									ShareOpenProgress.make({
										type: 'progress',
										phase: resolved.phase,
										bytes: resolved.bytes
									}),
									{ type: 'completed', candidate: resolved.candidate }
								])
							)
						)
					)
				);

			return { open } satisfies ShareSourceResolverShape;
		})
	);

export const ShareHttpClientLive = BrowserHttpClient.layerFetch.pipe(
	Layer.provide(
		Layer.succeed(BrowserHttpClient.RequestInit)({
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'follow'
		})
	)
);

import { BrowserHttpClient } from '@effect/platform-browser';
