# Portable extension lifecycle verification — 2026-08-02/03

## Outcome

Flect treats community `.flect` extensions as inert, role-scoped portable
packages rather than same-process Pi extensions. Capsule decoding verifies the
package bytes. Protected host state owns review, grants, tests, activation,
pins, forks, accepted/candidate binding, and removal. App Agent and Shaper have
independent activation and authority. Every call starts a fresh bounded QuickJS
worker and passes only strict inert intents to the broker. Guardian never loads
package code.

The protected rail shows provenance, target roles, required and optional
authority, execution ceilings, candidate test state, conflicts, pins, local
forks, safe failures, disablement, and removal. Optional authority begins off.
Every enabled candidate role must pass its worker test before Keep, and the
workspace controller repeats the rule independently of React.

The embedded authenticated AXI surface exposes deferred discovery and calls:

```text
flect extensions list
flect extensions describe <extension-id>
flect extensions call <extension-id> [--input <json>]
```

It exposes no grant command. Role and accepted/candidate binding come from the
authenticated gateway, not shell variables or prompt text. Trusted external Pi
extensions remain a separate, explicitly enabled host-code path.

## Evidence boundary

The implementation is based on Git commit
`32d20f5dcb82af6cd53db9188bb029dd0d4012e4` plus the scoped PR worktree on
`codex/flect-self-contained-shaper`. The evidence below was generated from that
uncommitted worktree on 2026-08-03. It does not claim a commit, push, release,
Developer ID signature, or notarization.

## Automated proof

The focused production-browser command
`bunx playwright test tests/e2e/capsule-frame.spec.ts tests/e2e/portable-extensions.spec.ts`
passed 11 of 11 workflows in 23.6 seconds.

A fresh `bun run check:all` then passed from the beginning:

- Effect checkout and dependency-license checks;
- generated Flect skill and product-quality coverage checks;
- Biome and TypeScript;
- 650 passed and 1 skipped Vitest cases across 115 passed and 1 skipped files;
- 64 of 64 production Chromium workflows in 2.5 minutes;
- 21 of 21 Rust/native tests; and
- a fresh release-mode arm64 `Flect.app` bundle.

The Chromium lifecycle installs a deterministic dual-role capsule, inspects
unsigned provenance and resource ceilings, enables App Agent with required read
authority while leaving optional propose authority off, blocks Keep until the
candidate worker test passes, and calls the package through embedded Bash in
both candidate and accepted bindings. It then disables and removes only App
Agent while leaving Shaper available.

The update workflow accepts version 1.0.0, records a pin and local-fork
revision, stages a broken 1.1.0 update, exposes the conflict, chooses upstream,
and fails the new worker safely. Private thrown detail never reaches public UI,
Keep remains disabled, and Reject restores the accepted product. The accepted
capsule is also restored after a real page reload.

Adversarial workflows prove that network, browser storage, process credential,
21-intent flood, infinite-loop, memory-exhaustion, malformed-message,
oversized-message, and oversized-bundle probes fail closed. Unit proofs also
cover wrong role, wrong binding, inactive, incompatible, capability-denied,
malformed-result, input/output, worker, stale-frame, callback-rerender, and
repeated-failure boundaries.

## Packaged macOS dogfood

The packaged app was driven through the visible protected UI. A dual-role
candidate was reviewed, required read authority was granted separately, App
Agent and Shaper were enabled and tested independently, and Keep became
available only after both tests completed. A broken candidate then entered the
sanitized failed state, disabled Keep, and preserved the accepted baseline.
The failure was rejected. A fresh accepted dual-role revision was tested and
kept, and its capsule presentation survived two subsequent cold launches.

The exact gated bundle replaced the prior `/Applications/Flect.app`; the prior
app was moved recoverably to
`/Users/robin/.Trash/Flect-before-final-gate-20260803-0032.app`. Each final
launch was allowed five seconds, exceeding the frame's two-second ready
deadline. Both showed `Portable product` and
`Accepted baseline remains visible.` with no fallback. The final process had
exactly one window, Pi ready, and Local control off. Local control had been on
only during bounded earlier inspection and was disabled before final evidence.

Native dogfood exposed and fixed four real host defects before this proof:

- an unstyled capsule inherited an unreadable host canvas;
- an unrelated global message could consume a one-shot ready listener;
- changing host callbacks could tear down an authenticated channel; and
- WebKit applied the protected Tauri CSP to inline scripts in `srcdoc`/`data:`
  frames, preventing the bridge from starting.

The final runtime gives every document a fresh 128-bit nonce, keeps the typed
bridge on one bounded `MessageChannel`, holds host callbacks without restarting
that channel, and scopes a failed ready deadline to the failed source. Browser
hosts use a self-contained base64 data document. Tauri serves the same generated
document from a token-bound, no-store in-memory `flect-capsule` protocol because
that lets WebKit run the capsule's own denied-by-default document without adding
`unsafe-inline` to the protected host. The registry accepts at most eight live
documents of at most 16 MiB each and releases the exact token on disposal.

## Installed artifact truth

`rsync -ainc --delete` produced no difference between the gated bundle and
`/Applications/Flect.app`. The 90 MiB app contains four files. Executable
SHA-256 values match between build and install:

```text
flect         304d19e109ac2594a22482ca7bd3dcd562791bd8b3602706ba0e220eef7cd3af
flect-runtime 05be4277fefb453551358649bba50c97b0f74d7f23fe04b05fbddcd206c08abc
```

`codesign --verify --deep --strict` passed. The bundle identifier is
`dev.akua.flect`; it is arm64, hardened-runtime, ad-hoc signed, and has no Team
Identifier. Its full CodeDirectory SHA-256 is
`5515f1347547d5b1d93064b5236b7972e3d98284c291b585286eb2aee5f0cc52`.
`spctl --assess` therefore rejects it and `stapler validate` reports no ticket.
Those are expected truths for this local gate artifact, not a claim of public
macOS distribution readiness.

## Visual evidence

- [Dual-role candidate ready for Keep](assets/2026-08-02-portable-extension-native-review.png)
- [Broken candidate stopped safely](assets/2026-08-02-portable-extension-native-failure.png)
- [Accepted capsule after exact installed-app restart](assets/2026-08-03-portable-extension-native-accepted-restart.png)

## Update and fork truth

Pins and local-fork revision markers persist in protected state and turn a new
package into an explicit conflict. Version 1 does not claim three-way capsule
merging. The honest choices are to use upstream or reject the candidate app
update and retain the accepted fork; the catalog rejects an unresolved
transition.

## Remaining limitations

- Publisher signatures are represented, but identity verification and trust
  stores are not implemented; the UI labels unsigned capsules honestly.
- Portable Extension API version 1 returns only strict inert intents. It does
  not expose arbitrary host APIs, DOM, network, storage, credentials, native
  processes, or ambient shell.
- Package editing flows through Shape and a new verified capsule; version 1 has
  no three-way merge between upstream package bytes and a personalized fork.
- A dual-role package shares one verified source bundle, while role activation,
  grants, conversations, bindings, and workspaces remain separate.
- This local app is not Developer ID signed or notarized. Public macOS release
  packaging remains a distinct distribution step.
- Git delivery is not authorized in this task. Issue #26 remains open until the
  worktree is reviewed and delivered observably.
