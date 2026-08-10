# Open-issue audit — 2026-08-10

This audit maps every open GitHub issue to the tested implementation and the
authority still needed to close it. The implementation is maintained on
`codex/flect-vision-complete` and proposed by
[PR #38](https://github.com/akua-dev/flect/pull/38). Hosted evidence for each
pushed head is authoritative in the PR checks; the implementation
[quality run](https://github.com/akua-dev/flect/actions/runs/31394013331) passed
on commit `ddfe43c`.
The PR has not been merged. A PR-ready status does not mean the change exists
on GitHub `main`.

Status meanings:

- **pr-ready**: the accepted implementation passes local and canonical hosted
  gates on PR #38 and can close through intentional integration;
- **external-gate**: implementation exists locally, but closure requires a
  credential, independent review, repository-policy change, or clean device
  unavailable to the PR workflow; and
- **tracking**: an epic remains open while any required child gate remains.

| Issue | Status | Evidence and remaining gate |
| ---: | --- | --- |
| #1 | tracking | The vision-aligned loop passes locally; #13, #17, #19, #21, #22, #23, #28, #31, and #36 still contain external gates. |
| #5 | pr-ready | Integrity-checked package graphs, bounded extraction, cache reuse, offline rebuild, and provider separation pass source and Chromium tests. |
| #8 | pr-ready | Folder, ZIP, POSIX TAR, and exact immutable Git ingestion feed standard Vite/React through the same isolated build/export path. |
| #9 | pr-ready | Vanilla, React, Vue, and Svelte fixtures use the same Rolldown workspace, capsule, failure, and offline-cache contract. |
| #10 | pr-ready | File/URL installation, review, offline execution, provenance, explicit fork lineage, guarded three-way update/conflict resolution, export, and two-stage uninstall pass. The primary capsule store additionally proves that only strictly bound objects are removed while unrelated workspace and unknown data survive. |
| #11 | pr-ready | Canonical Ed25519 content signing, key validity/rotation/revocation policy, all requested trust states, protected presentation, and unsigned fork lineage pass source and production Chromium tests. |
| #12 | pr-ready | A real Swift/AppKit accent read crosses a fixed C ABI and main-window-only Rust command, then a schema-decoded Effect service and explicit revocable broker grant; browsers receive typed unavailability. |
| #13 | external-gate | ADR 0004 selects user-hosted first and specifies authorities, threats, key lifecycle, protocol, offline behavior, and operations. Pure fixtures cover pairing, reconnect, replay, interruption, revocation, and lost-device recovery. Independent security approval is still required; no listener was implemented. |
| #17 | tracking | The 85-flow production Chromium journey and isolated packaged-macOS setup/recovery gate pass; real provider authorization, VoiceOver, clean distribution hardware, and hosted-CI children remain. |
| #19 | external-gate | A real packaged bundle with an isolated Pi home now exposes one direct recommended provider action, progressive disclosure for the other providers, an editable persistent first draft, and no passive retry dead end. Authentication/model/cancellation/redaction tests pass; a real provider callback and successful clean-profile turn still require external authorization. |
| #20 | pr-ready | The dedicated Apple-Silicon run passes the exact product target at 216 ms cold, 218 ms warm, 4 ms composer p95, and 7,233,416 B retained growth after 50 cycles. Fast 4G with 4× CPU throttling reaches the warmed workspace in 510 ms; LCP is 367 ms on Fast 4G and 1,203 ms on Slow 4G with zero CLS. Shared hosted CI reports against its documented 1,000 ms scheduler ceiling. |
| #21 | external-gate | Browser recovery covers workspace, Git, canvas, conversation, drafts, interruption, stale writers, quota, reload, and offline packages. A random-ID packaged bundle additionally survives hard sidecar loss and restores the exact private draft, one runtime, and one window after app relaunch. Clean-machine accepted-revision/storage-pressure proof remains external. |
| #22 | external-gate | AXE gates, AA contrast, keyboard/focus, light/dark, forced colors, reduced motion, 200% text, 320 px reflow, and compact 44 px protected targets pass. Manual VoiceOver and packaged-host assistive-technology evidence remain external. |
| #23 | external-gate | The final optimized `Flect.app`, private runtime, updater boundary, Swift adapter, ownership-aware setup/uninstall, and ad-hoc signing build locally. Developer ID, notarization, hardened-runtime review, and clean-machine launch require Apple credentials and external hardware. |
| #25 | pr-ready | One embedded-Git canonical workspace supplies automatic accepted checkpoints, simple Undo, retained last-known-good state, conflict rejection, cross-tab serialization, and complete source/history export. |
| #27 | pr-ready | Bounded static HTML/CSS/script/assets import preserves files and attribution, isolates runtime authority, rejects malformed/remote assumptions, and runs offline as a capsule. |
| #28 | external-gate | The five-export `@flect/product` tarball and clean-consumer/reference-product suites pass. Publishing a registry artifact or deploying references was not authorized by the push-only request. |
| #31 | external-gate | The canonical workflow passed on PR #38 in hosted run 31394013331 at commit `ddfe43c`: 888 source tests, 85 production-Chromium workflows, 26 Rust host tests, and the signed-ad-hoc desktop app build. Repository settings currently show no classic protection and no ruleset, so requiring this check on `main` remains an explicit repository-policy change. |
| #32 | pr-ready | One conversation continuously turns local valid edits into the running canvas with last-known-good failure behavior and no Keep/Reject ceremony. |
| #33 | pr-ready | Persistent source/Git/package state, warm typed build boundaries, state-preserving live presentation, offline reuse, and repeated edit-cycle bounds pass. |
| #34 | pr-ready | Bounded revision-bound workspace commands, semantic selected-element context, build/shell diagnostics, protected capability invocation, stale-result rejection, and visible concise tool activity pass. |
| #35 | pr-ready | Protected pointer/keyboard selection, bounded semantic/source/layout context, targeted conversation, move/resize intents, automatic Git checkpoints, and compact accessibility pass. |
| #36 | external-gate | Browser-native URLs, selection, focus, reflow, appearance, touch targets, no-overflow, and interaction budgets pass. The actual packaged AX tree now proves standard macOS menus and controls, the 760 × 560 window clamp, actionable setup, editable draft, sidecar-loss survival, relaunch, and single-window ownership alongside the genuine AppKit adapter. Clean-machine trackpad/VoiceOver/long-session hardware evidence remains external; mobile is not claimed supported. |
| #37 | pr-ready | Astro emits the static activation document while Vite remains the build engine. A custom `client:flect` directive hydrates the Preact-rendered Effect workspace only for prompt, shortcut, or agent actions; CSS is declarative. View-only stays at four requests, the coordinator is 2,365 B gzip / 5,218 B decoded, and the protected pre-tool graph is 190,325 B gzip / 611,858 B decoded. Optional tools remain separate lazy boundaries. |

## Final local gates

- `bun run check`: 166 passed test files, 888 passed tests, one deliberate skip.
- `bun run test:e2e`: 85 of 85 production Chromium workflows passed.
- hosted `Flect quality gate`: run 31394013331 passed the same source/browser
  gates plus 26 Rust host tests and the desktop app build on commit `ddfe43c`.
- `bun run product:package`: 63,559-byte verified package tarball.
- `bun run check:rust`: 26 of 26 Rust host tests passed.
- `bun run build:desktop -- --bundles app`: final ad-hoc signed app bundle built.
- `bun run test:desktop:local`: isolated real-bundle setup, native-window,
  sidecar-loss, and relaunch proof passed.
- `chrome-devtools-axi`: static-only view graph, focus with zero added requests,
  activation-only workspace and CSS, no overflow or clean-run console output,
  and 100/100 Accessibility, Best Practices, SEO, and Agentic Browsing scores.

Issues must not be closed merely to make the list empty. PR-ready issues can be
closed through intentional integration of PR #38. External gates close only
when their required independent evidence exists.
