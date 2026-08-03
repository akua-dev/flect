# Flect permission lifecycle design

**Status:** Approved for implementation on 2026-08-02
**Owner:** Protected Flect core
**Tracks:** GitHub issue #6, “Define capability manifests and the permission broker”

## Outcome

Flect will replace its product-operation boolean grant with one capability-centric
permission broker. The broker is the only route from an untrusted capsule or its
App Agent to product effects. It will expose a complete, inspectable lifecycle,
enforce the narrowest intersection of capsule request, trusted availability,
user decision, and product policy, and remain operable from the compiled safe
interface when customized UI and every model provider are unavailable.

This design extends the product-operation vertical slice. It deliberately does
not add a specific GraphQL, filesystem, database, privileged native, or event
adapter. Those adapters must later implement the same broker contract through
platform-specific Effect Layers.

## Decisions

### One broker, structured decisions

Flect will use one Effect-owned permission broker backed by versioned Effect
Schema contracts. It will not extend the current boolean map with scattered
expiry and rate checks, and it will not introduce cryptographic bearer tokens
inside the browser application. Structured decisions are sufficient for the
current local/browser trust boundary and keep authority visible and revocable.

The current `ProductCapabilityRegistry` remains the trusted registry for named
product operations, but its public role becomes the product-capability adapter
behind the new permission lifecycle. React, capsules, Pi roles, outside control,
and host adapters cannot read or mutate the broker’s internal state directly.

### Lifecycle states

The protected projection exposes these closed states:

- `available`: the trusted runtime offers the capability, but the current
  capsule did not request it;
- `requested`: the current capsule requested an available capability and no
  user decision exists;
- `granted`: a current decision authorizes the requested use;
- `denied`: the user explicitly denied the request;
- `expired`: a former grant is outside its time or invocation allowance;
- `revoked`: a former grant was explicitly withdrawn.

An unavailable request remains visible as `requested` with
`availability: "unavailable"`; it can never become invocable. Availability and
request membership are retained as separate fields because a requested
capability can become unavailable after a platform or product change. The
single lifecycle `state` is a projection, not a second persisted state machine.

Only explicit user decisions are persisted. `available`, `requested`, and
`expired` are derived from trusted manifests, the active capsule manifest, the
stored decision, usage, and Effect `Clock`.

### Confirmation policies

The protected prompt offers exactly five actions across four grant policies:

- **Allow once** — permits one attempted invocation, then becomes `expired`;
- **Allow for this session** — default; lasts until this Flect runtime closes;
- **Always allow in this workspace** — survives reload for this capsule and
  workspace;
- **Always allow for this app** — survives reload for this capsule across
  workspaces; and
- **Deny** — records an explicit denial without granting authority.

“Once” and “session” decisions are memory-only. Workspace and persistent
decisions use strict, versioned storage. The UI labels the two durable choices
plainly; the schema names are `workspace` and `persistent`.

The user chooses from policies allowed by the trusted capability manifest.
Products cannot silently force a broader policy. A manifest may omit durable
policies for sensitive operations.

### Capability and grant scopes

A trusted version-1 `ProductCapabilityManifest` declares:

- stable capability ID, user-facing name, and bounded description;
- allowed operation IDs;
- allowed resource IDs;
- allowed data-class IDs;
- allowed confirmation policies;
- optional maximum grant duration; and
- optional maximum invocation rate.

A `ProductCapabilityDecision` records:

- a generated decision ID;
- capsule scope ID;
- workspace ID only for a workspace decision;
- capability ID;
- `granted`, `denied`, or `revoked` decision status;
- confirmation policy;
- approved operation, resource, and data scopes;
- optional expiry time and rate limit, each no broader than the trusted
  manifest;
- creation and last-update times; and
- the closed authority value `protected-user`.

The broker never accepts operation/resource/data scope from model text or an
untrusted invocation. A protected decision is created from the intersection of
the active capsule request and the trusted capability manifest. Input values,
aliases, redirects, a later manifest revision, or a newly registered operation
cannot widen an existing decision. A changed request receives a new decision
ID and returns to `requested` until the user decides again.

### Product policy remains authoritative

