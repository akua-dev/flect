# Shape–Use workbench verification

## Scope

- **Date:** 2026-08-01; completion verification refreshed 2026-08-02
- **Release interpretation:** public-beta workbench slice, not a Flect release
- **Repository:** `akua-dev/flect`
- **Branch:** `codex/flect-self-contained-shaper`
- **Base revision:** `32d20f5dcb82af6cd53db9188bb029dd0d4012e4`
- **State:** dirty, uncommitted implementation work; this is not a reproducible
  release revision
- **Host:** Apple Silicon, macOS 26.5.2 (25F84)
- **Browser:** Playwright Chromium against the production Vite build
- **Toolchains:** Bun 1.4.0; Cargo 1.93.0

This report supersedes only the Shape–Use observations in
`2026-08-01-product-quality-baseline.md`. The frozen baseline remains the
historical before-state. This report does not reclassify unrelated Flect
criteria.

## Result

Flect now has one explicit, protected **Use | Shape** workbench. A validated
candidate is exercised by a separate Preview App Agent with its own Pi session,
conversation, cancellation state, and browser-shell workspace. Shaper remains
warm, corrections atomically supersede the candidate, and accepted state is not
mutated until Keep. App Agent can request an edit only through the typed
`request_interface_edit` seam; normal product questions remain in Use.

The implementation and proof slice is now closed in this dirty working tree.
A production Chromium journey explicitly enables an App extension, loads and
runs a genuine TypeScript Pi extension through Pi's public SDK, observes its
turn failure, exposes only a bounded public event, proves that Shaper did not
inherit it, disables it, and retries successfully. The exact packaged macOS app
was also driven through Shape → candidate Use → sandbox failure → Fix in Shape
→ corrected candidate Use, with rendered switch-latency measurements. This is
still not a release or delivery claim because the implementation is uncommitted.

## Commands and outcomes

### Complete repository gate

```text
bun run check:all
```

Passed after the final implementation changes:

- pinned Effect checkout and Rifty dependency policy passed;
- generated Flect AXI skill was current;
- Biome checked 327 files and TypeScript passed;
- Vitest: 112 files passed, 1 skipped; 618 tests passed, 1 skipped;
- production Chromium: all 59 workflows passed;
- Rust/Tauri: 18 tests passed;
- production browser and private sidecar built; and
- `Flect.app` built and received an ad-hoc signature.

The production performance gate recorded 422 ms interactive startup, 36 ms
worst warm browser target switch, 7 ms composer input, 47 ms model menu, 172 ms
Markdown rendering, 336 ms cancellation acknowledgement, 800,257 transferred
startup bytes, 2,736,989 decoded startup bytes, and 9,111,152 bytes repeated
cycle heap growth.

The build warns that large browser chunks remain and that the app is not
notarized because Apple release credentials were not provided. Neither warning
is hidden or treated as release proof.

### Repeated reload regression

```text
bunx playwright test tests/e2e/flect.spec.ts \
  --grep "keeps a revision" --repeat-each 3
```

All three repetitions passed. The test waits for the public streamed prompt
response to finish before navigation, so a transport abort is not suppressed.

### Live Pi boundary

```text
bun run test:pi-smoke
```

Passed with a private Guardian/Shaper pair using the approved existing Pi
provider state. No provider credential or session capability was captured.

### Genuine extension-isolation proof

```text
bunx vitest run server/pi-extension-isolation.test.ts \
  server/pi-runtime.test.ts src/lib/agent-workspace.test.ts \
  shared/contracts.test.ts
```

All four files and 68 tests passed. The integration fixture is loaded by Pi's
`DefaultResourceLoader`; a real Pi session runs through an in-memory faux
provider; `extensionRunner.onError` observes the thrown `agent_start` handler;
and Flect emits only `external_extension_failed` with a generated failure ID,
role, stage, fixed message, and fixed recovery action. The fixture path, private
error sentinel, and stack are absent from the public contract, activity, and
journal.

