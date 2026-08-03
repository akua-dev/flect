# Flect Pi authentication verification — 2026-08-01

## Result

The implemented slice lets browser and packaged-macOS Flect discover Pi
providers, show bounded connection state, start supported login methods,
handle public links/device codes/safe selections, route every free-text prompt
through a one-use private-runtime page, choose model-supported reasoning, and
disconnect with an explicit private-session restart warning. It requires no
terminal bootstrap and creates no Flect credential store.

The slice is **verified with explicit residual gaps**. GitHub issue `#19`
remains open until a clean Pi store completes a real first-time packaged-macOS
login and the remaining production-UI failure/canary matrix is captured.

## Environment

- Date: 2026-08-01
- Host: Apple Silicon macOS
- Pi: `@earendil-works/pi-ai` and
  `@earendil-works/pi-coding-agent` `0.82.1`
- Effect: pinned checkout `cccd029ae0124a33254b4094f1bc9c06cd43324e`
- Browser: Playwright Chromium production build
- Native host: Tauri release `Flect.app`, ad-hoc signed

No provider credential, callback payload, provider-native failure text, or
credential-store contents were captured in this report.

## Observable proof

### Complete repository gate

`bun run check:all` exited `0` after the final UI changes:

- Effect checkout, Rifty license/version checks, generated Flect skill, Biome,
  and TypeScript: passed;
- Vitest: 85 files passed, one intentionally skipped; 483 tests passed, one
  intentionally skipped;
- production Chromium: all 20 workflows passed;
- Rust/Tauri: all 18 tests passed; and
- the private Bun/Pi sidecar and signed-ad-hoc macOS application bundle built.

### Authentication and secret boundary

Focused contracts and adversarial tests prove:

- only bounded provider summaries, supported reasoning levels, safe replies,
  and closed public auth events encode;
- credential-shaped and excess fields fail strict schema decoding;
- auth events, provider state, login identifiers, and URLs are absent from
  `AgentWorkspaceSnapshot`, `FlectWorkspaceSnapshot`, AXI/control state, and
  operation history;
- the auth coordinator orders Pi notifications, limits active logins to four,
  uses a 32-event sliding queue, correlates safe selections, rejects stale
  replies and duplicate logins, cancels scoped work, and expires after ten
  minutes;
- malformed public URLs fail closed without exposing provider copy;
- free-text prompts cross only the protected host as Effect `Redacted` values;
  and
- the protected host binds `127.0.0.1`, uses an unguessable one-use path,
  validates loopback peer/origin/method/media type/body limits, rejects replay,
  cancels/expires, reflects no submitted value, and sends CSP/no-store/
  no-referrer/nosniff/frame/permissions headers.

### Production browser

The deterministic production Chromium workflow completed:

```text
disconnected provider
  -> Connect inside Flect
  -> connected provider
  -> supported High reasoning
  -> Shaper turn
  -> validated interface candidate
  -> explicit Disconnect confirmation
  -> disconnected provider
```

The shaped interface remained visible after sign-out. Component proof also
covers protected-entry navigation without a React credential input, safe
selection correlation, public device-code copying, expired-login recovery
copy, and disconnect confirmation.

### Live Pi and packaged macOS

`bun run test:pi-smoke` passed with a private Guardian/Shaper pair using Pi's
existing approved authentication. No credential data was printed.

The exact signed build was opened from
`src-tauri/target/release/bundle/macos/Flect.app`. Its 1180 × 781 native window
was observed running with the private `flect-runtime` child. Public UI showed
Pi ready, discovered models, supported reasoning controls, and the provider
surface over private stdio. The provider surface was opened through the native
window, not a browser development server.

## Residual proof gaps retained in issue #19

1. The packaged test used an existing approved Pi login. A clean temporary Pi
   credential store has not completed a real provider login through the native
   UI without disturbing the user's actual provider state.
2. Coordinator/component tests cover cancelled, expired, malformed,
   unavailable, unsupported, and generic provider failure behavior, but the
   complete matrix has not yet been repeated as production Chromium UI flows.
3. Secret canaries are proven at contracts, coordinator, protected host, and
   snapshot boundaries. One real provider callback/credential canary cannot be
   synthesized safely without a dedicated fake Pi provider accepted by the
   packaged runtime.
4. Native UI was visually exercised and live Pi completed a private turn, but
   a fully automated packaged-WebView first-run login-to-turn harness does not
   yet exist.

These gaps limit the proof claim; they do not weaken the implemented boundary
or justify copying credentials into React, Tauri IPC, AXI, extensions, or test
fixtures.
