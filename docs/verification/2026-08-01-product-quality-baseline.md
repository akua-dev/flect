# Flect product-quality baseline

Date: 2026-08-01
Contract: `docs/product-quality.md`
Release class evaluated: local developer-preview worktree
HEAD: `32d20f5dcb82af6cd53db9188bb029dd0d4012e4` (`v0.2.0`)
Worktree: `codex/flect-self-contained-shaper`, substantially modified and
uncommitted; results describe this local snapshot and are not release evidence
for the tagged commit by themselves
Host: macOS 26.5.2 (25F84), arm64
Browser: Playwright Chromium 1.62.0
Live provider use: `bun run test:pi-smoke` only; no credentials or provider
content captured

Editorial correction on 2026-08-02: combined range rows were split so each of
the contract's 188 identifiers has exactly one explicit maturity row. The
historical maturity judgments were not re-evaluated or promoted by that
correction; later implementation evidence remains in later dated reports.

## Verdict

The current worktree is a healthy protected vertical slice, not the complete
Flect destination. Its current browser, Effect, AXI, role isolation, revision,
recovery, Markdown, responsive-shell, extension-opt-in, and macOS bundle claims
have substantial automated evidence. The full credential-free gate and private
Pi smoke pass.

The largest destination gaps are intentional and already disclosed in the
README: in-Flect provider login; warm candidate **Use ↔ Shape** testing;
Git-backed agent-shell filesystems; project import/round-trip; portable `.flect`
capsules; complete product/API capability adapters; portable extension
distribution; broader native hosts; collaboration; notarized distribution;
and stable ecosystem contracts.

No absent destination capability is treated as a failed current-release test.
It remains `unimplemented` until observable behavior exists.

## Evidence executed

### Dependency and baseline gate

```text
bun install --frozen-lockfile
  passed; 506 installs checked, no changes

bun run check
  Effect checkout cccd029ae0124a33254b4094f1bc9c06cd43324e verified
  Rifty dependency and license policy passed
  generated Flect operator Skill drift check passed
  Biome passed
  TypeScript passed
  Vitest: 80 files passed, 1 intentionally skipped;
          438 tests passed, 1 intentionally skipped
```

### Complete credential-free gate

`bun run check:all` exited `0`:

- all baseline checks above passed;
- Playwright: 17 production-Chromium workflows passed;
- Rust: 18 tests passed;
- production browser and private sidecar builds passed;
- the Tauri release application bundled successfully; and
- ad-hoc code signing completed, while notarization was explicitly skipped
  because no release notarization credentials were configured.

Chromium covered the pinned browser execution substrate, browser Bun,
role-bound embedded AXI, proposal authority, visible product actions, manual
scroll preservation, blank-workspace shaping, AA composer qualifiers,
Keep/Reject/rollback, separate histories, sanitized Markdown, model search,
rail resize/collapse/focus, compact sheets, safe mode, promptless products,
keyboard shaping, reduced motion, and outside-agent reactive control.

### Live Pi and packaged host

```text
bun run test:pi-smoke
  passed with a private Guardian/Shaper pair

codesign --verify --deep --strict <built Flect.app>
  passed
```

The freshly built app opened. Its bundle contains exactly two arm64 Mach-O
executables: public `flect` and private `flect-runtime`. Calling public
`flect inspect` while outside control was disabled failed safely with
`unavailable` and instructed the user to enable Local control in Diagnostics.
No control grant was exposed or enabled during this baseline.

Prior dated evidence used where still applicable:

- `2026-07-31-chat-markdown-verification.md`;
- `2026-07-31-embedded-axi-verification.md`;
- `2026-07-31-observable-control-verification.md`; and
- `2026-07-31-t3code-design-ux-audit.md`.

## Criterion classifications

