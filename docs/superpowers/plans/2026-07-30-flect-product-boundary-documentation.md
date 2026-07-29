# Flect Product Boundary Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flect's long-term capability boundary, trust model, documentation ownership, and implementation backlog explicit without presenting future work as already shipped.

**Architecture:** `VISION.md` remains the canonical product destination, `ARCHITECTURE.md` remains limited to implemented behavior, and `docs/trust-model.md` becomes the public explanation of the invariant authority boundary. `README.md` summarizes and links rather than duplicating those documents. GitHub issues contain executable work only and are grouped under one Flect 1.0 parent issue, one repository milestone, and a dedicated public Flect organization project.

**Tech Stack:** Markdown, GitHub Issues, GitHub Projects, `gh-axi`, GitHub CLI fallback only for project and milestone operations not supported by `gh-axi`.

## Global Constraints

- Preserve every unrelated or unfinished worktree change.
- Do not change application behavior or Effect contracts.
- Do not commit, push, publish, or deploy.
- Use the approved boundary: interfaces may reshape the user experience, but may affect the outside world only through inspectable, approved, and revocable capabilities.
- Keep future capabilities in `VISION.md`; keep implemented topology and limitations in `ARCHITECTURE.md`.
- Keep the README concise and distinguish “works today” from “direction”.
- GitHub issues must link to canonical documents instead of copying the complete vision.

---

### Task 1: Record documentation ownership

**Files:**
- Modify: `AGENTS.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the approved documentation source-of-truth mapping.
- Produces: permanent contributor rules explaining where product, implementation, trust, design-decision, and work-tracking information belongs.

- [x] **Step 1: Add a documentation ownership section to `AGENTS.md`**

State that:

- `VISION.md` owns the long-term product destination, capabilities, and intentional non-capabilities.
- `PRODUCT.md` owns audience, positioning, personality, and product principles.
- `DESIGN.md` owns the visible design system.
- `ARCHITECTURE.md` describes only verified implementation that exists.
- `docs/trust-model.md` explains the public capability and sandbox trust model.
- `docs/superpowers/specs/` and `docs/decisions/` hold reviewed future designs and durable technical decisions.
- GitHub issues and the dedicated Flect project own executable work and status.
- `README.md` is a concise entry point and must link rather than duplicate.

- [x] **Step 2: Align `CONTRIBUTING.md`**

Replace the ambiguous “update this architecture document” instruction with a rule to update the owning document and to avoid describing planned behavior as implemented architecture.

- [x] **Step 3: Verify terminology**

Run:

```bash
rg -n "Documentation ownership|VISION.md|trust-model|GitHub issues|Flect organization project" AGENTS.md CONTRIBUTING.md
```

Expected: every owner is named once in `AGENTS.md`, and `CONTRIBUTING.md` points contributors back to the ownership rule.

### Task 2: Publish the canonical product and trust boundary

**Files:**
- Modify: `VISION.md`
- Create: `docs/trust-model.md`

**Interfaces:**
- Consumes: the approved positive and negative Flect boundary.
- Produces: one canonical product promise and one public trust explanation.

- [x] **Step 1: Extend `VISION.md`**

Add:

- the defining capability rule;
- “What Flect enables” covering conversational creation, imported web interfaces, portable capsules, product capabilities, user-controlled models, sharing, platforms, native adapters, and recovery;
- “What Flect deliberately does not allow” covering unrestricted shell/native/backend execution, ambient data or credential access, permission escalation, protected-core modification, authorization bypass, and silent interface replacement;
- “What Flect does not promise” covering URL-only cloning, universal Node/Vite compatibility, automatic native conversion, invented backend capabilities, and cloud/runtime replacement.

- [x] **Step 2: Create `docs/trust-model.md`**

Explain the four authority levels:

```text
interface capsule
  -> logic sandbox
  -> capability broker
  -> product or native capability
```

Define capsule isolation, inert logic results, explicit grants, protected core, deterministic recovery, platform differences, and the difference between build-time compatibility and installed-capsule runtime.

- [x] **Step 3: Check for contradictions**

Run:

```bash
rg -n "arbitrary generated React|shell commands|capabilit|safe launcher|Guardian|implemented|future" VISION.md ARCHITECTURE.md docs/trust-model.md
```

Expected: `VISION.md` and the trust model describe the destination; `ARCHITECTURE.md` continues to say arbitrary generated React and privileged extension execution are not implemented.

### Task 3: Make the README an accurate entry point

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `VISION.md`, `ARCHITECTURE.md`, and `docs/trust-model.md`.
- Produces: a concise landing document with accurate current/future labeling.

- [x] **Step 1: Add a compact destination section**

Summarize that Flect will support user-shaped web interfaces, portable capsules, approved product capabilities, and shared customizations.

- [x] **Step 2: Add a compact intentional-boundary section**

State that shared components never receive ambient shell, filesystem, network, credential, native, Pi, or backend authority and link to the trust model.

- [x] **Step 3: Add canonical documentation links**

Link to:

- `VISION.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `docs/trust-model.md`
- the Flect 1.0 GitHub parent issue after Task 4 creates it.

- [x] **Step 4: Verify local Markdown links**

Run:

```bash
bun -e 'import { existsSync } from "node:fs"; import { dirname, resolve } from "node:path"; for (const file of ["README.md","VISION.md","docs/trust-model.md"]) { const text = await Bun.file(file).text(); for (const [, target] of text.matchAll(/\\[[^\\]]+\\]\\((?!https?:|#)([^)]+)\\)/g)) { const clean = target.split("#")[0]; if (clean && !existsSync(resolve(dirname(file), clean))) throw new Error(`${file}: missing ${target}`) } }'
```

