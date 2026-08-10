# Flect architecture

Flect is an agent-native interface shell with one shared TypeScript application
kernel and two current hosts: a normal browser and a Tauri desktop app. Astro
owns the static browser document above Vite; the protected React/Effect
workspace activates only after an explicit user signal.

This document describes the implementation that exists now. Future platform and
remote-runtime work belongs in the design documents under `docs/superpowers/`.

## Runtime topology

```text
Astro static document -- focus/pointer/Cmd-K/prompt --> React workspace entry
        |                                      |
        | view-only: no Flect runtime          v
        |                            Effect application kernel
        |                                      |
        |                                      +-> validated live canvas
        |                                      +-> one protected conversation
        |                                      +-> bounded Git-backed history
        |
Browser or Tauri WebView ----------------------+
             |                      |
             |                      +-> FlectWorkspaceController
             |                          -> typed commands and events
             |                          -> bounded OperationJournal
             |
             |                      +-> disposable QuickJS-NG/WASM Worker
             |                          -> typed inert intents only
             |
             |                      +-> lazy role-owned just-bash workspace
             |                          -> reserved Bun-compatible command
             |                          -> reserved role-bound `flect`
             |                          -> Rifty Workers and preview broker
             |
             +-- browser development
             |      Effect HTTP + SSE
             |      -> origin-restricted 127.0.0.1 Bun runtime
             |
             +-- packaged desktop
                    Effect RPC client
                    -> Tauri invoke/event bridge
                    -> Rust proxy
                    -> private NDJSON stdio
                    -> compiled Bun sidecar
                                    |
                         optional authenticated
                         loopback control broker
                        /          |          \
              public `flect`    JSON/SSE   `flect mcp`
                                    |
                                    v
                         shared Pi ModelRuntime
                         /                 \
             primary session set     candidate session set
             Guardian/App/Shaper     Preview App (+ isolated managers)
```

The browser never imports Pi. React never writes interface storage or revision
state directly. The native host never interprets prompts or model responses.
The static view-only route imports neither React nor Effect. Compiler, package,
shell, Worker, and Wasm implementations are separate dynamic boundaries after
workspace activation.

## Effect application kernel

Effect is the application architecture, not a utility wrapper:

- `Schema.Class`, tagged classes, and tagged errors define values and expected
  failures at every untrusted boundary.
- `Context.Service` defines Pi, client transport, storage, shaping, sandbox,
  and platform capabilities.
- named `Layer` values provide live and test implementations at composition
  roots.
- `Effect` models finite workflows and typed failures; `Stream` models agent
  turns.
- `Scope`, `acquireRelease`, finalizers, fibers, queues, refs, and subscription
  refs own cancellation, worker lifetime, transport lifetime, and serialized
  state.
- React owns rendering and ephemeral form state only. Event handlers are thin
  adapters into the managed Effect runtimes.

`FlectWorkspaceController` is the single semantic command and observable state
authority. Visible controls and authorized outside clients submit the same
strict `FlectCommandEnvelope` union. Its `SubscriptionRef` snapshot contains
validated interface, revision, workbench target and binding, model,
shell-preference, activity, control-client, and bounded diagnostic state. Its
event stream attributes
command, turn, tool, revision, safe-mode, and control transitions. Command IDs
are retained in a bounded idempotency window, and optional expected sequences
fail with a typed conflict instead of applying to newer state.

`FlectAxiProgram` is the single command-language boundary. One strict parser,
typed gateway, bounded projection, TOON/JSON formatter, and stable `0`/`1`/`2`
exit contract serve native terminal calls and browser-agent calls. The
`AgentCommandBus` is a bounded, scoped queue whose deferred response carries
the captured agent source into `FlectWorkspaceController`; its bridge owns
inspection, log reads, interface proposals, and authorized commands. Queue
capacity, cancellation, shutdown, and timeout fail closed without introducing
another state owner.

An interactive agent turn may call an authorized controller command from its
reserved Bash while the parent prompt command is waiting. The controller marks
only that exact parent operation as re-entrant, keeps unrelated user/control
commands behind the global permit, and removes the marker with an Effect
finalizer. This lets Shaper checkpoint a retained share fork or submit an exact
reviewed conflict resolution without deadlock or granting App Agent, Capsule,
or unrelated agent turns concurrent mutation.

`OperationJournal` retains at most 128 records and 512 KiB in memory; the public
workspace snapshot projects only the latest 12. Records
correlate workspace, command, operation, role, session, tool call, revision,
and outside client identifiers. Secret-shaped text is redacted before storage.
It is diagnostic evidence, not revision authority or a durable audit store.

All Effect packages are pinned to one exact version. `.repos/effect` is an
ignored checkout of that matching upstream release and is the primary local API
reference.

## Interface shaping

`InterfaceDocument` is a strict, recursive, versioned Effect Schema. Its closed
node registry currently contains:

- `stack`
- `text`
- `prompt`
- `button`
- `divider`
- `agent-panel`

Unknown types, unknown fields, duplicate node identifiers, unsupported
versions, excessive nesting, and unsafe actions fail before React renders them.
The raw tree is first checked by a non-recursive preflight with limits of 10
levels, 100 nodes, and 30 children per stack before the recursive schema
decoder runs. Persisted revision snapshots preflight their raw documents before
recursive revision decoding, and browser HTTP plus private native RPC shape
handlers validate their unknown document fields before passing them to the
runtime. Trusted browser and native clients schema-encode validated documents
before JSON transport. An `InterfaceDocument` contains no generated HTML, CSS,
JSX, or executable code path.

