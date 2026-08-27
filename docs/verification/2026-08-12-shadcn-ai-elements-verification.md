# Shadcn AI Elements verification — 2026-08-12

## Scope and result

- Pull request: [#39](https://github.com/akua-dev/flect/pull/39)
- Behavior revision: `4511688` on `codex/shadcn-ui-system`
- Host: Apple Silicon macOS, Bun 1.3.14, Playwright Chromium 151
- Scope: the protected conversation, messages, composer, reasoning, tool
  activity, neutral appearance, accessibility, and activation boundary
- Product-quality criteria reviewed: FQ-13.2–FQ-13.8, FQ-15.1–FQ-15.9,
  FQ-18.1–FQ-18.8, and FQ-19.1–FQ-19.7

The affected behavior is implemented and its automated Contract, Browser,
Accessibility, performance, Rust-host, and local packaged-build evidence is
green. This report does not classify the criteria as fully `proven`: the exact
published head still requires the hosted pull-request gate, and the existing
manual VoiceOver and supported-device experience residuals remain open.

The review found that the earlier pull-request head had raised the decoded
protected-client gate from the canonical 600 KiB threshold to 652 KiB. The
final change restores the threshold from `shared/performance-budgets.ts` and
moves the AI Elements conversation timeline behind actual conversation or
activity content. The empty protected composer and model chooser remain
immediately usable; the model chooser was deliberately kept eager after an
experimental deferred version measured 109 ms against the 100 ms interaction
limit.

## Automated evidence

`bun run check:all` produced:

- 889 Vitest tests passed with one intentional skip;
- all 86 production Chromium workflows passed;
- model-menu response of 69 ms;
- cold/warm protected activation of 235/218 ms;
- composer acknowledgement p95 of 4 ms;
- Fast/Slow-4G LCP of 354/1,189 ms with zero CLS and no long task;
- cancellation acknowledgement of 0 ms; and
- 7,752,144 bytes retained across 50 complete cycles, below the 8 MiB
  threshold.

The shell running `check:all` did not include Cargo on `PATH`, so the command
stopped after the complete browser suite. The remaining canonical phases were
then run with the documented toolchain path:

```bash
PATH=/Users/robin/.cargo/bin:$PATH bun run check:rust
PATH=/Users/robin/.cargo/bin:$PATH bun run build:desktop -- --bundles app
```

All 26 Rust tests passed. The release-mode macOS application compiled, bundled,
and received the expected ad-hoc signature. No notarization identity was
present or claimed.

The final production bundle gate reported:

| Boundary | Decoded | Gzip |
| --- | ---: | ---: |
| View-only document | 6,849 B | 2,919 B |
| Activation bootstrap | 4,646 B | 2,199 B |
| Initial CSS | 2,976 B | 1,094 B |
| Deferred workspace CSS | 100,550 B | 17,534 B |
| Protected pre-tool client | 612,799 B | 191,277 B |

The protected client is below the unchanged canonical limits of 614,400
decoded bytes and 204,800 gzip bytes. Shell, compiler, package, Worker, and
Wasm substrates remain separate on-demand boundaries.

The model-menu performance workflow was also repeated three times after the
final eager-control decision. It passed at 47, 58, and 47 ms.

## Limitations and release impact

- The automated browser coverage proves keyboard behavior, focus restoration,
  scroll retention, WCAG checks, reflow, reduced motion, forced colors, and
  light/dark contrast. It does not replace the manual VoiceOver walkthrough
  owned by issue #22.
- The local packaged build proves compilation and ad-hoc signing, not
  Developer ID signing, notarization, clean-machine distribution, or the
  supported-device experience matrix owned by issues #23 and #36.
- The exact pull-request head must receive the required hosted `Flect quality
  gate` before #39 is ready to merge.
