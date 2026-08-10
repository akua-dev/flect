# Astro live-canvas performance and native-feel verification — 2026-08-10

## Outcome

The checked-out Flect browser host now passes the implemented Astro-on-Vite
activation, bundle, long-session, accessibility, responsive-layout, and core
workflow gates. The historical eager React/Vite entry remains documented in
[`2026-08-10-performance-and-native-feel-baseline.md`](2026-08-10-performance-and-native-feel-baseline.md).

Astro and Vite are complementary here: Astro owns the static document and a
custom `client:flect` island directive; Vite remains the development and
production build engine. The static document includes only a 2.4 KiB gzip
activation coordinator. Focus and pointer intent arm that coordinator without
loading the workspace. Submitting the first prompt, using the Flect shortcut,
or invoking an agent action hydrates the protected Effect workspace through
Astro's island lifecycle. Workspace CSS is a declarative component resource,
not an imperative DOM loader, and the Effect coordinator does not replace the
static shell until that resource has loaded. Tool substrates remain lazy after
activation.

## Environment

- Host: Apple Silicon macOS
- Bun: `1.3.14`
- Astro: `7.2.0`
- Vite: `8.1.5`
- React: `19.2.8`
- Astro island renderer: Preact `10.29.8` with React compatibility
- Playwright/Chromium: `1.62.0` / Chrome 151
- Production output: static Astro document served by `vite preview`
- Runtime: deterministic origin-restricted Flect fixtures; no private provider
  credential or model content entered the measurements

## Production request and bundle boundary

`bun run build` and `bun run check:bundle` report:

| Boundary                     |                                          Result |                         Budget |
| ---------------------------- | ----------------------------------------------: | -----------------------------: |
| View-only requests           |                                               4 |  no authoring/runtime requests |
| View-only document           |                  2,921 B gzip / 6,849 B decoded |                     diagnostic |
| Activation bootstrap         |                  2,199 B gzip / 4,646 B decoded |                    10 KiB gzip |
| Initial CSS                  |                  1,094 B gzip / 2,976 B decoded |                    25 KiB gzip |
| Deferred workspace CSS       |                12,018 B gzip / 64,796 B decoded |  16 KiB gzip / 80 KiB decoded |
| First protected JS workspace | 184,607 B gzip / 594,425 B decoded / 41 modules | 200 KiB gzip / 600 KiB decoded |

The complete first protected payload is 196,625 B gzip / 659,221 B decoded
when the separately cached CSS and JavaScript graphs are combined.

The static route contains no Effect runtime, React workspace, Git, compiler,
shell, package resolver, worker, or Wasm dependency. The bundle graph proves
separate on-demand boundaries for shell, compiler, package resolution, Workers,
and Wasm. A view-only visit can use the opened surface without activating Flect.

## Browser timings

The production Chromium performance gate records:

| Metric                              |   Result |     Budget |
| ----------------------------------- | -------: | ---------: |
| View-only readiness                 |    25 ms | diagnostic |
| Cold protected-workspace activation |   227 ms |   1,000 ms |
| Warm activation                     |   220 ms |     300 ms |
| Warm Fast 4G / 4× CPU activation    |   501 ms |   1,000 ms |
| Fast 4G / 4× CPU LCP                |   361 ms |   1,000 ms |
| Slow 4G / 4× CPU LCP                | 1,188 ms |   2,500 ms |
| Fast/Slow 4G CLS                    |    0 / 0 |      < 0.1 |
| Composer p95 acknowledgement        |     5 ms |      50 ms |
| View-only transfer                  |  4,188 B |    200 KiB |
| View-only decoded bytes             |  7,622 B |    600 KiB |
| Cancellation acknowledgement        |     0 ms |     250 ms |
| Representative Markdown             |   166 ms |   1,000 ms |

Activation is measured inside the page with `performance.now()` and a
`MutationObserver`, avoiding remote-driver polling overhead. Model/provider
latency remains separate from local UI latency.

