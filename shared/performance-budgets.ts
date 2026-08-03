const mebibytes = (value: number) => value * 1024 * 1024;

export const FlectPerformanceBudgets = {
  version: 1,
  browser: {
    interactiveStartupMs: 2_000,
    initialTransferBytes: 1_500_000,
    initialDecodedBytes: 4_000_000,
    composerInputMs: 250,
    modelMenuMs: 250,
    candidateRebuildMs: 3_000,
    targetSwitchMs: 350,
    markdownRenderMs: 2_000,
    cancellationAcknowledgeMs: 500,
    heapCeilingBytes: mebibytes(96),
    repeatedCycleGrowthBytes: mebibytes(24),
  },
  macos: {
    coldWindowMs: 5_000,
    reopenWindowMs: 1_000,
    modelReadyMs: 5_000,
    cancellationAcknowledgeMs: 1_000,
    steadyRssBytes: mebibytes(400),
    repeatedCycleGrowthBytes: mebibytes(64),
  },
} as const;
