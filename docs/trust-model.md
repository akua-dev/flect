# Flect trust model

Flect is designed to let an interface change radically without silently
changing its authority.

The invariant is:

> Interfaces may reshape the user experience, but may affect the outside world
> only through inspectable, approved, and revocable capabilities.

This document describes the public trust model Flect is building toward.
[`ARCHITECTURE.md`](../ARCHITECTURE.md) is the source of truth for boundaries
that are implemented today.

## Authority layers

```text
interface capsule
       |
       | local rendering and interaction
       v
logic sandbox
       |
       | schema-validated inert intentions
       v
capability broker
       |
       | approved, scoped operations
       v
product APIs / files / data / native host / Pi
```

### Interface capsule

A `.flect` capsule contains compiled web assets, a manifest, declared
capability requirements, provenance, and compatible revision metadata. It
runs in an isolated renderer rather than the trusted shell.

The renderer may construct complex HTML, CSS, and web interactions. It does
not receive ambient access to the host DOM, Flect storage, credentials, Pi,
Tauri, native commands, product APIs, or arbitrary network destinations.
Communication with Flect uses a versioned, schema-validated message protocol.

Installed capsules run from their compiled assets. Vite, Rolldown, package
registries, and source dependencies belong to authoring and import; they are
not runtime requirements for opening an installed experience.

### Logic sandbox

Optional extension logic performs bounded pure computation in a disposable
sandbox. It receives explicitly provided input and may return only
schema-validated inert intentions.

An intention describes a requested result; it does not perform an effect.
Logic cannot acquire network, filesystem, native, credential, model, module,
or host-function authority by constructing a different return value.

### Browser agent workspace

Accepted App Agent, candidate Preview App Agent, and Shaper may each use one
Pi-visible `bash` tool. Pi does not run a host shell: each tool call returns
over the Flect transport to that context's separate just-bash workspace inside
the browser or desktop WebView. Preview App retains App authority but cannot
read or mutate the accepted App filesystem. Guardian remains tool-free.

Each workspace is a separate working mirror and has no handle to canonical
interface state, the canonical OPFS root, Git metadata, credentials, product
APIs, Pi internals, Tauri, or the parent DOM. Supported hosts persist each
mirror under a role-specific OPFS namespace; unavailable OPFS falls back to
disposable memory without granting another capability. Its reserved
Bun-compatible command may:

- transform and run workspace JavaScript and TypeScript in disposable Rifty
  Workers;
- stage integrity-checked npm packages through the trusted registry broker;
- build into a workspace-only output directory; and
- register an isolated service-worker preview handler.

Ambient guest network is denied. The package broker permits credential-free
GET/HEAD access to the configured npm origin only. Package lifecycle scripts,
native addons, native processes, system Bun, system shells, raw sockets, and
Node compatibility are absent. A validated, bounded workspace delta is the
only package-mutation result.

Preview documents run with an opaque origin and restrictive response CSP. They
cannot use OPFS or make outbound connections. Preview request and response
messages are bounded and schema validated; stopping a run releases its Worker
and iframe and tombstones its route.

Rifty and just-bash are cooperative execution rather than hostile-code
containment. They are useful machinery inside the boundary, not the boundary
itself. Flect relies on disposable mirrors, separate realms, strict messages,
typed brokers, deadlines, resource finalizers, deterministic validation, and
recovery. The exact compatibility surface is documented in
[`docs/bun-compatibility.md`](bun-compatibility.md).

Each interactive workspace also contains a reserved `flect` command. This is
not an outside-control grant. Flect captures App Agent or Shaper identity, Pi session,
parent operation, and tool-call ID when it constructs the command; model text,
arguments, environment variables, aliases, functions, PATH entries, and files
cannot change that source. Requests cross a bounded in-process Effect queue
and the shared workspace controller enforces the role policy. App Agent can
inspect and invoke currently projected product actions and registered product
operations. Shaper can validate
and propose a file from its own disposable workspace. Neither can impersonate
the other, enable outside control, accept a proposal, change recovery policy,
or gain host access.

