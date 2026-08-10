# Astro live-canvas performance and native-feel verification — 2026-08-10

## Outcome

The checked-out Flect browser host now passes the implemented Astro-on-Vite
activation, bundle, long-session, accessibility, responsive-layout, and core
workflow gates. The historical eager React/Vite entry remains documented in
[`2026-08-10-performance-and-native-feel-baseline.md`](2026-08-10-performance-and-native-feel-baseline.md).

Astro and Vite are complementary here: Astro owns the static document and
activation boundary; Vite remains the development and production build engine.
Focus or pointer intent prewarms only the 3 KiB activation bootstrap. The
protected React/Effect workspace is dynamically imported when the person sends
a prompt, uses the Flect shortcut, or invokes an agent action. Tool substrates
remain lazy after workspace activation.

## Environment

- Host: Apple Silicon macOS
- Bun: `1.3.14`
- Astro: `7.2.0`
- Vite: `8.1.5`
- React: `19.2.8`
- Playwright/Chromium: `1.62.0` / Chrome 151
- Production output: static Astro document served by `vite preview`
- Runtime: deterministic origin-restricted Flect fixtures; no private provider
  credential or model content entered the measurements

## Production request and bundle boundary

`bun run build` and `bun run check:bundle` report:

| Boundary | Result | Budget |
| --- | ---: | ---: |
| View-only requests | 4 | no authoring/runtime requests |
| Activation bootstrap | 3,031 B gzip / 6,288 B decoded | 10 KiB gzip |
| Initial CSS | 1,094 B gzip / 2,976 B decoded | 25 KiB gzip |
| First protected workspace | 22 modules | 200 KiB gzip / 600 KiB decoded |

The static route contains no Effect runtime, React workspace, Git, compiler,
shell, package resolver, worker, or Wasm dependency. The bundle graph proves
separate on-demand boundaries for shell, compiler, package resolution, Workers,
and Wasm. A view-only visit can use the opened surface without activating Flect.

## Browser timings

The production Chromium performance gate records:

| Metric | Result | Budget |
| --- | ---: | ---: |
| View-only readiness | 19 ms | diagnostic |
| Cold protected-workspace activation | 225 ms | 1,000 ms |
| Warm activation | 221 ms | 300 ms |
| Composer p95 acknowledgement | 6 ms | 50 ms |
| Activation transfer | 3,490 B | diagnostic |
| Activation decoded bytes | 6,901 B | diagnostic |
| Deterministic model fixture | 50 ms | reported separately |
| Cancellation acknowledgement | 0 ms | 250 ms |
| Representative Markdown | 161 ms | 1,000 ms |

Activation is measured inside the page with `performance.now()` and a
`MutationObserver`, avoiding remote-driver polling overhead. Model/provider
latency remains separate from local UI latency.

## Long-session behavior

The strict repeated-cycle gate runs 50 complete UI edit/use cycles without an
intermediate garbage collection:

| Metric | Result | Budget |
| --- | ---: | ---: |
| Baseline used heap | 16,265,924 B | — |
| Retained growth after 50 cycles | 7,401,424 B | 8 MiB |
| Final heap including Markdown | 25,536,132 B | 64 MiB |
| Worst `/shape` operation | 51 ms | 150 ms text/CSS class |
| Worst complete cycle | 1,848 ms | diagnostic end-to-end |

The hot state path uses bounded projections, sliding latest-value streams, and
shallow trusted snapshot evolution. The embedded libgit2 worker is recycled on
a bounded lease; concurrent operations choose the worker only after acquiring
the Git semaphore, so a queued request cannot capture a terminated worker.

## Native-feel and accessibility evidence

Production Chromium workflows verify:

- inline wide layout, right-sheet compact layout, and full-width phone layout;
- no horizontal overflow at 720 px;
- at least 44 px touch targets for protected compact controls;
- collapse, Escape, reopen, keyboard resizing, and deterministic focus return;
- light/dark system appearance, forced colors, and reduced motion;
- AA contrast for essential composer labels and controls;
- one mounted composer and one chronological conversation across internal
  routing and reload;
- no exposed Edit/Run, Shaper/App Agent, Reset, Keep, or Reject workflow for
  ordinary local changes; and
- explicit Activate/Discard only for imported code, shared artifacts, and
  authority changes.

The final `chrome-devtools-axi` inspection observed four view-only requests,
one 3 KiB bootstrap request after composer focus, no console errors, no mode
switcher or local decision buttons, no horizontal overflow, and focus on the
live composer after the first change completed.

## Native package evidence

The native gate built the private Bun/Pi sidecar, passed 25 Rust tests, produced
the optimized macOS executable, and bundled an ad-hoc signed `Flect.app` with
the runtime helper inside `Contents/MacOS`. This proves the static Astro output,
Tauri CSP/isolation configuration, private sidecar, reopen behavior, and local
application bundle remain compatible.

The web verification establishes browser-native responsiveness and interaction
conventions. It does not substitute for signed/notarized packaged-host evidence.
Developer ID signing, Apple notarization, and clean-machine launch proof require
release credentials and an external clean macOS runner; those gates remain
fail-closed and cannot be completed in an unpushed local-only run.

## Commands

```bash
bun run build
bun run check
bunx playwright test
bun run check:rust
```

The final command results and AXI request/focus inspection are recorded in the
local completion commit and the corresponding GitHub issue evidence.
