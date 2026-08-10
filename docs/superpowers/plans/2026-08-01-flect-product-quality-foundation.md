# Flect Product-Quality Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical, agent-routed, evidence-backed definition of every user-important Flect outcome, baseline the current release against it, and create the project-backed delivery queue for every gap.

**Architecture:** Stable promises live in `docs/product-quality.md`; mandatory routing lives in `AGENTS.md`; the conditional audit procedure lives in `.agents/skills/flect-quality/SKILL.md`; dated observations live under `docs/verification/`; GitHub issues own executable acceptance criteria and the Flect organization project owns live status. The complete product destination is then implemented through separate vertical-slice designs and plans rather than one unreviewable mega-plan.

**Tech Stack:** Markdown, Flect public AXI, Effect/Bun test suite, Playwright Chromium, packaged Tauri macOS application, `gh-axi`, GitHub Issues, GitHub Projects.

**Execution status (2026-08-02):** Tasks 1–6 are complete. The frozen baseline
now gives all 188 canonical criteria one explicit classification row, and the
mandatory `bun run check:quality` Effect gate rejects missing, duplicated,
unexpected, invalid-state, or evidence-free classifications. The dated
foundation verification report owns exact commands and limitations.

## Global Constraints

- Preserve all unrelated and unfinished changes in the existing `codex/flect-self-contained-shaper` worktree.
- Do not commit, push, publish, release, or mutate deployment systems without explicit authority.
- Treat source and prose as guidance; only public-interface behavior and named evidence can establish `proven`.
- Keep the quality contract, dated evidence, executable work, and live project status in their designated sources of truth.
- Do not duplicate the canonical outcome list in `AGENTS.md`, skills, `README.md`, `PRODUCT.md`, issues, or verification reports.
- Current release claims must fail closed: an unsupported or stale claim is a product defect.

---

### Task 1: Canonical user-quality contract

**Files:**
- Create: `docs/product-quality.md`
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: the four constituencies and source-of-truth rules from `docs/superpowers/specs/2026-08-01-flect-product-quality-system-design.md`
- Produces: stable quality identifiers `FQ-01.1` through `FQ-24.n`, proof classes, and release-gate semantics used by evaluation reports and GitHub issues

- [ ] **Step 1: Create the contract header and interpretation rules**

  Define the four constituencies, `unimplemented | partial | implemented | proven | regressed`, evidence recency rules, developer-preview/public-beta/stable release gates, and the rule that current maturity never lives in the canonical contract.

- [ ] **Step 2: Encode every approved user outcome**

  Create the following permanent pillars, retaining every approved outcome as one numbered criterion:

  ```text
  FQ-01 installation and first run
  FQ-02 immediate comprehension
  FQ-03 conversational shaping
  FQ-04 fast Shape–Use testing
  FQ-05 product usage
  FQ-06 preview, acceptance, and recovery
  FQ-07 Git-backed ownership
  FQ-08 import and export
  FQ-09 portable .flect applications
  FQ-10 extensions
  FQ-11 sandbox and capabilities
  FQ-12 models and authentication
  FQ-13 agent transparency
  FQ-14 external agent control
  FQ-15 performance and responsiveness
  FQ-16 reliability
  FQ-17 privacy and data ownership
  FQ-18 accessibility
  FQ-19 visual and interaction quality
  FQ-20 cross-platform behavior
  FQ-21 product-team adoption
  FQ-22 open-source and ecosystem trust
  FQ-23 sharing and collaboration
  FQ-24 honest boundaries
  ```

  For each pillar, record constituencies, release criticality, user-observable criteria, and required proof classes. Do not record current status.

- [ ] **Step 3: Link the contract from product context**

  Add one short `## Product quality` section to `PRODUCT.md` that names `docs/product-quality.md` as the canonical user-outcome and proof contract without copying its criteria.

- [ ] **Step 4: Self-review the contract**

  Verify that every criterion is observable, has exactly one stable identifier, names an acceptable proof class, and does not claim implementation.