Shaper must terminate a proposal turn through its role-bound browser shell:
it writes `/workspace/interface.json`, runs `flect interface validate`, then
runs `flect interface propose` as its final action. The reserved command reads
only that disposable workspace, decodes unknown JSON through the closed
`InterfaceDocument` Effect Schema, and sends the validated value over the
bounded `AgentCommandBus`; the controller never receives a sandbox path.
Missing fields, invented node types or actions, excess properties, duplicate
identifiers, and tree bounds become safe path-specific output. Shaper receives
one bounded corrective retry in the same Pi session. A second missing or
invalid proposal ends without creating a revision and leaves field-level tool
evidence in the activity UI and journal.

The `ShapingKernel` owns the active, proposed, previewed, superseded, accepted,
last-known-good, rejected, and recovered revision transitions. A Shaper result
is decoded as an unknown value and fully validated. A valid local conversation
edit becomes one accepted Git transition without a visible proposal. External
code, shared artifacts, and authority changes remain isolated candidates until
explicit activation.
Ordinary transitions write one versioned journal snapshot before making the
new state visible; the startup-only reconciliation of a persisted `proposed`
revision is the exception. Reconciliation first creates the in-memory
`previewed` state, then makes its repair write best-effort so a storage failure
does not remove the visible preview or the safe-mode escape. Each journal
snapshot contains the active and last-known-good revisions, any proposal,
disabled extensions, safe-mode state, and the latest sequenced event. Discarding
an external candidate leaves the active document unchanged. Undo and safe mode are deterministic
and do not require Pi. The previous document-only storage key is read only as a
one-time migration source when no journal exists.

The built-in recovery shell is compiled with the app. `?safe=1` bypasses
customized storage without reading or writing it. Invalid persisted state fails
closed to that shell in a protected recovery state. The shell renders one
compiled composer outside the customizable document, so shaping cannot remove
the user's route back to the agent. Internal bindings route each request, but
the person sees no Use/Shape or agent-role selector. The same mounted composer
moves from the centered blank state into the protected right rail when a
document or conversation appears.

## Pi trust domains

Flect creates one Pi `ModelRuntime` for provider discovery and authentication.
Its primary session set contains three isolated agent sessions:

- **Guardian** has immutable recovery instructions. It has no user extensions,
  skills, templates, themes, context files, or tools. It accepts only a closed
  set of typed recovery reasons and returns a bounded plain-text diagnostic; it
  cannot write revisions or perform recovery.
- **App Agent** is the Use agent for an accepted product experience.
  It has its own prompt, history, operation controller, and role-owned
  browser-shell workspace. It does not receive shaping context or revision
  authority. Configured external Pi extensions remain disabled unless the user
  explicitly enables them for App Agent.
- **Shaper** receives the current validated document and a shaping instruction.
  It has no ambient host resources. Its only Pi tool is custom `bash`, which
  runs in a disposable browser workspace and returns through a typed
  request/result bridge. The reserved `flect interface validate/propose`
  commands are the terminating proposal path.
  Configured external Pi extensions remain disabled unless the user explicitly
  enables them for Shaper. A shaped document still returns as an untrusted
  candidate for Flect to validate.

While an external candidate exists, the client acquires another Pi session set and uses
its App session as **Preview App Agent**. It receives only a bounded public
projection of the candidate document, the candidate revision identifier, and
the user's request. It has its own history, lifecycle, cancellation, Pi session,
and disposable browser-shell workspace; it cannot see accepted-product history
or activation, discard, shaping, recovery, credential, or host authority.
Repeated corrections keep this candidate conversation warm. Activate or
Discard disposes its candidate session authority.

Each session has its own in-memory `SessionManager`, `SettingsManager`, and
`DefaultResourceLoader`. Their only shared object is the provider/model runtime.
Prompts and responses are not persisted by Flect. Disposing the Effect runtime
unsubscribes and disposes every acquired session set. The client closes its
primary and candidate handles when the model changes, the runtime is refreshed,
an operation fails, or the UI unmounts. Session handles are keyed by model
selection, and the runtime evicts and disposes the oldest set before exceeding
32 active sets.
Each protected session admits one active operation at a time: overlapping
shape requests fail with a typed busy conflict, while prompt-stream conflicts
become typed non-destructive busy events. App and Shaper cancellation and
browser-shell completion carry an explicit role and cannot affect the other
role. The client preserves a busy set, and the shell disables its composer
while a shaping proposal is running. Closing or evicting a set interrupts its
active operations, waits for completion for up to two seconds, and then
disposes every session in that set.
Raw Shaper output is capped at 256 KiB and raw Guardian output at 16 KiB before
either can cross the runtime boundary.

## Continuous protected shell

React derives four workspace phases from the validated revision snapshot:
blank, preview, accepted, and safe. A typed `WorkbenchSnapshot` retains internal
routing and accepted/candidate bindings, but those trust domains are not user
modes. One composer and one chronological conversation stay mounted while Flect
routes product work and edit work. Valid local changes become the running canvas
immediately; external candidates expose only **Activate app** and **Discard**.
Safe mode replaces the canvas with deterministic protected recovery.

