# Flect sharing and collaboration implementation plan

> **For agentic workers:** Execute inline in the existing isolated worktree.
> Every production behavior starts with a failing public test. This task does
> not authorize commit, push, publish, release, issue closure, or remote-state
> mutation beyond an evidence comment on issue #29.

**Goal:** Deliver deterministic, Git-preserving, inactive-by-default sharing,
forking, update, merge, private distribution, removal, and deletion workflows
for all five Flect artifact kinds.

**Architecture:** A public .flect-share contract and trusted source-adapter
contract normalize local, URL, Git, and private sources into a disposable
quarantine. Validated Git objects enter namespaced guarded refs only after a
protected controller decision. Existing capsule, extension, capability,
proposal, and acceptance paths remain the only activation routes.

**Tech stack:** Effect 4.0.0-beta.102, Effect Schema/Context/Layer/Stream/Scope,
TypeScript 7, React 19, OPFS, wasm-git 0.0.17/libgit2 1.9.4, Web Workers, Vitest
with @effect/vitest, Playwright Chromium, Tauri 2/Rust.

**Design:** [Flect sharing and collaboration design](../specs/2026-08-03-flect-sharing-collaboration-design.md)

## Global constraints

- Preserve the frozen pre-change baseline at
  docs/verification/2026-08-03-sharing-collaboration-baseline.md.
- Keep .flect version 1 unchanged; the share envelope is version 1 and
  separately decoded.
- Keep all external/persisted/worker values strict Effect Schema with excess
  properties rejected.
- Never import grants, credentials, conversations, local paths, runtime state,
  recovery metadata, or protected receipts.
- Every source remains inactive until protected review and controller
  acceptance.
- Signature, publisher, product origin, and popularity never create authority.
- Preserve interrupts; map defects/private adapter failures to fixed public
  errors.
- Compose Layers once at the runtime edge. React renders snapshots only.
- No any, casts, namespaces, thrown domain errors, local Effect.provide, system
  Git, host shell, or new background daemon.
- Do not silently resolve Git conflicts or ask a model to merge them.
- Keep exactly one ordinary installed Flect window at final handoff, with Local
  control off.

---

## Task 1: Public share contracts and deterministic archive

**Files:**

- Create: packages/product/src/share.ts
- Create: packages/product/src/share.test.ts
- Create: packages/product/src/host/share-source.ts
- Create: packages/product/src/host/share-source.test.ts
- Modify: packages/product/src/contracts.ts
- Modify: packages/product/src/host.ts
- Modify: packages/product/src/index.ts
- Create: shared/share.ts
- Create: src/sharing/share-archive.ts
- Create: src/sharing/share-archive.test.ts

**Interfaces:**

- Produce ShareId, ShareArtifactId, ShareArtifactKind, ShareRepositoryReceipt,
  ShareArtifactDescriptor, ShareMigration, ShareManifest, ShareSource,
  ShareSourceFailure, PrivateShareSource, PrivateShareSourceRegistry,
  DecodedShareArchive, encodeShareArchive, and decodeShareArchive.
- ShareRepositoryReceipt is a tagged embedded/git union. Embedded names
  repository.tar, sha256, and commit; git names the exact commit.
- A public Git source pins the descriptor commit containing .flect/share.json;
  the Git receipt separately names the exact payload commit, avoiding an
  impossible self-referential commit hash.
- encodeShareArchive accepts one embedded manifest, repository bytes, and
  verified capsule byte entries and returns Effect<Uint8Array,
  ShareArchiveFailure>.

- [x] Write strict public-schema RED cases for every artifact/source variant,
  duplicate IDs and paths, invalid namespaces, excessive artifacts, ambiguous
  migrations, credentials/excess fields, malformed digests/object IDs, and
  embedded-vs-Git receipt misuse.
- [x] Run bunx vitest run packages/product/src/share.test.ts and observe missing
  exports.
