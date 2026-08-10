# Flect Portable Extension Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not delegate because this Flect
> session is constrained to inline execution.

**Goal:** Build a complete role-scoped portable extension lifecycle for
`.flect` capsules, including inspection, candidate testing, activation,
execution, recovery, updates, pins, forks, disablement, removal, browser and
packaged-host proof.

**Architecture:** Strict capsule declarations feed a protected persisted
extension catalog. The controller resolves accepted/candidate and role scope,
then a portable host executes a verified bundle in the existing fresh QuickJS
worker and applies only granted inert intents. Protected UI and the embedded
AXI command both drive the same schema-defined controller commands.

**Tech Stack:** Effect and Effect Schema, React, QuickJS WASM worker isolation,
OPFS/local protected storage, embedded AXI/just-bash, Vitest with
`@effect/vitest`, Playwright Chromium, Tauri/macOS packaging.

## Global Constraints

- Guardian never loads community extensions.
- Portable packages never load as same-process Pi extensions.
- App, Preview App, and Shaper retain separate Pi sessions, extension views,
  conversations, and browser-shell workspaces.
- Capsule declarations contain requests and provenance, never grants,
  credentials, conversations, or mutable lifecycle state.
- Every call is role- and accepted/candidate-binding scoped.
- Runtime code returns only strict inert intents through a fresh bounded worker.
- Expected failures stay typed in the Effect error channel and are matched by
  `_tag`, never `instanceof`.
- No `any`, unsafe assertions, raw JSON trust, host shell, native process, or
  ambient network/storage access.
- Protected fallback, safe mode, accepted state, and last-known-good recovery
  remain independent of package code and models.
- Do not commit, push, publish, or close issue #26 without explicit authority.

---

### Task 1: Define the portable package and lifecycle contracts

**Files:**
- Modify: `shared/extensions.ts`
- Modify: `shared/extensions.test.ts`

**Interfaces:**
- Produces `PortableExtensionPackage`, `PortableExtensionRoleState`,
  `PortableExtensionProjection`, `PortableExtensionFailure`, and pure update,
  grant, compatibility, pin, fork, and conflict rules.

- [x] Write failing strict-schema tests for App, Shaper, dual-role, role
  duplicates, unknown roles, credential-shaped excess fields, invalid semver,
  oversized resources/instructions/contributions, and Guardian absence.
- [x] Run `bunx vitest run shared/extensions.test.ts` and confirm the new
  symbols or cases fail.
- [x] Implement the minimal Effect Schema contracts and pure transition
  functions, keeping the existing inert runtime manifest source compatible.
- [x] Run `bunx vitest run shared/extensions.test.ts` and confirm all cases
  pass.

### Task 2: Embed and verify extension packages in capsules

**Files:**
- Modify: `shared/capsule.ts`
- Modify: `shared/capsule.test.ts`
- Modify: `shared/capsule-fixture.ts`
- Modify: `docs/capsule-format.md`

**Interfaces:**
- Consumes `PortableExtensionPackage`.
- Produces decoded capsules whose declared bundle/source-map paths and SHA-256
  digests are verified before return.

- [x] Add failing codec tests for a valid extension-bearing capsule, missing
  bundle, mismatched digest, duplicate package ID, undeclared source map,
  credential/grant fields, deterministic round-trip, and legacy capsule input.
- [x] Run `bunx vitest run shared/capsule.test.ts` and confirm failures.
- [x] Add optional strict `extensions` declarations and post-decode payload
  verification without executing code.
- [x] Update the canonical capsule-format document with the exact manifest
  contract and trust consequence.
- [x] Re-run the capsule and extension contract tests and confirm they pass.

### Task 3: Persist protected accepted/candidate extension lifecycle state

**Files:**
- Create: `src/extensions/extension-catalog.ts`
- Create: `src/extensions/extension-catalog.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Produces Effect service `ExtensionCatalog` with `snapshot`, `changes`,
  `stageCandidate`, `promoteCandidate`, `rejectCandidate`, `enable`, `disable`,
  `pin`, `fork`, `resolveUpdate`, `remove`, `recordSuccess`, and
  `recordFailure`.

- [x] Write failing Layer-backed tests for accepted/candidate separation,
  strict restore, corruption fallback, explicit role enablement, grant
  intersection, pin/fork conflict behavior, promotion/rejection, removal,
  bounded failures, and reactive changes.
- [x] Run the focused test and confirm the missing service fails.
- [x] Implement the service with Effect `SubscriptionRef`, schema-validated
  protected storage, stable sorting, and named Effect workflows.
- [x] Compose its Layer once at the browser runtime edge.
- [x] Re-run the focused tests and confirm they pass.

### Task 4: Build the role-bound portable extension host

**Files:**
- Create: `src/extensions/portable-extension-host.ts`
- Create: `src/extensions/portable-extension-host.test.ts`
- Modify: `src/sandbox/extension-execution.ts`
- Modify: `src/sandbox/extension-execution.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Produces `PortableExtensionHost.list(role, binding)`,
  `describe(role, binding, id)`, and `call(source, id, input)`.
- Consumes `ExtensionCatalog`, `ExtensionSandbox`, and
  `SandboxCapabilityBroker`.

- [x] Write failing tests proving inactive, wrong-role, wrong-binding,
  incompatible, failed, and ungranted calls never acquire a worker or adapter.
- [x] Add adversarial tests for cross-role data, credential fields, network,
  storage, dynamic evaluation, flood, deadline, memory, stack, input, output,
  and malformed results.
- [x] Implement verified bundle lookup, public input projection, fresh worker
  invocation, capability intersection, typed bounded failure recording, and
  release on interruption.
