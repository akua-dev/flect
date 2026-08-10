# ADR 0003: Use Astro on Vite as the browser activation shell

- **Status:** Accepted and implemented
- **Date:** 2026-08-10

## Context

Flect has two distinct browser responsibilities:

1. run the interface a person opened; and
2. provide the Flect system that can inspect, edit, build, repair, version, and
   recover that interface.

Those responsibilities previously shared one eager direct Vite/React SPA entry
graph. Astro does not replace Vite: Astro itself uses Vite for development,
transformation, plugins, and production bundling. Flect now uses Astro's
document and activation layer above Vite while keeping the protected workspace
as an on-demand React/Effect application.

The
production baseline at commit `f5503b0` transfers approximately 539 KiB of
compressed initial JavaScript and decodes 1.89 MiB before the user invokes an
agent, compiler, package manager, sandbox, or history operation. The entry
runtime statically composes the role-owned browser shell, which reaches
`just-bash/browser` even when the user only opens the current interface.

Flect should instead make an opened interface useful immediately and load the
authoring system only when the person asks Flect to act. This is especially
important for shared browser interfaces, where most visits may never enter an
editing flow.

Astro's islands architecture renders ordinary components to HTML without a
client runtime and hydrates only explicitly selected client islands. It can
also build React, Preact, Svelte, Vue, and Solid components through framework
integrations. Static generation is Astro's default route behavior, which is
compatible in principle with a browser deployment and a packaged Tauri
WebView.

These properties match the outer-host problem, but they do not by themselves
solve Flect's runtime, workspace, or arbitrary-framework problem.

## Decision

Flect adopts Astro as the browser document and activation shell.

Astro owns:

- the static browser document, metadata, loading and unavailable states;
- the smallest protected visual frame needed before Flect activation;
- static or selectively hydrated product surfaces that are known at build
  time; and
- the explicit activation boundary that loads the Flect system.

Astro does not own:

- agent orchestration or Pi sessions;
- the canonical source workspace, Git history, builds, or last-known-good
  runtime;
- untrusted-code execution, package installation, or capability grants;
- the platform-native host boundary; or
- runtime interpretation of arbitrary React, Vue, Svelte, HTML, or CSS
  projects.

Those responsibilities remain behind typed Effect services and host-specific
Layers.

## Activation model

Opening a shared interface and activating Flect are different lifecycle
events.

### Opened interface

The browser first receives the smallest complete document that can display and
run the opened product experience. It must not construct the Flect agent,
workspace, Git, compiler, sandbox, package manager, or model client merely
because the page opened.

The opened interface may load its own application JavaScript when its behavior
requires it. That application payload is measured separately from the Flect
authoring payload.

### Flect activation

Flect activates only after an explicit user signal such as:

- focusing or opening the Flect composer;
- focusing or opening the protected composer;
- using the Flect keyboard shortcut; or
- invoking an operation that requires a Flect capability.

The activation control acknowledges input in the same frame. It then performs
an explicit dynamic import of the Flect client runtime and mounts the protected
agent surface. Astro's built-in `client:load`, `client:idle`, and
`client:visible` policies are useful for ordinary islands, but none represents
"load only after this product action" exactly. The activation boundary must
therefore use a small event-driven dynamic import or a reviewed custom client
directive.

Loading the Flect client runtime still does not load every capability. Agent
tools acquire compiler, shell, sandbox, package, Worker, and Wasm Layers only
when the selected typed operation needs them. Their Effect scopes own cleanup
and disposal.

## Target topology

```text
Astro browser document
├─ opened product interface
│  └─ only the product JavaScript required by that interface
├─ tiny Flect activation control
└─ explicit user activation
   └─ Flect client island
      ├─ protected canvas and composer
      ├─ typed Effect runtime client
      └─ runtime coordinator
         ├─ one visible conversation
         ├─ isolated App, Shaper, and Guardian trust domains
         ├─ capability policy
         ├─ workspace, Git, build, and last-known-good services
         └─ on-demand execution substrates
            ├─ browser Workers
            └─ private desktop sidecar
```

The person experiences one agent with one continuous conversation. Existing
internal trust separation remains an implementation and authority boundary;
it is not exposed as Edit/Run modes, separate drafts, or role switches.

## Effect composition roots

The implementation must replace the current universal client runtime with
explicit subsystem boundaries:

- `BrowserDocumentLayer` provides only environment detection, minimal
  appearance, activation, and unavailable-state behavior.
- `FlectClientLayer` is constructed once when Flect activates and owns the
  typed transport, session projection, workspace projection, preferences, and
  platform-capability contracts required by the protected UI.
- `WorkspaceRuntimeLayer` owns canonical workspace, Git, build, preview, and
  last-known-good lifecycles outside the UI main thread.
- `ToolExecutionLayer` is acquired only for a typed tool operation and owns
  disposable Workers, shell workspaces, Wasm runtimes, package operations, and
  cancellation.
- Browser, Tauri, and test composition roots provide different platform Layers
  without platform checks inside React components.

Layers that own transports, Workers, sidecars, subscriptions, or workspaces
must have scoped acquisition and release. Layer values are constructed once at
their runtime boundary so Effect memoization and resource sharing remain
explicit.

