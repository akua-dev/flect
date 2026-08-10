# Flect performance verification — 2026-08-01

## Result

Flect now has one checked-in machine-readable browser/native performance
contract, a documented measurement and variance policy, and mandatory
production-Chromium gates for startup, initial resources, composer/model
interaction, candidate rebuild, warm Use–Shape switching, complete Markdown,
cancellation acknowledgement, heap ceiling, and repeated candidate-cycle heap
growth.

The browser gate is **proven on the supported development baseline**. Native
launch/RSS has a bounded local sample, but cold-boot, reopen, AXI cancellation,
and repeated-cycle native memory still need a repeatable release harness;
GitHub issue `#20` therefore remains open.

## Canonical contract

- Machine thresholds: `shared/performance-budgets.ts`
- Human decision and variance policy: `docs/performance.md`
- Mandatory Chromium implementation: `tests/e2e/performance.spec.ts`

Instrumentation prints only metric names, durations, byte counts, and
iteration counts. It contains no prompt, product, provider, credential, URL,
model-output, or tool-output content and creates no telemetry or state store.

## Production Chromium observations

The final focused run used cache-disabled production assets and one worker:

| Metric | Observed | Budget |
| --- | ---: | ---: |
| Interactive startup | 306 ms | < 2,000 ms |
| Initial transfer | 687,706 bytes | ≤ 1,500,000 bytes |
| Initial decoded resources | 2,387,956 bytes | ≤ 4,000,000 bytes |
| Composer input | 5 ms | < 250 ms |
| Model menu | 44 ms | < 250 ms |
| Worst of 16 warm Use–Shape switches | 195 ms | < 350 ms |
| Complete Markdown render | 180 ms | < 2,000 ms |
| Cancellation acknowledgement | 343 ms | < 500 ms |
| Final garbage-collected JS heap | 16,618,104 bytes | < 96 MiB |
| Five-cycle garbage-collected heap growth | 8,395,920 bytes | < 24 MiB |

The repeated cycle creates and rejects five validated candidates, creates and
keeps a sixth, performs a complete App Agent Markdown turn, and measures after
explicit Chromium garbage collection. The cancellation fixture remains active
until the visible Stop action interrupts its owned Shaper turn, avoiding a
race against an artificially fast completed response.

## Packaged macOS sample

The signed-ad-hoc release bundle was already built and running on Apple
Silicon. A new exact bundle instance produced an on-screen Flect process and
its private runtime in 348–370 ms with warm filesystem/runtime caches. The
sampled process RSS was:

- Flect application: 109,559,808 bytes;
- private `flect-runtime`: 48,726,016 bytes; and
- combined: 158,285,824 bytes, below the 400 MiB steady-state ceiling.

This is a warm new-instance observation, not a clean-machine cold-launch
claim. The exact packaged UI and private Pi runtime were separately opened and
dogfooded in the authentication verification.

## Residual proof retained in issue #20

1. Add a versioned native measurement harness for three-sample cold launch,
   Dock reopen, first model-ready, and public AXI cancellation.
2. Repeat native role/session/build/extension-failure/cancellation cycles and
   gate garbage-collected or settled RSS growth at 64 MiB.
3. Add representative concurrent typing/frame-latency evidence while another
   role streams and while a candidate build is active; current composer input,
   streaming, sticky-follow, rebuild, and cancellation gates are separate.
4. Decide whether optional build/syntax assets should be lazy-loaded further
   only after their actual user-visible path crosses a budget; the initial
   production path is currently within its transfer and decoded limits.

These residuals limit the native/concurrency proof claim. They do not justify
loosening the now-mandatory browser thresholds.