Each trusted `ProductOperationDefinition` maps untrusted input to an
`AuthorizedProductOperation` containing the exact operation, resource, and data
classes that the adapter will use. This effect is the product-policy boundary.
It may reject an input with a typed `product-denied` failure before any HTTP or
platform adapter is invoked.

Invocation requires all of these to agree:

1. the active accepted or candidate capsule identity and binding;
2. the capsule’s declared capability request;
3. the trusted capability manifest and registered operation;
4. the current user decision, including lifetime, operation, resource, data,
   and rate scopes; and
5. the product operation’s independent policy authorization.

User approval cannot override product denial. Product availability cannot grant
user approval. No redirect, URL, or adapter alias is accepted from the capsule;
the existing product HTTP policy remains authoritative after brokerage.

### Atomic lifetime and rate enforcement

The broker owns decisions and usage in one `SynchronizedRef`. Invocation
authorization, once-policy consumption, and rate-window reservation happen in
one atomic effect before the adapter runs. An attempted invocation consumes an
“allow once” grant even if product policy or transport subsequently fails; this
prevents retrying a sensitive one-time approval with varied inputs.

For durable grants, usage needed to enforce the configured rate survives reload
in the versioned decision record. For memory-only grants, usage remains
memory-only. Rate windows use Effect `Clock`; tests use `TestClock` and never
sleep against wall time.

If durable usage cannot be saved, the invocation fails closed before the
adapter. A failed grant, denial, or revocation save leaves live authority
unchanged. Concurrent invocations cannot both consume the same final allowance.

### Persistence and migration

The durable store moves to `flect.product-capability-decisions.v2` with a strict
version-2 record. Unknown fields, duplicate decision IDs, invalid policy/scope
combinations, out-of-range values, and malformed JSON fail closed to no durable
authority.

The existing version-1 boolean record is migrated once:

- `granted: true` becomes a persistent `granted` decision limited to the
  operations currently registered for that capability;
- `granted: false` becomes a `revoked` decision; and
- the version-1 key is retained unless the complete version-2 record was saved
  successfully.

Migration never invents resource or data scope. A capability whose current
trusted manifest cannot bound the old decision remains requested rather than
being broadened. The v2 record is the only source read after successful
migration.

### Protected user experience

The compiled capability panel is available in normal review and safe mode. It
does not depend on the capsule renderer, Pi, a model provider, or user-loaded
extensions.

For every requested capability it shows:

- capability name and purpose;
- requesting app and accepted/candidate revision binding;
- lifecycle and platform availability;
- operation, resource, and data scope summary;
- lifetime and rate summary;
- the applicable grant-policy actions plus Deny; and
- the current decision ID in an expandable technical detail view.

`Allow for this session` is selected by default. Saving is visibly pending and
controls are disabled until the atomic transition succeeds. Failures appear as
stable, actionable alerts without changing the displayed authority.

The protected inspection view also lists all durable grants for the current
workspace and installed capsules, including grants whose custom interface can
no longer render. Every granted, denied, expired, or revoked entry can be
inspected. A granted entry can be revoked immediately without uninstalling the
capsule. Revocation refreshes accepted, candidate, last-known-good, App Agent,
capsule, and public-control projections through the shared workspace
controller.

Shaper, Guardian, App Agent, Preview App Agent, capsule JavaScript, QuickJS,
outside control, AXI, MCP, and a signed publisher cannot grant authority. App
Agent and capsule calls may invoke a currently granted operation. The public
`flect permissions list` and `flect permissions revoke` commands can inspect
and revoke through the same controller only after the normal local-control
pairing boundary; they cannot create grants.

### Receipts and diagnostics

Every attempted product invocation appends one bounded receipt through the
existing `OperationJournal`. The receipt contains:

- operation and command correlation IDs;
- requester kind, capsule ID, accepted/candidate binding, and workspace;
- capability, operation, decision ID, confirmation policy, and capsule
  revision;
- the closed result `succeeded`, `denied`, `expired`, `revoked`,
  `rate-limited`, `product-denied`, `unavailable`, or `failed`; and
- a stable redacted summary.