### Task 2: Mandatory agent routing

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/product-quality.md`
- Produces: a repository-wide instruction that routes product work and release claims through the quality contract

- [ ] **Step 1: Add the permanent routing rule**

  Add this rule near the other repository-wide product constraints:

  ```markdown
  - Read `docs/product-quality.md` before designing, implementing, reviewing,
    or releasing user-visible behavior. It owns Flect's stable user outcomes
    and proof requirements. Do not claim an outcome is supported or proven
    without current linked evidence through the required public interfaces.
  ```

- [ ] **Step 2: Add documentation ownership**

  Add one ownership entry stating that `docs/product-quality.md` owns stable
  outcomes and proof requirements, while dated baselines live under
  `docs/verification/`, issues own work, and the organization project owns
  status.

- [ ] **Step 3: Check for duplication**

  Read the resulting `AGENTS.md`, `PRODUCT.md`, `README.md`, and design spec.
  Remove any new parallel checklist or current-status assertion outside its
  owner.

### Task 3: Conditional Flect quality-review skill

**Files:**
- Create: `.agents/skills/flect-quality/SKILL.md`

**Interfaces:**
- Consumes: `docs/product-quality.md`, public Flect UI/AXI behavior, tests, packaged application, and GitHub project state
- Produces: a dated verification baseline, evidence-linked classifications, and minimal GitHub work items without duplicating the contract

- [ ] **Step 1: Create skill routing metadata**

  Use this front matter:

  ```yaml
  ---
  name: flect-quality
  description: Evaluate, improve, or release Flect against its canonical user-quality contract using public-interface evidence, dated verification reports, and project-backed gaps.
  ---
  ```

- [ ] **Step 2: Define the evaluation workflow**

  Require the agent to read repository instructions and
  `docs/product-quality.md`, identify the release class, inspect current claims,
  gather existing evidence, run missing public checks, classify each criterion,
  write a dated baseline, and reconcile unproven release gates with GitHub
  issues and the Flect project.

- [ ] **Step 3: Define proof discipline**

  Explicitly reject source inspection, prose, snapshots without behavior,
  successful compilation alone, and agent assertions as sufficient proof.
  Require exact commands, dates, revisions, hosts, outcomes, and redaction.

- [ ] **Step 4: Define improvement routing**

  Require a reviewed subsystem design and implementation plan before changing
  an independently scoped gap; require TDD, real Chromium where UI behavior is
  involved, packaged macOS/AXI dogfooding where host behavior is involved, and
  documentation updates in the owning file.

- [ ] **Step 5: Validate skill legibility**

  Read the complete generated skill as a fresh agent. Confirm it can execute an
  evaluation without receiving a copied outcome list and cannot mark work
  proven from source or prose.

### Task 4: Current-release evidence baseline

**Files:**
- Create: `docs/verification/2026-08-01-product-quality-baseline.md`
- Read: `README.md`
- Read: `ARCHITECTURE.md`
- Read: `docs/verification/*.md`
- Read: test and release configuration selected by each proof requirement

**Interfaces:**
- Consumes: every `FQ-*` criterion and current repository/runtime evidence
- Produces: one dated maturity classification and evidence map for every criterion

- [ ] **Step 1: Record baseline identity**

  Record date, branch, worktree status, tested commit, uncommitted-change caveat,
  release class, browser host, native host, and whether live Pi credentials were
  used. Never include credentials or private control capabilities.

- [ ] **Step 2: Inventory existing evidence**

  Map current unit, integration, Playwright, Rust, package, Pi-smoke, media, and
  prior verification reports to exact criteria. Do not infer a pass from a test
  filename; inspect and run the behavior.

- [ ] **Step 3: Run the credential-free verification gate**

  Run:

  ```bash
  bun run check:all
  ```

  Expected: exit `0`. Record each underlying gate separately. If it fails,
  classify affected criteria no higher than `implemented` and capture the
  bounded failure.

- [ ] **Step 4: Exercise public browser and AXI workflows**

  Use production Chromium and public `flect` commands to cover installation
  discovery, Shape, preview, Keep/Reject, Run, tool visibility, cancellation,
  recovery, local-control enable/revoke, and reactive external actions.

- [ ] **Step 5: Exercise the packaged macOS application**

  Build and open the application, then drive the same supported behaviors
  through public UI and the bundled `flect` executable. Record unsupported
  distribution promises honestly.

- [ ] **Step 6: Classify every criterion**

  For each identifier, record exactly one maturity state, linked evidence,
  missing proof, release impact, and existing issue if present. Future
  destination capabilities described as absent in `README.md` remain
  `unimplemented`, not failed tests.

- [ ] **Step 7: Check current claims**

  Compare `README.md`, `ARCHITECTURE.md`, download instructions, screenshots,
  and release metadata to the evidence. Treat every unsupported current claim
  as a release-blocking defect.

### Task 5: GitHub delivery reconciliation

**Files:**
- Modify externally: issues in `akua-dev/flect`
- Modify externally: the dedicated Flect organization project

**Interfaces:**
- Consumes: unproven criteria and dependencies from the dated baseline
- Produces: complete issue coverage and one dependency-ordered delivery backlog

- [ ] **Step 1: Inspect before mutation**

  Use `gh-axi issue list`, repository searches, and the existing Flect project
  to find work already covering each gap. Never create a duplicate merely to
  mirror one criterion.

- [ ] **Step 2: Create the smallest missing issues**

  Each issue must name affected `FQ-*` identifiers, observable acceptance
  criteria, proof commands or host workflows, dependencies, documentation
  owners, and explicit non-goals. One issue may prove several tightly coupled
  criteria; one broad criterion may require multiple independently reviewable
  issues.

- [ ] **Step 3: Reconcile the project**

  Add every delivery issue to the dedicated Flect project and set priority,
  dependency order, release slice, and status there. Do not copy project status
  back into the canonical contract.

- [ ] **Step 4: Publish the first implementation slice plan**

  Write a separate approved design and implementation plan for the highest
  dependency P0 gap: the protected warm-session Shape–Use–recover workbench.
  Continue with browser workspace/Git/import/capsules, extensions/product
  capabilities, cross-platform adoption, and stable ecosystem delivery as
  independent vertical slices.

### Task 6: Foundation verification

**Files:**
- Verify: `docs/product-quality.md`
- Verify: `AGENTS.md`
- Verify: `PRODUCT.md`
- Verify: `.agents/skills/flect-quality/SKILL.md`
- Verify: `docs/verification/2026-08-01-product-quality-baseline.md`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: a reviewable foundation from which implementation work can continue without losing the product-quality contract

- [ ] **Step 1: Search for ownership contradictions**

  Use `rg` to find copied maturity tables, quality lists, or alternate status
  claims. Resolve them by linking to the canonical owner.

- [ ] **Step 2: Run repository documentation and code gates**

  Run the applicable formatting and full verification commands. Record exact
  results in the baseline rather than claiming success from plan completion.

- [ ] **Step 3: Review the diff without discarding existing work**

  Inspect only the files touched by this foundation, then inspect the complete
  worktree status to ensure no unrelated file was overwritten or removed.

- [ ] **Step 4: Continue into the first vertical slice**

  Invoke the approved execution workflow for the warm-session Shape–Use
  workbench. The active goal remains incomplete until all release-targeted
  outcomes are implemented, evidenced, documented, and delivered.