### Capability broker

The broker is the only route from an untrusted experience to product or host
effects. Every capability has a typed contract and an implementation provided
through a protected Effect service.

The implemented product-operation path never accepts a URL from a capsule or
agent. A trusted registry maps an operation ID to one manifest capability,
broker policy, HTTP policy, and input/output projections. Capsule identity,
accepted/candidate binding, workspace, provenance revision, declared request,
and SHA-256 of the exact archive are constructed by the host. A decision must
match that immutable binding. The shared controller rejects stale, undeclared,
unregistered, and ungranted requests before the adapter. The broker atomically
reserves one-use and rate allowance before independent product authorization,
so approval cannot override product denial or scope expansion. The initial HTTP
adapter enforces HTTPS origin/path/method/header/byte/deadline policy, injects
host credentials privately, and returns only allowlisted headers and bounded
bytes.

A grant identifies:

- the capsule or product requesting it;
- the operation and resource scope;
- the approving authority;
- any duration, rate, or data limits;
- whether approval lasts once, for the session, for the workspace, or for the
  exact request persistently; and
- how the grant can be inspected and revoked.

Only the protected user can create or deny a decision. A paired outside agent
may inspect the reactive lifecycle and revoke a visible decision but cannot
grant one; App Agent, Preview App Agent, Shaper, Guardian, capsules, and shaped
UI cannot grant or revoke. Every attempted invocation records only bounded
decision/operation/revision/result metadata, never its input or output payload.

Product authorization and user approval are separate requirements. A user
cannot grant an operation the product has not exposed, and a product cannot
silently take ownership of a user's local workspace.

Raw SQL, general file access, or similarly broad operations are not default
capabilities. An owner may expose a deliberately scoped version when its
utility justifies its authority and audit surface.

### Product and native capabilities

Capabilities may connect to HTTP APIs, event streams, databases, selected
files, local services, Pi, notifications, windows, menus, or other native
features. Their adapters run outside the capsule and enforce platform and
product policy.

HTTP and GraphQL callers receive named operations, not network primitives.
GraphQL endpoints and documents are fixed and digest-checked by trusted host
code. Event callers receive a bounded decoded stream; a scoped host connector
owns backpressure, finite reconnect, sequence resume, cancellation, and live
grant revocation. Product credentials are resolved after public validation and
may enter only the protected transport request, never capsule/Pi messages,
interface state, Git, receipts, logs, screenshots, or public failures.

Platform adapters do not give a shared capsule native code execution. Swift,
Kotlin, Rust, and TypeScript implementations remain protected host
capabilities behind the same typed broker contract.

`@flect/product` is the public description and trusted-adapter boundary, not an
authority SDK. It exports strict product, recommended-experience,
compatibility/migration, inference, and adoption schemas plus bounded
transport services. It does not export Flect's grant store, broker mutation,
activation, workspace, safe-mode, recovery, or credential state. Product
connection metadata remains separate from user-owned fork/export references,
and detach preserves those references. A model provider or product inference
choice is never an input to capability or product authorization.

## Protected core

The following remain independent from user-modifiable capsules and extensions:

- the compiled recovery shell;
- a known-safe route to open the agent and recovery controls;
- a compiled fallback composer when a customized document omits its prompt;
- capability inspection and revocation;
- interface validation and compatible migration;
- the attributable revision journal;
- last-known-good rollback;
- extension disabling; and
- the Guardian's bundled instructions and required recovery capabilities.

The Shaper may propose changes to normal Flect surfaces, including the default
agent rail. It cannot modify the protected fallback or promote its own
permissions. Guardian output is advisory text behind a typed diagnostic
operation; the Guardian cannot mutate the revision journal, invoke rollback, or
authorize capabilities.

External Pi extensions are loaded only after an explicit role-scoped user
enablement. App Agent and Shaper receive separate extension-enabled sessions;
Guardian never does. The enabled sessions load only the user's configured Pi
extension sources and keep them outside the protected recovery domain.
Candidate Preview App uses the App extension policy but a separate Pi session
and disposable execution workspace; breaking it cannot replace the accepted
session or protected shell. It never loads Shaper extensions into its session
set.