### FQ-01 Installation and first run

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-01.1 | partial | macOS bundle, verified DMG/checksum/evidence flow, exact arm64 inventory, and strict ad-hoc hardened-runtime signature exist; Developer ID, notarization, and independent clean-machine install remain absent. |
| FQ-01.2 | proven | Production Chromium workflows run the browser UI without the desktop application; the documented local runtime remains required for Pi-backed use. |
| FQ-01.3 | unimplemented | Provider login still requires entering Pi outside Flect. |
| FQ-01.4 | proven | Live Pi smoke uses the approved Pi authentication owner without copying provider credentials into browser state. |
| FQ-01.5 | partial | Documentation explains boundaries; the complete locations and data-flow explanation is not present in-product. |
| FQ-01.6 | partial | Manual DMG install and removal are documented; automatic update, migration, and complete uninstall evidence are absent. |
| FQ-01.7 | proven | Blank-workspace Shaper and protected schema UI run without a product backend in Chromium. |

### FQ-02 Immediate comprehension

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-02.1 | implemented | The blank invitation and composer exist; no first-time usability study proves independent comprehension. |
| FQ-02.2 | proven | Browser tests distinguish blank, candidate preview, Keep/Reject, and accepted Run states. |
| FQ-02.3 | partial | Edit/Shaper and Run/App Agent are explicit, but the proposed candidate **Use/Shape** target does not exist. |
| FQ-02.4 | proven | Preview decisions and accepted Run state remain visually and behaviorally separate. |
| FQ-02.5 | partial | Model and role are visible and Diagnostics exposes control state; the complete capability/workspace summary is not yet one coherent surface. |
| FQ-02.6 | implemented | The protected product shell avoids IDE chrome; direct first-time-user proof is absent. |

### FQ-03 Conversational shaping

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-03.1 | proven | Blank shaping, validated proposal, preview, and live private Pi construction pass. |
| FQ-03.2 | partial | Schema validation bounds output, but semantic preservation of unrelated interface behavior lacks a representative prompt suite. |
| FQ-03.3 | partial | Edit currently routes submitted text to Shaper; prior dogfood showed a question could trigger a proposal. No conversational intent tool is implemented. |
| FQ-03.4 | implemented | Shaper returns summaries and validation feedback; explanation quality lacks experience evidence. |
| FQ-03.5 | implemented | Shaper session and revision context persist within the running workspace; extended follow-up and restart evidence is incomplete. |
| FQ-03.6 | partial | The protected actions menu accepts a bounded plain static-site directory; general prompt attachments and framework-project context remain open. |
| FQ-03.7 | partial | Protected interface actions share the controller, but direct-manipulation authoring is not shipped. |
| FQ-03.8 | partial | External Shaper Pi extensions are role-scoped and opt-in; portable sandboxed authoring extensions are not complete. |

### FQ-04 Fast Shape–Use testing

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-04.1 | proven | Candidate UI preview is exercised in production Chromium. |
| FQ-04.2 | unimplemented | There is no candidate-bound Preview App Agent that remains warm beside Shaper. |
| FQ-04.3 | unimplemented | There is no warm in-workbench **Use ↔ Shape** transition. |
| FQ-04.4 | partial | Run and Edit preserve separate history, draft, and scroll state, but not the proposed co-resident workbench targets. |
| FQ-04.5 | unimplemented | Candidate product extensions cannot yet be exercised before acceptance. |
| FQ-04.6 | unimplemented | No typed failure and candidate-context handoff to Shaper exists. |
| FQ-04.7 | unimplemented | Automatic visible target selection and immediate override are absent. |
| FQ-04.8 | implemented | Explicit mode and protected acceptance limit current mistakes, but the future automatic-target path has not been built or adversarially proven. |

### FQ-05 Product usage

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-05.1 | proven | Accepted schema UI and visible actions remain usable without an active model turn. |
| FQ-05.2 | proven | App Agent uses a separate session, instructions, active tools, and role-owned sandbox. |
| FQ-05.3 | partial | Typed projected interface actions and registered, capsule-scoped product HTTP operations work through Capsule and App Agent paths. GraphQL, events, databases, and native product adapters remain open. |
| FQ-05.4 | proven | Tool activity, phase, duration, output, and failures render in the role timeline. |
| FQ-05.5 | proven | The protected Flect composer remains present even when shaped UI omits a prompt node. |
| FQ-05.6 | proven | Pi model discovery, search, favorites, and explicit selection are tested. |
| FQ-05.7 | partial | Product-owned operation registration and HTTP origin/path/method/header/byte/deadline policy are enforced outside capsules, with private credential injection and redacted evidence. A complete product-authentication experience and privileged native credential transport remain open. |