```text
bunx playwright test tests/e2e/flect.spec.ts --project=chromium \
  -g "tests a candidate, returns to Shape"
```

The production Chromium workflow passed. It explicitly enabled trusted Pi
extensions for Preview App, exposed the failed **Trusted Pi extension**
activity and **Fix in Shape**, proved Shape still offered **Enable trusted Pi
extensions**, disabled App extensions, and completed the same candidate prompt
successfully.

### Packaged-host Shape–Use dogfood

The prior installed app was quit and moved recoverably to
`~/.Trash/Flect-before-extension-proof-20260802-2129.app`. The exact ad-hoc
signed build was copied to `/Applications/Flect.app`, verified with
`codesign --verify --deep --strict`, and compared recursively with the source
bundle. Installed executable hashes matched the build:

```text
flect          9c3c71f01fa1cb4adfcdc58049e41975291d40c77bb1074f535565982899f9e3
flect-runtime  cc6979d04f09dd9160ac722664fa632e2f27386e7e2e2bac717abf904534bc53
```

The installed app opened with one visible Flect window and Local control off.
Control was enabled through Diagnostics only for dogfood, then the public
bundled `flect` command and visible UI drove this sequence:

1. select `openai-codex/gpt-5.6-luna`;
2. Shape a title-only candidate, producing revision `revision-30` and entering
   candidate Use;
3. make Preview App Bash exit 7, recorded as failed operation
   `operation-4cba4fec-931c-4b2f-95ea-9ea860da59c6` with 51 ms duration;
4. click **Fix in Shape**, which entered Shape with that correlated operation,
   revision, and `Command exited with code 7` summary;
5. recover from one invalid proposal attempt, validate and propose
   `revision-31`, and return automatically to candidate Use; and
6. run corrected Preview App Bash successfully in 30 ms with output
   `native corrected use complete`.

Rendered button-state polling over three warm native pairs measured Shape at
293/247/249 ms and Use at 177/181/243 ms. Every sample met the documented
350 ms budget. Local control was disabled afterward; a fresh control status
failed closed with the documented bounded guidance. Exactly one installed
Flect window remains visible.

After the complete gate, the final bundle containing the corrected failed-tool
journal summary was installed the same way. The dogfooded app was moved
recoverably to `~/.Trash/Flect-before-final-gate-20260802-2144.app`; recursive
comparison and the hashes above prove the final installed app matches the
fresh gate output. The persisted candidate, failure, and corrected Use history
reopened in exactly one window with Local control still off.

## Observable workbench evidence

Contract and integration tests prove:

- strict workbench target, binding, transition-sequence, and handoff schemas;
- blank, accepted, candidate, stale, safe-mode, Keep, and Reject transitions;
- atomic candidate supersede with accepted/candidate preservation on invalid,
  stale, persistence-failed, and cancelled paths;
- separate accepted App, Preview App, and Shaper conversations, Pi session
  handles, cancellation, browser-shell filesystems, and operation evidence;
- candidate session reuse plus disposal on Keep, Reject, model change,
  extension-policy change, refresh, and release;
- simultaneous candidate submission fails as a typed busy conflict without
  affecting accepted App, and candidate cancellation targets only its session;
- Preview App receives App extension policy but never Shaper extension policy;
- App's typed edit request enters Shape with a bounded revision handoff;
- stale revision, nonexistent selected node, uncorrelated failure, and
  caller-supplied failure summary fail closed or are replaced by correlated,
  journal-redacted evidence; and
- Keep/Reject and revision acceptance remain controller/user authority.

Production Chromium proves:

- one mounted composer moves between visible **Use · App Agent** and
  **Shape · Shaper** targets;
- a candidate automatically enters Use under the visible Preview App Agent;
- candidate Use and Shape retain independent drafts and scroll positions;
- warm two-direction switching makes no prompt/shape request and completes
  under the documented 350 ms browser budget;