## Local paired control

An outside coding agent may receive user-equivalent control of one currently
open Flect workspace. This is distinct from a capsule capability: it is a
temporary grant made by the user from the protected shell to a named local
client.

The grant is:

- disabled by default and impossible to enable from outside Flect;
- bound to an ephemeral server on `127.0.0.1`, never a wildcard, LAN, or remote
  address;
- authenticated by a fresh 256-bit bearer stored only in an atomic,
  owner-private descriptor;
- scoped to one live instance and workspace;
- attributable in workspace state and bounded operation evidence;
- revocable from Flect or through an already authorized disable command; and
- removed when its owning runtime exits.

Paired commands enter the same closed Effect command union and workspace
controller as visible user controls. They cannot write revision storage,
invoke DOM selectors, bypass a proposal decision, address an action that is not
in the current validated document, grant a capability, enable their own
control token, or cross App Agent, Shaper, and Guardian authority boundaries.

The broker caches the latest published snapshot and recent events for
authorized readers. It is not a daemon, workspace owner, revision store, or
second application state machine. Browser and desktop bridges stop with their
Effect scopes. Bearers, credentials, raw provider payloads, private Pi session
objects, and host handles are excluded from public snapshots and logs.

The exact CLI, MCP, JSON/SSE, lifecycle, and descriptor behavior is documented
in [`docs/local-control.md`](local-control.md).

## Native setup integrations

Installing `~/.local/bin/flect` or an ambient Codex, Claude Code, or OpenCode
context hook is a separate opt-in host mutation. These operations are available
only through the native adapter and require explicit confirmation in the
protected UI when invoked there. The link target is fixed to the current Flect
app. Integration files use a stable ownership marker, private atomic writes,
and merge/remove logic that preserves unrelated settings. A regular file,
foreign symlink, malformed configuration, or occupied plugin path becomes a
visible conflict rather than an overwrite.

The integrations run bounded `flect context --host ...` discovery; they do not
copy the control descriptor, grant control, read Pi credentials, or keep a
Flect process alive. A user can remove each integration independently.

Uninstall preparation composes only these ownership-checked removals. It first
revokes Local control, preserves every conflict, reports the exact `Flect.app`
bundle for the user to move to Trash, and retains workspaces, provider
authentication, and exports. It has no general filesystem-delete capability.

Native updating is a separate protected host capability. Only the compiled main
window may call the fixed HTTPS updater adapter, and every install requires a
reviewed candidate plus user confirmation. A public verification key may be
compiled into the app; its corresponding private key remains only in the release
environment. Capsules, shaped UI, all Pi roles, extensions, product adapters,
Local control, AXI, MCP, and embedded Bash receive no updater operation.

## Interface change flow

```text
user request
  -> explicit Shape or typed App-Agent edit request
  -> Shaper proposes source or interface changes
  -> browser or desktop authoring service compiles them
  -> isolated preview runs with requested capabilities ungranted
  -> schemas, compatibility, and capability requests are validated
  -> candidate Preview App Agent can exercise the isolated proposal
  -> user returns to Shape, or keeps or rejects the revision
  -> accepted capsule runs with approved grants
  -> deterministic recovery can disable or roll back failures
```

Generated code is untrusted input throughout this flow. Model provenance may
help explain a change, but it never substitutes for isolation, validation, or
authorization.

## Sharing and provenance

People and products may share complete experiences, components, themes, and
workflows. Flect records publisher and build provenance where available and
can present signatures or review status.

Provenance answers who produced an artifact and whether it changed. It does not
grant authority. A signed capsule still starts without ambient capabilities
and must request the operations it needs.

User customizations remain user-owned assets. Installing a product's
recommended experience does not give the product permission to rewrite,
remove, or export unrelated workspace state.

## Platform boundaries