### FQ-06 Preview, acceptance, and recovery

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-06.1 | proven | Candidate preview is distinct from accepted state. |
| FQ-06.2 | partial | Users see the candidate but do not yet receive a source/Git diff or complete meaningful-change comparison. |
| FQ-06.3 | proven | Keep and Reject are protected controller actions covered in Chromium. |
| FQ-06.4 | partial | Revision list, rejection, rollback, and last-known-good work; complete comparison and redo do not. |
| FQ-06.5 | implemented | Revisions and operations carry identifiers and timestamps; Git authorship is not yet available. |
| FQ-06.6 | proven | Deterministic last-known-good recovery remains independent of model availability. |
| FQ-06.7 | proven | The compiled safe-mode path remains independent of shaped UI. |
| FQ-06.8 | implemented | Role extension enablement can be disabled and recovery remains protected; injected extension-failure dogfood is incomplete. |
| FQ-06.9 | proven | Corrupt journal, invalid candidate, rejection, and rollback tests preserve accepted state. |

### FQ-07 Git-backed ownership

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-07.1 | proven | Accepted interface source and validated snapshots are commits in an ordinary Git repository persisted through OPFS. |
| FQ-07.2 | partial | Bundled Wasm/libgit2 Git runs in production Chromium without system Git; the same behavior has not yet passed packaged-macOS restart/offline dogfood. |
| FQ-07.3 | partial | Canonical history uses ordinary branches, commits, refs, conflicts, and reset. Shaper has unshadowable inspection plus guarded status/add/commit/restore; accepted source round-trips through an exported repository. Patch-producing diff remains open because the pinned browser engine emitted no patch under proof. |
| FQ-07.4 | proven | Accepted and proposal refs are distinct, guarded, and covered by real-browser persistence and stale-writer tests. |
| FQ-07.5 | partial | UI and AXI expose bounded ref status and complete repository export; native Git opens and verifies it, but continuation and round-trip import remain unproven. |
| FQ-07.6 | partial | Conflicts, interrupted partial writes, stale refs, and typed failures fail closed; complete user repair actions and adversarial corruption/quota coverage remain open. |
| FQ-07.7 | partial | Protected activation receipts stay outside user-controlled Git and `.git` is hidden from file APIs; imported user-repository ownership is not yet in scope. |

### FQ-08 Import and export

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-08.1 | partial | The public directory chooser supports bounded static sites and standard single-entry Vite JavaScript/TypeScript/React projects. Vue/Svelte, multi-page/routing, archive/Git input, and the complete advertised framework matrix remain open. |
| FQ-08.2 | partial | Import validates paths and a versioned compatibility report before candidate mutation and excludes unsupported or secret-shaped inputs, but the complete dependency compatibility matrix remains open. |
| FQ-08.3 | partial | Chromium proves static, Vite TypeScript, and React JSX behavior with local CSS and cached dependencies; broader routing, styling, asset, and state compatibility remains open. |
| FQ-08.4 | partial | Recognizable source is preserved in embedded Git and exact guarded proposals compile without executing Vite config or package scripts; broader framework maintainability evidence remains open. |
| FQ-08.5 | proven | The current closed interface source and complete Git history download as an ordinary tar repository that passes native Git verification. |
| FQ-08.6 | proven | Exported source and Git history open without a proprietary Flect service. |
| FQ-08.7 | implemented | Malformed `.flect` input and preflight-unsupported Vite plugins fail safely without activation; restricted build failures reject the new proposal while accepted and last-successful state remain available. A broader adversarial framework-import recovery matrix remains open. |

