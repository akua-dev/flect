# Flect role continuity verification — 2026-08-01

## Result

Flect now has a strict, bounded, generation-checked role-continuity record and
a private reactive draft channel. Accepted App Agent, candidate Preview App
Agent, and Shaper conversations restore separately. The exact candidate
revision scopes preview history. Active partial assistant output, activities,
tool data, credentials, auth state, Pi sessions, provider/model state, and
control grants are excluded.

The browser slice is implemented and directly proven. GitHub issue #21 remains
open for the residual native, real multi-tab, quota, and migration harnesses.

## Checked implementation

- `shared/role-continuity.ts`: strict version-one schema and 512 KiB codec.
- `src/lib/role-continuity-repository.ts`: locked load/save/export/discard,
  generation conflict, and prior-record preservation.
- `src/lib/role-continuity.ts`: bounded completed-message projection and exact
  candidate reconciliation.
- `src/lib/workspace-controller.ts`: private continuity stream, persistence,
  recovery state, drafts, export, and isolated discard.
- `docs/recovery.md`: user and contributor lifecycle contract.

## Focused evidence

The focused unit/integration run passed 61 tests across the schemas,
repository, projection, controller, hook, composer, shell, app, control bridge,
and AXI bridge. Biome and TypeScript passed.

The fresh full repository gate also passed: Effect and Rifty source checks,
Biome, TypeScript, 498 unit/contract tests (one intentional skip), 27
production Chromium workflows, 18 Rust tests, and a rebuilt signed-ad-hoc
macOS application bundle. The continuity scenarios are mandatory members of
that Chromium gate.

Production Chromium passed these direct lifecycle scenarios:

1. completed App Agent and Shaper histories survive reload and remain isolated;
2. candidate-use and Shape drafts survive reload, while Reject removes only the
   candidate draft from durable continuity;
3. reload during an active Shaper turn restores the complete user request,
   omits partial assistant output, exposes no proposal, and returns an enabled
   composer; and
4. safe mode leaves stored drafts unhydrated, exports a valid decoded JSON
   record, and discards continuity without deleting canonical revisions;
5. a real second same-origin tab with a stale generation cannot replace the
   first tab's newer draft and surfaces `stale-write`; and
6. injected browser `QuotaExceededError` preserves the byte-for-byte prior
   record and surfaces `storage-unavailable` recovery.

Repository fault injection proves missing, valid, malformed, unknown-version,
oversized, stale-generation, rejected-write, export, and isolated-discard
behavior. A rejected write leaves the exact previous encoded value intact.

## Residual proof retained in issue #21

1. Add a versioned migration implementation and interrupted-migration proof
   when the first compatible schema evolution is introduced; retry is already
   available without a model.
2. Extend the native evidence from the now-proven exact child-sidecar kill and
   candidate-preserving bundle relaunch to an explicitly accepted revision,
   completed role continuity, and a packaged private-state canary.
3. Reconcile role continuity with the future canonical OPFS/libgit2 workspace
   without turning it into a second interface history.

## Packaged macOS observation

One newly launched exact signed-ad-hoc bundle instance was isolated by its full
executable path and process tree. Its only child `flect-runtime` was terminated
with `SIGKILL`; the owning Flect application remained alive. That exact app
instance was then terminated and the exact bundle relaunched. A new private
runtime child appeared, the 1180 × 781 window reported Pi ready, and the same
validated **Flect Studio** candidate, canvas, and Keep/Reject decision were
visibly preserved. No pre-existing Flect process or window was targeted.

This proves packaged candidate persistence through exact sidecar loss and app
relaunch. It does not yet prove an explicitly accepted revision, completed role
conversation restoration, or a secret canary, so issue #21 remains open.
