# Flect architecture

Flect is an agent-native interface shell with one shared TypeScript application
kernel and two current hosts: a normal browser and a Tauri desktop app.

This document describes the implementation that exists now. Future platform and
remote-runtime work belongs in the design documents under `docs/superpowers/`.

## Runtime topology

```text
                         validated InterfaceDocument
                         revision and shaping state
                                    |
                                    v
Browser or Tauri WebView -> Effect application kernel -> React renderer
             |                      |
             |                      +-> disposable QuickJS-NG/WASM Worker
             |                          -> typed inert intents only
             |
             |                      +-> role-owned just-bash workspace
             |                          -> reserved Bun-compatible command
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
                                    v
                         shared Pi ModelRuntime
                      /          |           \
             Guardian session  App session  Shaper session
```

The browser never imports Pi. React never writes interface storage or revision
state directly. The native host never interprets prompts or model responses.

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

The `ShapingKernel` owns the active, proposed, previewed, accepted,
last-known-good, rejected, and recovered revision transitions. A Shaper result
is decoded as an unknown value and fully validated before it becomes a preview.
Ordinary transitions write one versioned journal snapshot before making the
new state visible; the startup-only reconciliation of a persisted `proposed`
revision is the exception. Reconciliation first creates the in-memory
`previewed` state, then makes its repair write best-effort so a storage failure
does not remove the visible preview or the safe-mode escape. Each journal
snapshot contains the active and last-known-good revisions, any proposal,
disabled extensions, safe-mode state, and the latest sequenced event. Rejecting
leaves the active document unchanged. Rollback and safe mode are deterministic
and do not require Pi. The previous document-only storage key is read only as a
one-time migration source when no journal exists.

The built-in recovery shell is compiled with the app. `?safe=1` bypasses
customized storage without reading or writing it. Invalid persisted state fails
closed to that shell in a protected recovery state. The shell renders one
compiled composer outside the customizable document, so shaping cannot remove
the user's route back to an agent. A blank workspace routes it to Edit/Shaper;
an accepted product routes it to Run/App Agent. The same mounted composer moves
from the centered blank state into the protected right rail when a document or
conversation appears.

## Pi trust domains

Flect creates one Pi `ModelRuntime` for provider discovery and authentication,
then creates three isolated agent sessions:

- **Guardian** has immutable recovery instructions. It has no user extensions,
  skills, templates, themes, context files, or tools. It accepts only a closed
  set of typed recovery reasons and returns a bounded plain-text diagnostic; it
  cannot write revisions or perform recovery.
- **App Agent** is the Run-mode agent for using an accepted product experience.
  It has its own prompt, history, operation controller, and role-owned
  browser-shell workspace. It does not receive shaping context or revision
  authority. Configured external Pi extensions remain disabled unless the user
  explicitly enables them for App Agent.
- **Shaper** receives the current validated document and a shaping instruction.
  It has no ambient host resources. Its only Pi tool is Flect's custom `bash`,
  which runs in a disposable browser workspace and returns through a typed
  request/result bridge. Configured external Pi extensions remain disabled
  unless the user explicitly enables them for Shaper. A shaped document still
  returns as an untrusted candidate for Flect to validate.

Each session has its own in-memory `SessionManager`, `SettingsManager`, and
`DefaultResourceLoader`. Their only shared object is the provider/model runtime.
Prompts and responses are not persisted by Flect. Disposing the Effect runtime
unsubscribes and disposes all three sessions. The client closes its current
agent set when the model changes, the runtime is refreshed, an operation fails,
or the UI unmounts. Session handles are keyed by model selection, and the
runtime evicts and disposes the oldest set before exceeding 32 active sets.
Each protected session admits one active operation at a time: overlapping
shape requests fail with a typed busy conflict, while prompt-stream conflicts
become typed non-destructive busy events. App and Shaper cancellation and
browser-shell completion carry an explicit role and cannot affect the other
role. The client preserves a busy set, and the shell disables its composer
while a shaping proposal is running. Closing or evicting a set interrupts its
active operations, waits for completion for up to two seconds, and then
disposes all three sessions.
Raw Shaper output is capped at 256 KiB and raw Guardian output at 16 KiB before
either can cross the runtime boundary.

## Role-aware protected shell

React derives four workspace phases from the validated revision snapshot:
blank, preview, accepted, and safe. Blank and preview use Edit/Shaper; accepted
opens in Run/App Agent; safe mode replaces both with protected recovery.
Switching roles changes the visible role-owned timeline without relabeling
messages or submitting the other role's draft.