### FQ-09 Portable `.flect` applications

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-09.1 | proven | Real Chromium exports and imports a deterministic bounded capsule without a proprietary hosted service. |
| FQ-09.2 | proven | The installed capsule runs from verified archive content without its original build tool or registry. |
| FQ-09.3 | proven | Strict manifest decoding, SHA-256 payload verification, and protected provenance, contents, compatibility, signature-presence, and capability review precede activation. |
| FQ-09.4 | proven | Compiled HTML runs in an opaque-origin network-denied iframe behind a bounded typed MessageChannel; real Chromium proves interaction, escape denial, message abuse containment, disposal, acceptance, and safe-mode bypass. |
| FQ-09.5 | partial | Accepted archives persist and export byte-identically, but a complete user-facing personal fork workflow is absent. |
| FQ-09.6 | partial | Same-ID update comparison preserves the accepted archive until Keep, but compatible upstream merge and personal-lineage handling are absent. |
| FQ-09.7 | partial | Browser and desktop share the capsule codec and fixture contract; equivalent packaged-host persistence and framework-runtime proof remains open. |

### FQ-10 Extensions

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-10.1 | partial | Outside Pi extension loading is explicitly enabled per role; complete per-workspace portable grants are not present. |
| FQ-10.2 | proven | App Agent and Shaper use separate session and resource-loader policies. |
| FQ-10.3 | partial | Role opt-in is explicit, but complete granular permission review before activation is absent. |
| FQ-10.4 | partial | Role isolation exists, but comprehensive proof that external Pi extensions cannot reach credentials or unrelated product data is incomplete. |
| FQ-10.5 | partial | Disable exists; inspect, update, pin, fork, and remove workflows are incomplete. |
| FQ-10.6 | implemented | Protected startup and Guardian boundaries exist; a comprehensive broken-community-extension matrix remains missing. |
| FQ-10.7 | unimplemented | Portable extension sharing with inspectable trust is not shipped. |
| FQ-10.8 | unimplemented | Extension compatibility and migration recovery UX is not shipped. |

### FQ-11 Sandbox and capabilities

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-11.1 | partial | Closed interface documents, disposable QuickJS logic, static compiled capsules, and restricted Vite/React bundles run in an opaque network-denied frame with real-browser tests. Named product HTTP effects now cross a typed, scoped, revocable broker; broader frameworks and non-HTTP/native capabilities remain open. |
| FQ-11.2 | proven | Role-owned browser Bash, reserved Bun-compatible commands, denial of host/native execution, and role-bound AXI are tested. |
| FQ-11.3 | partial | Canonical Git, each isolated just-bash role mirror, content-addressed compiled-capsule bindings, and content-addressed restricted-build artifacts use browser-native OPFS in production Chromium, including role-file, compiled-capsule, and verified build-artifact page-restart proof. Packaged-WebView persistence and explicit degraded-memory UX remain open. |
| FQ-11.4 | partial | Current model, control, revision, shell, interface, and product HTTP effects are typed. General SQL, event, file, and native brokerage remains future work. |
| FQ-11.5 | partial | Existing control and product HTTP capabilities are inspectable and bounded, but the complete least-privilege and revocation model for future capability families is absent. |
| FQ-11.6 | proven | Shaped state and role commands cannot self-grant control, accept outside authority, or replace recovery. |
| FQ-11.7 | proven | Credential-shaped fields, logs, errors, APIs, and control grants have redaction and closed-schema coverage. |
| FQ-11.8 | proven | Session registry, journal, output, QuickJS, pending command, frame, and cancellation bounds have tests. |
| FQ-11.9 | proven | README and trust model explicitly distinguish defense-in-depth browser realms from OS sandboxes. |

### FQ-12 Models and authentication

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-12.1 | unimplemented | Login still occurs in Pi outside Flect. |
| FQ-12.2 | proven | Authenticated discovery, search, favorites, selection, and private live construction pass. |
| FQ-12.3 | implemented | Public failures are redacted and model unavailability is typed; complete in-product reauthentication is absent. |
| FQ-12.4 | proven | Model change and session lifecycle invalidation are tested without merging role histories. |
| FQ-12.5 | unimplemented | No complete user-facing reasoning-effort control exists. |
| FQ-12.6 | proven | Pi remains behind the private runtime and credentials do not enter browser state. |
| FQ-12.7 | unimplemented | Product-provided inference/adoption is not shipped. |
| FQ-12.8 | proven | Safe mode and deterministic rollback do not require a model. |

