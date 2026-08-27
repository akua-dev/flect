# Flect performance and memory budgets

This is the human decision record for Flect's release performance contract. The
exact thresholds live once in
[`shared/performance-budgets.ts`](../shared/performance-budgets.ts); tests and
release measurements import or report those values rather than copying them.

## Product budgets

On the supported Apple Silicon development/release baseline, production Flect
must stay within these user-visible classes:

- browser cold activation within 1,000 ms and warm activation within 300 ms;
- protected pre-tool client at or below 200 KiB gzip / 600 KiB decoded and
  initial CSS at or below 25 KiB gzip;
- composer p95 acknowledgement within 50 ms and ordinary interaction within
  100 ms;
- after Send, the submitted message, responding state, and cancellation control
  appear within 100 ms; deterministic agent activity appears within 500 ms;
- a deterministic schema-interface request visibly changes the running canvas
  within 2,500 ms, including controller, sandbox, validation, checkpoint, and
  render work;
- text/CSS patch within 150 ms and component patch within 500 ms;
- external candidate rebuild and representative complete Markdown within
  1,000 ms;
- browser cancellation acknowledgement within 250 ms;
- Fast 4G LCP within 1,000 ms and Slow 4G LCP within 2,500 ms;
- 16.7 ms frame and 50 ms long-task thresholds;
- garbage-collected Chromium heap at or below 64 MiB, growing by no more than
  8 MiB across 50 complete product cycles;
- packaged-macOS cold window within 2,000 ms and reopen within 500 ms;
- packaged cancellation acknowledgement within 250 ms; and
- packaged steady RSS at or below 250 MiB, growing by no more than 32 MiB over
  the release repetition run.

The budgets include Flect orchestration and rendering, not provider inference
latency. The deterministic canvas-change fixture supplies bounded agent events
without a provider call. Live model latency is reported separately and never
hidden by extending a spinner budget.

## Measurement contract

Mandatory browser gates use a production Astro-on-Vite build, Playwright Chromium, one
worker, deterministic Flect fixtures, a 1180 × 781 desktop viewport unless the
scenario names another size, and no network other than the origin-restricted
test runtime. Resource measurements use browser `PerformanceResourceTiming`.
Heap gates expose Chromium's precise memory information. The strict long-session
gate deliberately performs no intermediate garbage collection: it measures 50
real create/use cycles and fails above 8 MiB retained growth. A final collected
sample may be reported separately as diagnostic evidence.

Timing diagnostics contain only metric names, durations, byte counts, and
iteration counts. They must not contain prompts, model output, product data,
credentials, URLs, or tool content. Each mandatory interaction is exercised
at least once per gate. Warm target switching uses multiple samples and fails
on the worst sample; release dogfood records three native samples and uses the
median while also rejecting any sample above 150 percent of its budget.

Logical time-dependent Effect workflows use Effect test services such as
`TestClock`. User-visible acknowledgement, activity, and canvas-change budgets
use Chromium's monotonic `performance.now()` around rendered DOM observations;
advancing a simulated clock cannot prove a paint or interaction deadline.

The dedicated supported-device browser run and release dogfood fail warm
activation at the exact 300 ms product threshold. Shared hosted CI cannot be a
hardware baseline: it reports that same metric, restores the browser cache
before measuring it, and rejects warm activation at the existing 1,000 ms cold
ceiling so scheduler contention cannot create a false release claim or hide a
major regression. Native measurements complement CI on the supported macOS
release host and are recorded in the dated verification report. A different
supported-device baseline requires a reviewed update to the one TypeScript
budget contract and this rationale.

## Resource behavior

Flect keeps deterministic limits on sessions, queues, messages, activities,
output, frames, QuickJS work, auth logins, and auth events. The hot workspace
path uses shallow trusted snapshot evolution instead of recursively decoding
unchanged history on every streamed update. Public operation projection is 12
records; the internal journal is bounded to 128 records / 512 KiB. Internal
conversation projections retain 12 messages and eight activities per authority.
Performance instrumentation creates no telemetry, identifier, daemon, cache,
or second runtime state. A failed budget is fixed by reducing user-visible
work—such as lazy-loading a large optional surface—rather than by suppressing
the measurement or retaining more hidden work.

The current measured release evidence is in
[`docs/verification/2026-08-10-astro-live-canvas-verification.md`](verification/2026-08-10-astro-live-canvas-verification.md).