- [x] Implement named Schema classes/tagged classes and the public source
  service contracts. Use Schema.decodeUnknownEffect and optionalKey.
- [x] Write archive RED cases for byte determinism, entry order, nested bounds,
  traversal, duplicate/trailing/link/device entries, digest mismatch, capsule
  mismatch, and prohibited state.
- [x] Run bunx vitest run src/sharing/share-archive.test.ts and observe the
  missing codec.
- [x] Implement the normalized ustar codec by extracting only reusable
  low-level bounded tar helpers from the capsule codec; keep capsule and share
  semantic validation separate.
- [x] Run both tests GREEN, build @flect/product, pack it, and verify a clean
  consumer can decode manifest/source contracts without importing Flect
  internals.

## Task 2: Strict repository archive import and quarantine

**Files:**

- Create: src/git/repository-tar.test.ts
- Modify: src/git/repository-tar.ts
- Modify: shared/git-workspace.ts
- Modify: src/git/git-workspace.ts
- Modify: src/git/git-workspace-worker.ts
- Create: src/sharing/share-quarantine.ts
- Create: src/sharing/share-quarantine.test.ts

**Interfaces:**

- Add decodeRepositoryTar(bytes) returning validated file/directory entries
  without links.
- Add GitImportRepositoryRequest/Result and GitInspectShareRequest/Result.
- Add ShareQuarantine Context.Service with inspect(sourceBytes) and
  inspectGit(url, commit), both scoped and returning ShareCandidateMaterial.

- [x] Write repository-tar RED cases for checksum, truncation, path traversal,
  duplicate entries, links/devices, config/index/log sanitization, hooks,
  alternates, worktrees, replace refs, shallow files, submodules, LFS pointers,
  protected refs, invalid object paths, excessive bytes/files, and extra data.
- [x] Run bunx vitest run src/git/repository-tar.test.ts and observe the missing
  decoder.
- [x] Implement a non-throwing Effect decoder with fixed RepositoryArchiveError
  reasons and no private archive text.
- [x] Write Worker/service RED cases proving import uses a fresh namespace,
  exact commit checkout, safe config recreation, reachable bounded tree,
  sanitized corruption failure, interruption cleanup, and no canonical ref
  access.
- [x] Run the focused Git/quarantine tests and observe missing operations.
- [x] Implement the internal Worker operations. Keep fetch/clone/import
  unavailable to agent-run Git commands; only the typed service may invoke
  them.
- [x] Use Effect.acquireRelease for Worker/OPFS lifetime and remove quarantine
  on success, failure, and interrupt.
- [x] Run focused tests GREEN and rerun production opfs-git.spec.ts.

## Task 3: Local, URL, Git, and private source resolution

**Files:**

- Create: src/sharing/share-source-resolver.ts
- Create: src/sharing/share-source-resolver.test.ts
- Create: src/sharing/private-share-source-registry.ts
- Create: src/sharing/private-share-source-registry.test.ts
- Modify: src/lib/runtime.ts
- Modify: src/lib/api.ts
- Modify: src/lib/tauri-transport.ts
- Modify: shared/rpc.ts
- Modify: server/rpc-handlers.ts

**Interfaces:**

- ShareSourceResolver.open(source) returns a scoped Stream of ShareOpenEvent
  ending in ShareCandidateMaterial.
- Private registry register(definition), list, and open(adapterId, reference)
  retain callbacks/credentials only in trusted closures.

- [x] Write RED table tests for local bytes, credential-free HTTPS, explicit
  public Git commit, and named private adapter normalization.
- [x] Add negative RED cases for schemes, credentials in URL, floating Git
  revisions, redirects out of policy, CORS/fetch failure, declared and streamed
  oversize, timeout with TestClock, cancellation, duplicate adapters, private
  callback defect, and secret-shaped sentinel absence from every public value.
- [x] Implement resolver methods with Effect HTTP/Stream facilities and named
  Layers. Public Git delegates only to ShareQuarantine.
