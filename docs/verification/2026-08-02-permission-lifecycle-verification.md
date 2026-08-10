# Permission lifecycle verification — 2026-08-02

## Outcome

Flect implements one protected, Effect-owned product-capability lifecycle for
capsules, App Agent, the compiled UI, and public AXI adapters. Decisions bind an
exact capsule request and approved operation/resource/data intersection; they
support once, session, workspace, persistent, deny, expiry, rate limiting, and
revocation. Product policy remains an independent required authorization.
Expected failures and operation receipts are bounded and payload-free.

Only the protected user source can grant. Paired outside control can inspect
and revoke through `flect permissions`, while capsule code, App Agent, Shaper,
Guardian, extensions, and outside control cannot create authority. The same
inspection and revocation surface remains available in safe mode without Pi.

## Executable proof

`bun run check:all` passed on branch
`codex/flect-self-contained-shaper`, based on Git commit
`32d20f5dcb82af6cd53db9188bb029dd0d4012e4` plus the scoped uncommitted PR
worktree:

- Effect checkout `cccd029ae0124a33254b4094f1bc9c06cd43324e` verified;
- Rifty dependency/license and generated Flect-skill drift checks passed;
- Biome checked 322 files and TypeScript passed;
- 110 Vitest files passed, one skipped; 611 cases passed, one skipped;
- all 59 production Chromium workflows passed in one worker;
- all 18 Rust tests passed; and
- Tauri produced a fresh ad-hoc-signed Apple Silicon `Flect.app`.

The Chromium lifecycle drives the rendered protected UI, shared controller,
and public `flect` command. It proves digest-bound isolation between equal
capability IDs, session and durable decisions, reload expiry, product-policy
denial, atomic rate/once consumption, safe-mode inspection and revocation, and
denial after revocation. The outside-control workflow now also proves that
safe-mode entry and restore each advance the protected Git commit and that the
restored revision survives reload.

## Installed native proof

The exact gate artifact was installed at `/Applications/Flect.app`; recursive
bundle comparison and strict deep code-signature verification passed.
Notarization was not attempted because Apple notarization credentials were not
available. Installed executable SHA-256 values are:

```text
d6841798380f7760995d5840f185b4509144c1fe79c73af9d47a3dc8c73677a3  flect
b404f6c452024ad52977301a61a651f36ac4d22c31696d0317a4f934ae2ba580  flect-runtime
```

Dogfooding used the existing native workspace rather than resetting it. Its
legacy protected snapshot contained a previewed proposal while the activation
receipt claimed no proposal. Flect opened the compiled safe shell, reconstructed
recovery from the protected ref, and **Restore interface** advanced
`flect/accepted` from `fc8627cf286c6bf933cf48fe6ccc0f3bbabe82f1` to
`5caf6c1afcb4300a1d153c5788e5fc3b46cf8978`. The resulting snapshot was not in
safe mode, retained accepted revision `revision-23`, and contained no proposal.
A complete app quit and relaunch returned directly to that restored interface.

This run exposed and fixed a WebKit-only persistence hazard: embedded Git had
relied on a global HOME config for commit identity and could leave dangling
trees while returning an unchanged protected ref. Every embedded repository now
persists its own bounded Flect author identity, and checkpoint rejects an
unchanged ref as corrupt. Exported-Git Chromium proof verifies the local
identity; native recovery verifies a real protected commit advance.

After the final install, public `flect inspect` reported `phase: ready`,
`safeMode: false`, revision `revision-23`, and durable source/capsule storage.
`flect permissions list` returned an empty bounded list, as expected for the
stock composition. One exact main process owned one exact runtime child, and
CoreGraphics reported one on-screen layer-zero Flect window at 1180 × 781.
Local control was disabled again after inspection.

## Deliberate exclusions

The stock distribution registers no product operation, so native dogfooding
does not pretend to invoke one. The public grant/invoke/revoke/deny path is
proved by the production-browser diagnostic composition; a packaged reference
product remains adoption work. GraphQL, resumable event subscriptions,
database and privileged-native adapters, OS-keystore product credentials, and
user-authored custom duration/rate controls are also not shipped. The current
desktop adapter therefore retains the browser's CORS-aware transport boundary.
