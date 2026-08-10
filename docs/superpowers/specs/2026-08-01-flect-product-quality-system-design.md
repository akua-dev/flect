# Flect product-quality system design

**Status:** Approved for implementation on 2026-08-01

## Purpose

Flect needs one durable definition of what matters to its users and one
repeatable way to prove those outcomes. Product prose, implementation claims,
tests, verification reports, GitHub issues, and project status must not become
competing quality models.

The system covers four first-class constituencies:

1. people using a Flect application;
2. people shaping or importing an interface;
3. people authoring components, capsules, or extensions; and
4. product teams adopting Flect as their interface shell.

## Sources of truth

`docs/product-quality.md` owns the stable user outcomes, quality identifiers,
release criticality, and acceptable proof classes. It does not claim that an
outcome is currently implemented.

`AGENTS.md` contains one mandatory routing rule requiring agents to read the
quality contract for product design, implementation, review, and release work.
It does not duplicate the contract.

`.agents/skills/flect-quality/SKILL.md` owns the conditional evaluation
workflow. It tells an agent how to inspect public behavior, classify evidence,
record a baseline, and open the smallest implementation work. It links to the
contract instead of copying its outcomes.

`docs/verification/` owns dated, immutable evidence reports. A later report may
supersede an earlier report but must not rewrite what was observed previously.

GitHub issues own executable work and acceptance criteria. The dedicated Flect
organization project owns priority, dependency order, assignee, and live
status.

`ARCHITECTURE.md` continues to describe verified implemented behavior only.
`VISION.md`, `PRODUCT.md`, `DESIGN.md`, and `README.md` keep their existing
ownership and link to the quality contract where useful.

## Quality units

Every stable outcome has a permanent identifier in the form `FQ-<pillar>.<nn>`,
for example `FQ-04.3`.
An outcome defines:

- the user-observable promise;
- the constituencies to which it applies;
- whether it blocks the current release class;
- the proof required to call it proven; and
- boundaries that must not be weakened to satisfy it.

Outcome identifiers remain stable when wording improves. An identifier is
retired, never silently reused, when its promise is removed or split.

## Maturity and evidence

Current maturity is time-varying and belongs in a dated baseline and the GitHub
project, not in the canonical contract.

The allowed maturity states are:

- `unimplemented`: no observable implementation exists;
- `partial`: some behavior exists but the complete promise does not;
- `implemented`: the behavior exists but required proof is incomplete;
- `proven`: all required automated and manual evidence exists and is current;
- `regressed`: a previously proven outcome currently fails.

Prose, source inspection, a passing build, or an agent's assertion is never
sufficient proof by itself. Evidence may include:

- Effect unit and integration tests through exported contracts;
- real Chromium workflows against a production build;
- packaged macOS application tests through public UI and AXI surfaces;
- sandbox and capability adversarial tests;
- accessibility and visual verification;
- clean-machine installation and release verification; and
- bounded manual dogfooding reports for judgment-dependent experience.

Every `proven` classification names the exact evidence and the release or
commit against which it ran. Missing, stale, or contradictory evidence lowers
the classification.

## Release gates

Release classes may select different outcome subsets, but they cannot redefine
the outcomes:

- a developer preview may ship with clearly disclosed unimplemented
  destination outcomes, while all claims it does make are proven;
- a public beta requires the complete protected Shape–Use–recover loop,
  trustworthy installation, and honest compatibility boundaries;
- a stable release requires every advertised host, portability, extension,
  adoption, privacy, and recovery promise to be proven.

Security, credential isolation, deterministic recovery, data ownership, and
honest product claims are non-waivable gates for every release class.

## Evaluation workflow

An evaluation run:

1. reads the canonical contract and current release claims;
2. inspects the implementation without treating source as proof;
3. runs the smallest public-interface tests that can establish each outcome;
4. records evidence and assigns one allowed maturity state;
5. reports contradictions between documentation and behavior immediately;
6. maps every unproven release-blocking outcome to one or more GitHub issues;
7. places those issues in the dedicated Flect project; and
8. implements gaps in dependency order using approved subsystem designs,
   test-driven development, real-browser verification, and packaged-app
   dogfooding.

Evaluation and implementation evidence remain linked, but an implementation
task cannot mark its own outcome proven without running the required public
verification.

## Delivery order

The complete destination is delivered as independently reviewable vertical
slices:

1. protected end-user Shape–Use–recover loop;
2. browser-native workspace, Git, import, build, and capsule portability;
3. role-scoped extension and product-capability ecosystem;
4. product-team adoption and cross-platform host contracts; and
5. stable release, distribution, collaboration, and ecosystem guarantees.

Each slice must leave Flect usable and honestly documented. Later slices may
extend a stable contract but must not bypass the protected core established by
earlier slices.

## Non-goals

This system does not create a second runtime state store, a quality daemon, an
AgentOS-style controller, or a prose-only certification mechanism. It does not
make all destination capabilities release blockers for today's developer
preview. It makes every current claim provable and every destination gap
visible, attributable, prioritized, and implementable.
