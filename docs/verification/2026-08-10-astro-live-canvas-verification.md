# Astro live-canvas performance and native-feel verification — 2026-08-10

## Outcome

The checked-out Flect browser host now passes the implemented Astro-on-Vite
activation, bundle, long-session, accessibility, responsive-layout, and core
workflow gates. The historical eager React/Vite entry remains documented in
[`2026-08-10-performance-and-native-feel-baseline.md`](2026-08-10-performance-and-native-feel-baseline.md).

Astro and Vite are complementary here: Astro owns the static document and
activation boundary; Vite remains the development and production build engine.
The static document includes only a 3.1 KiB activation coordinator. Composer
focus, the Flect shortcut, or an agent action asks that coordinator to import
the protected React/Effect workspace; opening the view alone does not. Tool
substrates remain lazy after workspace activation.

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
| Activation bootstrap | 3,159 B gzip / 6,559 B decoded | 10 KiB gzip |
| Initial CSS | 1,094 B gzip / 2,976 B decoded | 25 KiB gzip |
| First protected workspace | 28 modules | 200 KiB gzip / 600 KiB decoded |

The static route contains no Effect runtime, React workspace, Git, compiler,
shell, package resolver, worker, or Wasm dependency. The bundle graph proves
separate on-demand boundaries for shell, compiler, package resolution, Workers,
and Wasm. A view-only visit can use the opened surface without activating Flect.

## Browser timings

The production Chromium performance gate records:

| Metric | Result | Budget |
| --- | ---: | ---: |
| View-only readiness | 17 ms | diagnostic |
| Cold protected-workspace activation | 241 ms | 1,000 ms |
| Warm activation | 219 ms | 300 ms |
| Composer p95 acknowledgement | 5 ms | 50 ms |
| View-only transfer | 3,494 B | 200 KiB |
| View-only decoded bytes | 6,928 B | 600 KiB |
| Deterministic model fixture | 51 ms | reported separately |
| Cancellation acknowledgement | 1 ms | 250 ms |
| Representative Markdown | 177 ms | 1,000 ms |

Activation is measured inside the page with `performance.now()` and a
`MutationObserver`, avoiding remote-driver polling overhead. Model/provider
latency remains separate from local UI latency.

## Long-session behavior

The strict repeated-cycle gate runs 50 complete UI edit/use cycles without an
intermediate garbage collection:

| Metric | Result | Budget |
| --- | ---: | ---: |
| Baseline used heap | 16,613,080 B | — |
| Retained growth after 50 cycles | 7,268,416 B | 8 MiB |
| Final heap including Markdown | 25,837,400 B | 64 MiB |
| Worst candidate rebuild request | 149 ms | 1,000 ms |
| Worst complete cycle | 1,441 ms | diagnostic end-to-end |

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
then the protected workspace graph only after the first agent action, no
console errors, no mode switcher or local decision buttons, no horizontal
overflow, and focus on the one live composer after the first change completed.
Its desktop Lighthouse navigation passed all 45 applicable audits with 100 for
Accessibility, Best Practices, SEO, and Agentic Browsing. AXI's 1,200 px window
and the independent Playwright 320 px/200%-text flow both remained contained;
protected compact actions have at least 44 px targets.

## Native package evidence

The native gate built the private Bun/Pi sidecar, passed 26 Rust tests, produced
the optimized macOS executable, and bundled an ad-hoc signed `Flect.app` with
the runtime helper inside `Contents/MacOS`. The bundle also compiles the fixed
Swift/AppKit accent adapter and exposes it only through the typed, revocable
native-appearance capability. An isolated random-ID copy then passed the real
macOS Accessibility-tree gate for standard menus and window controls, minimum
window clamping, actionable first-run provider setup, editable draft, hard
sidecar loss, exact draft restoration, relaunch, and single-window ownership.
The full observation is recorded in
[`2026-08-10-packaged-macos-local-verification.md`](2026-08-10-packaged-macos-local-verification.md).

The local package verification establishes ad-hoc-signed packaged-host behavior;
it does not substitute for Developer ID distribution trust. Developer ID
signing, Apple notarization, and clean-machine launch proof require release
credentials and an external clean macOS runner; those gates remain fail-closed
and cannot be completed in an unpushed local-only run.

## Commands

```bash
bun run build
bun run check
bunx playwright test
bun run check:rust
PATH=/Users/robin/.cargo/bin:$PATH bun run build:desktop -- --bundles app
bun run test:desktop:local
```

The final source gate passed 166 test files / 886 tests with one deliberate
skip. The production Chromium gate passed all 84 workflows, including the
50-cycle performance case, framework imports, direct manipulation, offline
package reuse, Capsule trust, accessibility, Git history, sharing, and
capability revocation. A submit/menu race found by the first full run was fixed
by locking protected composer actions synchronously; the regression and the
complete final run pass.

The final command results and AXI request/focus inspection are recorded in the
local completion commit and the open-issue audit.
