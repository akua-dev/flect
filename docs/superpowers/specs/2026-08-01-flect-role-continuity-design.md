# Flect role continuity and recovery design

Date: 2026-08-01
Status: accepted for implementation
Tracks: GitHub issue #21, FQ-16.1–FQ-16.8

## Outcome

Flect survives refreshes, host restarts, interrupted agent turns, corrupt browser
state, quota exhaustion, and competing tabs without losing accepted interface
work, silently mixing role histories, or making recovery depend on a model.

This design does not invent a second interface history. The existing shaping
kernel and its revision repository remain the only authority for accepted,
last-known-good, and candidate interface revisions. Role continuity is a
bounded convenience projection that can always be discarded independently.

## State classes

| State | Lifecycle | Owner |
| --- | --- | --- |
| Accepted and last-known-good interface revisions | durable | `ShapingKernel` + `InterfaceRepository` |
| Valid candidate identity and document | restart-resumable until Keep, Reject, rollback, or safe mode | `ShapingKernel` + `InterfaceRepository` |
| Accepted-use, candidate-use, and Shape composer drafts | restart-resumable, isolated by target | private `RoleContinuity` UI channel |
| Completed App Agent, Preview App Agent, and Shaper user/assistant messages | restart-resumable, bounded, isolated by role and candidate binding | `AgentWorkspace` + `RoleContinuityRepository` |
| Current target and candidate binding | reconstructed from the canonical revision snapshot | `WorkbenchState` |
| Partial assistant stream, active tool invocation, raw tool output, shell process, and in-flight operation | ephemeral; cancelled and recorded as interrupted | owning role/session |
| Provider credentials, auth events, protected-entry references, Pi session internals, control grants, and connected-client state | deliberately never persisted in continuity state | private runtime owners |
| Bounded operation evidence | process-local today; later canonical workspace evidence | `OperationJournal` |

Restoration never merges App Agent, Preview App Agent, or Shaper history. A
Preview App Agent conversation is restored only when its persisted candidate
revision id exactly matches the canonical candidate revision id. Otherwise it
is discarded.

## Storage record

`RoleContinuityRepository` owns one strict versioned record under
`flect.role-continuity.v1`. The record contains:

- schema version and monotonically increasing generation;
- the canonical revision sequence observed when it was written;
- three drafts: `acceptedUse`, `candidateUse`, and `shape`;
- three bounded completed-message projections: `app`, `previewApp`, `shaper`;
- the candidate revision id that scopes `previewApp`; and
- a bounded recovery marker containing only a closed reason and timestamp.

Every string, array, and aggregate serialized size has an explicit limit.
Only strict Effect Schema decoding may enter runtime state. Excess properties,
unknown versions, malformed JSON, oversized content, and inconsistent
candidate bindings are rejected before mutation.

Conversation projections contain completed user/assistant text only. They do
not contain activities, tool arguments/results, auth data, environment values,
URLs, control grants, session ids, or provider/model payloads. The projection
keeps the most recent messages that fit both the count and aggregate byte
budgets.

## Writes and concurrency

All continuity writes flow through one Effect service. A write supplies the
generation that was loaded. The repository serializes same-origin writers
with the Web Locks API where available, rereads inside the lock, and rejects a
generation mismatch as a typed `ContinuityConflict`. A deterministic in-memory
lock provides the same contract in tests and hosts without Web Locks.

The storage adapter writes a complete encoded record with one `setItem` call.
Web Storage defines that operation as atomic with respect to the stored value;
Flect never removes the last-known-good record before its replacement is
accepted. Quota or host failures surface as typed storage failures and leave
the previous record untouched.

Concurrent tabs do not merge automatically. The losing writer reloads the
newer record and presents a recovery choice. This prevents a stale tab from
overwriting a newer candidate or role conversation.

## Restore rules

On startup, Flect loads canonical revisions first and continuity second.

1. Missing continuity state starts empty.
2. A valid compatible record is reconciled against the canonical revision.
3. `submitting`, `streaming`, or `cancelling` roles restore as idle with an
   `interrupted-turn` recovery marker; partial assistant content is absent.
4. A candidate mismatch drops candidate-use draft and Preview App Agent
   history without touching accepted-use or Shape continuity.
5. Corrupt, oversized, unknown-version, or storage-unreadable records never
   partially hydrate. Flect starts with empty role continuity and exposes safe
   recovery.
6. Safe mode bypasses role continuity reads and keeps the compiled interface,
   last-known-good restoration, inspection, export, and discard available
   without Pi.

## Safe recovery

The compiled safe-mode surface can:

- inspect record metadata and the closed recovery reason without rendering
  untrusted stored content;
- export a schema-validated continuity record only after an explicit user
  action;
- discard continuity state without deleting canonical revisions;
- restore the last-known-good interface through the shaping kernel; and
- retry normal startup after the user resolves quota or compatibility issues.

An incompatible record is retained until explicit discard so a future Flect
version or support workflow may export it. Flect never rewrites unknown state
opportunistically.

## Host and process recovery

Browser refresh and browser restart reconstruct canonical revisions and then
bounded continuity. Packaged macOS uses the same WebView storage contract;
the private Pi sidecar may restart independently. A sidecar loss cancels owned
turns, keeps accepted/candidate interface state and completed continuity, and
recreates role sessions after transport recovery. No credential or Pi session
state crosses into WebView persistence.

## Proof

Unit tests cover strict decoding, size bounds, role isolation, candidate
reconciliation, stale generations, quota failures, corrupt/unknown records,
and interrupted state normalization. Production Chromium covers refresh and
new-context restart at idle, completed turns, active stream cancellation,
candidate preview, Keep, Reject, and rollback. Packaged macOS evidence kills
only the exact owned sidecar process and proves accepted work survives
relaunch without private-state exposure.

The dated verification report records what was actually proven and keeps
unproven native or multi-tab cases open in issue #21.