### FQ-13 Agent transparency

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-13.1 | proven | Role and authority are explicit in the composer and histories. |
| FQ-13.2 | proven | Activity cards distinguish tool execution from assistant prose. |
| FQ-13.3 | proven | Activity cards expose queued, running, completed, failed, and cancelled lifecycle states. |
| FQ-13.4 | proven | Activity cards expose duration, bounded output, exit status, and disclosures. |
| FQ-13.5 | partial | Typed public errors and diagnostics exist; not every live Pi failure has a verified user recovery action. |
| FQ-13.6 | implemented | Infrastructure is kept behind activity and Diagnostics disclosures; direct experience evidence is limited. |
| FQ-13.7 | proven | Sanitized GFM, safe links, contained tables/code, copy/wrap, fallback, and compact behavior have dedicated verification. |
| FQ-13.8 | proven | Sticky follow, unread jump, role-specific position, and focus preservation pass in Chromium. |

### FQ-14 External agent control

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-14.1 | proven | Public AXI inspects and operates the live workspace through the shared controller. |
| FQ-14.2 | proven | Browser App Agent and Shaper receive the applicable role-bound embedded AXI language. |
| FQ-14.3 | proven | JSON/SSE, MCP, native transport, and browser adapters converge on the same reactive controller state. |
| FQ-14.4 | proven | Authorized external actions update the visible interface reactively without reload. |
| FQ-14.5 | proven | Outside clients can inspect bounded logs and cancel owned work through public surfaces. |
| FQ-14.6 | proven | Role authority, schema validation, protected acceptance/recovery, authentication, and denial paths fail closed. |
| FQ-14.7 | proven | Control is UI-enabled only, bearer-authenticated, rotating, bounded, and immediately revocable; the fresh app rejected inspection while disabled. |
| FQ-14.8 | proven | Browser roles use the in-process reserved `flect` command without an installed companion binary. |

### FQ-15 Performance and responsiveness

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-15.1 | implemented | App and production build launch, but no documented startup budget is gated. |
| FQ-15.2 | unimplemented | Warm candidate **Use ↔ Shape** does not exist. |
| FQ-15.3 | implemented | Typing behaves in current Chromium scenarios; representative concurrent-agent and build latency budgets are not measured. |
| FQ-15.4 | implemented | Streaming and sticky-follow behave in current Chromium scenarios; representative frame-smoothness budgets are not measured. |
| FQ-15.5 | implemented | Bounded output and long Markdown conversations render in current Chromium scenarios; long-session responsiveness budgets are not measured. |
| FQ-15.6 | partial | Browser build and preview work, but explicit incremental-rebuild evidence is absent. |
| FQ-15.7 | implemented | Many resource bounds exist; long-duration aggregate budgets are not measured. |
| FQ-15.8 | proven | Concurrent cancellation, activity finalization, browser UX, and public AXI cancellation are verified. |
| FQ-15.9 | unimplemented | No repeated-session memory regression gate exists. |

### FQ-16 Reliability

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-16.1 | proven | Accepted revision persistence, corrupt-journal recovery, last-known-good behavior, and strict reconstruction of persisted compiled-capsule bindings have tests. |
| FQ-16.2 | implemented | Production Chromium restores isolated accepted-Use, candidate-Use, and Shape drafts plus completed App, Preview App, and Shaper conversations. Packaged-host restart evidence remains. |
| FQ-16.3 | implemented | Production Chromium normalizes an interrupted active Shaper turn without partial assistant output or revision corruption; sustained native transport interruption still lacks full host evidence. |
| FQ-16.4 | proven | Revision and proposal transitions prevent early accepted-state replacement. |
| FQ-16.5 | proven | Busy conflicts, controller serialization, generation checks, Web Locks, broker revocation barriers, cancellation races, and a real same-origin stale second tab are tested. |
| FQ-16.6 | partial | Closed schemas and transport errors exist; a complete public host/runtime compatibility UX is absent. |
| FQ-16.7 | proven | Production Chromium injects quota exhaustion, preserves the exact previous record, surfaces protected recovery, and retains valid export/discard paths. |
| FQ-16.8 | implemented | Invalid or incompatible state fails closed, candidate capsule bindings are restored only alongside matching shaping proposals, candidate mismatches discard only candidate continuity, and interrupted turns return to a protected idle path. Accepting an already-restored proposal exposes a pinned Wasm-Git commit edge; migration/native crash proof also remains. |

