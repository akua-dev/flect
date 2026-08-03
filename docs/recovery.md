# Session continuity and recovery

Flect keeps interface history and session continuity deliberately separate.
The shaping kernel and revision repository are the only authority for the
accepted interface, last-known-good revision, and validated candidate. The
role-continuity record is a bounded convenience projection for unsent drafts
and completed conversations; deleting it never deletes accepted interface
work.

## What survives a refresh or restart

- accepted App Agent messages;
- candidate Preview App Agent messages only while the exact candidate revision
  still exists;
- Shaper messages;
- separate accepted-Use, candidate-Use, and Shape drafts; and
- the canonical accepted, last-known-good, and candidate interface revisions.

An in-flight user message may be retained, but a partial assistant stream is
not. Active sessions, tool calls, raw tool output, shell processes, and partial
model output are cancelled and recreated as needed. Provider credentials, Pi
session internals, authentication events, protected-entry references, outside
control grants, connected-client state, and provider/model payloads never
enter the continuity record.

The continuity record is strict Effect Schema data under
`flect.role-continuity.v1`. It is limited to 512 KiB, 200 messages per role,
16,000 retained characters per projected message, a 100,000-character Use
draft, and a 4,000-character Shape draft. Tool activities are not persisted.

## Conflicts and storage failures

Every successful write increments a generation. Flect serializes same-origin
writes with Web Locks where available, rereads under that lock, and rejects a
stale generation instead of merging tabs or replacing newer state. One
`localStorage.setItem` atomically replaces the complete encoded record; quota
or host failures leave the prior record intact.

Malformed, oversized, unknown-version, and incompatible records are rejected
before runtime mutation. Flect does not opportunistically rewrite them. A
candidate mismatch discards only candidate-use continuity. Accepted App Agent
and Shaper continuity remain separate.

## Protected recovery

Open `/?safe=1` or choose **Safe mode** from the protected composer. Safe mode
does not hydrate stored drafts or conversations into the UI. It can show only
bounded generation/revision metadata and a closed recovery reason.

The `?safe=1` URL is a one-shot protected launcher, not a durable repository
mode. A successful **Restore interface** writes the recovered snapshot through
the guarded Git repository, removes only the `safe=1` query parameter while
preserving other URL state, and remains restored after reload or process
restart. A failed restore keeps the launcher and prior protected refs intact.
If an activation receipt is missing or disagrees with its protected refs,
Flect reconstructs bounded recovery metadata from `flect/last-known-good`,
enters safe mode, and requires the same explicit restore before realigning the
accepted and last-known-good refs.

Without Pi or a model, safe mode can:

- restore the last-known-good interface;
- export a valid, schema-decoded continuity record;
- discard session continuity while preserving interface revisions;
- retry strict decoding after the underlying storage condition changes; and
- keep the compiled protected shell available when customized state fails.

Export is disabled for an invalid continuity record because Flect does not
render or repackage undecoded stored content. Discard remains available.

## Current proof boundary

Production Chromium tests cover completed App/Shaper conversation restoration,
three isolated drafts, candidate refresh, rejection cleanup, active Shaper
interruption, safe-mode non-hydration, valid export, isolated discard, a real
same-origin stale second tab, injected browser quota exhaustion, protected Git
commit advancement on safe-mode entry/restore, and restoration after reload.
Unit tests additionally inject malformed, incompatible, oversized, stale,
rejected, missing-receipt, legacy-ref, and receipt/ref-mismatch states.

The packaged macOS proof in
[`docs/verification/2026-08-02-permission-lifecycle-verification.md`](verification/2026-08-02-permission-lifecycle-verification.md)
repairs a real legacy receipt/ref mismatch, advances the protected commit, and
survives a complete app quit and relaunch. Future interrupted-migration proof
and complete private-state canary evidence remain tracked in GitHub issue #21.