App Agent does not rely on a semantic text router. Questions and product work
stay in Use. Its Pi session has a bounded `request_interface_edit` tool; only a
typed tool event can request the controller to hand an explicit edit to Shaper.
The controller correlates revision and operation identifiers and routes the
result through validation and atomic local acceptance. Internal authority
selection never mounts a second composer or asks the person to choose an agent.

Explicit element targeting adds one protected overlay outside guest authority.
The isolated frame publishes only a bounded semantic selector, role/text
summary, source hint, layout box, curated computed styles, viewport, and current
workspace revision; form values and unrelated DOM never cross the channel.
Pointer, touch, and keyboard selection are inactive during normal app use.
Move/resize/spacing/style intents and conversational targeted prompts enter the
same revision-checked Shaper handoff, so the agent remains the implementation
brain and a successful manipulation creates the same automatic Git checkpoint
as any other visible edit.

At wide sizes the agent rail is inline, 400 px by default, and keyboard- or
pointer-resizable from 340–520 px. At 761–980 px it becomes a right sheet; at
760 px and below it becomes a full-width sheet. Collapse, Escape, reopen, focus
restoration, and reduced-motion behavior remain owned by the compiled shell.
The revision decision, model picker, safe mode, rollback, send, and stop
controls are protected rather than part of a shaped document.

Turn and tool lifecycle are visible as separate instruments rather than
generic chat sentences. Tool cards show queued/running/succeeded/failed state,
duration, bounded command and result detail, exit status, preview links, and
proposal validation issues. Diagnostics exposes the latest safe correlated
operation evidence and the protected local-control toggle.

Each role owns a sticky-follow viewport. New content follows only while the
reader remains within 48 px of the bottom. Scrolling away preserves position,
tracks unread updates, and presents a keyboard-operable **Jump to latest**
control; streaming never steals focus.

Pi remains the sole owner of provider login state. One scoped Effect
authentication coordinator adapts Pi's discovered auth methods into bounded
public status and login events. It permits at most four concurrent provider
logins, keeps at most 32 public events per login, expires unfinished logins
after ten minutes, and normalizes every expected failure into Flect-authored
copy. Active login events live in a private auth `SubscriptionRef`; they never
enter `FlectWorkspaceSnapshot`, operation records, control SSE, AXI, MCP,
agent tools, revision storage, or shaped interfaces.

Safe selection replies carry only correlated login, prompt, and option
identifiers. Every free-text Pi prompt is sensitive and opens through an
unguessable, one-use `127.0.0.1` form owned by the private runtime. The form is
no-store, script-free, origin-checked, size-bounded, abortable, and passes an
Effect `Redacted` value directly to Pi before wiping it. Flect neither creates
a credential format nor exposes provider tokens to the WebView, browser APIs,
logs, fixtures, or interface documents.

## Browser host

Browser development starts:

- Vite on `127.0.0.1:5173`; and
- an Effect/Bun HTTP runtime on `127.0.0.1:3210`.

The client uses strict JSON contracts for finite requests and SSE for turn
events. The runtime accepts only the configured local origins and emits
sanitized public errors. This loopback API exists for browser development; it
is not used by the packaged desktop app and is not approved for network
exposure.

The connected browser workspace also registers its controller with the local
control broker through origin-protected internal routes. Those routes are not
the public control API and reject missing or foreign origins.

## Desktop host

Tauri packages the same Vite build with two executables: public `flect` and
private `flect-runtime`. Finder or explicit `flect app` launches the GUI. A
terminal invocation dispatches AXI arguments or `mcp` to the sibling runtime,
inherits stdio, and propagates its exit status. Rust selects only the host mode;
it does not parse domain commands, duplicate Effect policy, or render output.

In GUI mode the Rust host starts `flect-runtime`, limits frontend authority to
`core:default`, and exposes the private `rpc_send` command plus narrow,
main-window-only native setup and updater commands. `rpc_send`:

- accepts only Effect RPC request, acknowledgement, interrupt, EOF, and ping
  message tags;
- rejects frames larger than one MiB;
- writes accepted frames to sidecar stdin; and
- emits parsed sidecar responses back to the WebView.

The sidecar is a compiled Bun executable running the same `FlectRuntime`
handlers through Effect RPC NDJSON. Pi traffic never binds a TCP port. The
control broker owns a separate random loopback listener; without an enabled
grant it publishes no descriptor and rejects every request.

This RPC boundary owns Pi runtime operations: health, provider status and
authentication, model discovery and selection, session creation and close,
turns, interruption, shaping proposals, the narrow Guardian diagnostic,
browser-shell results, and their streams.
The client Effect kernel deliberately owns the revision journal so browser and
desktop hosts share one client-side state machine. Revision operations are not
duplicated in the sidecar.

Diagnostics exposes fixed native setup capabilities. Shell-link commands may
inspect, install, repair, or remove only `~/.local/bin/flect` targeting the
current installed app. Codex and Claude hook mutation and the OpenCode local
plugin are implemented by one Effect `AgentIntegration` service with injected
filesystem and path Layers, strict unknown JSON decoding, atomic private
writes, stable ownership markers, conflict detection, and removal of only
Flect-owned entries. Browser mode reports these host mutations as unavailable.

The `Uninstall` Effect service composes those ownership-aware operations into a
closed inspect/prepare plan. It derives the application path from the packaged
executable, disables Local control in the protected UI, preserves conflicts and
user data, and never receives a recursive-delete or app-removal operation. AXI
can inspect or prepare the same plan but cannot remove the app.