React renders validated snapshots and owns ephemeral input state. It does not
coordinate proposal, build, Git, recovery, or capability workflows.

## Framework boundary

Astro's framework integrations are a build-time composition feature, not a
universal runtime for arbitrary user projects.

Flect may use Astro to combine known host components from different supported
frameworks, but it must not install every framework integration into the host
or download multiple framework runtimes speculatively. A component island is
implemented in one framework, and each hydrated framework brings its required
client runtime.

User projects continue to enter through Flect's independent project-adapter
and build contracts:

- detect and validate the project type;
- build it in the isolated workspace runtime;
- produce an attributable runnable artifact;
- run that artifact behind the canvas isolation boundary; and
- expose semantic inspection and editing through typed Flect tools.

React, Vue, Svelte, Astro, HTML, and CSS support is therefore a property of the
workspace/build adapter system. Astro is the host gate into those
possibilities, not the mechanism that makes arbitrary source projects mutually
compatible at runtime.

## Browser and native hosts

The browser uses Astro's static output by default. Server islands and
server-only Astro features are outside the initial local/browser-host decision.

The Tauri application may package the same static document and shared
protected UI, but it activates the Flect client as part of opening the Flect
workspace. Tauri remains responsible for platform-native window, menu,
shortcut, file, appearance, accessibility, notification, and lifecycle
surfaces. Astro does not provide native feel.

On desktop, workspace, Git, build, agent, and sandbox work belong in the
private sidecar or explicitly isolated workers rather than the WebView main
thread. Moving a tool out of the WebView must not turn it into ambient native
shell access; the same typed capability, virtual-filesystem, package, network,
and resource limits remain mandatory.

## Performance gates

Production builds must continue to prove all of the following:

- a view-only route requests no Flect agent, Effect runtime, workspace,
  compiler, shell, package, sandbox, Worker, or Wasm chunk;
- the Flect activation bootstrap is at most 10 KiB gzip;
- the protected interactive Flect client is at most 200 KiB gzip and 600 KiB
  decoded before optional tools;
- esbuild, Rifty, QuickJS, `just-bash`, package clients, and their Worker/Wasm
  artifacts load only on the typed operation that needs them;
- activation acknowledges input in the same frame and presents stable progress
  without layout shift or focus loss;
- the warmed protected composer is usable within 300ms locally and 1,000ms on
  the Fast 4G / 4x CPU reference profile;
- opening and using the product interface remains possible if the Flect runtime
  is offline; and
- static Astro output packages and runs under the existing Tauri CSP and
  isolation boundary without an Astro server.

The browser and packaged-host performance gates in issue #36 remain mandatory.

## Validation result

The measured comparison used an Astro-on-Vite static host and a direct Vite SPA
with the same event-driven activation boundary. Both variants used Vite. The
implemented Astro path includes:

1. a static opened-interface route;
2. focus, pointer, keyboard-shortcut, and initial-prompt activation;
3. the existing React protected shell behind the activation boundary;
4. the real typed Effect client Layer constructed only after activation;
5. real compiler, package, shell, Worker, and Wasm Layers loaded only after a
   typed tool request;
6. production bundle and request-graph evidence;
7. production Chromium and AXI checks for open, activation, reload, keyboard,
   narrow viewport, reduced motion, appearance, focus, and request boundaries;
   and
8. static output compatible with the existing Tauri bundle and CSP boundary.

The accepted build requests four view-only resources. Its activation bootstrap
is 3,159 bytes gzip / 6,559 bytes decoded and its initial CSS is 1,094 bytes
gzip / 2,976 bytes decoded. The view-only route requests no Flect workspace,
Effect runtime, Git, compiler, shell, package, Worker, or Wasm code. The first
workspace activation reaches 28 modules; shell, compiler, package, Worker, and
Wasm boundaries remain independently on demand. Local production measurements
record 241 ms cold activation, 219 ms warm activation, and 5 ms p95 composer
acknowledgement. The full evidence is recorded in
[`2026-08-10-astro-live-canvas-verification.md`](../verification/2026-08-10-astro-live-canvas-verification.md).

## Consequences

- Shared browser interfaces can open without paying for Flect authoring.
- Flect can acknowledge activation immediately while loading the system behind
  a deliberate boundary.
- The host can use more than one UI framework where a known component justifies
  it, but this is not the default and does not replace project adapters.
- Browser and Tauri can share static output while retaining different platform
  capability Layers.
- The former eager singleton entry is replaced by an event-driven activation
  module and scoped lazy build/shell services.
- Build, CSP, service-worker, routing, and test configuration become more
  complex and must be justified by measured payload and lifecycle improvements.

## Primary references

- [Astro islands architecture](https://docs.astro.build/en/concepts/islands/)
- [Astro client directives](https://docs.astro.build/en/reference/directives-reference/#client-directives)
- [Astro framework components](https://docs.astro.build/en/guides/framework-components/)
- [Astro static route behavior](https://docs.astro.build/en/reference/routing-reference/#prerender)
- [Astro/live-canvas verification](../verification/2026-08-10-astro-live-canvas-verification.md)
- [Historical performance and platform-native baseline](../verification/2026-08-10-performance-and-native-feel-baseline.md)
- [ADR 0002: Browser Bun command](0002-browser-bun-command.md)
