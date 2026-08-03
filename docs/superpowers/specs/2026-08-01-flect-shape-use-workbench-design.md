# Flect Shape–Use workbench design

**Status:** Approved for implementation on 2026-08-01

## Purpose

Edit must be a live product workbench, not a one-way prompt that turns every
message into a revision. A user needs to alternate between using a candidate
experience and shaping it without reauthenticating, losing context, accepting
an untested change, or letting one agent cross another agent's authority.

The compiled shell therefore presents one conversation rail and one composer
with an explicit semantic target:

- **Use** talks to an App Agent bound to the interface currently on the canvas;
- **Shape** talks to Shaper and may create or supersede the candidate; and
- **Keep**, **Reject**, rollback, and safe mode remain deterministic protected
  controls outside both agents.

## User model

The visible model is `Use | Shape`, not a hidden intent router.

```text
accepted interface                 candidate workbench

canvas + Use (App Agent)   Shape   canvas + Use (Preview App Agent)
         |                                  |
         +-- accepted context               +-- candidate public context
                                            |
                                  Shape ----+-- Shaper context
                                            |
                                   Keep / Reject (protected)
```

On a blank workspace, Shape is selected and Use is unavailable until a valid
candidate exists. When Shaper produces a valid candidate, Flect selects Use so
the user can immediately test it. The user may return to Shape, revise the same
candidate, and test again before deciding it. On an accepted workspace, Use
means the accepted App Agent; selecting Shape enters the workbench.

The composer, conversation viewport, draft, cancellation state, and sticky
scroll behavior belong to each target. Switching target never relabels a
message, clears the other draft, steals scroll position, or creates a second
composer.

## Runtime topology and trust

Pi remains the provider authentication and model runtime. Flect owns one
shared Pi `ModelRuntime` and creates separately disposable session sets:

1. the accepted set contains Guardian, accepted App Agent, and Shaper;
2. the candidate set contributes a distinct App Agent session for Use in the
   workbench; and
3. Guardian remains immutable, extension-free, tool-free, and outside both.

The candidate App Agent is not Shaper with a different prompt and is not the
accepted App Agent with its history relabelled. It receives only the validated
candidate's public interface projection and granted public capabilities. It
has no revision, Keep/Reject, Shaper, host, credential, or Guardian authority.
Shaper receives the candidate document plus a bounded handoff; it does not
receive the App Agent's complete transcript or private product data.

Accepted and candidate sessions stay warm while their selection key and
authority context remain valid. Candidate UI-only revisions may keep the
candidate session; changes to instructions, extensions, capabilities, model,
or authority dispose and recreate it. Reject disposes candidate authority.
Keep promotes the validated document, then deterministically selects or
recreates the accepted App session according to the same context rule.

## Effect-owned workbench state

`FlectWorkspaceController` remains the sole semantic command and snapshot
authority. Its schema-validated workbench state records:

- target: `use | shape`;
- whether Use is bound to `accepted | candidate`;
- candidate revision identity when present;
- a monotonically increasing transition sequence; and
- an optional bounded, redacted handoff reference.

Typed commands select a target, submit to the selected target, cancel that
target, and transfer a correlated failure. Effect serializes transitions,
rejects stale expected sequences, scopes sessions/fibers, and records bounded
events. React only renders the snapshot and retains ephemeral drafts and
viewport positions.

Explicit user selection wins. There is no semantic classifier and no model
response may mutate target state merely by containing suggestive prose.

## Shaping and superseding candidates

Shaper may start from the accepted document or the current validated candidate.
The shaping kernel gains one atomic supersede transition. It validates the new
document before replacing the existing preview, preserves the accepted and
last-known-good revisions, persists one coherent snapshot, and never exposes a
missing or half-replaced candidate.

A failed or cancelled supersede leaves the existing candidate usable. A stale
candidate or revision mismatch fails with a typed conflict. Keep and Reject
remain explicit; Shaper cannot invoke either operation.

## Bounded handoff

Use can request Shape through a Pi custom tool named
`request_interface_edit`. The tool returns a typed request to Flect; it does not
change mode itself. Flect verifies that the caller is the active accepted or
candidate App session, records the visible transition, and starts the next
Shaper turn with only:

- the user's stated instruction;
- candidate or accepted revision identifier;
- a bounded selected-interface-state projection;
- an optional correlated operation/failure identifier; and
- a redacted summary capped by the contract.

The tool is for clear modification intent. Questions remain ordinary App turns.
The user can always select Shape directly, including rapid back-and-forth
testing. Invalid, stale, oversized, cross-role, or uncorrelated handoffs fail
closed and do not create a proposal.

The initial vertical slice must establish the typed transition seam even if
the first public flow exposes explicit selection before enabling automatic
continuation from every provider.

## UI behavior

The existing T3Code-inspired rail remains the visual foundation. The role
control becomes a compact, keyboard-operable `Use | Shape` segmented control
near the model selector. Identity copy names `App Agent`, `Preview App Agent`,
or `Shaper`; the canvas and revision banner make candidate status unmistakable.

When a candidate exists:

- Use remains available while the preview is undecided;
- Shape remains available for correction;
- Keep and Reject are disabled only by an actually conflicting operation;
- failure and tool activity stays visible in its originating conversation;
- **Fix in Shape** transfers only the selected correlated evidence; and
- switching targets has no loading shell when the warm session is healthy.

Compact sheet, full-width mobile sheet, keyboard focus, screen-reader labels,
sticky-follow, reduced-motion, and safe-mode behavior remain compiled-shell
responsibilities.

## Observability and proof

Meaningful workbench operations use named `Effect.fn` boundaries and annotate
workspace, operation, target, session, and revision identifiers without prompt
payloads or secrets. The operation journal distinguishes accepted App,
candidate App, Shaper, transition, and revision evidence.

Required proof includes:

- Effect tests for valid, stale, simultaneous, cancelled, invalid-handoff,
  session-reuse, session-disposal, supersede, Keep, and Reject paths;
- component tests for target-specific drafts, histories, scroll, focus,
  disabled states, and a single mounted composer;
- production Chromium repetition of
  Shape → Use → failure → Shape → corrected Use without reauth,
  accepted mutation, lost drafts, or forced scrolling; and
- packaged macOS dogfooding of the same public behavior.

The switch interaction is measured locally and must not make a model request.
Provider latency is reported separately from shell transition latency.

## Compatibility and migration

The public command language gains target-oriented commands. Existing
`set-mode`, `submit-app-prompt`, `submit-shaper-instruction`, and role-cancel
commands remain accepted during the developer-preview migration and map to the
new explicit state machine without weakening validation. No durable user data
is silently discarded.

## Non-goals

This slice does not combine App and Shaper trust, grant product APIs, implement
the complete extension marketplace, make prompt text authoritative, auto-Keep
a revision, or use a model router. OPFS/libgit2 history, portable `.flect`
packages, capability grants, and product-team SDKs remain later linked slices.