The official Tauri updater plugin is registered only when a non-empty public
key was compiled into a release. Rust fixes the HTTPS GitHub manifest endpoint,
checks the `main` window label, retains a plugin candidate behind a single-use
opaque token, and projects only bounded state through four commands. The Effect
adapter decodes every response and invalidates stale tokens; React owns only the
protected review/progress UI. Browser Flect receives an explicit unavailable
Layer. No capsule, agent, extension, product operation, AXI command, MCP method,
or embedded Bash route receives updater authority.

The Tauri window uses isolation mode and a restrictive content security policy.
`freezePrototype` is disabled because the current Tauri/React bootstrap fails
when it is enabled; it is not treated as a security boundary. The isolation
iframe, CSP, capability manifest, strict schemas, narrow command validation,
and private process transport remain active.

The current local app bundle is ad-hoc signed so macOS can validate its public
`flect` executable, private `flect-runtime` helper, and app resources during
development. It contains no separately shipped CLI or MCP companion. It is not
claimed to be Developer ID signed, notarized, hardened-runtime audited, or
protected by the macOS App Sandbox entitlement.

## Local control plane

`FlectControlBroker` is lifecycle-scoped inside the Bun browser runtime or
desktop sidecar. It binds only to `127.0.0.1` on a random port and stores no
parallel workspace state machine. When the protected UI enables control, the
connected workspace publishes its current snapshot, the broker creates a fresh
256-bit bearer, and `ControlDescriptor` writes the discovery record atomically
with private directory and file permissions.

The public loopback surface provides authenticated status, instance,
workspace, log, SSE event, and command endpoints. Bodies are bounded to one
MiB. Commands are strict schema values, cannot enable their own grant, and are
queued through a bounded Effect `Queue`; exact results use `Deferred`.
Multiple delivered commands run in scoped fibers so a cancel command can reach
an active App or Shaper turn. Disable is acknowledged through the shared
controller before the broker removes the descriptor, shuts down the queue,
fails pending requests, and invalidates the bearer.

The browser bridge uses origin-restricted HTTP. The desktop bridge uses the
existing private Effect RPC/Tauri channel. Both publish the same controller
snapshots, events, command outcomes, and named-client attribution. React
subscribes to the controller itself, so an outside action becomes visible
without reload, DOM automation, storage polling, or shadow state.

The public `flect` AXI program defaults to bounded TOON, supports explicit JSON
and one-event SSE-backed `watch`, and is embedded under the reserved command in
each role sandbox. The native executable dispatches command or MCP mode to the
private runtime without parsing domain arguments. MCP v2 advertises four
compact tools for inspect, command, event waiting, and logs; its command input
comes from the same Effect Schema union. Neither adapter prints or returns the
bearer. Complete invocation and security details are in
[`docs/local-control.md`](docs/local-control.md).

## Portable capsule boundary

The host-neutral codec in `shared/capsule.ts` is the executable `.flect`
format contract. It produces deterministic bounded ustar archives, strictly
decodes the versioned manifest, verifies every SHA-256 payload, and rejects
unknown fields, unsafe paths, duplicate entries, unsupported versions, and
authority-bearing state. Browser and desktop loaders enter through this same
decoder.

The end-user flow exports an accepted interface and imports a verified capsule
as an isolated proposal. Import never replaces accepted state directly; the
external preview/activate/discard boundary remains authoritative. Declarative
entrypoints use the trusted closed renderer. Compiled HTML entrypoints run in
an opaque-origin `allow-scripts` iframe with a network-denying CSP and one
rate/size-bounded Effect Schema `MessageChannel`. Capsule messages and host
replies are JSON-only, limited to 64 KiB, correlated by an intent identifier,
and closed over a versioned success/failure union. Capsules receive no direct
host authority. Safe mode bypasses the frame. Shaper may invoke import through its
reserved sandboxed `flect capsule import` command; App Agent may not.
Before activation, the protected shell projects a bounded review from the decoded
manifest: publisher, version, source revision, signature presence, contents,
platforms, and all requested capabilities. Required capabilities are activation
preconditions. The shell evaluates the declared semver range against the actual
Flect package version and the declared platform set against the browser or
native host; incompatibility blocks activation at the UI and controller while
leaving the isolated preview inspectable. A required request without a
registered grant keeps the preview inspectable but blocks activation in both
the UI and controller; optional requests remain ungranted. Protected review
projects availability separately from requested, granted, denied, expired, and
revoked lifecycle state.

Named product operations use an Effect decision store, capability broker,
registry, and adapter. A trusted host maps a stable operation ID to one strict
manifest capability, operation/resource/data scope, permitted confirmation
policies, optional limits, and bounded request/response projections. The
controller hashes the exact capsule archive and binds each decision to that
digest, provenance revision, capsule ID, workspace ID, and declared request.
Session and one-use decisions stay in memory; workspace and persistent
decisions use the strict version-2 store and matching legacy boolean state is
migrated without widening authority. No decision is copied into the capsule.
Capsule, App Agent, embedded `flect`, outside
CLI, JSON, and MCP calls enter the same closed `invoke-product-operation`
command and workspace controller. Capsule-origin commands additionally bind the
current accepted/candidate capsule ID and intent ID; undeclared, stale,
unregistered, or ungranted operations fail before the adapter.