### FQ-17 Privacy and data ownership

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-17.1 | partial | Workspace state is local and user-controlled; canonical portable ownership/export is not shipped. |
| FQ-17.2 | partial | Documentation names model/runtime boundaries; a complete in-product data-flow view is absent. |
| FQ-17.3 | implemented | No product telemetry is declared and Chromium fails unexpected network requests; no formal telemetry manifest exists. |
| FQ-17.4 | unimplemented | General product connections and personal forks are not shipped. |
| FQ-17.5 | unimplemented | Complete workspace export and deletion workflows are not shipped. |
| FQ-17.6 | proven | Pi owns provider credentials behind the runtime boundary. |
| FQ-17.7 | proven | Operation evidence is bounded, in-memory, correlated, and redacted. |
| FQ-17.8 | partial | Accepted local schema UI and recovery work without inference; complete offline personal tools and portable storage are not shipped. |

### FQ-18 Accessibility

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-18.1 | proven | Keyboard shaping, modal menus, model selection, resizing, collapse/reopen, and sheet escape pass in production Chromium. |
| FQ-18.2 | proven | Preview, menu, sheet, collapse, and reopen focus restoration pass in production Chromium. |
| FQ-18.3 | implemented | One atomic workbench status announces role, candidate, activity/cancel, and recovery state; the packaged macOS AX tree exposes the named workbench controls. VoiceOver was off and was not enabled, so a spoken walkthrough remains residual. |
| FQ-18.4 | proven | Statuses use text and semantics in addition to color. |
| FQ-18.5 | proven | Pinned Axe WCAG 2.2 A/AA audits pass blank, candidate, extension/recovery menu, Diagnostics, model, accepted, safe, dark, light, zoom-equivalent, compact, and forced-colors states. |
| FQ-18.6 | proven | Reduced-motion behavior and its complete text/status fallback pass in production Chromium. |
| FQ-18.7 | proven | A 640 px 200%-zoom viewport equivalent, 320 px layout, 200% root text, internal scrolling, one composer, and zero document overflow pass. |
| FQ-18.8 | proven | Compact controls retain 44 px sizing and Axe's WCAG 2.2 target-size audit passes, including the modal actions surface. |
| FQ-18.9 | proven | Safe mode remains pointer- and keyboard-reachable outside the rail; compact users retain the protected actions route and promptless products retain the composer. |

### FQ-19 Visual and interaction quality

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-19.1 | implemented | The direct T3-derived audit scored 19/20 and dark/light/compact screenshots were reviewed; broader user evidence remains absent. |
| FQ-19.2 | proven | The canvas remains primary and infrastructure stays in compact role activity/Diagnostics. |
| FQ-19.3 | implemented | Familiar controls and major states exist; a complete component-state inventory is not proven. |
| FQ-19.4 | proven | Inline rail and compact sheets were visually inspected at representative widths without overflow. |
| FQ-19.5 | proven | State motion is bounded and reduced-motion behavior passes. |
| FQ-19.6 | proven | Responsive tests preserve one composer, recovery access, viewport containment, and focus. |
| FQ-19.7 | proven | Warm-neutral light and restrained dark appearances follow the system preference through one semantic token system, including dual-theme Markdown syntax. |
| FQ-19.8 | partial | Validated interface documents can shape product presentation, but arbitrary product design systems are not yet portable. |
| FQ-19.9 | implemented | The compiled composer survives omitted prompt nodes; fully shapeable composer/rail packages are future work. |