It never contains credentials, authorization headers, raw input, raw output,
URLs, response bodies, provider payloads, stack traces, or arbitrary thrown
values. The journal remains bounded and in memory; it is evidence, not a second
permission store.

### Platform adapters

The broker depends on named Effect services and Layers at the application
runtime edge. A platform that does not provide an operation fails with a
schema-backed `ProductCapabilityUnavailable` error. Browser and Tauri use the
same broker and lifecycle; platform Layers differ only below the trusted
operation adapter. No adapter may provide a broader fallback when its intended
capability is unavailable.

## Effect architecture

Boundary values and errors use `Schema.Class`, tagged unions, and
`Schema.TaggedErrorClass`. Expected failures remain in the Effect error channel
and are routed by stable `_tag`, never `instanceof`.

The implementation has three focused services:

1. `ProductCapabilityDecisionStore` loads, migrates, and atomically saves
   durable decisions and durable rate usage through `InterfaceStorage`.
2. `ProductCapabilityBroker` owns current decisions and usage in a
   `SynchronizedRef`, derives lifecycle projections with `Clock`, creates and
   revokes protected decisions, and reserves invocations atomically.
3. `ProductCapabilityRegistry` owns trusted manifests and operation adapters,
   applies independent product policy, and invokes `ProductHttp` or another
   platform service only after broker authorization.

The browser/Tauri `ManagedRuntime` composes these Layers once. React calls the
shared controller; it does not call stores, clocks, or registries directly.
Meaningful workflows use named `Effect.fn` operations and annotate only stable,
non-secret identifiers.

## Error behavior

Public failures use stable reasons and safe messages:

- undeclared, undecided, denied, expired, revoked, or scope mismatch →
  `The product operation was denied.`;
- rate limit exhausted → `The product operation is temporarily limited.`;
- product policy denial → `The product denied this operation.`;
- missing platform adapter → `This capability is unavailable on this
  platform.`;
- decision persistence failure → `The product capability decision could not be
  saved.`; and
- adapter or output failure retains the current existing redacted messages.

The protected details view may show the closed reason and correlation ID. It
must not expose causes or secrets. Corrupt persistence and ambiguous migration
fail closed and surface a recoverable warning in the compiled interface.

## Verification

Implementation is incomplete until observable tests prove:

1. strict manifest and decision schemas reject malformed, excessive, and
   over-broad records;
2. requested, available, granted, denied, expired, and revoked projections are
   distinct and deterministic;
3. once, session, workspace, and persistent policies have the documented
   lifetime across invocation, refresh, reload, and runtime reconstruction;
4. `TestClock` expires grants and resets rate windows deterministically;
5. concurrent calls cannot double-consume once/rate allowance;
6. storage failure leaves live authority unchanged and blocks durable usage;
7. an undeclared, ungranted, denied, expired, revoked, rate-limited, stale, or
   unavailable operation never reaches product policy or transport;
8. input, redirect, alias, capsule-manifest update, and registry update cannot
   widen a decision;
9. product policy denial remains authoritative after user approval;
10. revocation stops capsule and App Agent invocation without uninstalling the
    capsule;
11. Guardian, Shaper, outside control, and capsule messages cannot grant;
12. receipts explain requester, decision, operation, result, and revision while
    excluding secrets and payloads;
13. the compiled normal and safe-mode UI can inspect and revoke without Pi;
14. Chromium proves session default, a durable grant across reload, isolation
    between two capsules requesting the same capability, and safe-mode
    revocation; and
15. a freshly built and installed macOS bundle exposes the same protected
    lifecycle and exactly one visible Flect window.

The dated evidence belongs under `docs/verification/`. Stable outcome criteria
remain in `docs/product-quality.md`; implemented boundaries are updated in
`ARCHITECTURE.md` only after the tests pass. GitHub issue #6 and the dedicated
Flect project retain live execution status.

## Non-goals

- General host shell, native-process, ambient network, or credential access.
- Capability grants carried inside `.flect` archives.
- Authority implied by signatures, publishers, Pi extensions, or model output.
- A second permission database, daemon, or background controller.
- Product-specific REST, GraphQL, SQL, filesystem, event, or native adapters.
- Cryptographic delegation between separate machines.