The broker atomically reserves one-use and rate allowance before independent
product authorization, validates the product's exact operation/resource/data
projection against that reservation, and then invokes the adapter. Approval
does not override product denial. Every attempted registry invocation adds
bounded structured capability metadata to the operation journal without raw
input, output, headers, or credentials. The public AXI snapshot includes the
same reactive projections; `flect permissions list` can inspect them and paired
outside control can revoke a visible decision, but no agent-facing command can
create one.

`ProductHttp` owns HTTPS origin, path prefix,
method, header, request/response byte, and deadline policy. Callers supply only
the registered operation input. Absolute/cross-origin paths, undeclared methods
or headers, caller authorization/cookie headers, oversized traffic, redirects,
and deadlines fail through a typed sanitized error. Host credential headers are
injected privately, `fetch` omits browser credentials, only allowlisted response
headers and bounded bytes return, and neither capsule nor Pi receives raw
`fetch`. `ProductGraphql` builds on that service with an exact endpoint,
operation kind/name, SHA-256-pinned document, bounded variables/result, and
sanitized GraphQL failures. `ProductEvents` owns a scoped connector and bounded
backpressure queue, validates canonical decimal sequence order, resumes from
the last accepted cursor for a finite number of retries, and aborts on caller
cancellation. `ProductEventRegistry` holds the exact broker reservation open
and interrupts the connector when that decision expires, changes, or is
revoked.

Public adopter contracts and transport-only services live in the independently
packable `packages/product` workspace as `@flect/product`. Its Effect Schema
metadata separates product identity/compatibility, recommended capsule digest,
capability and extension sets, declarative migrations, inference policy, prior
connection state, and user-owned fork/export references. A validated branded
`ProductIntegration` supplies only named bounded closures. Flect's private
`product-integration` Layer bridge composes those public operation/event types
with the protected broker, decision store, and registries; the package has no
route to grant, activate, write workspace state, or replace recovery.

Adoption evaluation is deterministic and model-free. It compares a validated
integration with host facts and the prior connection record and returns ordered
public diagnostics for ready, offline, update, review, compatibility,
authentication, migration, and detach states. Product connection records are
independent from `ProductUserState`, so detaching a product retains personal
Git/export references for protected continuation or export. Model/inference
ownership is not an authorization input.

The stock Flect distribution registers no product operations; adopters compose
their policies and operations at the trusted runtime root. Browser and the
current desktop WebView use these same provider-neutral service contracts.
Ordinary HTTP/GraphQL uses CORS-aware fetch. Protected review offers once,
session, workspace,
persistent, deny, and revoke actions only when permitted by the host manifest;
safe mode uses the same model-free protected projection. One-use consumption,
expiry, and rate enforcement are implemented in the broker. Custom duration or
rate editing in the protected UI and a privileged native credential/transport
adapter are not yet shipped.

The public-boundary reference set exercises offline state, browser-direct fixed
GraphQL/events, a named authenticated broker, and a closure-private sharing
source. The three product integrations ship recommended capsules with public
App Agent guidance and an optional Shaper role; the private-sharing reference
composes only the trusted source adapter. The Flect-owned harness supplies
grants and protected state.

Ed25519 publisher-signature verification is implemented for `.flect-share`
manifests, while ordinary `.flect` capsule signature claims remain
presence-only and non-authoritative. Guarded personal forks and two-parent
merges are implemented by the sharing lifecycle, and standard single-entry
Vite JavaScript, TypeScript, React, Vue, and Svelte source projects compile
through the separate build adapter. Verified archive-local stylesheets, classic scripts, images,
fonts/media, and CSS URLs are projected into the generated `srcdoc`: text is
strict UTF-8, binary assets become `data:` URLs, and unresolved or remote
references remain unavailable under the deny-by-default CSP. Module graphs,
import maps, and source dependency resolution are not claimed.

URL installation is a user-initiated protected-shell operation over HTTPS, with
loopback HTTP reserved for local development. The browser request omits
credentials, bypasses cache, follows CORS, and is bounded by a 20-second timeout
and the format's 32 MiB ceiling while streaming. Only bytes that pass the same
strict capsule decoder become a candidate; a fetch, CORS, size, timeout, or
integrity failure leaves accepted state untouched.

If an installed and candidate capsule share an ID, the protected shell labels
the transition with both versions. A different ID is labeled as a replacement.
In both cases the accepted archive remains bound until activation, so Discard is a
lossless return to the installed version. Capsule personal-fork lineage and
compatible merge policy remain future layers rather than implicit overwrite
behavior.

Static-site and supported single-entry Vite imports use a protected pre-capsule
adapter. It validates all directory-relative paths, ignores VCS/dependency/cache
and common credential/private-key entries without reading their contents,
requires one root `index.html`, applies the capsule bounds, and
encodes the unchanged supported files into a local capsule. Source is not
executed during inspection. The ordinary manifest review and opaque compiled
frame remain the only path to preview. The current adapter does not yet commit
source to accepted state directly: it checkpoints recognizable files under
`project/` on isolated `flect/authoring`; the existing proposal-source delta
promotes them to `flect/accepted` only on Activate. It does not yet analyze
multi-page routes or content-dependent secrets. Folder files, bounded ZIP/POSIX
TAR archives, and public credential-free HTTPS Git repositories at an exact
commit all converge on this adapter. Archive validation rejects traversal,
encryption, ZIP64, unsupported entry types, excessive expansion, and unsafe
paths before packaging; Git clones and checkouts run in a disposable WASM-Git
workspace. Its bounded text inspection reports forms, module graphs, remote
URLs, storage, and workers as visible manifest requests;
unsupported required assumptions block activation.