### FQ-20 Cross-platform behavior

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-20.1 | partial | Browser UI, execution, sandbox, embedded AXI, canonical OPFS/Git, declarative capsule round trips, static assets, and restricted Vite/React build/import/activation are first-class. Broader framework/assets and remote-host behavior remain open. |
| FQ-20.2 | partial | macOS packaging, reopen/focus, private stdio, and public executable work; deeper native Swift/AppKit experience is not present. |
| FQ-20.3 | proven | Browser and Tauri adapters share Effect contracts, RPC, controller, and application state. |
| FQ-20.4 | proven | Current Tauri/Rust host authority enters through narrow typed commands and private stdio. |
| FQ-20.5 | partial | Documentation is honest; not every unsupported platform action has in-product degradation UX. |
| FQ-20.6 | partial | Apple Silicon macOS and browser requirements are documented; Windows, Linux, mobile, and Intel are not supported or fully matrixed. |
| FQ-20.7 | partial | Browser and desktop share the capsule codec and fixture; Chromium proves persisted static and restricted Vite/React capsules. Equivalent packaged-host framework-build/import/runtime proof remains open. |

### FQ-21 Product-team adoption

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-21.1 | partial | Public Effect contracts let adopters register named operations over a least-privilege HTTP adapter without replacing the interface shell. GraphQL, event, database, and native adapters plus a reference product are open. |
| FQ-21.2 | implemented | A validated recommended schema UI can ship; complete capsule/product distribution is absent. |
| FQ-21.3 | partial | Personal accepted revisions are local, but upstream product/fork reconciliation is not shipped. |
| FQ-21.4 | partial | Product-defined HTTP policies remain authoritative over origins, paths, methods, headers, bytes, deadlines, credentials, and available operations; user approval remains separately capsule-scoped and revocable. Product authentication and non-HTTP policy adapters remain open. |
| FQ-21.5 | proven | Shaped UI cannot replace protected composer, safe mode, or recovery. |
| FQ-21.6 | unimplemented | An incremental public adoption SDK is not shipped. |
| FQ-21.7 | unimplemented | Product-team testing, versioning, distribution, and update contracts are not shipped. |
| FQ-21.8 | unimplemented | Stable adopter compatibility and migration contracts are not shipped. |

### FQ-22 Open-source and ecosystem trust

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-22.1 | implemented | The protected core and boundaries are documented, but no maintained complexity budget proves continued smallness. |
| FQ-22.2 | partial | The manifest records source, toolchain, input, artifact, and unsigned-content digests. A two-build comparison found intentional Tauri Isolation Pattern randomness; public mode fails closed until independent reproducibility is proven. |
| FQ-22.3 | partial | Checksums and strict ad-hoc hardened-runtime signatures exist; Developer ID signing and notarization are absent. |
| FQ-22.4 | partial | Interface, control, RPC, extension settings, capsule format, product operations, product HTTP, and durable grant records use closed versioned Effect Schemas. Additional adapter families remain open. |
| FQ-22.5 | partial | Early schemas fail closed, but stable public migration guarantees are not established. |
| FQ-22.6 | proven | Architecture/current behavior, vision/future behavior, README limitations, and trust documentation are explicitly separated. |
| FQ-22.7 | proven | Source browser/native workflows and the protected core require no proprietary Flect service. |
| FQ-22.8 | proven | Apache-2.0 licensing and public repository permit community and commercial use; formal governance can evolve separately. |

### FQ-23 Sharing and collaboration

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-23.1 | partial | Complete local `.flect` experiences can be exported and imported; independent component, theme, workflow, and extension sharing is not shipped. |
| FQ-23.2 | partial | Protected capsule review exposes provenance, compatibility, and requested capabilities, but equivalent review for every shareable artifact class is absent. |
| FQ-23.3 | unimplemented | Compatible upstream reconciliation that preserves personal changes is not shipped. |
| FQ-23.4 | partial | Interface and capability changes are attributable through revisions and Git, but complete team review workflows are not shipped. |
| FQ-23.5 | partial | Export preserves source attribution, but a complete fork contract that cannot create authority is not shipped. |
| FQ-23.6 | unimplemented | Private artifact sharing without public publication is not shipped. |
| FQ-23.7 | partial | Untrusted capsules open in protected review before Keep, but the equivalent safe state for every shareable artifact class is absent. |