The canonical hosted PR run
[`31401481772`](https://github.com/akua-dev/flect/actions/runs/31401481772)
independently passed the complete gate on commit `2f09c0b`: 166 source test
files / 888 tests, 85 production Chromium workflows, 26 Rust host tests, and
the signed-ad-hoc desktop app build. Its shared-runner observations were 519 ms
cold and 419 ms warm activation, 694 ms warmed activation on Fast 4G with 4×
CPU throttling, 447 ms Fast-4G LCP, 1,288 ms Slow-4G LCP, zero CLS, and 16 ms
composer p95. As defined in `docs/performance.md`, shared CI applies the
1,000 ms scheduler ceiling to warm activation; only the supported-device gate
makes the 300 ms product claim.

## Long-session behavior

The strict repeated-cycle gate runs 50 complete UI edit/use cycles without an
intermediate garbage collection:

| Metric                          |       Result |                Budget |
| ------------------------------- | -----------: | --------------------: |
| Baseline used heap              | 15,248,080 B |                     — |
| Retained growth after 50 cycles |  7,223,232 B |                 8 MiB |
| Final heap including Markdown   | 24,385,560 B |                64 MiB |
| Worst candidate rebuild request |        47 ms |              1,000 ms |
| Worst complete cycle            |     1,813 ms | diagnostic end-to-end |

The hosted shared runner retained 7,229,072 B across the same 50-cycle gate,
reported a 141 ms worst candidate rebuild and a diagnostic 4,453 ms worst
complete cycle, and stayed below the source-of-truth heap and rebuild budgets.

The hot state path uses bounded projections, sliding latest-value streams, and
shallow trusted snapshot evolution. The embedded libgit2 worker is recycled on
a bounded lease; concurrent operations choose the worker only after acquiring
the Git semaphore, so a queued request cannot capture a terminated worker.
Flect source, scripts, and tests use Effect concurrency combinators instead of
native promise fan-out. Product TypeScript callback APIs use `Effect.callback`
with interruption cleanup rather than ad hoc Promise constructors. `bun run
check:effect-concurrency` scans every owned TypeScript source file and fails if
either boundary regresses; test-only callback fixtures remain explicit
exceptions. The isolated unbundled preview service worker stays a platform
callback boundary so loading it never pulls the Effect runtime into that lazy
worker.

## Native-feel and accessibility evidence

Production Chromium workflows verify:

- inline wide layout, right-sheet compact layout, and full-width phone layout;
- no horizontal overflow at 720 px;
- at least 44 px touch targets for protected compact controls;
- collapse, Escape, reopen, keyboard resizing, and deterministic focus return;
- the topmost Actions dialog consumes Escape before the compact agent sheet,
  preventing an open modal from surviving a rail collapse; the exact
  draft/conversation/routing journey passes 10 consecutive production runs;
- light/dark system appearance, forced colors, and reduced motion;
- AA contrast for essential composer labels and controls;
- one mounted composer and one chronological conversation across internal
  routing and reload;
- no exposed Edit/Run, Shaper/App Agent, Reset, Keep, or Reject workflow for
  ordinary local changes; and
- explicit Activate/Discard only for imported code, shared artifacts, and
  authority changes.

The final `chrome-devtools-axi` inspection observed only the document, static
CSS, activation module, preload helper, and favicon before activation. Focus
added no request; the protected workspace graph and its one declarative
stylesheet appeared only after activation. The static shell remained visible
until that link had a live CSSStyleSheet, then the workspace reached `active`
in 59 ms on the warm local preview. The clean runtime-backed run had no console
messages, no horizontal overflow, and one live composer. Its
desktop Lighthouse navigation passed all 46 applicable audits with 100 for
Accessibility, Best Practices, SEO, and Agentic Browsing. AXI's 500 px minimum
window and the independent Playwright 320 px/200%-text flow both remained
contained; protected compact actions have at least 44 px targets.

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
and cannot be completed in an untrusted PR workflow.

## Commands

```bash
bun run build
bun run check
bunx playwright test
bun run check:rust
PATH=/Users/robin/.cargo/bin:$PATH bun run build:desktop -- --bundles app
bun run test:desktop:local
```

The final source gate passed 166 test files / 888 tests with one deliberate
skip. The production Chromium gate passed all 85 workflows, including the
50-cycle performance case, framework imports, direct manipulation, offline
package reuse, Capsule trust, accessibility, Git history, sharing, and
capability revocation. A submit/menu race found by the first full run was fixed
by locking protected composer actions synchronously; the regression and the
complete final run pass.

The final command results, hosted run, and AXI request/focus inspection are
recorded in the completion commits and the open-issue audit.