Compiled capsule bytes persist through `CapsuleStore`, independently from the
user-controlled interface Git repository. The production store uses the
pinned `@riftydev/vfs` OPFS adapter and falls back to an in-memory VFS only
when OPFS is unavailable. It writes immutable archive objects first at
`/flect-capsules/default/objects/<sha256>.flect`, then atomically advances the
versioned accepted, candidate, and last-known-good bindings in
`/flect-capsules/default/bindings.json`. Startup re-decodes and hash-verifies
every bound archive before reconstructing presentation; a candidate is exposed
only when the shaping kernel also reports a proposal. Invalid or mismatched
bindings fail closed without replacing accepted state. Export reads the exact
accepted archive object, preserving the original bytes across reload.
The store exposes whether this binding is durable or session-only through the
public workspace snapshot. Diagnostics keeps a session-only warning visible
even while collapsed and states exactly which compiled state will be lost;
the fallback is never presented as durable persistence.

This capsule persistence contract currently supports compiled HTML entrypoints
plus the bounded local asset classes above. Framework source builds and module
graphs are compiled before capsule persistence and are not part of the runtime
capsule format. Additional capability adapters, authoritative capsule signing,
and capsule-level update/fork lineage remain open. Restored candidates can be
activated after worker restart; the guarded Wasm-Git transaction advances the
accepted snapshot before the decision completes.

## Restricted browser build boundary

`BrowserBuild` is an Effect service over a schema-decoded, one-build-per-Worker
protocol. A request contains an exact source revision, entrypoint, and bounded
mirrored file set. The Worker validates every path and byte limit, copies only
that set into Rolldown's disposable memfs, compiles browser JavaScript,
TypeScript, JSX, TSX, Vue SFCs, and Svelte components, and returns bounded output files plus deterministic
SHA-256 input and artifact digests. Completion, failure, timeout, and
interruption terminate the Worker. The service updates its in-memory
last-successful artifact only after a valid success response, so a later
compiler failure cannot replace the preview fallback.

Vue's and Svelte's official compilers are separate dynamic Worker boundaries
selected only when a mirrored `.vue` or `.svelte` module is actually loaded.
They produce ordinary browser modules and deterministic CSS for the same
Rolldown graph; neither compiler, framework runtime, nor Vite plugin enters the
Astro activation bootstrap or a vanilla/React build. Unsupported preprocessors
and external component blocks fail with bounded source diagnostics.

Rolldown 1.2 removed its earlier experimental CSS bundling. Flect therefore
owns a deliberately smaller CSS adapter: local relative `.css` imports resolve
only to files in the mirrored input, become inert modules for the JavaScript
graph, and their strict-UTF-8 contents are emitted in deterministic path order
as `app.css`. It is not a Vite plugin host and does not claim CSS modules,
PostCSS, preprocessors, remote imports, or `url(...)` rewriting.

`ProposalBuild` reads only the exact proposal commit from embedded Git, guarded
by the expected accepted and last-known-good commits. It strips the protected
`project/` prefix and hands that immutable snapshot to `BrowserBuild`; a dirty
authoring mirror or stale ref cannot enter the artifact. Successful artifacts
are written object-first to `/flect-builds/default/objects/<sha256>/`, with a
strict manifest and per-output hashes, before the last-successful binding is
advanced. Startup reconstructs and rehashes every output from OPFS; unsupported
hosts fall back to memory without changing the build authority boundary.
The workspace controller projects dependency resolution, lock checkpoint,
compile, package, success, and sanitized failure as typed `build-progress`
events and a reactive build snapshot. Active or failed work stays visible in
the protected rail, and outside clients observing the public snapshot see the
same phases; progress is not inferred from prose or private Worker logs.

Production Chromium proves this substrate with a real guarded Git proposal
containing React 19 TSX, stateful interaction, and imported local CSS, then a
new broken proposal commit, last-successful retention, explicit
cross-origin-isolation gating, Worker disposal, and OPFS restoration after page
reload. The protected **Import app project** flow also recognizes standard Vite
browser entrypoints, checkpoints source on `flect/authoring`, supersedes the
candidate from that source, compiles the exact guarded proposal, packages only
the verified outputs plus the inert import report, and opens the normal
Activate/Discard review. The review exposes the exact source revision and artifact
digest. Chromium proves Vite TypeScript activation/reload/export and a React JSX
import whose cached dependency graph rebuilds with the npm registry blocked.
The same production-browser contract covers interactive Vue and Svelte
fixtures and an offline reload from their verified cached package graphs.

`BrowserPackageResolver` supplies the package-lock/cache part of that boundary.
For the portable import path, Flect derives an inert manifest containing only
package identity and runtime `dependencies`; scripts and development tools
remain recognizable in Git source but cannot enter package resolution or run.
The resolver hashes that exact portable manifest plus an optional lock, checks the
content-addressed OPFS cache first, and otherwise delegates registry resolution
to the existing Rifty npm client behind Flect's credential-free HTTPS registry
broker. The installer stages into a disposable VFS, validates tarball
integrity, runs no lifecycle scripts, and returns a bounded delta. Flect then
requires npm lockfile version 3, exact semantic versions, SHA-512 integrity,
and approved-registry HTTPS tarball sources for every non-root entry.

