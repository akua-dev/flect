import { Clock, Context, Effect, Layer, Schema, Stream, SubscriptionRef } from 'effect';
import { ProductCapabilityId } from '../../packages/product/src/product-capability';
import { OperationRecord, ToolActivity } from '../../shared/control';

const MAX_RECORDS = 128;
const MAX_ENCODED_BYTES = 512 * 1024;

export class OperationJournalInput extends Schema.Class<OperationJournalInput>(
	'OperationJournalInput'
)({
	version: OperationRecord.fields.version,
	operationId: OperationRecord.fields.operationId,
	commandId: OperationRecord.fields.commandId,
	workspaceId: OperationRecord.fields.workspaceId,
	source: OperationRecord.fields.source,
	category: OperationRecord.fields.category,
	phase: OperationRecord.fields.phase,
	summary: OperationRecord.fields.summary,
	role: OperationRecord.fields.role,
	sessionId: OperationRecord.fields.sessionId,
	toolCallId: OperationRecord.fields.toolCallId,
	revisionId: OperationRecord.fields.revisionId,
	clientId: OperationRecord.fields.clientId,
	validationIssues: OperationRecord.fields.validationIssues,
	tool: OperationRecord.fields.tool,
	capability: OperationRecord.fields.capability
}) {}

export class OperationQuery extends Schema.Class<OperationQuery>('OperationQuery')({
	operationId: OperationRecord.fields.operationId.pipe(Schema.optionalKey),
	role: OperationRecord.fields.role,
	category: OperationRecord.fields.category.pipe(Schema.optionalKey),
	phase: OperationRecord.fields.phase.pipe(Schema.optionalKey),
	toolName: ToolActivity.fields.toolName.pipe(Schema.optionalKey),
	revisionId: OperationRecord.fields.revisionId,
	clientId: OperationRecord.fields.clientId,
	capabilityId: ProductCapabilityId.pipe(Schema.optionalKey),
	failuresOnly: Schema.optionalKey(Schema.Boolean)
}) {}

export interface OperationJournalShape {
	readonly snapshot: Effect.Effect<ReadonlyArray<OperationRecord>>;
	readonly changes: Stream.Stream<ReadonlyArray<OperationRecord>>;
	readonly append: (event: OperationJournalInput) => Effect.Effect<OperationRecord>;
	readonly query: (filter: OperationQuery) => Effect.Effect<ReadonlyArray<OperationRecord>>;
}

export class OperationJournal extends Context.Service<OperationJournal, OperationJournalShape>()(
	'flect/OperationJournal'
) {}

type JournalState = {
	readonly records: ReadonlyArray<OperationRecord>;
	readonly sizes: ReadonlyArray<number>;
	readonly nextSequence: number;
};

const secretPatterns: ReadonlyArray<RegExp> = [
	/authorization\s*:\s*bearer\s+[^\s'"]+/gi,
	/bearer\s+[a-z0-9._~+/=-]+/gi,
	/\b(?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*[^\s'"]+/gi,
	/\bsk-[a-z0-9_-]{8,}\b/gi,
	/\bgh[pousr]_[a-z0-9_]{10,}\b/gi,
	/\bgithub_pat_[a-z0-9_]{10,}\b/gi
];

const redact = (value: string) =>
	secretPatterns.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value);

const redactTool = (tool: ToolActivity) =>
	ToolActivity.make({
		...tool,
		...(tool.command === undefined ? {} : { command: redact(tool.command) }),
		...(tool.output === undefined ? {} : { output: redact(tool.output) }),
		...(tool.resultSummary === undefined ? {} : { resultSummary: redact(tool.resultSummary) }),
		...(tool.previewUrl === undefined ? {} : { previewUrl: redact(tool.previewUrl) })
	});

const encodedSize = Effect.fn('Flect.OperationJournal.encodedSize')((record: OperationRecord) =>
	Schema.encodeEffect(OperationRecord)(record).pipe(
		Effect.map((encoded) => new TextEncoder().encode(JSON.stringify(encoded)).byteLength),
		Effect.orDie
	)
);

const collectionSize = (sizes: ReadonlyArray<number>) =>
	2 + sizes.reduce((total, size) => total + size, 0) + Math.max(0, sizes.length - 1);

const boundedState = (
	records: ReadonlyArray<OperationRecord>,
	sizes: ReadonlyArray<number>,
	nextSequence: number
): JournalState => {
	let first = 0;
	while (
		records.length - first > MAX_RECORDS ||
		collectionSize(sizes.slice(first)) > MAX_ENCODED_BYTES
	) {
		first += 1;
	}
	return {
		records: records.slice(first),
		sizes: sizes.slice(first),
		nextSequence
	};
};

export const OperationJournalLive = Layer.effect(
	OperationJournal,
	Effect.gen(function* () {
		const state = yield* SubscriptionRef.make<JournalState>({
			records: [],
			sizes: [],
			nextSequence: 1
		});

		const append = Effect.fn('Flect.OperationJournal.append')(function* (
			input: OperationJournalInput
		) {
			const timestamp = yield* Clock.currentTimeMillis;
			return yield* SubscriptionRef.modifyEffect(state, (current) =>
				Effect.gen(function* () {
					const record = OperationRecord.make({
						...input,
						sequence: current.nextSequence,
						timestamp,
						summary: redact(input.summary),
						...(input.tool === undefined ? {} : { tool: redactTool(input.tool) })
					});
					const size = yield* encodedSize(record);
					const next = boundedState(
						[...current.records, record],
						[...current.sizes, size],
						current.nextSequence + 1
					);
					return [record, next];
				})
			);
		});

		const query = Effect.fn('Flect.OperationJournal.query')((filter: OperationQuery) =>
			SubscriptionRef.get(state).pipe(
				Effect.map((current) =>
					current.records.filter(
						(record) =>
							(filter.operationId === undefined || record.operationId === filter.operationId) &&
							(filter.role === undefined || record.role === filter.role) &&
							(filter.category === undefined || record.category === filter.category) &&
							(filter.phase === undefined || record.phase === filter.phase) &&
							(filter.toolName === undefined || record.tool?.toolName === filter.toolName) &&
							(filter.revisionId === undefined || record.revisionId === filter.revisionId) &&
							(filter.clientId === undefined || record.clientId === filter.clientId) &&
							(filter.capabilityId === undefined ||
								record.capability?.capabilityId === filter.capabilityId) &&
							(filter.failuresOnly !== true || record.phase === 'failed')
					)
				)
			)
		);

		return {
			snapshot: SubscriptionRef.get(state).pipe(Effect.map((current) => current.records)),
			changes: SubscriptionRef.changes(state).pipe(Stream.map((current) => current.records)),
			append,
			query
		};
	})
);
