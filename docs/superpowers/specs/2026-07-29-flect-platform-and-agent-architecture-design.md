# Flect platform and agent architecture design

Date: 2026-07-29

Status: Draft for written review

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
| React Native | [`9da1a011530f`](https://github.com/facebook/react-native/commit/9da1a011530faa45b23bb18a382252e196011120) |
| React Native macOS | [`a93f65c1174d`](https://github.com/microsoft/react-native-macos/commit/a93f65c1174d335faf216d76ea69de6fd42cfabf) |
| React Native Windows | [`c69cf55f67f9`](https://github.com/microsoft/react-native-windows/commit/c69cf55f67f9b03f467502dac1007ac2d9ebe209) |
| React Native for Web | [`a9de220ba9e6`](https://github.com/necolas/react-native-web/commit/a9de220ba9e65bdea540fb5322ffb1da2b0bf442) |
| Flutter | [`e769fffb6c33`](https://github.com/flutter/flutter/commit/e769fffb6c3346381b62693fe6ca16bee5ad2144) |
| Compose Multiplatform | [`c7da17559a6b`](https://github.com/JetBrains/compose-multiplatform/commit/c7da17559a6b752b593e16c7371cd0edbd097b01) |
| Capacitor | [`4c1c8709413b`](https://github.com/ionic-team/capacitor/commit/4c1c8709413b9c19b008c99122ca330cc3c90e6f) |
| Electron | [`d470d8fa50e0`](https://github.com/electron/electron/commit/d470d8fa50e09a29a9d262683ca36259a8b83f7f) |

The Tauri source inspection established an important limit: the generated
desktop plugin implementation is Rust, while the generated Swift plugin is
selected for iOS. Swift in a Tauri macOS application is therefore a custom
native boundary, not an assumed desktop plugin feature.

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

One codebase means one repository, one shared product model, and one shared
interface implementation. It does not prohibit small platform adapters in
Rust, Swift, or Kotlin where the operating system requires them.

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
7. Acceptance atomically appends a revision and advances the active pointer.
8. A `Stream<UiShapeEvent>` updates React and records an attributable event.
9. A render or migration failure leaves the previous revision active and
   exposes recovery through safe mode.

React renders the validated active revision and preview state. Pi, React,
Tauri, Rust, Swift, and extensions all use the same `UiShaping` service; none
may mutate interface persistence directly.

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
- Prove the React renderer consumes only decoded interface state.
- Prove safe mode restores a valid prior revision without Pi.

### Platform tests

- Keep the normal browser build and browser tests passing.
- Contract-test browser and Tauri transports against the same Effect service
  behavior.
- Contract-test the Effect RPC HTTP and Tauri/Stdio protocols against the same
  `RpcGroup`, including streaming errors, cancellation, and interruption.
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

1. Add the Effect UI-shaping kernel, immutable revision journal, preview, and
   deterministic safe-mode restore in the browser application.
2. Split the existing Pi integration into Guardian and Shaper services under
   an Effect supervisor, initially keeping both sessions in memory.
3. Give the Shaper only typed UI-shaping tools and give the Guardian only
   typed recovery tools.
4. Add the Tauri desktop host and a private sidecar transport while preserving
   the existing browser transport.
5. Add a Swift bridge only with the first approved macOS-native capability.
6. Add iOS and Android hosts as authenticated remote-runtime clients after the
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
- invalid or broken customization cannot replace the protected launcher; and
- deterministic safe mode and rollback work without any model.