The resolved `node_modules` graph and lock are bounded, deterministically
hashed, written object-first under `/flect-packages/default/objects/<sha256>/`,
and bound from the package-input digest only after every file exists. Cache
loads revalidate the manifest, lock, every file hash, and aggregate graph hash.
Before compilation, `ProposalBuild` compares the resolved lock with the exact
guarded proposal. A new or changed lock is checkpointed as
`project/package-lock.json` on `flect/authoring`; the shaping kernel then
supersedes the candidate through its normal receipt-guarded proposal
transaction. Compilation rereads that new proposal commit and passes its lock
back into the resolver. `ProposalBuild` replaces any source-tree dependency
directory with this verified graph and records its graph digest in the compiler
request, capsule build receipt, and persisted build artifact. Production
Chromium proves the accepted lock, exact versions, and integrity fields are
present in an ordinary exported Git repository, then proves the warm graph is
reused with npm registry access blocked. General registry selection, lock
conflict UX, cache management, and server/native framework compatibility remain
outside this browser contract.

## QuickJS logic sandbox

Optional pure extension logic runs in a new dedicated Worker and a new
QuickJS-NG WebAssembly runtime for each request. The wrapper applies:

- 256 KiB source, 1 MiB input, and 1 MiB output limits;
- a 16 MiB heap and 512 KiB stack;
- a 100 ms QuickJS interrupt deadline that starts after context creation and
  fixed hardening, so it measures only untrusted extension evaluation, plus a
  2 second outer worker deadline for the overall request;
- no module loader or host callbacks; and
- no `fetch`, DOM, storage, IndexedDB, navigator, process, Bun, Tauri, Date,
  Promise, Proxy, dynamic evaluation, or function constructor authority.

The only accepted output is a bounded `SandboxResult` containing
schema-validated inert intents. Closing or timing out the Effect scope
terminates the worker.

This is not an OS containment boundary. Native code, shell commands, filesystem
access, Pi extensions, product credentials, and network capabilities are not
loaded into the realm. The current broker preflights every returned intent and
requires both declaration in the extension manifest and an explicit grant
before calling an adapter. Its only adapter contract is the inert,
interface-local `interface:propose` operation used by the isolation diagnostic.
Product APIs, native effects, credentials, network access, and other privileged
adapters still require a separately reviewed, explicit, revocable authorization
design.

## Browser agent shell and Bun compatibility

App Agent and Shaper each receive one Pi tool named `bash`; Pi's native host
Bash is not enabled. A tool call becomes a strict, role-tagged `shell_request`
event on that agent's operation stream. The browser or Tauri WebView runs it in
the matching role-owned `SandboxedShell`, then returns a bounded
`BunCommandResult` through HTTP or private Effect RPC while the Pi tool awaits
the response. Prompt turns and Shaper proposals both carry this typed event;
the bridge times out, cleans up on interruption and session disposal, and never
carries a filesystem handle or credential.

`SandboxedShell` uses `just-bash@3.2.0` with a role-isolated working mirror,
hardened execution limits, and reserved `bun`, `flect`, and `git` commands.
Supported browser and WebView hosts persist each mirror under a separate
namespaced OPFS root; an unavailable OPFS surface falls back to a disposable
memory mirror without changing the capability boundary. Static AST rewriting
prevents
aliases, functions, PATH changes, workspace files, packages, and extensions
from shadowing any reserved command. The `flect` adapter captures the trusted
role,
session, parent operation, and tool call; it uses a bounded Effect queue and
cannot be reclassified through shell input. Direct-network,
JavaScript-evaluation, Python, SQLite, and compression commands are excluded.
The Vite build replaces the package's
otherwise reachable `node:zlib` import with a fail-closed adapter, so compressed
ripgrep input is unsupported without pulling Node compatibility into the
browser.

The Bun-compatible command supports `run`, `build`, `install`, `add`, `remove`,
and `stop`. TypeScript-family source uses pinned `esbuild-wasm@0.28.1`; Flect
does not claim exact Bun transpilation. Module execution uses
`@riftydev/runtime-js@0.2.0`. Package mutation stages
`@riftydev/npm-client@0.2.0` operations in `@riftydev/vfs@0.2.0`, verifies
integrity, rejects lifecycle scripts and native addons, and applies only a
bounded delta. The trusted browser adapter permits credential-free GET/HEAD
requests only to `https://registry.npmjs.org`.

`Bun.serve({ fetch })` registers a handler rather than opening a socket. A
Flect service worker forwards `/preview/<port>/` requests to an opaque guest
Worker. The response CSP permits scripts needed by the preview but denies
connections, parent access, and undeclared resources; the guest has no OPFS,
Flect storage, credentials, native bridge, or parent DOM. Effect scopes,
deadlines, interruption, and finalizers own every Worker, iframe, active run,
and preview.

The role workspace has no handle to the canonical OPFS/libgit2 repository,
and changing it does not activate an interface revision. The reserved Git
adapter exposes role-bound `status`, `branch`, `rev-parse`, and `log`; Shaper
observes the actual proposal ref once one exists. A guarded full-ref snapshot
seeds the mirror. Shaper alone may run bounded `add -A`, `commit -m`, and
`restore .`; accepted and proposal transitions carry the source delta. Patch
producing `git diff` stays unavailable until the browser engine proves it.
Rifty and just-bash are cooperative execution substrates,
not hostile-code containment. The trust boundary is the isolated realm plus
strict schemas, typed brokers, bounds, capability denial, validation, and
deterministic recovery.