- [x] Verify repeated failure disables only the offending package role and the
  protected baseline remains callable.
- [x] Run all sandbox and portable-host tests and confirm they pass.

### Task 5: Route extension semantics through the workspace controller

**Files:**
- Modify: `shared/control.ts`
- Modify: `shared/control.test.ts`
- Modify: `src/lib/workspace-controller.ts`
- Modify: `src/lib/workspace-controller.test.ts`
- Modify: `src/hooks/use-workspace.ts`

**Interfaces:**
- Produces strict commands for enable, disable, test, pin, fork, update
  resolution, remove, and call plus an `extensions` projection in the reactive
  workspace snapshot.

- [x] Add failing schema tests showing excess fields, invalid roles/bindings,
  and shaped/capsule sources cannot make protected lifecycle decisions.
- [x] Add failing controller tests for capsule staging, candidate testing,
  Keep gating, promotion, Reject cleanup, accepted-state preservation,
  recovery, update conflict, pin/fork/remove, and operation evidence.
- [x] Implement commands through the controller and catalog; never infer
  binding or role from prompt text.
- [x] Refresh capsule review and workspace snapshots reactively after every
  transition.
- [x] Run focused controller/contract tests and confirm they pass.

### Task 6: Add deferred embedded AXI discovery and invocation

**Files:**
- Modify: `src/axi/command.ts`
- Modify: `src/axi/command.test.ts`
- Modify: `src/axi/program.ts`
- Modify: `src/axi/program.test.ts`
- Modify: `src/axi/gateway.ts`
- Modify: `src/axi/agent-gateway.ts`
- Modify: `src/shell/flect-command.ts`
- Modify: `src/shell/flect-command.test.ts`
- Modify: `.agents/skills/flect/SKILL.md` through the generator

**Interfaces:**
- Produces `flect extensions list|describe|call` for native control and the
  role-bound embedded command, defaulting to bounded TOON.

- [x] Add failing parser/output tests for discoverability, JSON input,
  role-binding, candidate binding, cancellation, stable errors, and bounded
  output.
- [x] Implement AXI commands through the shared controller gateway.
- [x] Prove App cannot discover Shaper packages, accepted App cannot discover
  candidate packages, and environment variables cannot spoof role or binding.
- [x] Regenerate the Flect agent skill and run its currentness check.
- [x] Run focused AXI and shell tests and confirm they pass.

### Task 7: Build protected extension review and management UI

**Files:**
- Create: `src/components/extension-review.tsx`
- Create: `src/components/extension-review.test.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes controller projections and dispatch callbacks only.
- Produces accessible review, test, enable/disable, pin/fork/update/remove, and
  recovery controls in the protected rail.

- [x] Add failing component tests for provenance, roles, compatibility,
  requested/granted capabilities, resources, unsigned trust copy, candidate
  test status, disabled/broken recovery, pin/fork conflict, keyboard names,
  and activation blocking.
- [x] Implement a compact details-based review consistent with `DESIGN.md` and
  existing capsule capability review.
- [x] Ensure visible labels distinguish portable sandboxed packages from
  trusted external Pi extensions.
- [x] Run component and accessibility tests and confirm they pass.

### Task 8: Prove browser lifecycle and adversarial isolation

**Files:**
- Add fixtures under: `tests/fixtures/portable-extensions/`
- Modify: `tests/e2e/flect.spec.ts`
- Create: `tests/e2e/portable-extensions.spec.ts`
- Create: `docs/verification/2026-08-02-portable-extension-lifecycle-verification.md`

**Interfaces:**
- Produces current Contract, Browser, Experience, and Security evidence.

- [x] Create deterministic App, Shaper, dual-role, update, fork, broken,
  incompatible, cross-role, injection, grant expansion, storage, network,
  credential, flood, loop, memory, and oversized fixtures.
- [x] Test install, inspect, enable, candidate call, Keep, accepted call,
  update, pin, fork, conflict resolution, disable, remove, and recovery through
  visible UI and embedded role Bash.
- [x] Verify candidate/accepted and App/Shaper private data never crosses the
  public interface.
- [x] Run production Chromium tests and write exact evidence, failures, and
  remaining limitations in the dated verification report.

### Task 9: Prove packaged macOS recovery and finish the release gate

**Files:**
- Modify only affected canonical docs if observable implementation changes.
- Update: `docs/verification/2026-08-02-portable-extension-lifecycle-verification.md`

**Interfaces:**
- Produces exact packaged-host evidence for the same built artifact delivered
  by the full gate.

- [x] Run focused checks, then a fresh `bun run check:all` from the beginning.
- [x] Build and safely install the exact gated `/Applications/Flect.app`,
  moving any prior app to a recoverable Trash location.
- [x] Keep exactly one Flect window open and Local control off except while
  bounded agent-driven inspection is needed.
- [x] Dogfood App, Shaper, dual-role, candidate testing, Keep, broken-package
  fallback, disable, and accepted-state preservation in the packaged app.
- [x] Record timings, hashes, screenshots, signature/notarization truth, and
  every remaining limitation in the verification report.
- [x] Add exact evidence to issue #26 but keep it open until Git delivery is
  authorized and observable.

## Plan self-review

- Every issue #26 required behavior and acceptance criterion maps to a task.
- The plan keeps external trusted Pi extensions separate from portable
  packages and never gives Guardian community code.
- Candidate/accepted and role isolation are explicit at contract, service,
  controller, AXI, browser, and native proof layers.
- Lifecycle state, grants, and credentials remain outside capsule bytes.
- No placeholder implementation steps or unowned parallel state remain.