- **Browser:** supports interface creation, isolated preview, sharing, web
  capabilities, and connections to explicitly selected authenticated Flect
  runtimes. It cannot receive native or local-runtime authority merely because
  it is open in a browser.
- **Desktop:** may provide local Pi, selected filesystem access, windows,
  menus, notifications, and other native capabilities through the broker.
- **Mobile:** uses the shared interface renderer and mobile adapters. Until a
  suitable local Pi runtime exists, agent work connects to an approved
  authenticated runtime.
- **Product distribution:** may provide branded defaults and proprietary
  capability implementations, but those adapters cannot bypass the protected
  broker or take ownership of user customizations.

An experience may degrade when a capability is unavailable on a platform. It
must receive a typed, user-actionable failure rather than silently gaining a
broader substitute.

## Failure and recovery

Role continuity is a private, bounded projection rather than a second revision
history. Its strict record excludes activities, tool payloads, provider
credentials, auth events, Pi sessions, control grants, and provider/model
state. Unsent drafts never enter workspace snapshots, AXI, the control broker,
operation logs, or diagnostics. Safe mode may decode bounded metadata for
inspection and explicit export/discard, but it does not hydrate stored draft or
conversation content into the recovery UI. See
[`docs/recovery.md`](recovery.md) for the lifecycle and limits.

- invalid capsule or interface state falls back to the compiled recovery shell;
- invalid generated output never becomes an accepted revision;
- rejecting a preview leaves the active revision unchanged;
- revoking a capability prevents later invocations without uninstalling the
  interface;
- repeated extension failures may disable the extension and restore the last
  known-good revision;
- unavailable models do not prevent safe mode, validation, revocation, or
  rollback; and
- public failures remain stable and redacted rather than exposing provider,
  process, credential, or product internals.

## Current implementation

The current vertical slice supports both the closed schema-defined renderer and
verified compiled HTML capsules in an opaque network-denied frame. It
implements model-backed proposals, preview, keep,
reject, a canonical OPFS Git repository with guarded accepted, proposal, and
last-known-good refs plus a protected activation receipt, complete ordinary-Git
export, rollback, safe mode, separate Guardian,
App Agent, and Shaper Pi sessions with explicit close and bounded retention, a
private Effect coordinator over Pi-owned provider authentication with a
one-use loopback credential-entry host and auth state excluded from public
workspace/control history, a
resource-limited QuickJS logic worker, a browser-resident agent shell with
bounded Bun-compatible source/package/preview operations, a schema-driven
proposal tool with one corrective retry, a bounded redacted operation journal,
and explicitly enabled local control through CLI, JSON/SSE, and MCP adapters.
Its minimal interface capability broker requires both manifest declaration and
an explicit grant supplied by the protected caller before invoking its current
interface-local adapter; denied requests never reach the adapter. Repeated
sandbox or broker failures disable the extension and request deterministic
recovery.

Its product-operation registry gives capsules and App Agent one shared named
operation contract. The HTTP implementation is policy-bounded and credential
private; the default distribution registers no product operations. Product
forks may compose explicit operations at the trusted Effect runtime root.
Protected review projects requested, granted, denied, expired, and revoked
state for one exact capsule request; unavailable host support remains a separate
visible fact. It supports once, session, workspace, persistent, deny, and revoke
choices, persists only durable decisions through the local interface store, and
fails without changing live authority when storage is unavailable. Safe mode
retains inspection and revocation without Pi. A privileged native product
transport and user-authored custom duration/rate controls remain open, so the
current desktop host uses the same CORS-aware WebView fetch behavior as the
browser.

Arbitrary Vite plugin activation, capsule-carried Pi extensions, additional
product/API adapters, privileged native brokerage, publisher signature
verification, real-time collaboration, mobile hosts, and remote runtimes remain
future work. The current inactive sharing, guarded personal-fork, clean-merge,
and explicit shared-conflict boundary is documented
in [`docs/sharing.md`](sharing.md). See
[`README.md`](../README.md) for the current user-facing status and
[`VISION.md`](../VISION.md) for the complete destination.