Retained sharing source uses separate opaque `flect/shared/...` base, upstream,
fork, and candidate refs in the same Worker. Shaper's embedded `flect share
checkpoint` reads only explicitly named files from its sandbox and submits a
strict optimistic command; the controller and `ShareRepository` guard every
other ref and update the observable installation record. Clean upstream
updates pass a deterministic three-way resolved snapshot into the Worker. The
Worker writes and verifies the exact tree and a two-parent merge commit before
moving the candidate. Conflicts use Flect's deterministic byte-level three-way
policy so different Git engines cannot silently choose different review paths;
Shape resolution rechecks the exact refs and every recorded conflict path. See
[`docs/sharing.md`](docs/sharing.md) for the user lifecycle and current limits.

Build-gated diagnostics still exercise fixed JavaScript, WASI Preview 1, npm
fixture, Bun command, and preview flows. The ordinary composer is separately
tested in production Chromium with a full Pi event -> browser shell -> result
round trip. The exact surface is maintained in
[`docs/bun-compatibility.md`](docs/bun-compatibility.md).

## Recovery and failure behavior

Accepted and candidate interface state remains solely owned by the shaping
kernel and its Effect-owned Git repository. The repository is an ordinary Git
tree persisted in OPFS by a dedicated Wasm/libgit2 Worker. Guarded checkpoint
transactions verify expected accepted, proposal, and last-known-good refs
under a cross-context Web Lock before updating `flect.json` and the validated
snapshot. A protected activation receipt lives outside user-controlled Git
state; ref or receipt disagreement fails closed. Complete export includes
`.git`, and `flect repository status` projects bounded reactive ref and conflict
state through the shared controller. On the first load of a new repository,
the repository service commits the built-in interface and establishes matching
accepted, last-known-good, and activation state before exposing the workspace.
This makes a no-edit reload durable without weakening receipt/ref
reconciliation. Legacy state follows the separate, explicit migration path.
The Git service serializes every operation before selecting its current Worker;
the Worker is recycled after a bounded lease so long sessions release libgit2
state without handing queued work a terminated instance. Main-realm durable
stores share one initialized asynchronous OPFS surface under disjoint roots,
which lets lazy build and package services start without reopening storage while
the Git worker is active. Safe-mode entry records only the separate guarded
recovery marker and does not rewrite the accepted product ref.
A separate bounded role-continuity projection stores one visible compatibility
draft and completed App, Preview App, and Shaper messages. Each internal
projection retains at most 12 messages and eight activities. It is not
interface history and can be discarded without
touching revisions. Preview continuity is restored only for an exact candidate
revision match; partial assistant streams, activities, credentials, auth
events, Pi sessions, control grants, and provider state are excluded.

The continuity repository uses strict Effect Schemas, a 512 KiB aggregate
limit, generation checks, and Web Locks where available. It rereads inside the
lock and replaces one complete Web Storage value, so a stale tab or failed
quota write cannot silently replace the prior valid record. Safe mode does not
hydrate continuity content. Its compiled controls may inspect bounded
metadata, export a valid decoded record, or discard continuity independently
of last-known-good restoration. The exact lifecycle and current proof boundary
are in [`docs/recovery.md`](docs/recovery.md).

- invalid interface state -> compiled recovery shell;
- safe mode -> bypass customized state;
- invalid Shaper output -> no proposal;
- discarded external candidate -> active state unchanged;
- activated external candidate -> previous active state becomes last-known-good;
- rollback -> last-known-good becomes active;
- rollback failure -> the protected kernel remains authoritative and may ask
  Guardian for a bounded, inert explanation;
- repeated extension failures -> extension disabled and protected recovery shell
  restored;
- unavailable model runtime -> visible offline state while local interface
  recovery remains available;
- public runtime failures -> stable redacted messages, never raw provider
  errors.

## Performance boundary

Flect measures production-browser startup, initial resources, protected
composer interaction, local patches, external candidate rebuilds, Markdown,
cancellation, and repeated-cycle heap growth without adding telemetry or
another state owner. The one machine-readable release contract is
`shared/performance-budgets.ts`; the measurement environment, variance policy,
native-host complement, and rationale are documented in
[`docs/performance.md`](docs/performance.md).

## Pinned implementation sources

The implementation was checked against:

- Effect `4.0.0-beta.102`, upstream commit
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`;
- `@earendil-works/pi-coding-agent` `0.82.1`, release commit
  `b4f293684bba718d59cc1157679bcf6157b3a7f5`;
- Rifty leaf packages `0.2.0`, evaluated upstream commit
  `207e0ee9f108d6457e2448c956b84c2758e62671`;
- `@rolldown/browser` `1.2.1`, release tag `v1.2.1` at
  `93c535d8875daacde3afa84c0d4e9d26e87453e9`;
- `just-bash` `3.2.0` and `esbuild-wasm` `0.28.1`;
- Tauri CLI `2.11.4`, JavaScript API `2.11.1`, Rust crate `2.11.5`, and shell
  plugin `2.3.5`;
- `quickjs-emscripten-core` and the QuickJS-NG release-sync variant `0.32.0`;
- Playwright `1.62.0`; and
- Model Context Protocol split server/client packages `2.0.0` and Zod
  `4.2.0`.

Exact package versions are recorded in `package.json` and `bun.lock`.