- [x] Implement the host registry as a protected Layer; map callback failure and
  Cause defects to one fixed ShareSourceFailure while preserving interrupts.
- [x] Confirm RPC/Tauri frames are unnecessary because private adapters compose
  at the trusted client runtime edge; never serialize a callback, endpoint, or
  credential.
- [x] Run focused tests GREEN and verify browser bundles import no Pi/private
  host implementation.

## Task 4: Deterministic review and installation records

**Files:**

- Create: shared/share-installation.ts
- Create: shared/share-installation.test.ts
- Create: src/sharing/share-review.ts
- Create: src/sharing/share-review.test.ts
- Create: src/sharing/share-installation-store.ts
- Create: src/sharing/share-installation-store.test.ts
- Create: src/sharing/share-signature-verifier.ts
- Create: src/sharing/share-signature-verifier.test.ts

**Interfaces:**

- ShareInstallationRecord binds source/archive/artifact digests and
  base/upstream/fork commits without grants.
- ShareReview deterministically projects origin, compatibility, lineage,
  signature status, file/interface/instruction/extension/capability/dependency/
  migration changes, activation blockers, and safe actions.
- ShareSignatureVerifier returns unsigned, present-unverified, verified, or
  invalid; default live never upgrades unverified signatures.

- [x] Write RED schemas for strict stored records, duplicate artifacts, bad ref
  relationships, prohibited grants/credentials, and corrupted persisted state.
- [x] Write RED review tables for new/update/replacement/fork/conflict, all five
  artifact kinds, each authority-affecting delta, ordered diagnostics, and
  signature status not changing grant requirements.
- [x] Write RED persistence cases for load/save/remove, invalid-record recovery,
  quota failure preserving the prior record, and stable ordering.
- [x] Implement the three focused services with SubscriptionRef for observable
  state and named Layers.
- [x] Prove invalid signatures block while unverified signatures remain
  inspectable and non-authoritative.
- [x] Run Task 4 tests GREEN and rerun capsule, extension, product-adoption, and
  capability contract tests.

## Task 5: Guarded Git fork, update, merge, reject, and deletion

**Files:**

- Modify: shared/git-workspace.ts
- Modify: src/git/git-workspace.ts
- Modify: src/git/git-workspace-worker.ts
- Create: src/sharing/share-repository.ts
- Create: src/sharing/share-repository.test.ts
- Modify: src/lib/git-interface-repository.ts
- Modify: src/lib/git-interface-repository.test.ts

**Interfaces:**

- ShareRepository retains candidate objects, creates guarded namespaced refs,
  forks, prepares fast-forward/merge/conflict/replacement results, rejects
  candidates, snapshots selected artifacts, removes installation refs, and
  deletes only uninstalled share data.
- ShareUpdateResult is a strict tagged union: fast-forward, merged, conflict,
  replacement.

- [x] Write RED tests from real temporary Git fixtures for initial retention,
  fork, personal commit, disjoint upstream merge with two parents, overlapping
  conflict paths, rewritten history replacement, stale expected ref, interrupted
  merge, rejection, restart restoration, and unrelated-ref preservation.
- [x] Add adversarial RED cases for malicious incoming protected refs, object
  corruption, oversized reachable tree, unsafe source path, and candidate
  attempts to move accepted/LKG/authoring refs.
- [x] Implement object import and internal local fetch under the existing Web
  Lock and sole Worker. Agent Git allowlist remains unchanged.
- [x] Implement fast-forward and guarded merge on a detached candidate commit. Persist
  only a clean merge commit; reset dirty/conflicted state before returning a
  conflict result.
- [x] Implement reject/remove/delete with exact namespaced targets and stale
  guards. Deletion refuses installed data and preserves canonical/unrelated
  refs.
- [x] Run Task 5 GREEN, production OPFS Git conflict/export proof, and native
  git fsck on exported representative history.