At wide sizes the agent rail is inline, 400 px by default, and keyboard- or
pointer-resizable from 340–520 px. At 761–980 px it becomes a right sheet; at
760 px and below it becomes a full-width sheet. Collapse, Escape, reopen, focus
restoration, and reduced-motion behavior remain owned by the compiled shell.
The revision decision, model picker, safe mode, rollback, send, and stop
controls are protected rather than part of a shaped document.

Pi remains the sole owner of provider login state. Flect neither creates a
credential format nor exposes provider tokens to the WebView, browser APIs,
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

## Desktop host

Tauri packages the same Vite build. The Rust host starts one external sidecar,
limits frontend authority to `core:default`, and exposes one private
`rpc_send` command. That command:

- accepts only Effect RPC request, acknowledgement, interrupt, EOF, and ping
  message tags;
- rejects frames larger than one MiB;
- writes accepted frames to sidecar stdin; and
- emits parsed sidecar responses back to the WebView.

The sidecar is a compiled Bun executable running the same `FlectRuntime`
handlers through Effect RPC NDJSON. It does not bind a TCP port.

This RPC boundary owns Pi runtime operations: health, model discovery and
selection, session creation and close, turns, interruption, shaping proposals,
the narrow Guardian diagnostic, browser-shell results, and their streams.
The client Effect kernel deliberately owns the revision journal so browser and
desktop hosts share one client-side state machine. Revision operations are not
duplicated in the sidecar.

The Tauri window uses isolation mode and a restrictive content security policy.
`freezePrototype` is disabled because the current Tauri/React bootstrap fails
when it is enabled; it is not treated as a security boundary. The isolation
iframe, CSP, capability manifest, strict schemas, narrow command validation,
and private process transport remain active.

The current local app bundle is ad-hoc signed so macOS can validate its nested
sidecar and app resources during development. It is not claimed to be Developer
ID signed, notarized, hardened-runtime audited, or protected by the macOS App
Sandbox entitlement.

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

`SandboxedShell` uses `just-bash@3.2.0` with a memory VFS, hardened execution
limits, and one reserved `bun` command. Static AST rewriting prevents aliases,
functions, PATH changes, workspace files, packages, and extensions from
shadowing that command. Direct-network, JavaScript-evaluation, Python, SQLite,
and compression commands are excluded. The Vite build replaces the package's
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

The role workspace is currently disposable memory. It is not the future
canonical OPFS/libgit2 workspace, and changing it does not activate an
interface revision. Rifty and just-bash are cooperative execution substrates,
not hostile-code containment. The trust boundary is the isolated realm plus
strict schemas, typed brokers, bounds, capability denial, validation, and
deterministic recovery.

Build-gated diagnostics still exercise fixed JavaScript, WASI Preview 1, npm
fixture, Bun command, and preview flows. The ordinary composer is separately
tested in production Chromium with a full Pi event -> browser shell -> result
round trip. The exact surface is maintained in
[`docs/bun-compatibility.md`](docs/bun-compatibility.md).

## Recovery and failure behavior

- invalid interface state -> compiled launcher;
- safe mode -> bypass customized state;
- invalid Shaper output -> no proposal;
- rejected preview -> active state unchanged;
- accepted preview -> previous active state becomes last-known-good;
- rollback -> last-known-good becomes active;
- rollback failure -> the protected kernel remains authoritative and may ask
  Guardian for a bounded, inert explanation;
- repeated extension failures -> extension disabled and protected launcher
  restored;
- unavailable model runtime -> visible offline state while local interface
  recovery remains available;
- public runtime failures -> stable redacted messages, never raw provider
  errors.

## Pinned implementation sources

The implementation was checked against:

- Effect `4.0.0-beta.102`, upstream commit
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`;
- `@earendil-works/pi-coding-agent` `0.82.1`, release commit
  `b4f293684bba718d59cc1157679bcf6157b3a7f5`;
- Rifty leaf packages `0.2.0`, evaluated upstream commit
  `207e0ee9f108d6457e2448c956b84c2758e62671`;
- `just-bash` `3.2.0` and `esbuild-wasm` `0.28.1`;
- Tauri CLI `2.11.4`, JavaScript API `2.11.1`, Rust crate `2.11.5`, and shell
  plugin `2.3.5`;
- `quickjs-emscripten-core` and the QuickJS-NG release-sync variant `0.32.0`;
  and
- Playwright `1.62.0`.

Exact package versions are recorded in `package.json` and `bun.lock`.
