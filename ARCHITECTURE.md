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
                           /               \
                  Guardian session      Shaper session
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
An `InterfaceDocument` contains no generated HTML, CSS, JSX, or executable code
path.

The `ShapingKernel` owns the active, proposed, previewed, accepted,
last-known-good, rejected, and recovered revision transitions. A Shaper result
is decoded as an unknown value and fully validated before it becomes a preview.
Before committing a transition in memory, the kernel writes one versioned
journal snapshot containing the active and last-known-good revisions, any
proposal, disabled extensions, safe-mode state, and the latest sequenced event.
Rejecting leaves the active document unchanged. Rollback and safe mode are
deterministic and do not require Pi. The previous document-only storage key is
read only as a one-time migration source when no journal exists.

The built-in launcher is compiled with the app. `?safe=1` bypasses customized
storage without reading or writing it. Invalid persisted state fails closed to
that launcher in a protected recovery state. The shell also renders a compiled
composer outside the customizable document whenever that document omits a
`prompt` node, so shaping cannot remove the user's route back to the agent.

## Pi trust domains

Flect creates one Pi `ModelRuntime` for provider discovery and authentication,
then creates two isolated agent sessions:

- **Guardian** has immutable recovery instructions. It has no user extensions,
  skills, templates, themes, context files, or tools. It accepts only a closed
  set of typed recovery reasons and returns a bounded plain-text diagnostic; it
  cannot write revisions or perform recovery.
- **Shaper** receives the current validated document and a shaping instruction.
  It has no ambient resources or tools and can only return a candidate value
  for Flect to validate.

Each session has its own in-memory `SessionManager`, `SettingsManager`, and
`DefaultResourceLoader`. Their only shared object is the provider/model runtime.
Prompts and responses are not persisted by Flect. Disposing the Effect runtime
unsubscribes and disposes both sessions. The client closes its current pair
when the model changes, the runtime is refreshed, a transport operation fails,
or the UI unmounts. Session handles are keyed by model selection, and the
runtime evicts and disposes the oldest pair before exceeding 32 active pairs.
Each protected session admits one active operation at a time: overlapping shape
requests fail with a typed busy conflict, while prompt-stream conflicts become
typed non-destructive busy events. The client preserves a busy session, and the
shell disables its composer while a shaping proposal is running. Closing or
evicting a pair interrupts its active operation, waits for completion for up to
two seconds, and then disposes both sessions.
Raw Shaper output is capped at 256 KiB and raw Guardian output at 16 KiB before
either can cross the runtime boundary.

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
the narrow Guardian diagnostic, and their streams.
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
- a 100 ms QuickJS interrupt deadline and 2 second outer worker deadline;
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

## Recovery and failure behavior

- invalid interface state -> compiled launcher;
- safe mode -> bypass customized state;
- invalid Shaper output -> no proposal;
- rejected preview -> active state unchanged;
- accepted preview -> previous active state becomes last-known-good;
- rollback -> last-known-good becomes active;
- rollback failure -> the protected kernel remains authoritative and may ask
  Guardian for a bounded, inert explanation;
- repeated extension failures -> extension disabled and deterministic rollback;
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
- Tauri CLI `2.11.4`, JavaScript API `2.11.1`, Rust crate `2.11.5`, and shell
  plugin `2.3.5`;
- `quickjs-emscripten-core` and the QuickJS-NG release-sync variant `0.32.0`;
  and
- Playwright `1.62.0`.

Exact package versions are recorded in `package.json` and `bun.lock`.