## Task 6: Protected sharing lifecycle in FlectWorkspaceController

**Files:**

- Modify: shared/control.ts
- Modify: shared/control.test.ts
- Modify: src/lib/workspace-controller.ts
- Modify: src/lib/workspace-controller.test.ts
- Modify: src/lib/workbench-state.ts
- Modify: src/lib/workbench-state.test.ts
- Modify: src/lib/runtime.ts

**Interfaces:**

- Add source-open, candidate-reject, retain, fork, prepare-update, activate,
  remove, delete, and export action/result schemas.
- Extend FlectWorkspaceSnapshot with bounded share installations and one
  optional inactive ShareReview.

- [x] Add controller RED tests showing every semantic adapter reaches one
  action, accepted state stays usable during review, App Agent cannot retain/
  fork/activate/delete, Shaper can request bounded conflict resolution but
  cannot Keep, and user/external actions recheck source authority.
- [x] Add RED recovery tests for cancellation, stale refs, invalid persisted
  candidate, crash points around object/ref/record creation, quota failure,
  controller restart, safe mode, and removal/deletion scope.
- [x] Implement the Effect workflows with Effect.fn, services acquired from the
  runtime environment, SubscriptionRef publication, structural error recovery,
  and operation-journal redaction.
- [x] Route experience activation through existing capsule proposal, source
  artifacts through guarded proposal roots, and extension activation through
  candidate catalog/test gates.
- [x] Prove required grants, extension tests, compatibility, migration, and
  signature blockers are rechecked inside the controller.
- [x] Run controller/workbench/continuity/capability/extension tests GREEN.

## Task 7: AXI, HTTP/SSE, MCP, and embedded Bash convergence

**Files:**

- Modify: src/axi/command.ts
- Modify: src/axi/command.test.ts
- Modify: src/axi/program.ts
- Modify: src/axi/program.test.ts
- Modify: src/shell/flect-command.ts
- Modify: src/shell/flect-command.test.ts
- Modify: server/control-broker.ts
- Modify: server/control-broker.test.ts
- Modify: server/mcp-adapter.ts
- Modify: server/mcp-adapter.test.ts
- Modify: docs/local-control.md
- Regenerate: .agents/skills/flect/SKILL.md

**Interfaces:**

- Add flect share list, inspect, open-url, open-git, reject, and export.
- Protected retain/fork/merge/activate/remove/delete remain controller actions
  with role/source authorization and stable AXI exit codes.

- [x] Write parser/program RED cases for discovery, TOON/JSON output, exact
  option validation, URL/commit bounds, role denial, private-state redaction,
  stable exits, and cancellation.
- [x] Write convergence RED proving embedded Bash, public HTTP, SSE, MCP, and
  native transport produce the same operation IDs and reactive snapshots.
- [x] Implement commands as real controller actions; do not add a second binary
  or DOM-driving adapter.
- [x] Regenerate the Flect skill and run its check.
- [x] Run focused AXI/control/MCP/embedded tests GREEN.

## Task 8: Protected review interface and accessible actions

**Files:**

- Create: src/components/share-review.tsx
- Create: src/components/share-review.test.tsx
- Create: src/components/share-source-dialog.tsx
- Create: src/components/share-source-dialog.test.tsx
- Modify: src/components/composer-actions-menu.tsx
- Modify: src/components/composer-actions-menu.test.tsx
- Modify: src/components/agent-rail.tsx
- Modify: src/components/agent-rail.test.tsx
- Modify: src/components/role-aware-shell.tsx
- Modify: src/hooks/use-workspace.ts
- Modify: src/styles.css

**Interfaces:**

- ShareReview renders only the strict controller projection and invokes typed
  callbacks.
- ShareSourceDialog collects URL/Git/private opaque references without
  credentials.

- [x] Write component RED cases for each source and lineage state, all review
  sections, signature wording, authority deltas, merge/conflict choices,
  accepted-state prominence, existing-candidate confirmation, removal/delete
  confirmation, and no secret/raw endpoint text.
