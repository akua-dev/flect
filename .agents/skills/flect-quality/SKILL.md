---
name: flect-quality
description: Evaluate, improve, review, or release Flect against its canonical user-quality contract. Use for product-quality baselines, release readiness, user-outcome audits, evidence verification, gap prioritization, claim validation, dogfooding, or implementation work intended to move an FQ criterion to proven.
---

# Flect quality

Use Flect's public behavior to prove user outcomes. Do not reconstruct the
quality contract inside this skill.

## Load the contract

1. Read the repository `AGENTS.md`, `VISION.md`, `PRODUCT.md`,
   `ARCHITECTURE.md`, `CONTRIBUTING.md`, and every nearer instruction file.
2. Read `docs/product-quality.md` completely. It owns criteria, constituencies,
   release gates, and proof classes.
3. Read the current release claims in `README.md` and the relevant owning
   documentation.
4. Read existing reports under `docs/verification/` that claim evidence for
   the criteria in scope.
5. Inspect the worktree and record uncommitted-state caveats. Never discard or
   overwrite unrelated work.

## Select the operation

- **Evaluate:** classify every criterion required by the requested release or
  scope and write a dated baseline.
- **Improve:** start from a frozen baseline, select the smallest independently
  reviewable gap, and follow the repository's design, plan, TDD, and
  verification workflow.
- **Review:** compare a proposed change and its evidence with the affected
  criteria; report missing behavior, weakened boundaries, and unsupported
  claims before style concerns.
- **Release:** prove every current release claim and every criterion required
  by that release class. Any regression, unsupported claim, missing mandatory
  evidence, or non-waivable gate failure blocks the release.

Evaluation and improvement are separate phases. Freeze the observations before
changing the behavior they describe.

## Build an evidence map

For every criterion in scope, record:

- criterion identifier;
- `unimplemented`, `partial`, `implemented`, `proven`, or `regressed`;
- exact evidence path, command, workflow, host, date, and revision;
- missing proof or observed failure;
- release impact; and
- existing GitHub issue, if any.

Use only the proof classes required by the contract. Prefer the smallest public
surface that establishes the whole outcome:

- exported Effect contracts and Layers for deterministic behavior;
- production Chromium for visible browser behavior;
- the packaged application and public `flect` executable for native behavior;
- adversarial tests for capabilities, credentials, sandboxes, extensions, and
  recovery;
- keyboard, assistive-technology, visual, and dogfooding evidence for outcomes
  automation cannot judge alone;
- clean artifacts and clean-machine workflows for release claims; and
- public integration contracts for adopter outcomes.

Source inspection may identify where to test. Prose, source strings, successful
compilation, test names, screenshots without behavior, generated plans, and an
agent's assertion cannot establish `proven`.

## Exercise Flect publicly

Use visible UI, public HTTP/SSE or MCP contracts, and the public `flect` AXI.
Do not drive React internals, mutate browser storage, call private sidecar
modes, or treat direct database or journal inspection as user evidence.

Start agent-first discovery with `flect`, then request only the bounded state
needed. Keep outside control disabled unless the user explicitly enables it in
the protected shell. Revoke it when live inspection is finished.

For a complete supported-slice baseline, normally run:

```bash
bun install --frozen-lockfile
bun run check:quality
bun run check:all
```

Run `bun run test:pi-smoke` only when approved provider authentication is
available and a live turn is required. Never capture credentials, private
control capabilities, unbounded logs, or sensitive product output.

## Record the baseline

Write `docs/verification/YYYY-MM-DD-<scope>-verification.md`. Include:

1. scope, release class, date, revision, branch, dirty-state caveat, and hosts;
2. commands and public workflows actually run;
3. one classification for every criterion in scope;
4. exact evidence and limitations;
5. current claims contradicted by behavior; and
6. unproven release gates and their issue links.

Keep a baseline immutable after it is frozen except to correct factual or
redaction errors. A later run creates a later report and may supersede it.

## Reconcile delivery work

Use `gh-axi` for GitHub inspection and mutation. Search open and closed issues
before creating anything. Do not create one issue per criterion mechanically.

Create the smallest independently reviewable issue that closes a real behavior
gap. Each issue names:

- affected `FQ-*` identifiers;
- observable acceptance criteria;
- exact proof classes and public workflows;
- dependencies and explicit non-goals;
- owning documentation; and
- security, recovery, portability, or accessibility constraints that must
  remain true.

Place delivery issues in the dedicated Flect organization project. The project
owns live priority, dependency order, release slice, assignee, and status. Do
not copy that status into `docs/product-quality.md`.

## Improve one vertical slice

Before behavior changes, use the repository's required brainstorming and plan
workflow. Split independent subsystems into separate reviewed designs and
plans. Start observable behavior with a failing test and use Effect throughout
the application architecture as required by `AGENTS.md`.

Require:

- real Chromium for UI, shaping, import, accessibility, or browser sandbox
  behavior;
- packaged-host and public AXI dogfooding for native or external-control
  behavior;
- adversarial negative tests for new authority or extension boundaries;
- deterministic recovery tests for changes affecting candidates, persistence,
  extensions, or accepted state; and
- updates to the canonical documentation owner without parallel capability
  lists or implementation claims.

Implementation does not make its own criterion `proven`. Re-run the required
public evidence after the change and record a new verification report.

## Fail closed

Immediately report and treat as release-blocking when applicable:

- shipped behavior contradicts a current claim;
- credentials or private capabilities appear in output or artifacts;
- shaped or extension code can bypass typed capabilities or recovery;
- acceptance, rollback, safe mode, or outside-control revocation is not
  deterministic;
- evidence is missing, stale, scoped to the wrong host, or derived only from
  implementation details; or
- a regression is obscured by changing prose or lowering the criterion.
