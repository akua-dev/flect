# Flect role continuity implementation plan

Date: 2026-08-01
Design: `docs/superpowers/specs/2026-08-01-flect-role-continuity-design.md`

## 1. Establish the strict continuity contract

- [x] Add versioned Effect Schemas for isolated drafts, completed role
  projections, generation, revision binding, and closed recovery reasons.
- [x] Prove excess properties, credentials, auth/control fields, oversized
  content, and unknown versions fail closed.
- [x] Document the durable, resumable, ephemeral, and discarded lifecycle in
  architecture and user-facing recovery documentation.

## 2. Add one Effect-owned repository

- [x] Add `RoleContinuityRepository` over the existing storage capability.
- [x] Preserve the prior valid record on quota/write failure.
- [x] Reject stale generations and serialize browser writers with Web Locks
  when available.
- [x] Add production fault tests for browser quota and competing writes.
- [ ] Add interrupted-migration proof when a compatible schema migration
  exists.

## 3. Restore and persist isolated role conversations

- [x] Load continuity after canonical revisions and before exposing ready role
  state.
- [x] Persist only completed bounded user/assistant projections.
- [x] Normalize active turns to interrupted idle state after restart.
- [x] Reconcile Preview App Agent history against the exact candidate revision.
- [x] Keep App Agent and Shaper histories structurally and behaviorally
  separate.

## 4. Persist private composer drafts

- [x] Move the three composer drafts from component-local state to a private
  reactive Effect service.
- [x] Keep unsent draft text out of workspace snapshots, AXI, control events,
  logs, diagnostics, and auth state.
- [x] Restore accepted-use, candidate-use, and Shape drafts independently.

## 5. Add compiled recovery controls

- [x] Surface a bounded recovery status in the protected shell.
- [x] Add explicit inspect/export/discard/retry actions that do not require a
  model and never render undecoded stored state.
- [x] Preserve canonical revisions when discarding role continuity.

## 6. Prove browser and native lifecycle behavior

- [x] Add production Chromium refresh/restart coverage for idle, completed
  turn, active stream, candidate preview, Keep, Reject, and rollback.
- [x] Add quota, stale-generation, and simultaneous-tab production fault
  injection plus corrupt/incompatible unit fault injection.
- [ ] Add interrupted-migration production fault injection when a migration
  exists.
- [ ] Dogfood the exact packaged macOS bundle through exact sidecar loss and
  relaunch, preserving accepted work and proving private fields are absent.
- [x] Run `bun run check:all`, update the dated verification report, and
  reconcile issue #21 without claiming residual work complete.
