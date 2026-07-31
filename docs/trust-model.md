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

App Agent and Shaper may each use one Pi-visible `bash` tool. Pi does not run a
host shell: each tool call returns over the Flect transport to that role's
just-bash workspace inside the browser or desktop WebView. Guardian remains
tool-free.

Each workspace is disposable memory and has no handle to canonical interface
state, OPFS, Git metadata, credentials, product APIs, Pi internals, Tauri, or
the parent DOM. Its reserved Bun-compatible command may:

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

### Capability broker

The broker is the only route from an untrusted experience to product or host
effects. Every capability has a typed contract and an implementation provided
through a protected Effect service.

A grant identifies:

- the capsule or product requesting it;
- the operation and resource scope;
- the approving authority;
- any duration, rate, or data limits;
- whether confirmation is required for each invocation; and
- how the grant can be inspected and revoked.

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

Platform adapters do not give a shared capsule native code execution. Swift,
Kotlin, Rust, and TypeScript implementations remain protected host
capabilities behind the same typed broker contract.

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

## Interface change flow

```text
user request
  -> Shaper proposes source or interface changes
  -> browser or desktop authoring service compiles them
  -> isolated preview runs with requested capabilities ungranted
  -> schemas, compatibility, and capability requests are validated
  -> user keeps or rejects the revision
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

The current vertical slice uses a closed schema-defined renderer rather than
arbitrary UI capsules. It implements model-backed proposals, preview, keep,
reject, a versioned revision journal, rollback, safe mode, separate Guardian,
App Agent, and Shaper Pi sessions with explicit close and bounded retention, a
resource-limited QuickJS logic worker, a browser-resident agent shell with
bounded Bun-compatible source/package/preview operations, and a minimal
capability broker. That broker requires both manifest declaration and an
explicit grant supplied by the protected caller before invoking its current
interface-local adapter; denied requests never reach the adapter. Repeated
sandbox or broker failures disable the extension and request deterministic
recovery.

Arbitrary generated React activation, the isolated capsule renderer, canonical
OPFS/Git source workspaces, product/API adapters, privileged native brokerage,
sharing, signing, mobile hosts, and remote runtimes remain future work. See
[`README.md`](../README.md) for the current user-facing status and
[`VISION.md`](../VISION.md) for the complete destination.
