# PR #39 handoff verification — 2026-08-12

## Scope and result

- Pull request: [#39](https://github.com/akua-dev/flect/pull/39)
- Revision: working tree based on `db0c8c0` on `codex/shadcn-ui-system`; the
  final commit and hosted gate are recorded in PR #39
- Host: Apple Silicon macOS, Bun 1.3.14, Chromium 151
- Scope: the PR-description P0/P1 handoff items that can be proved on this
  host, plus the locally discovered product regressions they exposed

This evidence supplements, rather than changes, the immutable AI Elements
baseline in
[`2026-08-12-shadcn-ai-elements-verification.md`](2026-08-12-shadcn-ai-elements-verification.md).

## Proven on this host

| Handoff item | Classification | Public evidence |
| --- | --- | --- |
| Authenticated Pi session | proven | `bun run test:pi-smoke` completed a private App turn and Shaper proposal-command turn. No credentials or model output were recorded. |
| Browser product loop | proven | Production browser inspection opened the deferred workspace, selected an authenticated Pi model, created a session (`201`), and received the bounded `OK` reply to a private prompt. Safe-mode restore returned the protected workspace. |
| Git/recovery continuity | proven | `PATH=/Users/robin/.cargo/bin:$PATH bun run test:desktop:local` passed against a random-ID, ad-hoc-signed bundle: editable first draft, sidecar loss survival, restored draft, one restarted sidecar, and one native window. |
| Session ownership/cancellation | implemented and automated | The established contract suite covers isolated App/Preview/Shaper session slots, Effect-fiber cancellation, pending shell cleanup, and busy conflicts. `bun run check` passed 891 tests with one intentional skip. This is not a substitute for an AgentOS-cluster repeated-workspace run. |
| Deferred-island dependency visibility | proven | `bun run build` emits `islands[0]` in the bundle-gate JSON: sorted entry assets and every measured protected-workspace dependency. The gate continues to enforce the canonical 600 KiB decoded / 200 KiB gzip budget. |

## Regressions found and fixed

1. The normal Astro development origins `localhost:4321` and
   `127.0.0.1:4321` were missing from the server's strict loopback allowlist.
   A real browser therefore received `403 Origin not allowed` when creating a
   session. The allowlist now includes only those two loopback origins, with a
   HTTP-contract regression test.
2. The packaged macOS verifier assumed a fragile nested accessibility-group
   path. It now finds the labelled `Message Flect` text area by its public AX
   role and name, and the entire isolated recovery flow passes again.
3. The controlled composer could accept a stale continuity snapshot after a
   local edit began. Local typing now owns the visible draft for that mounted
   composer; an asynchronous persistence update cannot overwrite it. A
   component regression test covers the race.
4. Protected Flect controls were cramped into the conversation rail. Settings
   now opens as a dedicated full-height workspace: it fills the left canvas at
   wide sizes while the conversation remains on the right, and it takes the
   complete viewport at compact sizes. The close action restores focus to the
   Settings trigger. A component regression test and production-Chromium flow
   verify geometry, compact behavior, and keyboard focus. The workspace also
   exposed an existing low-contrast failed-operation label; its semantic
   background and neutral text now pass the WCAG A/AA audit.
5. The default interface exposed canvas-only actions before a canvas existed.
   The starter state now asks only for the desired outcome, hides selection and
   product-action affordances until a real interface is present, and gives the
   static home page one concrete creation action. The left product surface no
   longer carries a Flect wordmark; Flect remains identified in the agent rail.
   The native drag region is now a clear 64 px strip above the product surface.
   Targeted component and production-Chromium tests cover the starter state;
   the ad-hoc macOS bundle and isolated native lifecycle verifier passed.
6. A generic native-button colour rule could override the primary recovery
   action's foreground token. In one appearance this produced light text on a
   light `Restore interface` button. Primary decision actions now carry the
   intended semantic foreground with matching selector specificity. Production
   Chromium checks every enabled recovery decision action in light and dark
   appearance, runs Axe's WCAG A/AA audit, and measures the rendered text and
   background contrast before and during the primary action's hover state.
   The desktop development command now targets Astro's actual loopback dev
   origin (`127.0.0.1:4321`), so the development window automatically reloads
   interface changes instead of waiting for the unused port 5173.

## Host limits and unproven gates

- `xcrun xctrace list templates` reports that `xctrace` is unavailable. This
  host cannot produce the required Instruments launch, first-input, frame-time,
  or INP traces; no native performance claim is made.
- The environment has no AgentOS cluster, no second host, and no Windows or
  Linux target. AgentOS concurrent-workspace ownership, supported-device
  sleep/wake/offline traces, and Windows/Linux matrices remain external gates.
- Manual macOS VoiceOver, trackpad, drag/drop/file-panel, and clean-machine
  distribution evidence remain outside this automated host. Existing issue
  #22 and the supported-device work tracked by #36 remain the owning gaps.

## Required final validation

`PATH=/Users/robin/.cargo/bin:$PATH bun run check:all` completed successfully
on this working tree: 891 Vitest tests passed with one intentional skip, all 86
production Chromium workflows passed, 26 Rust tests passed, and the ad-hoc
macOS application bundled successfully. `bun run test:pi-smoke` and
`bun run test:desktop:local` also passed afterward.

The hosted required quality gate still must pass on the final pushed revision
before merging. Its browser phase supplies the authoritative shared-runner
coverage; this report's live Pi verification deliberately stores no private
transcript.

## Current repair validation

On the working tree containing the recovery-contrast repair, `bun run check`
passed with 893 tests and one intentional skip. The focused production-browser
command `bun run test:e2e -- tests/e2e/accessibility.spec.ts` passed all eight
workflows, including the new light/dark recovery contrast and hover checks.
