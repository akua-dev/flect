# Flect platform and agent architecture design

Date: 2026-07-29

Status: Approved for implementation

## Purpose

Flect needs one application architecture that can deliver a first-class
browser experience, installable applications on macOS, Windows, Linux, iOS,
and Android, and selective native implementation where a platform-specific
experience materially improves the product. It must preserve Effect as the
application and UI-shaping backbone, preserve Pi as the model and agent
runtime, and add the protected lower-level and customizable higher-level Pi
design described in the product vision.

This design chooses:

- Tauri 2 as the native application host;
- the existing React, TypeScript, and Effect application as the shared
  interface canvas;
- a typed native capability boundary that can use Swift and SwiftUI on macOS;
- a protected Guardian Pi and a user-facing Shaper Pi as isolated Pi SDK
  sessions supervised by Effect; and
- deterministic validation, safe mode, and rollback beneath both agents.

The design does not claim that the current repository already implements these
decisions. `ARCHITECTURE.md` remains the source of truth for implemented
behavior until the implementation is verified.

## Product interpretation of native

Flect's main canvas remains HTML, CSS, and React rendered by the browser or a
platform system WebView. This is deliberate. Flect's defining capability is
that people and product teams can shape and share interfaces without rebuilding
the product separately for every platform. The DOM, browser accessibility
model, web distribution, and existing Effect browser runtime are product
assets, not temporary scaffolding.

“Native” therefore means:

- a signed, installed application with platform-correct lifecycle and
  distribution;
- native windows, menus, keyboard behavior, file and share surfaces,
  notifications, secure storage, deep links, and system integration;
- responsive layouts and interaction patterns appropriate to each device;
- platform capabilities reached through explicit, typed permissions; and
- selective native windows or features when a WebView cannot provide the
  desired result.

It does not mean that every button must be an AppKit, UIKit, WinUI, or Android
View. A requirement for native-rendered controls throughout the main canvas
would be a different product architecture and would require reconsidering this
decision.

## Framework decision

### Selected: Tauri 2

Tauri can package a frontend that compiles to HTML, CSS, and JavaScript on
macOS, Windows, Linux, iOS, and Android. It uses the operating system WebView
instead of bundling Chromium and exposes native behavior through a
permissioned command and plugin boundary. The browser continues to receive the
same Vite build without the native host.

This is the best fit for Flect because it:

- preserves the implemented React and Effect code;
- keeps the browser a primary target rather than a compatibility target;
- gives the complete requested desktop and mobile host matrix in one
  framework;
- keeps native privileges outside user-shaped interface code;
- supports capability declarations and runtime authority at the WebView
  boundary; and
- permits Rust, Kotlin, Swift, and deeper platform integration behind a small
  adapter surface.

Primary evidence:

