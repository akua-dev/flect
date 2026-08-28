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

// Runner-relative calibration (akua-dev/flect#61), not a weakening: budgets
// are inherently tied to the hardware/virtualization the assertion runs on,
// and `browser` above was tuned against macos-15 (its values stay byte-
// identical -- see FlectPerformanceBudgets.browser). e2e moved macos-15 ->
// ubuntu-latest (cnap#866); on GitHub-hosted ubuntu-latest's shared,
// lower-per-core-throughput runners, the same interaction/activation work
// consistently takes longer, not because anything regressed but because
// the two runner classes are not equivalent hardware. Five of `browser`'s
// fields measured consistently, materially over-budget there across five
// separate real ubuntu-latest runs (flect-projection-staging, 2026-08-28,
// runs 33179409709 / 33181595439 / 33182118334 / 33183111898 /
// 33187083212; values are the assertion's own Playwright "Received:"
// numbers, i.e. the exact same measurement the assertion already takes --
// no new instrumentation):
//   - coldInteractiveMs ("cold Flect activation milliseconds" /
//     "warmed protected workspace on Fast 4G / 4x CPU milliseconds"):
//     27 samples (`test:e2e -- performance.spec.ts --repeat-each=3`),
//     median ~1.62s (Fast-4G-throttled path) / ~1.01s (untethered path),
//     max 2.37s.
//   - composerP95Ms ("composer input p95 milliseconds"): 6 samples
//     (`--repeat-each=3`), median ~54ms, max ~72ms.
//   - interactionLatencyMs ("model menu milliseconds"): 8 samples
//     (`--repeat-each=3`), median ~116ms, max ~140ms.
//   - markdownRenderMs ("Markdown render milliseconds"): missed by the
//     narrower `--repeat-each=3` sweep above (that sweep did not include
//     this spec) and only surfaced once the full suite ran for real on run
//     33183111898, where it failed all 3 attempts (Playwright's automatic
//     retries are independent full re-runs, so these are 3 independent
//     samples): 1045.73ms, 1070.52ms, 1074.58ms; median ~1070.52ms, max
//     ~1074.58ms.
//   - sendVisualAcknowledgeMs ("visible send acknowledgement
//     milliseconds"): passed cleanly on two separate full runs
//     (33183111898, 33184979807) but failed marginally, once, on run
//     33187083212: 100.94ms against a <100ms budget (a ~1% miss, and it
//     passed outright on that same run's automatic retry). Real, if
//     marginal, evidence that this field sits right on the macOS-tuned
//     boundary on ubuntu.
// Every other field (including lcpFast4gMs/lcpSlow4gMs -- the LCP
// assertions never failed once across any of the five runs, so they are
// not touched here) stayed comfortably inside `browser`'s existing numbers
// on every sample, so only these five get a linux-specific value, each set
// to roughly 1.5-2x the observed median with real margin above the
// observed max: coldInteractiveMs 3_000 (~1.8x median, ~1.27x max),
// composerP95Ms 100 (~1.85x median, ~1.4x max), interactionLatencyMs 200
// (~1.7x median, ~1.4x max), markdownRenderMs 2_000 (~1.87x median, ~1.86x
// max), sendVisualAcknowledgeMs 200 (2x the macOS budget -- only one, only
// marginally over-budget sample exists so there's no real median/max to
// anchor to; 2x matches the ratio already used for interactionLatencyMs,
// a similarly-shaped immediate-UI-feedback assertion). The assertion
// structure and margins are otherwise unchanged -- this only supplies a
// different number to the same `expect(...).toBeLessThan(budget.<field>)`
// calls.
//
// A sixth failure mode seen on these same runs -- "bounds 50 accepted
// edit cycles, Markdown rendering, and heap growth" (performance.spec.ts
// :554) intermittently hanging mid-loop until its 180s test timeout --
// was root-caused as NOT a budget problem: Bun.serve's own default
// idleTimeout is 10s, and real shape()/real-Git operations under
// sustained load occasionally exceeded that, so the backend killed the
// connection mid-flight ("[Bun.serve]: request timed out after 10
// seconds" in the server's own log) and the client never saw a response.
// Fixed at the server (see server/index.ts's BunHttpServer.layer call),
// not here -- a slow response is not the same failure as a genuinely
// too-tight budget, and bumping a budget number would not have fixed a
// connection that never completes at all.
const LINUX_BROWSER_OVERRIDES = {
	coldInteractiveMs: 3_000,
	composerP95Ms: 100,
	interactionLatencyMs: 200,
	markdownRenderMs: 2_000,
	sendVisualAcknowledgeMs: 200
} as const satisfies Partial<FlectPerformanceBudgets['browser']>;

const LinuxBrowserPerformanceBudgets: FlectPerformanceBudgets['browser'] = Schema.decodeUnknownSync(
	BrowserPerformanceBudgets
)({
	...FlectPerformanceBudgets.browser,
	...LINUX_BROWSER_OVERRIDES
});

/**
 * The browser performance budgets for the platform this process is
 * actually running the Playwright e2e suite on -- see
 * LINUX_BROWSER_OVERRIDES above for why Linux needs its own numbers for a
 * few fields. Falls back to the macOS-calibrated `FlectPerformanceBudgets
 * .browser` on every other `process.platform` (darwin included), matching
 * this file's behavior before this platform split existed.
 */
export const platformBrowserPerformanceBudgets = (): FlectPerformanceBudgets['browser'] =>
	process.platform === 'linux' ? LinuxBrowserPerformanceBudgets : FlectPerformanceBudgets.browser;
