import { Schema } from 'effect';

const mebibytes = (value: number) => value * 1024 * 1024;

const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0));

const BrowserPerformanceBudgets = Schema.Struct({
	coldInteractiveMs: PositiveNumber,
	warmInteractiveMs: PositiveNumber,
	initialShellGzipBytes: PositiveNumber,
	initialShellDecodedBytes: PositiveNumber,
	initialCssGzipBytes: PositiveNumber,
	composerP95Ms: PositiveNumber,
	interactionLatencyMs: PositiveNumber,
	sendVisualAcknowledgeMs: PositiveNumber,
	firstVisibleActivityMs: PositiveNumber,
	deterministicCanvasChangeMs: PositiveNumber,
	textCssPatchMs: PositiveNumber,
	componentPatchMs: PositiveNumber,
	candidateRebuildMs: PositiveNumber,
	cancellationAcknowledgeMs: PositiveNumber,
	markdownRenderMs: PositiveNumber,
	lcpFast4gMs: PositiveNumber,
	lcpSlow4gMs: PositiveNumber,
	frameBudgetMs: PositiveNumber,
	longTaskMs: PositiveNumber,
	heapCeilingBytes: PositiveNumber,
	repeatedCycleCount: PositiveNumber,
	repeatedCycleGrowthBytes: PositiveNumber
});

const MacosPerformanceBudgets = Schema.Struct({
	coldWindowMs: PositiveNumber,
	reopenWindowMs: PositiveNumber,
	cancellationAcknowledgeMs: PositiveNumber,
	steadyRssBytes: PositiveNumber,
	repeatedCycleGrowthBytes: PositiveNumber
});

const FlectPerformanceBudgetsSchema = Schema.Struct({
	version: Schema.Literal(2),
	browser: BrowserPerformanceBudgets,
	macos: MacosPerformanceBudgets
});

export type FlectPerformanceBudgets = typeof FlectPerformanceBudgetsSchema.Type;

export const FlectPerformanceBudgets: FlectPerformanceBudgets = Schema.decodeUnknownSync(
	FlectPerformanceBudgetsSchema
)({
	version: 2,
	browser: {
		coldInteractiveMs: 1_000,
		warmInteractiveMs: 300,
		initialShellGzipBytes: 200 * 1024,
		initialShellDecodedBytes: 600 * 1024,
		initialCssGzipBytes: 25 * 1024,
		composerP95Ms: 50,
		interactionLatencyMs: 100,
		sendVisualAcknowledgeMs: 100,
		firstVisibleActivityMs: 500,
		deterministicCanvasChangeMs: 2_500,
		textCssPatchMs: 150,
		componentPatchMs: 500,
		candidateRebuildMs: 1_000,
		cancellationAcknowledgeMs: 250,
		markdownRenderMs: 1_000,
		lcpFast4gMs: 1_000,
		lcpSlow4gMs: 2_500,
		frameBudgetMs: 16.7,
		longTaskMs: 50,
		heapCeilingBytes: mebibytes(64),
		repeatedCycleCount: 50,
		repeatedCycleGrowthBytes: mebibytes(8)
	},
	macos: {
		coldWindowMs: 2_000,
		reopenWindowMs: 500,
		cancellationAcknowledgeMs: 250,
		steadyRssBytes: mebibytes(250),
		repeatedCycleGrowthBytes: mebibytes(32)
	}
});
