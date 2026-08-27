# Contributing to Flect

Flect is early. Changes should strengthen the small protected core and preserve
the browser/native trust boundaries.

## Requirements

- Bun 1.3.14 exactly
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

`prepare` creates or updates an ignored checkout of the exact Effect source
version used by Flect in `.repos/effect`, then verifies the pinned commit. Use
that checkout and the pinned upstream versions listed in `ARCHITECTURE.md`
rather than guessing from older examples. `check:effect` performs the
non-mutating verification and is included in `bun run check`.

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

The check begins with `bun run check:effect`, which confirms that the local
Effect source checkout is at the pinned commit without changing it.

This runs:

1. Biome;
2. TypeScript project checking;
3. Vitest unit and integration tests;
4. Playwright against a production Astro-on-Vite build in real Chromium;
5. Rust formatting and host tests; and
6. a release-mode macOS application bundle build.

The pinned, least-privilege GitHub workflow runs these same commands for
every pull request and every change to `main`, split into independent
parallel jobs for faster feedback: `bun run check` on Linux, the Playwright
suite on macOS, and the Rust checks plus the release-mode bundle build with
its own clean production web build on macOS. A required `Flect quality gate`
summary check always reports and fails unless every job succeeded;
documentation-only pull requests (Markdown, `docs/`, `.agents/`) may skip the
browser and desktop jobs while `bun run check` still runs. Live Pi, Apple
signing, notarization, and other credentialed release proof remain separate
authorized gates; the public workflow must never silently represent them as
completed.

Playwright uses `FLECT_TEST_MODE=1`, a deterministic in-memory runtime, and no
provider credentials. It covers streamed turns, schema-driven Shaper tool
activity, accept/reject, persistence, rollback, corrupt-journal recovery,
sticky follow, keyboard submission, reduced motion, QuickJS isolation, compact
layout, reserved browser `flect` role policy and shell composition, plus a real
public `flect` process driving the same reactive browser workspace. Unexpected
browser console errors, page errors, and failed local application requests
fail the test.

Unit and integration coverage additionally proves the protected fallback
composer, typed Guardian diagnostic, session close across both transports,
model/refresh lifecycle invalidation, non-destructive busy conflicts in both
directions, the 32-pair runtime bound, strict local-control authentication and
descriptor permissions, concurrent cancellation, token rotation, SSE
decoding, CLI behavior, and MCP protocol interoperability.

After authenticating Pi, verify the real Guardian/Shaper construction:

```bash
bun run test:pi-smoke
```

For a local bundle:

```bash
bun run build:desktop -- --bundles app
bun run test:desktop:local
open src-tauri/target/release/bundle/macos/Flect.app
```

`build:desktop` requests an explicit ad-hoc hardened-runtime signature so the
development bundle is internally valid. `build:desktop:inferred-signing` is
reserved for the release pipeline, where Tauri infers an imported signing
certificate. Do not use the inferred-signing path as a local trust claim.
`test:desktop:local` copies that bundle under a random test-only identifier,
uses the real macOS Accessibility tree to verify actionable clean-profile
setup, hard sidecar loss, private-draft restoration, relaunch, and single-window
ownership, then removes only the isolated test profile and temporary Pi home.
It never consumes a provider credential or the ordinary Flect/Pi profiles.

The application bundle must contain public `flect` and private
`flect-runtime` in `Contents/MacOS`, with no separately shipped command
companions.
After enabling local control from Diagnostics, smoke-test the installed app
through the public executable rather than a private test hook:

```bash
src-tauri/target/release/bundle/macos/Flect.app/Contents/MacOS/flect
src-tauri/target/release/bundle/macos/Flect.app/Contents/MacOS/flect inspect
src-tauri/target/release/bundle/macos/Flect.app/Contents/MacOS/flect mcp
```

See [`docs/local-control.md`](docs/local-control.md).

The local bundle is ad-hoc signed with hardened runtime for development. It is
not a substitute for Developer ID signing, notarization, App Sandbox
entitlement review, independent reproducibility, or clean-machine distribution
testing. `bun run release:package` stages the DMG, checksum, demo MP4, and
release evidence under ignored `dist-release/`; it mounts and verifies the DMG
before succeeding. `FLECT_PUBLIC_RELEASE=1 bun run release:package` fails
closed at every public-trust boundary and must not be bypassed.

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
