# Flect performance and memory budgets

This is the human decision record for `FQ-15.1` through `FQ-15.9`. The exact
release thresholds live once in
[`shared/performance-budgets.ts`](../shared/performance-budgets.ts); tests and
release measurements import or report those values rather than copying them.

## Product budgets

On the supported Apple Silicon development/release baseline, production Flect
must stay within these user-visible classes:

- browser shell interactive in 2,000 ms;
- initial browser transfer at or below 1.5 MB and decoded initial resources at
  or below 4 MB;
- model menu and composer input acknowledgement within 250 ms;
- warm Use–Shape switches within 350 ms;
- candidate rebuild within 3,000 ms;
- representative complete Markdown within 2,000 ms;
- browser cancellation acknowledgement within 500 ms;
- garbage-collected Chromium heap at or below 96 MiB, growing by no more than
  24 MiB across the gated repeated product cycles;
- packaged-macOS cold window within 5,000 ms, reopen within 1,000 ms, and first
  model-ready state within 5,000 ms;
- packaged cancellation acknowledgement within 1,000 ms; and
- packaged steady RSS at or below 400 MiB, growing by no more than 64 MiB over
  the release repetition run.

The budgets include Flect orchestration and rendering, not provider inference
latency. Model latency is reported separately and never hidden by extending a
spinner budget.

## Measurement contract

Mandatory browser gates use a production Vite build, Playwright Chromium, one
worker, deterministic Flect fixtures, a 1180 × 781 desktop viewport unless the
scenario names another size, and no network other than the origin-restricted
test runtime. Resource measurements use browser `PerformanceResourceTiming`.
Heap gates use Chromium CDP after an explicit garbage collection before both
samples.

Timing diagnostics contain only metric names, durations, byte counts, and
iteration counts. They must not contain prompts, model output, product data,
credentials, URLs, or tool content. Each mandatory interaction is exercised
at least once per gate. Warm target switching uses multiple samples and fails
on the worst sample; release dogfood records three native samples and uses the
median while also rejecting any sample above 150 percent of its budget.

CI is intentionally tolerant of ordinary scheduler variation but not silent
regression: a mandatory browser metric fails at its exact threshold and prints
the bounded numeric diagnostic. Native measurements complement CI on the
supported macOS release host and are recorded in the dated verification
report. A different supported-device baseline requires a reviewed update to
the one TypeScript budget contract and this rationale.

## Resource behavior

Flect keeps the existing deterministic limits on sessions, queues, messages,
activities, output, frames, QuickJS work, auth logins, and auth events.
Performance instrumentation creates no telemetry, identifier, daemon, cache,
or second runtime state. A failed budget is fixed by reducing user-visible
work—such as lazy-loading a large optional surface—rather than by suppressing
the measurement or retaining more hidden work.
