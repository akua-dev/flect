const mebibytes = (value: number) => value * 1024 * 1024;

export const FlectPerformanceBudgets = {
  version: 2,
  browser: {
    coldInteractiveMs: 1_000,
    warmInteractiveMs: 300,
    initialShellGzipBytes: 200 * 1024,
    initialShellDecodedBytes: 600 * 1024,
    initialCssGzipBytes: 25 * 1024,
    composerP95Ms: 50,
    interactionLatencyMs: 100,
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
    repeatedCycleGrowthBytes: mebibytes(8),
  },
  macos: {
    coldWindowMs: 2_000,
    reopenWindowMs: 500,
    cancellationAcknowledgeMs: 250,
    steadyRssBytes: mebibytes(250),
    repeatedCycleGrowthBytes: mebibytes(32),
  },
} as const;