- [x] Add keyboard/focus/announcement RED cases. Reject stays reachable, focus
  returns to the opener, disclosures do not auto-scroll, forced colors/reduced
  motion retain meaning, and narrow layouts contain every action.
- [x] Implement semantic components using existing tokens and familiar
  affordances. Keep summaries compact; put Git and authority detail in
  disclosures.
- [x] Wire actions through useWorkspace/controller only.
- [x] Run component/accessibility tests GREEN and inspect light/dark snapshots.

## Task 9: Production Chromium end-to-end workflows

**Files:**

- Create: tests/fixtures/sharing/
- Create: tests/e2e/sharing.spec.ts
- Modify: tests/e2e/reset-browser-workspace.ts
- Modify: playwright.config.ts only if a source fixture server route is needed

**Interfaces:**

- Deterministic fixture generator produces initial, compatible-update,
  conflicting-update, malicious, component/theme/workflow, extension, and
  private-adapter shares from real Git histories.

- [x] Write the complete Playwright workflow RED before enabling the UI route.
- [x] Cover export, local file, credential-free URL, public Git exact commit,
  and named private adapter.
- [x] Prove inactive inspection and install for all five artifact kinds.
- [x] Fork and modify a representative experience, merge a disjoint upstream
  update, inspect the two-parent history, reject another candidate, surface a
  real conflict, open Shape, resolve explicitly, and Keep.
- [x] Prove malicious provenance/signature/archive/Git/dependency/capability/
  migration changes fail before execution and preserve accepted state.
- [x] Remove only installed state, export the retained fork, delete only after
  explicit confirmation, reload, and prove unrelated grants/repositories.
- [x] Gate axe, keyboard, 320px/200% reflow, reduced motion, forced colors,
  manual scroll stability, console/page/request/response failures, and secret
  sentinel absence.
- [x] Run sharing.spec.ts GREEN three times, then the complete Playwright suite.

Progress on 2026-08-03: the deterministic real-Git local component workflow is
implemented and passed Chromium three consecutive times. It proves inactive
review, focus and scroll stability, candidate replacement confirmation,
serialized activation/Keep, retained-fork export before and after removal,
independent archive decode, native `git fsck`, explicit irreversible deletion,
reload persistence, axe, 320 px/200% text, reduced motion, forced colors, and
zero console/page/local-request failures.

Expanded progress on 2026-08-03: the fixture generator now reproducibly emits
an initial payload, a parented fast-forward update, a divergent conflict input,
an all-five-artifact share, an invalid archive, a closure-private adapter input,
and a real bare public Git repository with distinct descriptor commits. Real
Chromium now covers local, credential-free HTTPS, exact public Git clone through
wasm-git, and host-composed private sources; inactive five-kind installation;
invalid-archive containment and recovery; and the full fast-forward
review/prepare/preview/Keep/export lifecycle. The expanded seven-test suite
passed three consecutive runs (33.7 s, 34.4 s, and 33.9 s). This also exposed
and fixed wasm-git clone invocation using an unsupported native-Git option and
an unhandled local-file rejection. Fork personalization, clean two-parent
merge, real conflict resolution, the broader adversarial matrix, and the full
Playwright suite were completed by the final evidence recorded below.

Fork/merge progress on 2026-08-03: Shaper's reserved browser Bash now supports
an exact optimistic `flect share checkpoint` that reads bounded sandbox files,
advances only the guarded share fork, updates reactive installation state, and
rolls Git back if record persistence fails. Nested agent commands are scoped to
the exact waiting parent operation so the path cannot deadlock or bypass global
serialization. Production Chromium prompted Shaper to add a disjoint personal
file, rejected the unrelated interface proposal, opened a real upstream update,
prepared and kept the clean merge, exported the result, and proved with native
Git that both files survived, the commit has personal and upstream parents,
`git fsck` succeeds, signatures are cleared, and Local control remains off. The
proof exposed and fixed both candidate export incorrectly returning publisher
objects and a cosmetic two-parent commit whose tree omitted upstream content.
The expanded eight-test sharing suite then passed three complete consecutive
runs (49.5 s, 51.2 s, and 50.6 s). Real conflict Shape resolution, the broader
adversarial matrix, and the complete repository Playwright suite were completed
by the final evidence recorded below.