### FQ-24 Honest boundaries

| Criteria | State | Evidence or missing proof |
| --- | --- | --- |
| FQ-24.1 | proven | README and Bun compatibility documentation explicitly list supported and excluded execution classes. |
| FQ-24.2 | partial | Static/Vite directory import reports project class, entrypoint, included/ignored files, adaptations, warnings, and build provenance before Keep. Unsupported named Vite plugins fail with a safe portable-build alternative; complete per-feature compatibility and alternative reporting remains open. |
| FQ-24.3 | partial | Vision and trust docs explain CORS/backend/auth limitations; complete in-product explanations are absent. |
| FQ-24.4 | proven | Documentation distinguishes web UI from genuinely native host capabilities. |
| FQ-24.5 | proven | Vision explicitly excludes backend, database, business-logic, and authorization replacement. |
| FQ-24.6 | partial | Browser shell returns bounded unsupported-command results; import/package alternative guidance is incomplete. |
| FQ-24.7 | proven | Trust and README claims identify QuickJS/browser defense-in-depth and deny OS-sandbox equivalence. |
| FQ-24.8 | proven | Current README labels Flect a developer preview and explicitly lists all major unshipped destination capabilities found in this baseline. |

## Release-blocking findings

For the current local developer-preview claim set, the source worktree passes
its credential-free and live Pi verification. It is not ready to replace the
published release because the snapshot is uncommitted and Tauri's current
Isolation Pattern introduces reviewed but unresolved per-build security
randomness. Public packaging rejects unverified reproducibility rather than
masking the difference.

Before a public beta, the highest dependency gaps are:

1. a spoken VoiceOver walkthrough on the packaged macOS app (`FQ-18.3`);
2. explicit native hard-exit/migration continuity evidence (`FQ-16.8`); and
3. trusted signed/notarized clean-machine distribution (`FQ-01.1`, `FQ-01.6`,
   `FQ-22.2`, `FQ-22.3`).

The broader framework matrix, product-capability and extension ecosystem,
cross-platform native proof, adoption, and collaboration pillars remain later
vertical slices required for the complete stable destination.

## Delivery mapping

- [#17](https://github.com/akua-dev/flect/issues/17) owns the public-beta epic;
  [#18](https://github.com/akua-dev/flect/issues/18) through
  [#23](https://github.com/akua-dev/flect/issues/23) own its workbench,
  authentication, performance, reliability, accessibility, and distribution
  slices.
- [#24](https://github.com/akua-dev/flect/issues/24) owns adoption of this
  canonical contract, baseline, agent routing, and evidence discipline.
- [#1](https://github.com/akua-dev/flect/issues/1) owns the complete 1.0
  adaptable-interface epic. Its original children
  [#2](https://github.com/akua-dev/flect/issues/2) through
  [#13](https://github.com/akua-dev/flect/issues/13) own capsules, isolated
  rendering, OPFS authoring, dependencies, capabilities, framework imports,
  sharing, signing, native adapters, and remote-runtime design.
- [#25](https://github.com/akua-dev/flect/issues/25) adds real browser-native
  Git; [#26](https://github.com/akua-dev/flect/issues/26) owns the role-scoped
  extension lifecycle; [#27](https://github.com/akua-dev/flect/issues/27) owns
  plain HTML/CSS import; [#28](https://github.com/akua-dev/flect/issues/28)
  owns the adoption SDK and reference products; and
  [#29](https://github.com/akua-dev/flect/issues/29) owns collaboration.

All items are in the dedicated
[Flect organization project](https://github.com/orgs/akua-dev/projects/8),
which owns live priority, area, dependency order, and status.

This report is the evidence input for GitHub issue and project reconciliation;
it does not duplicate live project status.