- [Tauri overview and language boundary](https://v2.tauri.app/start/)
- [Tauri frontend configuration](https://v2.tauri.app/start/frontend/)
- [Tauri distribution targets](https://v2.tauri.app/distribute/)
- [Tauri runtime authority](https://v2.tauri.app/security/runtime-authority/)
- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)

### Alternative: React Native platform family

React Native is the strongest option when the main surface must be composed
from native platform controls. It also has a credible macOS native-module
boundary using Swift and AppKit.

It is not selected because Flect would need to replace its DOM and CSS
renderer, use React Native for Web as a compatibility layer, combine separate
macOS and Windows partner projects, and find an additional Linux answer. That
is not one coherent platform host and would move browser behavior away from
the product's center.

Primary evidence:

- [React Native out-of-tree platforms](https://reactnative.dev/docs/0.77/out-of-tree-platforms)
- [React Native for Web compatibility](https://necolas.github.io/react-native-web/docs/react-native-compatibility/)
- [React Native macOS native development](https://microsoft.github.io/react-native-macos/docs/guides/native-development)

### Alternative: Flutter

Flutter has the most cohesive supported deployment matrix and a strong
macOS-native integration story, including Swift Package Manager integration.
It is a sound choice for a new Dart application whose shared renderer is the
primary goal.

It is not selected because it would replace Flect's Effect and TypeScript
application architecture with Dart and render the browser application through
CanvasKit or Skwasm rather than the normal DOM. That would discard the current
foundation and weaken the open, web-native interface canvas.

Primary evidence:

- [Flutter supported platforms](https://docs.flutter.dev/reference/supported-platforms)
- [Flutter web renderers](https://docs.flutter.dev/platform-integration/web/renderers)
- [Flutter integration in a native macOS project](https://docs.flutter.dev/add-to-app/macos/project-setup)

### Rejected combinations

Electron preserves the web application and has an officially documented
Swift/SwiftUI native-addon path, but it supports only desktop and bundles
Chromium, V8, and Node. Capacitor preserves the web application on iOS and
Android but does not provide the requested official desktop host. Combining
them would create two privileged host architectures where Tauri provides one.

- [Electron platform model](https://www.electronjs.org/docs/latest/why-electron)
- [Electron Swift integration](https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-swift-macos)
- [Capacitor platform model](https://capacitorjs.com/docs)

Compose Multiplatform is also not selected. It requires a Kotlin rewrite, its
web target is Beta, and Compose Desktop is a JVM-rendered surface rather than a
direct Swift/AppKit host.

## Research provenance

The decision was checked against shallow clones of the official upstream
repositories at the following commits on 2026-07-29:

| Project | Commit |
| --- | --- |
| Tauri | [`872428fe910e`](https://github.com/tauri-apps/tauri/commit/872428fe910efe25eeaa959b56adcd9d9a9a2157) |
| Effect | [`cccd029ae012`](https://github.com/Effect-TS/effect/commit/cccd029ae0124a33254b4094f1bc9c06cd43324e) |
| Pi | [`b4f293684bba`](https://github.com/earendil-works/pi/commit/b4f293684bba718d59cc1157679bcf6157b3a7f5) (`v0.82.1`) |
| QuickJS Emscripten | [`7b7af98e4e69`](https://github.com/justjake/quickjs-emscripten/commit/7b7af98e4e69757c64c27aac46a74e1e07229545) |
| React Native | [`9da1a011530f`](https://github.com/facebook/react-native/commit/9da1a011530faa45b23bb18a382252e196011120) |
| React Native macOS | [`a93f65c1174d`](https://github.com/microsoft/react-native-macos/commit/a93f65c1174d335faf216d76ea69de6fd42cfabf) |
| React Native Windows | [`c69cf55f67f9`](https://github.com/microsoft/react-native-windows/commit/c69cf55f67f9b03f467502dac1007ac2d9ebe209) |
| React Native for Web | [`a9de220ba9e6`](https://github.com/necolas/react-native-web/commit/a9de220ba9e65bdea540fb5322ffb1da2b0bf442) |
| Flutter | [`e769fffb6c33`](https://github.com/flutter/flutter/commit/e769fffb6c3346381b62693fe6ca16bee5ad2144) |
| Compose Multiplatform | [`c7da17559a6b`](https://github.com/JetBrains/compose-multiplatform/commit/c7da17559a6b752b593e16c7371cd0edbd097b01) |
| Capacitor | [`4c1c8709413b`](https://github.com/ionic-team/capacitor/commit/4c1c8709413b9c19b008c99122ca330cc3c90e6f) |
| Electron | [`d470d8fa50e0`](https://github.com/electron/electron/commit/d470d8fa50e09a29a9d262683ca36259a8b83f7f) |
| T3 Code | [`d19039aeef69`](https://github.com/pingdotgg/t3code/commit/d19039aeef6942e6eb204856c43b5354c0333e2d) |

The Tauri source inspection established an important limit: the generated
desktop plugin implementation is Rust, while the generated Swift plugin is
selected for iOS. Swift in a Tauri macOS application is therefore a custom
native boundary, not an assumed desktop plugin feature.

### T3 Code comparison

T3 Code is the closest inspected implementation reference for Flect's local
agent runtime and multi-surface concerns. At the pinned revision it uses an
Effect-heavy Bun server, Effect Schema contracts, a React/Vite web client, an
Electron desktop host, and a separate Expo/React Native mobile client. It
shares contracts and an Effect client runtime between web and mobile, but it
does not share the rendered interface between those surfaces.

Flect adopts the following demonstrated patterns:

- schema-only wire contracts that contain no runtime logic;
- one scoped Effect connection supervisor per runtime environment;
- separate finite queries, durable subscriptions, and idempotent commands;
- provider-native events normalized into a stable canonical event vocabulary;
- pure command decisions followed by durable events and projected read models;
- snapshot-plus-sequence subscriptions that cannot silently miss events
  during hydration or reconnection;
- scoped subprocess and session lifetimes with persisted resumption metadata;
- queue-backed side effects and typed milestone receipts so tests and runtime
  coordination do not poll or sleep; and
- platform applications that provide capability and persistence Layers rather
  than owning connection policy.

Flect deliberately does not copy:

- Electron plus a separately rendered React Native application, because
  Flect's customizable interface canvas must remain one DOM-based
  implementation across browser, desktop, and mobile;
- direct adapters for every model-provider CLI, because Pi already owns model
  selection, provider authentication, and provider integration;
- Git worktrees and hidden Git checkpoints, which are appropriate to a coding
  agent but not to a general interface shell;
- coding-specific thread, terminal, source-control, and diff semantics; or
- default persistence of raw provider payloads, which would make a user's
  company history provider-shaped and increase its privacy surface.

This comparison reinforces the Tauri decision rather than changing it. T3
Code's Electron host is effective because desktop owns Node-compatible coding
agent processes and its mobile UI is a separate remote-control application.
Flect instead values one user-shaped renderer on every platform. It adopts
T3 Code's runtime boundaries while keeping Tauri as the smaller,
capability-scoped cross-platform host.

Primary evidence:

- [T3 Code repository](https://github.com/pingdotgg/t3code)
- [T3 Code architecture overview](https://github.com/pingdotgg/t3code/blob/d19039aeef6942e6eb204856c43b5354c0333e2d/docs/architecture/overview.md)
- [T3 Code connection runtime](https://github.com/pingdotgg/t3code/blob/d19039aeef6942e6eb204856c43b5354c0333e2d/docs/architecture/connection-runtime.md)
- [T3 Code provider adapter contract](https://github.com/pingdotgg/t3code/blob/d19039aeef6942e6eb204856c43b5354c0333e2d/apps/server/src/provider/Services/ProviderAdapter.ts)
- [T3 Code canonical runtime event schemas](https://github.com/pingdotgg/t3code/blob/d19039aeef6942e6eb204856c43b5354c0333e2d/packages/contracts/src/providerRuntime.ts)
- [T3 Code orchestration contracts](https://github.com/pingdotgg/t3code/blob/d19039aeef6942e6eb204856c43b5354c0333e2d/packages/contracts/src/orchestration.ts)

## Platform architecture

### Shared interface and application kernel

The shared TypeScript application remains the product core:

- React renders validated interface documents and ephemeral interaction state.
- Effect owns workflows, data access, shaping, validation, errors, streams,
  concurrency, resource lifetime, and platform capabilities.
- Effect Schema is the source of truth for every value crossing the browser,
  native-host, Pi, extension, persistence, and product-API boundaries.
- Platform selection happens through Layers at composition roots, not through
  platform checks scattered through components.
- A schema-only contracts module defines commands, events, snapshots, RPC
  payloads, interface documents, and capability manifests without importing
  runtime implementations.
- A shared client-runtime module owns Effect workflows, environment
  supervision, subscriptions, projections, and platform capability contracts.
  Surface applications provide Layers and render state; they do not recreate
  connection or shaping policy.

One codebase means one repository, one shared product model, and one shared
interface implementation. It does not prohibit small platform adapters in
Rust, Swift, or Kotlin where the operating system requires them.

### Runtime environments and connection ownership

A Flect runtime environment is one authority that owns Pi, interface history,
product connections, capabilities, and local persistence. The environment may
be embedded beside a desktop client or reached through an approved remote
transport by a browser or mobile client.

Each connected environment receives one scoped `EnvironmentSupervisor`
service. It is the only owner of desired connection state, authentication
preparation, retries, active transport scope, and reconnection. Components,
hooks, query caches, and subscriptions never start their own retry loops.

The client boundary separates:

- finite queries for bounded reads;
- durable subscriptions for snapshots followed by live events; and
- idempotent commands for requested state transitions.

Connection health and domain-data freshness remain separate. Cached interface
state may be rendered while offline, but it never proves that the runtime is
connected. A transport is connected only after an authenticated application
probe succeeds. Interface, agent, and product-data subscriptions may each be
`empty`, `cached`, `synchronizing`, `live`, or failed without falsely changing
transport state.

Every durable subscription accepts the last applied sequence, replays later
events, emits a synchronization marker, and then continues live. Clients
deduplicate by sequence. This closes the race between fetching a snapshot and
subscribing, and makes browser, desktop, and mobile reconnection behavior
consistent.

### Browser host

The normal browser runs the Vite build directly. A browser transport Layer
communicates with an explicitly selected Flect runtime and a browser-native
capability Layer exposes only capabilities available through web standards.
Unavailable native capabilities fail with typed, user-actionable errors.

The current loopback Bun runtime remains a valid development and local-browser
host. A non-loopback runtime requires an independently reviewed authentication
and threat model.

### Desktop host

Tauri packages the same built frontend on macOS, Windows, and Linux. The Tauri
Rust host owns:

- window and application lifecycle;
- capability manifests and command authorization;
- native menus, tray behavior, deep links, and platform plugins;
- acquisition and shutdown of the Pi runtime sidecar; and
- the private transport between the WebView and the sidecar.

The packaged desktop application does not expose a privileged unauthenticated
localhost API. The preferred packaged transport is:

```text
React/Effect
    |
    | Effect RPC through a Tauri client Protocol
    v
Tauri Rust host
    |
    | opaque proxy over private stdio
    v
Effect RPC stdio server in the compiled Bun/TypeScript Pi runtime
```

An Effect `RpcGroup` is the transport contract. The browser uses Effect's HTTP
RPC protocol. The Tauri frontend uses a small `RpcClient.Protocol` adapter that
sends and receives framed messages through Tauri commands and channels. The
Rust host proxies those frames without interpreting application payloads, and
the Bun sidecar uses Effect's `RpcServer.layerProtocolStdio` with Bun's `Stdio`
Layer. Streaming RPCs carry agent events and cancellation.

Both transports therefore implement the same schema, handlers, typed failures,
and Streams. UI and shaping workflows do not know which transport is active.
The existing HTTP and SSE endpoints remain during migration and are removed
only after the Effect RPC browser transport has equivalent observable
behavior.

### Mobile host

Tauri packages the shared interface for iOS and Android and supplies native
plugins through Swift and Kotlin. Mobile does not embed the current Bun/Pi
runtime.

Bun currently distributes runtimes for macOS, Windows, and Linux, while Pi's
SDK is documented for Node.js applications:

- [Bun installation targets](https://bun.com/docs/installation)
- [Bun compiled executable targets](https://bun.com/docs/bundler/executables)
- [Pi SDK](https://pi.dev/docs/latest/sdk)

The first mobile host therefore connects to a user-approved authenticated
Flect runtime on another device or service. Designing that remote authority,
identity, discovery, and end-to-end protection is a separate security
milestone. A future mobile-compatible Pi runtime can replace that Layer
without changing the interface or UI-shaping architecture.

### macOS Swift boundary

Swift is available where it produces a materially better macOS experience. It
does not own cross-platform workflows or interface state.

The boundary is:

```text
Effect NativeHost service
    |
    | Effect Schema request and response
    v
Tauri command in Rust
    |
    | narrow C ABI, linked Swift package, or XPC protocol
    v
Swift/AppKit/SwiftUI capability
```

The implementation chooses one bridge mechanism for the first real Swift
capability rather than adding a bridge with no consumer. An XPC helper is
preferred when isolation or a separate process lifetime is valuable; a linked
Swift package with a narrow C ABI is preferred for small in-process
capabilities.

Swift may own a native window, menu-extra surface, share extension, or other
macOS-only presentation. It may not read or write the interface repository,
call Pi directly, or bypass Effect authorization. Responses return through
the typed native-host service.

## Two-level Pi architecture

### Topology

Flect creates two separate Pi SDK agent domains. They are siblings owned by an
Effect supervisor, not an untrusted agent process recursively constructing its
own security boundary.

```text
                         shared Pi ModelRuntime
                                  |
                  +---------------+---------------+
                  |                               |
           GuardianAgent                    ShaperAgent
     protected SessionManager          workspace SessionManager
     protected SettingsManager         workspace SettingsManager
     bundled ResourceLoader            approved ResourceLoader
                  |                               |
       Recovery capabilities                UI-shaping capabilities
                  +---------------+---------------+
                                  |
                         Effect UiShaping
                                  |
                     validated revision journal
                                  |
                 React renderer / protected safe mode
```

`SessionManager` supplies isolated session histories and persistence choices;
it is not the security boundary by itself. Separate `SettingsManager` and
`ResourceLoader` instances prevent resource discovery from crossing between
the two domains. The Effect capability graph and deterministic validation
enforce authority.

### Guardian Pi

The Guardian is the lower-level protected agent. Its system instructions and
resources are bundled with the application and excluded from the user-shaped
workspace.

It may receive narrowly scoped capabilities to:

- inspect the active interface document and validation result;
- inspect attributable revision metadata without model credentials or secret
  product data;
- compare the active revision with the last known-good revision;
- disable a failing user extension;
- restore a known-good revision after explicit user confirmation; and
- explain a recovery action before it is taken.

It cannot load user extensions, edit its own instructions, install packages,
call product APIs, execute a general shell, or grant capabilities. Recovery
continues to work deterministically when the Guardian has no available model.
The agent assists diagnosis and repair; it is not the root safety mechanism.

### Shaper Pi

The Shaper is the higher-level user-facing agent. It receives the user's
approved models, workspace context, components, and product capabilities. Its
first privileged ability is not direct filesystem or database access; it is a
typed UI-shaping capability.

The Shaper may:

- inspect the current validated interface document;
- discover approved component and action manifests;
- propose a typed change against an exact base revision;
- request a sandboxed preview;
- explain the proposed change; and
- request that the user accept or reject it.

It cannot write the interface repository directly, alter safe mode, modify the
Guardian, erase revision history, or promote its own permissions.

### Effect supervisor

An `AgentSupervisor` Effect service owns the shared `ModelRuntime` and acquires
both agent domains through scoped resources. It owns startup, interruption,
stream subscription, finalization, and communication. Guardian and Shaper
implementations are named Layers so tests can prove isolation without calling
model providers.

The supervisor may share non-secret model metadata and provider authentication
resolution through `ModelRuntime`. It does not share the two session managers,
settings managers, resource loaders, prompts, extension lists, or mutable
session histories.

### Canonical agent boundary

Pi remains Flect's only model and agent backend. Flect does not recreate Pi's
provider registry. A narrow `AgentRuntime` Effect service adapts Pi's SDK
events and session operations into Flect-owned canonical contracts.

The boundary distinguishes three representations:

1. Pi-native events exist only inside the runtime adapter.
2. `FlectAgentEvent` normalizes session, turn, content, tool, approval, usage,
   interruption, completion, and failure lifecycles.
3. `FlectDomainEvent` records product meaning such as a shaping request,
   proposal, preview, acceptance, revision activation, recovery, or user
   action.

Guardian and Shaper events use the same canonical vocabulary but carry an
explicit actor and trust-domain identity. Provider names, provider-native
request identifiers, and resumption cursors remain optional metadata at the
runtime boundary; they do not determine the product model. Raw Pi or provider
payloads are diagnostic data and are not persisted by default.

Each durable agent session has a runtime binding containing its role, session
identity, resumption cursor when supported, status, and last-seen metadata.
The initial in-memory milestone implements the same service contract without
claiming restart recovery. Once persistence is added, resumption is
capability-driven and fails closed to a new isolated session when the saved
cursor is absent or invalid. Effect `Scope` owns every session, event stream,
and subprocess so closing a session or runtime cannot leave an orphaned agent.

## Effect-first UI shaping

Effect is the default architecture for shaping the interface, not merely the
transport around an agent response.

### Contracts

Effect Schema defines:

- `InterfaceDocument`;
- `ComponentManifest` and `ActionManifest`;
- `UiRevision` and its attributable parent;
- `UiPatch` and `UiChangeProposal`;
- `CapabilityGrant`;
- `UiShapeEvent`;
- `FlectCommand`, `FlectDomainEvent`, `FlectEventMetadata`, and
  `FlectCommandReceipt`;
- snapshots, monotonic sequence cursors, and synchronization markers;
- preview and validation results; and
- typed shaping, conflict, capability, persistence, and recovery failures.

Unknown values are decoded before entering application state. Schema
migrations are explicit Effects. Unsupported versions fail closed.

### Services

The shaping kernel consists of focused `Context.Service` capabilities:

- `UiShaping` coordinates proposals, previews, validation, and commits.
- `InterfaceRepository` reads immutable revisions and atomically advances the
  active revision.
- `ComponentRegistry` resolves approved component and action manifests.
- `PreviewRuntime` renders an isolated proposed revision.
- `RevisionJournal` records attributable transitions and known-good markers.
- `EventJournal` appends durable domain events and reads them by sequence.
- `ProjectionPipeline` derives interface, agent, history, and recovery read
  models from committed events.
- `RuntimeReceiptBus` publishes typed completion milestones for runtime
  coordination and deterministic tests.
- `GuardianAgent` and `ShaperAgent` expose their distinct agent workflows.
- `NativeHost` exposes authorized platform capabilities.

Production, browser, Tauri, native, persistence, and test implementations are
named Layers composed at runtime edges.

Relevant Effect modules are the default building blocks:

- `JsonPatch` represents and applies deterministic document changes beneath
  the stricter `UiChangeProposal` authorization schema.
- `SubscriptionRef` owns the active revision and publishes its current value
  and subsequent changes.
- Effect Persistence and `BrowserPersistence` back revision storage where
  their guarantees fit the host.
- Effect RPC defines browser, Tauri, and sidecar requests, failures, and
  streaming responses.
- Effect process, Stdio, Sink, and Stream modules own TypeScript-side process
  and framed-I/O lifecycles.
- `Config`, `Redacted`, `Cause`, `Exit`, `Scope`, and `ManagedRuntime` remain
  the standard configuration, sensitive-value, failure, resource, and host
  boundaries.

Flect introduces a custom abstraction only when the pinned Effect checkout
lacks the required capability or when a platform boundary is implemented in a
non-TypeScript language. That adapter must still terminate in an Effect
service and use the shared schemas.

### Commands, events, and projections

State-changing intent enters the application as a schema-decoded command with
a unique command identifier, actor, correlation identifier, and exact base
revision where relevant. A pure decider evaluates the command against the
current projection and produces one or more event values or a typed rejection.
Side effects never live in the decider.

The runtime atomically:

1. rejects or recognizes an already processed command identifier;
2. appends the resulting events with monotonic sequence, causation, and
   attribution metadata;
3. persists any associated immutable interface revision;
4. advances the affected projections; and
5. stores the command receipt.

Queue-backed reactors perform work requested by committed events, such as
calling the Shaper, rendering a preview, invoking a product API, or asking the
Guardian for an explanation. Their results re-enter through commands and
events. A failed side effect therefore becomes visible history without
partially mutating the authoritative state.

The append-only event journal is the local foundation for the company or
personal history described in the product vision. Clients subscribe only to
the event channels and filters required by the active interface. Any future
external replication or interoperability transport requires a separate
reviewed identity, authorization, privacy, retention, and deletion design.
The local domain model must not depend on a particular transport.

Likewise, an advanced user or product may receive a scoped, read-only query
capability over approved projections. Arbitrary raw SQL from browser or
user-shaped code is not a default capability because it would bypass schema,
authorization, privacy, and migration boundaries.

Typed milestone receipts include at least `turn_quiesced`, `preview_ready`,
`revision_committed`, `interface_ready`, and `recovery_completed`. Runtime
coordination and tests wait on receipts or worker drains instead of polling
state or sleeping. Receipts do not replace durable domain events; they signal
that asynchronous consequences of those events have settled.

### Change flow

1. The user asks the Shaper to change the interface.
2. The Shaper calls the `UiShaping.propose` capability with the current base
   revision.
3. Effect Schema decodes the proposal and rejects unknown or unauthorized
   fields.
4. Deterministic validation checks document structure, component references,
   capabilities, and the protected-shell boundary.
5. `PreviewRuntime` produces an isolated preview without changing the active
   revision.
6. The user accepts or rejects the proposal.
7. Acceptance dispatches an idempotent command.
8. The command atomically appends the attributable domain event and immutable
   revision, advances projections, and stores its receipt.
9. A sequenced `Stream<UiShapeEvent>` updates React from the projection.
10. A render or migration failure leaves the previous revision active and
   exposes recovery through safe mode.

React renders the validated active revision and preview state. Pi, React,
Tauri, Rust, Swift, and extensions all use the same `UiShaping` service; none
may mutate interface persistence directly.

## Sandboxed extension execution

### Threat model and trust boundaries

The sandbox protects the application, user workspace, credentials, product
connections, native host, Guardian, recovery state, and machine from
agent-generated or third-party extension logic. Extension source, extension
input, model output, imported component packages, and persisted extension state
are untrusted.

The trusted computing base is deliberately smaller:

- the compiled launcher, renderer, schema decoder, capability broker, revision
  journal, safe mode, and recovery selector;
- the Effect runtime and the reviewed Flect application code;
- the Tauri Rust host and its explicit capability manifest; and
- the selected QuickJS WebAssembly runtime and system WebView.

QuickJS Emscripten states that it has not received a formal security audit.
Flect therefore does not treat a JavaScript interpreter alone as sufficient
isolation. Interpreter limits, a dedicated worker, a zero-authority protocol,
Tauri IPC isolation, content security policy, validation, attribution, and
deterministic recovery are independent layers.

Pi project trust and Pi sessions are not sandboxes. Pi documents that built-in
tools and extensions run with the authority of the Pi process. Both Flect Pi
domains therefore start with `noTools: "all"` and receive only their
Flect-defined typed tools.

### Declarative-first extension packages

An extension package is data, not an npm package. Installing an extension never
runs package-manager lifecycle scripts. Effect Schema defines its identifier,
semantic version, Flect API version, content hash, provenance, component and
action manifests, requested capabilities, declarative interface fragments, and
optional sandboxed source.

Interfaces remain declarative by default. A component that only needs layout,
content, state bindings, and host actions contains no executable source.
Generated UI changes likewise remain typed documents and patches. Executable
logic is opt-in for behavior that cannot be expressed declaratively.

The first sharing flow imports an inspected package after user confirmation and
pins its content hash. A network marketplace, automatic updates, signatures,
publisher identity, and revocation service require a later supply-chain design.

### Execution boundary

Optional extension logic runs in QuickJS-NG compiled to WebAssembly inside a
dedicated browser `Worker`. The same worker implementation runs in a normal
browser and the Tauri system WebView.

Effect owns the boundary:

- `ExtensionSandbox` is the application-facing `Context.Service`.
- `SandboxCapabilityBroker` authorizes returned intents.
- `ExtensionRegistry` resolves installed, enabled, and hash-pinned packages.
- an Effect `RpcGroup` defines schema-only evaluate, result, failure, health,
  and shutdown messages;
- `BrowserWorker` and Effect RPC's worker protocol own the client; and
- `BrowserWorkerRunner` owns the worker-side scoped runtime.

Each evaluation creates a fresh QuickJS runtime and context. It receives only a
schema-encoded immutable input and a frozen Flect API that can construct result
values and capability intents. It receives no DOM, `window`, network,
filesystem, process, environment, credentials, storage, Tauri IPC, or Pi
objects. Module loading is disabled. `Date`, dynamic evaluation, proxies, and
promises are disabled for the initial deterministic synchronous API.

Sandbox source cannot execute a product action directly. It can return a typed
intent such as a UI proposal or approved product-action request. The Effect
capability broker decodes the intent, checks the extension's grant, current
scope, user-confirmation policy, and exact base revision, then dispatches a
normal idempotent command. Rejected or unknown intents have no side effect.

### Resource limits and termination

Initial limits are configuration values with conservative protected defaults:

- 256 KiB source;
- 1 MiB encoded input and 1 MiB encoded result;
- 16 MiB QuickJS heap;
- 512 KiB QuickJS stack;
- 100 ms interpreter deadline; and
- 2 second outer worker watchdog, including worker and WebAssembly startup,
  with the 100 ms in-realm execution interrupt as the code deadline.

The interpreter uses its memory, stack, and interrupt handlers. Effect owns the
outer deadline, interruption, worker acquisition, and finalization. If the
interpreter does not return, the host terminates the worker and acquires a
fresh worker before accepting another evaluation. Handles, contexts, and
runtimes are disposed after every request.

Timeout, memory exhaustion, malformed output, worker failure, unsupported API
version, capability denial, and user cancellation are distinct schema-backed
errors. Public failures are sanitized; causes and extension source are not
copied into product history.

### Recovery

An extension result is always a preview or intent until deterministic
validation succeeds. It never updates the active interface directly.

The revision journal records the extension identifier, version, content hash,
requested grant, actor, and parent revision. Three consecutive startup or
render failures attributable to the same extension and active revision disable
that extension, preserve the rejected revision for inspection, and open safe
mode on the last known-good revision. Recovery works without QuickJS, Pi, or a
model provider.

The Guardian may inspect sanitized sandbox failures and request a deterministic
disable or restore operation. It cannot run extension source, grant a
capability, edit the sandbox, or write revision state itself.

### Desktop defense in depth

The packaged Tauri application additionally:

- uses Tauri's isolation pattern to validate frontend IPC before it reaches the
  Rust core;
- exposes no frontend shell or sidecar-spawn permission;
- loads only bundled application assets in privileged WebViews;
- applies a restrictive content security policy, adding only the
  `wasm-unsafe-eval` allowance required to instantiate the sandbox runtime;
- scopes the normal and safe-mode windows to separate minimum capabilities;
- proxies one schema-framed application protocol to the private sidecar; and
- keeps the compiled Bun/Pi sidecar on private standard I/O rather than a
  privileged local port.

QuickJS is an application-code sandbox, not an operating-system boundary for
native tools. Any future capability that executes an untrusted shell command,
native binary, or Pi extension requires a separately reviewed container, VM,
micro-VM, XPC, or operating-system sandbox with explicit filesystem, network,
process, and credential policy.

## Protected recovery

The compiled launcher, safe-mode entry point, document decoder, revision
selector, and deterministic restore operation remain outside user-modifiable
state.

Safe mode:

- starts without loading the active customized interface or user extensions;
- works without Pi or an authenticated model;
- shows the active, last-known-good, and available prior revisions;
- can restore a selected valid revision deterministically;
- may ask the Guardian to diagnose or explain when a model is available; and
- never asks the Shaper to repair the trust boundary it may have broken.

Repeated startup failures increment protected crash metadata. Crossing the
crash threshold opens safe mode and leaves customized state disabled until the
user explicitly retries or restores it. The threshold is three consecutive
failures for the same active revision before the interface reaches its
`interface_ready` event. A successful `interface_ready` event resets that
revision's failure count.

## Security model

- Tauri capabilities are denied by default and scoped per window and WebView.
- Tauri's isolation pattern validates the single application IPC surface.
- A WebView that can load remote content receives no privileged native
  commands.
- The safe-mode window has only recovery capabilities and cannot load user
  interface code.
- Native-host requests and results are decoded at the Effect boundary.
- The packaged desktop Pi runtime communicates over a private child-process
  channel using Effect RPC over Stdio rather than a generally reachable port.
- Guardian resources are bundled and immutable at runtime.
- Shaper capabilities are explicit, inspectable, and revocable.
- Model credentials remain owned by Pi and never enter interface documents,
  native messages, revision history, generated artifacts, or logs.
- Agent output is always a proposal until deterministic code validates and
  commits it.
- Extension packages are inert data at installation time; npm lifecycle code
  is never an extension installation mechanism.
- Optional extension source runs only through `ExtensionSandbox`; it has zero
  ambient authority and can return only schema-decoded capability intents.

## Failure behavior

- If Tauri or a native capability is unavailable, the corresponding Effect
  fails with a typed unsupported-capability error and the shared interface
  remains usable.
- If the desktop sidecar fails, the host reports a sanitized runtime error,
  disposes the child, and offers a bounded restart.
- If the Shaper fails or returns an invalid proposal, no revision changes.
- If a proposal is based on a stale revision, it fails with a typed conflict
  and must be regenerated against the active revision.
- If rendering the new revision fails, startup keeps the last known-good
  revision and safe mode exposes the rejected revision for diagnosis.
- If the Guardian fails, deterministic validation, revision selection, and
  rollback remain available.
- If no model is authenticated, browser, native shell, safe mode, and manual
  interface selection still work.
- If connectivity is lost, the single environment supervisor releases the
  active transport, preserves decoded cached projections, and resumes from the
  last applied sequence when connectivity returns.
- If a reactor fails after its initiating event commits, the failure is
  recorded as a domain event and no hidden partial state is treated as
  successful.

## Verification strategy

### Architecture tests

- Prove Guardian and Shaper receive different session managers, settings
  managers, resource loaders, system instructions, and capabilities.
- Prove Guardian resource discovery cannot load workspace or user extension
  paths.
- Prove Shaper capabilities cannot address Guardian, safe-mode, or revision
  journal internals.
- Prove both agents are acquired and disposed through the Effect supervisor.

### UI-shaping tests

- Use `@effect/vitest` and test Layers for every shaping workflow.
- Prove invalid, unauthorized, unsupported, and stale patches leave the active
  revision unchanged.
- Prove accepted patches append an attributable revision atomically.
- Prove duplicate command identifiers cannot apply a revision or product
  action twice.
- Prove rebuilding projections from the event journal produces the same
  observable state.
- Prove snapshot-plus-sequence subscription handoff neither drops nor
  duplicates observable events.
- Prove milestone tests wait on typed receipts or worker drains rather than
  timing delays.
- Prove the React renderer consumes only decoded interface state.
- Prove safe mode restores a valid prior revision without Pi.

### Sandbox tests

- Prove declarative extensions install and render without executing source.
- Prove the sandbox has no DOM, network, filesystem, process, Tauri, Pi, time,
  dynamic-evaluation, or module-loading authority.
- Prove undeclared, revoked, malformed, stale, and unknown capability intents
  have no side effect.
- Prove infinite loops, recursion, oversized input and output, and memory
  exhaustion terminate within their outer bound and leave a usable fresh
  worker.
- Prove two extensions never share globals or mutable QuickJS state.
- Prove every QuickJS handle, context, runtime, worker scope, and Effect fiber
  is released after success, failure, interruption, and application shutdown.
- Prove three attributable failures disable the extension and deterministic
  safe-mode restore works without the sandbox worker or Pi.
- Run the sandbox and recovery flows in the automated real-browser suite, not
  only under a simulated DOM.

### Platform tests

- Keep the normal browser build and browser tests passing.
- Contract-test browser and Tauri transports against the same Effect service
  behavior.
- Contract-test the Effect RPC HTTP and Tauri/Stdio protocols against the same
  `RpcGroup`, including streaming errors, cancellation, and interruption.
- Prove each environment has one retry owner and that cached data, transport
  health, and subscription freshness remain distinct states.
- Smoke-test desktop sidecar acquisition, streaming, cancellation, crash, and
  finalization on macOS, Windows, and Linux.
- Test Tauri capability manifests so normal, remote-content, and safe-mode
  windows receive only their intended commands.
- Test each Swift boundary with a fake `NativeHost` Layer and a native
  integration test on macOS.
- Treat iOS and Android as remote-runtime clients until a mobile-compatible
  Pi runtime is independently designed and verified.

## Implementation sequence

The architecture should be implemented as separately reviewable milestones:

1. Add schema-only command, canonical event, receipt, snapshot, and
   subscription contracts.
2. Add the Effect event journal, pure decider, projection pipeline, immutable
   revision journal, queue-backed reactors, and deterministic worker drains.
3. Add the Effect UI-shaping kernel, isolated preview, sequenced client
   projection, and deterministic safe-mode restore in the browser
   application.
4. Add declarative extension packages, the QuickJS-NG Effect worker sandbox,
   capability intents, execution limits, and attributable disable/recovery.
5. Split the existing Pi integration into Guardian and Shaper services under
   an Effect supervisor, initially keeping both sessions in memory.
6. Give the Shaper only typed UI-shaping tools and give the Guardian only
   typed recovery tools.
7. Add the Tauri desktop host, IPC isolation, and a private sidecar transport
   while preserving
   the existing browser transport.
8. Add a Swift bridge only with the first approved macOS-native capability.
9. Add iOS and Android hosts as authenticated remote-runtime clients after the
   remote authority design is approved.

Each milestone must leave the repository runnable, tested, and fail-closed.

## Success criteria

This design succeeds when:

- one React and Effect interface codebase runs in a browser and Tauri hosts;
- macOS, Windows, and Linux applications own Pi runtime lifecycle without
  exposing a privileged local port;
- iOS and Android run the shared interface with an explicit remote-runtime
  boundary;
- macOS can add a Swift or SwiftUI capability without moving shared product
  logic out of Effect;
- Guardian and Shaper sessions are demonstrably isolated;
- all UI shaping passes through typed Effect services;
- canonical commands and events produce replayable, attributable history
  without exposing provider-native payloads;
- clients hydrate and reconnect without gaps through sequenced snapshots and
  subscriptions;
- invalid or broken customization cannot replace the protected launcher; and
- deterministic safe mode and rollback work without any model;
- optional extension code runs with zero ambient authority inside the bounded
  worker sandbox; and
- sandbox failure, interruption, and escape attempts cannot mutate the active
  interface or invoke native and product capabilities.