Expected: exit code 0.

### Task 4: Create the Flect 1.0 GitHub work hierarchy

**Files:**
- No repository files.

**Interfaces:**
- Consumes: the canonical vision and trust-model links on `main`.
- Produces: one milestone, one parent issue, twelve bounded sub-issues, and dedicated Flect project items.

- [x] **Step 1: Create repository labels and milestone**

Create labels only when absent:

- `tracking`
- `security`
- `area:capsule`
- `area:authoring`
- `area:capabilities`
- `area:ecosystem`
- `area:platform`

Create one open milestone named `Flect 1.0 — Adaptable Interface Foundation`.

- [x] **Step 2: Create the parent issue**

Title:

```text
[Epic] Deliver the Flect 1.0 adaptable interface foundation
```

The body must link to `VISION.md` and `docs/trust-model.md`, state the defining capability rule, list the delivery outcomes, and state that completion requires all sub-issues rather than prose-only documentation.

- [x] **Step 3: Create bounded child issues**

Create:

1. Define the portable `.flect` capsule format.
2. Build the isolated iframe capsule renderer.
3. Integrate `@rolldown/browser` with an OPFS workspace.
4. Add reproducible browser dependency resolution and caching.
5. Define capability manifests and the permission broker.
6. Add product API capability adapters.
7. Import standard React and Vite projects.
8. Add Vue and Svelte authoring adapters.
9. Build capsule installation, sharing, and provenance.
10. Add signing and trust presentation.
11. Add native platform capability adapters.
12. Design authenticated remote runtimes for browser and mobile.

Each child must specify outcomes, exclusions, and observable acceptance criteria. Assign the `Flect 1.0 — Adaptable Interface Foundation` milestone and relevant labels.

- [x] **Step 4: Establish hierarchy and project membership**

Use `gh-axi issue subissue add` to attach all children to the parent. Create the
public Flect organization project, link it to the repository, and add the
parent and children. Set:

- Status: `Todo`
- Area: the owning Flect area (`Foundation`, `Capsule`, `Authoring`,
  `Capabilities`, `Ecosystem`, or `Platform`)
- Work Type: `Feature` (`Decision` for authenticated remote-runtime design)
- Priority: `P2`

Remove the Flect cards from the general Akua Work project after verifying all
thirteen items and their fields on the dedicated project.

- [x] **Step 5: Capture the parent URL in `README.md`**

Add the final parent issue URL under the documentation links.

- [x] **Step 6: Verify GitHub state**

Run:

```bash
gh-axi issue list -R akua-dev/flect --state open --limit 100
gh-axi issue subissue list -R akua-dev/flect <parent-number>
gh project item-list 8 --owner akua-dev --format json --limit 100
gh project item-list 2 --owner akua-dev --format json --limit 500
```

Expected: thirteen open issues, twelve children under the parent, all thirteen
present on the public Flect project with the intended fields, none remaining
on Akua Work, and all assigned to the Flect 1.0 milestone.

### Task 5: Final documentation verification

**Files:**
- Verify: `AGENTS.md`
- Verify: `CONTRIBUTING.md`
- Verify: `README.md`
- Verify: `VISION.md`
- Verify: `ARCHITECTURE.md`
- Verify: `docs/trust-model.md`

**Interfaces:**
- Consumes: all documentation and tracking changes.
- Produces: evidence that the repository remains internally consistent.

- [x] **Step 1: Check documentation whitespace and links**

Run:

```bash
git diff --check -- AGENTS.md CONTRIBUTING.md README.md VISION.md ARCHITECTURE.md docs/trust-model.md docs/superpowers/plans/2026-07-30-flect-product-boundary-documentation.md
bun -e 'import { existsSync } from "node:fs"; import { dirname, resolve } from "node:path"; for (const file of ["README.md","VISION.md","docs/trust-model.md"]) { const text = await Bun.file(file).text(); for (const [, target] of text.matchAll(/\\[[^\\]]+\\]\\((?!https?:|#)([^)]+)\\)/g)) { const clean = target.split("#")[0]; if (clean && !existsSync(resolve(dirname(file), clean))) throw new Error(`${file}: missing ${target}`) } }'
```

Expected: exit code 0.

- [x] **Step 2: Inspect only the scoped diff**

Run:

```bash
git diff -- AGENTS.md CONTRIBUTING.md README.md VISION.md ARCHITECTURE.md docs/trust-model.md docs/superpowers/plans/2026-07-30-flect-product-boundary-documentation.md
```

Expected: only the approved documentation ownership, product boundary, trust model, README links, and this implementation plan appear.

- [x] **Step 3: Confirm no placeholders or stale claims**

Run:

```bash
if rg -n "T[B]D|T[O]DO" AGENTS.md CONTRIBUTING.md README.md VISION.md ARCHITECTURE.md docs/trust-model.md docs/superpowers/plans/2026-07-30-flect-product-boundary-documentation.md; then exit 1; fi
rg -n "works today|What works today|arbitrary generated React" README.md VISION.md ARCHITECTURE.md docs/trust-model.md
if rg -n "WebContainer" AGENTS.md CONTRIBUTING.md README.md VISION.md ARCHITECTURE.md docs/trust-model.md; then exit 1; fi
```

Expected: no placeholders; WebContainer is not a required Flect dependency;
future capsule behavior is not listed under “What works today”.
