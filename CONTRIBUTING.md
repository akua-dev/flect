# Contributing to Flect

Flect is early. Changes should strengthen the small protected core and preserve
the browser/native trust boundaries.

## Requirements

- Bun 1.4 or newer
- Rust and Cargo
- macOS command-line developer tools for native builds
- a Playwright-supported Chromium installation
- Pi authentication only for the optional live model smoke test

## Setup

```bash
bun install --frozen-lockfile
bun run prepare
bunx playwright install chromium
```

`prepare` maintains an ignored checkout of the exact Effect source version used
by Flect in `.repos/effect`. Use that checkout and the pinned upstream versions
listed in `ARCHITECTURE.md` rather than guessing from older examples.

## Development

Browser plus loopback runtime:

```bash
bun run dev
```

Native Tauri application with its private sidecar:

```bash
bun run dev:desktop
```

Pi owns provider login and credentials:

```bash
bunx pi
# Run /login inside Pi, complete login, then quit Pi.
```

Never add keys to this repository, Flect storage, fixtures, screenshots, logs,
prompts, or command arguments.

## Verification

Credential-free:

```bash
bun run check:all
```

This runs:

1. Biome;
2. TypeScript project checking;
3. Vitest unit and integration tests;
4. Playwright against a production Vite build in real Chromium;
5. Rust host tests; and
6. a release-mode macOS application bundle build.

Playwright uses `FLECT_TEST_MODE=1`, a deterministic in-memory runtime, and no
provider credentials. It covers a streamed turn, model-backed-shaping behavior
through the test Layer, accept/reject, persistence, rollback, corrupt-journal
recovery, keyboard submission, reduced motion, the QuickJS isolation check, and
compact layout. Unexpected browser console errors, page errors, and failed
local application requests fail the test.

After authenticating Pi, verify the real Guardian/Shaper construction:

```bash
bun run test:pi-smoke
```

For a local bundle:

```bash
bun run build:desktop -- --bundles app
open src-tauri/target/release/bundle/macos/Flect.app
```

The local bundle is ad-hoc signed for development. It is not a substitute for
Developer ID signing, notarization, hardened-runtime review, App Sandbox
entitlements, or distribution testing.

## Change expectations

- Read `AGENTS.md`, `VISION.md`, `ARCHITECTURE.md`, `DESIGN.md`, and the
  relevant approved design before changing behavior.
- Read `.agents/skills/effect-ts/SKILL.md` and the routed guide for the Effect
  capability being changed.
- Start behavior changes with a failing observable test.
- Decode unknown values through Effect Schema with excess properties rejected.
- Keep services in `Context.Service`, implementations in named `Layer` values,
  finite work in `Effect`, live events in `Stream`, and acquired resources in
  `Scope`.
- Keep React limited to rendering and ephemeral interaction state.
- Keep browser, Tauri, Rust, Pi, sandbox, and shared-contract responsibilities
  separate.
- Add public errors deliberately; never forward raw provider or process
  failures.
- Test safe mode and last-known-good recovery when changing interface loading
  or shaping.
- Add no native or product capability to the QuickJS realm without a separate
  reviewed threat model and explicit broker.
- Follow the documentation ownership map in `AGENTS.md`: update
  `ARCHITECTURE.md` only when a verified implemented boundary changes, and
  update the owning vision, product, design, trust, decision, or issue source
  for other changes. Never describe planned behavior as implemented
  architecture.
- Preserve unrelated work. Do not commit, push, publish, or mutate external
  systems without current authorization.