- ordinary product questions create no proposal;
- the typed edit event visibly enters Shaper and returns a validated candidate;
- a genuinely loaded candidate App Pi extension failure exposes bounded
  **Trusted Pi extension** state and **Fix in Shape**, never loads into Shaper,
  passes correlated failure context, can be disabled, retries successfully,
  returns to candidate Use, and preserves its conversation;
- accepted state remains separate until Keep, and Reject/rollback/safe mode
  continue to work; and
- keyboard, reduced-motion, compact layout, accessible names, focus, contrast,
  Markdown, visible tool activity, and outside AXI reactivity remain green.

## Criterion classification

| Criterion | State | Current evidence and limitation |
| --- | --- | --- |
| FQ-02.3 | proven | Active Use or Shape and agent identity are visible before send in production Chromium and have explicit accessible pressed state. |
| FQ-02.4 | proven | Candidate Preview App, accepted App Agent, Shape, and protected revision decision are visibly distinct. |
| FQ-03.3 | proven | Contract and Chromium workflows prove a product question creates no proposal while a typed edit request enters Shape. |
| FQ-04.1 | proven | A validated candidate renders live and can be exercised before Keep. |
| FQ-04.2 | proven | Contract tests prove separate reused candidate/Shaper sessions; Chromium switching emits no model request and preserves both timelines. |
| FQ-04.3 | proven | Production Chromium completes two warm directions under 350 ms without a model request or repeated setup. |
| FQ-04.4 | proven | Candidate Use and Shape preserve distinct draft, conversation, scroll, revision, and bounded context state. |
| FQ-04.5 | proven | Production Chromium explicitly loads and exercises a genuine App Pi extension against the candidate, observes its bounded failure, and retries after disabling it. |
| FQ-04.6 | proven | Correlated failure, revision, valid selected-node state, and redacted summary cross a strict handoff; stale or invented context fails closed. |
| FQ-04.7 | proven | Post-shape selection is visible and immediately overridable through the same deterministic state machine. |
| FQ-04.8 | proven | No prompt classifier or model router changes target; typed edit requests cannot accept or publish and all revision decisions remain protected. |
| FQ-06.1 | proven | Every unaccepted change remains a labelled validated preview with Keep/Reject controls. |
| FQ-06.3 | proven | Keep and Reject remain protected deterministic controller actions in contract and Chromium evidence. |
| FQ-06.9 | proven | Failed/cancelled/stale supersedes and candidate failures preserve accepted state. |
| FQ-10.1 | proven | Role-specific UI/control state and production Chromium prove trusted Pi extensions are disabled by default and explicitly enabled or disabled per App/Shaper role. |
| FQ-10.2 | proven | Runtime contracts, distinct sessions, browser policy evidence, and the genuine failure journey prove candidate App extensions do not enter Shaper's private session or authority. |
| FQ-13.1 | proven | App Agent, Preview App Agent, or Shaper identity and target are visible before send. |
| FQ-13.2–FQ-13.4 | proven | Browser workflows expose separate queued/running/completed/failed Bash activity, result details, and Fix in Shape recovery. |
| FQ-14.1 | proven | UI and `flect target use|shape` route through the same Effect controller and reactive snapshot. |
| FQ-15.2 | proven | Production Chromium meets the budget without model requests; the installed supported macOS host measured Shape 293/247/249 ms and Use 177/181/243 ms over three rendered warm pairs. |

## Delivery boundary

The behavior and proof required by
[`#18`](https://github.com/akua-dev/flect/issues/18) are complete in the current
working tree. Commit, review, and merge remain required before this can be
called delivered. Broader authentication, performance, reliability,
accessibility, distribution, Git, import, capsule, extension lifecycle,
adoption, and collaboration gaps remain with the project issues mapped by the
frozen product-quality baseline.
