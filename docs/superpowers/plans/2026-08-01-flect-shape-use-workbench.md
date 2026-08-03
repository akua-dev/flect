# Flect Shape–Use Workbench Implementation Plan

> **Execution:** Use the repository's executing-plans, Effect, TDD, frontend,
> accessibility, and verification guidance. Preserve unrelated work and do not
> commit, push, publish, or release without explicit authority.

**Goal:** Deliver a warm, explicit Use–Shape workbench in which users can test a
candidate through an isolated Preview App Agent, revise it through Shaper, and
Keep or Reject it through the protected kernel.

**Architecture:** `FlectWorkspaceController` owns a schema-validated workbench
state and typed commands. `AgentWorkspace` owns separate accepted and candidate
session handles and conversations over the shared Pi model/auth runtime.
`ShapingKernel` atomically supersedes validated candidates. React renders one
composer and explicit target selector; no model routes intent or owns revision
authority.

**Primary quality criteria:** `FQ-02.3`, `FQ-03.3`, `FQ-04.1`–`FQ-04.8`,
`FQ-13.1`, `FQ-15.2`.

**Execution status (2026-08-01):** Tasks 1–5 and the contract/browser portions
of Task 6 are implemented and pass the repository gate. The packaged macOS app
builds and launches, but a public native Shape–Use walkthrough and a real
candidate Pi-extension failure remain unproven. Issue `#18` therefore remains
open; the dated verification report owns the exact evidence and limitations.

---

### Task 1: Workbench contracts and state transitions

**Files:**
- Modify: `shared/control.ts`
- Modify: `shared/control.test.ts`
- Create: `src/lib/workbench-state.ts`
- Create: `src/lib/workbench-state.test.ts`

- [ ] Write failing schema tests for strict `Use | Shape` targets, candidate
      binding, transition sequence, and bounded handoff data.
- [ ] Write failing Effect tests for blank, accepted, preview, stale, busy,
      Keep, Reject, and safe-mode transitions.
- [ ] Implement tagged schemas/errors and named Effect transition functions.
- [ ] Add target commands while retaining validated developer-preview mode
      command compatibility.
- [ ] Run only the new contract/domain tests until green.

### Task 2: Atomic candidate supersede

**Files:**
- Modify: `src/lib/shaping-kernel.ts`
- Modify: `src/lib/shaping-kernel.test.ts`
- Modify: `shared/revisions.ts` only if the observable event contract needs an
  additive supersede event

- [ ] Write failing tests proving a valid preview can be superseded atomically.
- [ ] Prove invalid, stale, failed-storage, and cancelled supersedes preserve
      the existing candidate and accepted revision.
- [ ] Implement `supersede` through one validated persisted Effect transition.
- [ ] Run shaping-kernel tests until green.

### Task 3: Candidate-bound App session

**Files:**
- Modify: `shared/control.ts`
- Modify: `shared/contracts.ts` and `shared/rpc.ts` only where a distinct public
  operation is required
- Modify: `src/lib/api.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/lib/agent-workspace.test.ts`
- Modify: `server/pi-runtime.ts`
- Modify: `server/pi-runtime.test.ts`

- [ ] Write failing AgentWorkspace tests for a separate candidate conversation,
      session reuse, model/extension invalidation, Reject disposal,
      role-specific cancellation, and no accepted-history contamination.
- [ ] Write failing runtime tests proving candidate public context is bounded
      and accepted/Shaper/Guardian authority is absent.
- [ ] Implement a separately scoped candidate App session over the shared Pi
      `ModelRuntime`; do not duplicate authentication or provider state.
- [ ] Attribute candidate tools and journal records distinctly while preserving
      role-owned browser sandbox limits.
- [ ] Run the focused workspace and runtime tests until green.

### Task 4: Controller integration and bounded handoff seam

**Files:**
- Modify: `src/lib/workspace-controller.ts`
- Modify: `src/lib/workspace-controller.test.ts`
- Modify: `src/axi/command.ts`
- Modify: `src/axi/program.ts`
- Modify: their focused tests and public documentation as required

- [ ] Write failing controller tests for explicit target selection, candidate
      Use prompts, post-shape auto-selection of Use, repeat shaping without
      deciding the prior candidate, stale commands, cancellation, and Keep or
      Reject disposal.
- [ ] Add a strict bounded handoff schema and reject uncorrelated, cross-role,
      stale, and oversized input.
- [ ] Implement typed target and handoff commands through the existing command
      bus, idempotency, sequence, event, and journal paths.
- [ ] Add the `request_interface_edit` Pi custom-tool bridge as a typed request;
      Effect verifies and applies the transition. Explicit user target always
      overrides it.
- [ ] Preserve old command compatibility and update AXI help without exposing
      credentials or session capability identifiers.

### Task 5: One-composer Use–Shape interface

**Files:**
- Modify: `src/app.tsx`
- Modify: `src/components/role-aware-shell.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/composer.tsx`
- Modify: `src/components/role-switcher.tsx`
- Modify: `src/styles.css`
- Modify: focused component tests

- [ ] Write failing component tests for one mounted composer, visible
      `Use | Shape`, Preview App Agent identity, target-specific drafts,
      histories, cancellation, disabled states, focus, and screen-reader names.
- [ ] Replace Run/Edit presentation with semantic target presentation while
      preserving safe mode and compatibility state underneath.
- [ ] Keep Use and Shape available during preview; disable Use only when no
      usable accepted or candidate product exists.
- [ ] Preserve sticky-follow independently per conversation and never scroll a
      reader merely because the other target changed.
- [ ] Polish wide, compact, reduced-motion, high-contrast, and keyboard paths.

### Task 6: Real-browser and packaged-host proof

**Files:**
- Modify: `tests/e2e/flect.spec.ts`
- Update: `docs/verification/2026-08-01-product-quality-baseline.md`
- Update: `ARCHITECTURE.md` only for behavior now proven

- [ ] Add a production Chromium workflow that repeatedly performs
      Shape → Use → failure → Shape → corrected Use, proving no
      reauthentication, accepted mutation, duplicate composer, lost draft,
      or forced scroll.
- [ ] Prove a question in Use creates no proposal and an explicit change uses
      a visible Shaper transition.
- [ ] Prove compact, keyboard, screen-reader-label, reduced-motion, Keep,
      Reject, rollback, and safe-mode paths.
- [ ] Run focused tests, `bun run check`, and production Playwright.
- [ ] Build and open the packaged macOS app and dogfood the same supported
      flow through public UI/AXI surfaces.
- [ ] Record exact evidence and reclassify only criteria actually proven.

### Task 7: Delivery reconciliation

**External:**
- Update GitHub issue `#18` and organization project `#8`

- [ ] Compare implementation to every issue acceptance criterion and this
      design's non-goals.
- [ ] Run the repository verification-before-completion and no-mistakes gates.
- [ ] Keep issue/project status honest while local changes remain uncommitted.
- [ ] Commit, push, publish, or release only with explicit current authority.