Conflict-resolution progress on 2026-08-03: a conflicting review now exposes
only Continue with my fork, Open conflict in Shape, and Reject update. Shape
receives an exact role-owned conflict tree with base/fork/upstream versions and
a bounded manifest, and only Shaper can submit `flect share resolve` for every
recorded path against the exact base/upstream/fork commits. The controller
rechecks the conflict and refs, persists an inactive fork candidate, restores it
after restart, and still requires Preview and Keep. Production Chromium proved
the end-to-end path and exported a native-`git fsck`-clean commit with exact
fork/upstream parents and the explicit combined bytes. This proof found that
wasm-git auto-merges the one-line fixture that Flect's deterministic three-way
policy correctly classifies as an overlapping conflict; the protected Worker
now keeps the reviewed portable policy authoritative while still constructing
and verifying the real two-parent Git commit. Repeated sharing, adversarial,
and complete repository gates were completed by the final evidence recorded
below.

## Task 10: Documentation, adoption reference, native dogfood, and evidence

**Files:**

- Create: docs/sharing.md
- Modify: README.md
- Modify: ARCHITECTURE.md
- Modify: docs/capsule-format.md
- Modify: docs/trust-model.md
- Modify: docs/product-capabilities.md
- Modify: packages/product/README.md
- Create: examples/product-sdk/private-sharing.ts
- Modify: examples/product-sdk/reference-products.test.ts
- Create: docs/verification/2026-08-03-sharing-collaboration-verification.md
- Update: this plan

- [x] Document current source classes, compatibility, quarantine, review,
  fork/update/merge, removal/deletion, private adapter, CORS/auth limitations,
  signature non-authority, and unsupported Git features in docs/sharing.md.
- [x] Keep README concise and link to the owner. Update architecture only with
  behavior that exists and passes.
- [x] Add a public-SDK private-adapter reference whose fake credential remains
  closure-private and absent from capsule, Git, diagnostics, logs, DOM, and
  outputs.
- [x] Run focused contract/security/adoption tests, product package clean
  consumer, bun run check:all, cargo fmt --check, and git diff --check.
- [x] Confirm a temporary private-adapter app is not appropriate for the stock
  distribution; dogfood real local-file inactive review/reject through macOS AX
  and prove host-composed private review through Chromium and the public SDK.
- [x] Rebuild the ordinary app, close every prior Flect process/window, move the
  installed app recoverably to Trash, install the exact gated artifact, prove
  source/install hashes/signature truth, and launch exactly one ordinary window
  with Pi ready and Local control off.
- [x] Record exact commands, counts, hashes, screenshots, failures/recovery,
  limitations, dirty/base caveat, and one classification for every criterion
  in scope in the dated verification report.
- [x] Check every plan box only after evidence exists and add an evidence
  comment to issue #29 without closing it. Do not commit, push, publish, or
  release.

## Plan self-review

- Every issue #29 acceptance criterion maps to Tasks 1 through 10.
- Local, URL, Git, and private sources converge before controller mutation.
- Every artifact kind remains inert and reuses an existing activation boundary.
- Real Git lineage and merge commits preserve attribution; conflicts remain
  explicit and model-free.
- Removal and deletion have different scopes and preserve user ownership.
- Signature verification, real-time sync, and public distribution remain their
  owning issues instead of acquiring hidden authority here.
- The plan contains no placeholder implementation step and defines every
  produced interface before later tasks consume it.
