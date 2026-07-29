# Flect native agent shell implementation plan

Date: 2026-07-29

## Goal

Deliver one verified vertical slice of Flect that works in a normal browser and
as an installed macOS Tauri application. The slice must let a user ask the
Shaper Pi to change a schema-defined interface, preview and accept or reject
the revision, recover deterministically through the protected Guardian Pi
boundary, and run optional extension logic inside the approved QuickJS worker
sandbox. The packaged application must keep Pi and provider credentials in a
private sidecar rather than exposing a privileged loopback API.

The implementation is complete only after unit, integration, sandbox, real
Chromium, production-build, packaged-app, and credentialed Pi smoke checks have
passed and `/Applications/Flect.app` is open.

## Implementation record

The vertical slice follows this plan with four deliberate boundary
clarifications:

1. The client Effect `ShapingKernel` is the sole owner of the versioned revision
   journal. The private sidecar RPC owns Pi runtime, model, session, stream, and
   validated proposal operations; it does not duplicate revision authority.
2. The QuickJS boundary uses one scoped dedicated Worker, strict Effect Schema
   messages, and one operation per worker. A general Effect RPC worker protocol
   would add machinery without narrowing this single-operation boundary.
3. The Shaper returns schema-constrained proposal data with all ambient Pi tools
   disabled. It does not receive a journal-writing tool; validation and
   transition authority remain in the kernel.
4. Real Chromium covers the currently exposed shaping, recovery, accessibility,
   persistence, and live isolation flows. Capability denial, timeout, resource
   limits, failure thresholds, and extension disabling are integration-tested
   below the UI because arbitrary extension authoring is not exposed in this
   slice.

Product/API adapters, arbitrary UI capsules, source building, sharing, signing,
and distribution hardening remain roadmap work rather than hidden partial
implementations.

## Required guidance and pinned sources

- Follow `AGENTS.md`, `VISION.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`,
  `DESIGN.md`, and the approved platform design.
- Follow `.agents/skills/effect-ts/SKILL.md` and its guides for Effect,
  Schema, Layers, testing, observability, and retries.
- Use test-driven development: write the observable failing test, run it and
  confirm the intended failure, add the smallest implementation, then rerun.
- Verify Effect APIs against `.repos/effect` at
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`.
- Use Pi `@earendil-works/*` version `0.82.1`, whose stable source is release
  commit `b4f293684bba718d59cc1157679bcf6157b3a7f5`. The clone at `/tmp/pi`
  is the implementation reference.
- Use Tauri CLI `2.11.4`, JavaScript API `2.11.1`, Rust crate `2.11.5`, and
  shell plugin `2.3.5`. Official source clones are at
  `/tmp/flect-tauri-source` and `/tmp/flect-tauri-plugins-workspace`.
- Use `quickjs-emscripten-core` and the QuickJS-NG release-sync WebAssembly
  variant at exact version `0.32.0`. The official wrapper source clone is at
  `/tmp/flect-quickjs-source`.
- Keep Playwright on exact version `1.62.0`.
- Commit, push, publish, or merge only with separate explicit authority.

## Architecture delivered by this plan

```text
                         validated InterfaceDocument
                         revisions and shaping events
                                      |
                                      v
Browser or Tauri WebView -> Effect application kernel -> React renderer
             |                        |
             |                        +-> QuickJS-NG/WASM worker sandbox
             |                            -> typed capability intents only
             |
             +-- browser: loopback Effect HTTP/SSE transport
             |
             +-- desktop: custom Effect RPC protocol
                          -> Tauri invoke/event bridge
                          -> private NDJSON stdio
                          -> compiled Bun sidecar
                                      |
                                      v
                     shared Pi ModelRuntime and model registry
                            /                       \
            protected Guardian session       Shaper session
            immutable resources only         narrow shaping tools only
```

React may retain ephemeral focus, selection, and panel state. All interface
documents, revisions, commands, events, capabilities, validation, persistence,
agent communication, and recovery remain Effect programs behind services and
Layers.

## Task 1: Pin the native, sandbox, and RPC foundation

Files:

- `package.json`
- `bun.lock`
- `.gitignore`
- `vite.config.ts`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `src/vite-env.d.ts`

Tests and changes:

1. Add exact dependencies:
   `@tauri-apps/api@2.11.1`,
   `quickjs-emscripten-core@0.32.0`, and
   `@jitl/quickjs-ng-wasmfile-release-sync@0.32.0`.
2. Add exact development dependency `@tauri-apps/cli@2.11.4`.
3. Add scripts for:
   `build:sidecar`, `dev:desktop`, `build:desktop`, `test:e2e`,
   `test:e2e:ui`, and `check:all`.
4. Configure Vite worker builds and the QuickJS `?url` WebAssembly import
   without widening browser globals.
5. Ignore generated sidecar binaries, Tauri target output, Playwright
   reports, and test results.
6. Run:

   ```bash
   bun install --frozen-lockfile
   bun run typecheck
   ```

Expected result: dependency resolution is exact and the existing application
still typechecks before behavior changes.

## Task 2: Define schema-only interface, revision, capability, and RPC contracts

Files:

- `shared/interface-document.ts`
- `shared/interface-document.test.ts`
- `shared/revisions.ts`
- `shared/revisions.test.ts`
- `shared/extensions.ts`
- `shared/extensions.test.ts`
- `shared/rpc.ts`
- `shared/rpc.test.ts`
- `shared/contracts.ts`
- `shared/contracts.test.ts`

Tests first:

1. Extend the interface decoder tests to reject unknown component types,
   unknown properties, excessive depth, duplicate node identifiers, unsafe
   action identifiers, and unsupported document versions.
2. Verify a valid recursive document containing `Stack`, `Text`, `Prompt`,
   `Button`, `Divider`, and `AgentPanel` nodes decodes and re-encodes.
3. Verify revision transitions:
   `active -> proposed -> previewed -> accepted`,
   rejection leaves active unchanged, rollback activates last-known-good, and
   an invalid revision can never become active.
4. Verify extension manifests reject undeclared intents, oversized source,
   unexpected fields, non-HTTPS product endpoints, and credential-shaped
   configuration.
5. Verify RPC schemas reject malformed payloads and include no credential,
   raw provider, or process-control fields.

Implementation:

1. Replace the flat interface document with a versioned recursive Effect
   Schema discriminated union and a strict trusted component registry.
2. Define branded identifiers and `Schema.TaggedClass` values for
   `InterfaceRevision`, `RevisionStatus`, `ShapingCommand`, `ShapingEvent`,
   `ExtensionManifest`, `SandboxRequest`, `SandboxResult`,
   `CapabilityIntent`, and public typed failures.
3. Define one schema-only `FlectRpc` group for finite queries, commands, and
   streamed agent/shaping events. It must not import browser, Bun, Pi, Tauri,
   React, or persistence implementations.
4. Preserve a compiled safe launcher document that contains no extension
   references and can always be rendered without persistence or Pi.
5. Use generated `.make` constructors and Effect decoders at every unknown
   boundary; do not add assertions or raw `JSON.parse` trust.
6. Run only the new contract tests until they pass, then all shared tests.

## Task 3: Build the Effect revision journal and shaping kernel

Files:

- `src/lib/interface-repository.ts`
- `src/lib/interface-repository.test.ts`
- `src/lib/shaping-kernel.ts`
- `src/lib/shaping-kernel.test.ts`
- `src/lib/interface-store.ts`
- `src/lib/interface-store.test.ts`
- `src/lib/runtime.ts`

Tests first:

1. With an isolated test Layer, create a valid proposal and observe a
   `RevisionProposed` event without changing the active document.
2. Preview then accept a proposal and observe the active and last-known-good
   pointers update atomically.
3. Reject, roll back, and enter safe mode; safe mode must bypass storage before
   any user document or extension is decoded.
4. Simulate corrupt persisted data and verify deterministic recovery to the
   compiled launcher.
5. Simulate three consecutive shaping or sandbox failures and verify the
   recovery policy disables the extension, restores last-known-good, and
   emits one typed recovery request.

Implementation:

1. Add `InterfaceRepository` and `ShapingKernel` as `Context.Service`
   capabilities with browser-storage, in-memory test, and safe-mode Layers.
2. Use Effect concurrency primitives for the active snapshot and event hub;
   revision mutation is one serialized Effect transaction.
3. Implement proposal, validation, preview, accept, reject, rollback, safe
   mode, and recovery as named `Effect.fn` operations.
4. Keep validation deterministic and independent of every model provider.
5. Migrate legacy flat browser state once through a Schema migration and
   retain no parallel storage format.
6. Compose these Layers once in `src/lib/runtime.ts`.

## Task 4: Render the trusted interface document and shaping workflow

Files:

- `src/components/interface-renderer.tsx`
- `src/components/interface-renderer.test.tsx`
- `src/components/shaper-panel.tsx`
- `src/components/shaper-panel.test.tsx`
- `src/components/launcher.tsx`
- `src/components/launcher.test.tsx`
- `src/app.tsx`
- `src/styles.css`

Tests first:

1. Render every trusted node through accessible semantic elements and reject
   an unregistered node before React sees it.
2. Verify keyboard submission, focus restoration, labelled controls, status
   announcements, and motion-reduction behavior.
3. Submit a shaping instruction, render a visually distinct preview, accept
   it, and then roll it back.
4. Verify reject leaves the live interface unchanged.
5. Verify safe mode is always reachable and never rendered from customizable
   state.

Implementation:

1. Replace hard-coded launcher composition with a renderer whose registry is
   a closed TypeScript map corresponding exactly to the Schema union.
2. Keep the default dark, high-quality central prompt surface. Add a restrained
   right-side shaping panel that can collapse on narrow layouts.
3. Show revision provenance, preview state, accept, reject, rollback, and safe
   mode without exposing implementation or provider details.
4. Keep React event handlers as small adapters that run Effect workflows
   through the existing managed runtime.
5. Preserve the product tokens in `DESIGN.md`; add no parallel UI state store.

## Task 5: Implement the QuickJS worker sandbox and capability broker

Files:

- `src/sandbox/extension-worker.ts`
- `src/sandbox/quickjs.ts`
- `src/sandbox/extension-sandbox.ts`
- `src/sandbox/extension-sandbox.test.ts`
- `src/sandbox/capability-broker.ts`
- `src/sandbox/capability-broker.test.ts`
- `src/sandbox/worker-client.ts`
- `src/sandbox/worker-client.test.ts`

Tests first:

1. Run a valid pure transformation and receive only a Schema-decoded
   `CapabilityIntent`.
2. Attempt access to `fetch`, DOM globals, storage, environment variables,
   Tauri APIs, Pi, filesystem, process, module loading, dynamic evaluation,
   promises, proxies, and time; each must be absent or fail closed.
3. Exceed source, input, result, heap, stack, instruction-time, and outer
   deadline limits; each returns a typed failure and terminates the worker.
4. Request an undeclared capability and verify the broker denies it without
   calling its test adapter.
5. Cause three consecutive failures and verify disable, worker replacement,
   last-known-good rollback, and one recovery signal.

Implementation:

1. Wrap `quickjs-emscripten-core` with the release-sync QuickJS-NG variant and
   an explicit `wasmLocation` imported through Vite.
2. Construct the minimal intrinsic set. Do not install a module loader or
   host callbacks. Disable Date, eval, Proxy, and Promise initially.
3. Apply the approved limits: 256 KiB source, 1 MiB input, 1 MiB output,
   16 MiB heap, 512 KiB stack, a 100 ms in-realm execution interrupt, and a
   2 second outer worker deadline that also covers worker and WebAssembly
   startup.
4. Own each dedicated worker with `Effect.acquireRelease`; terminate it on
   deadline, defect, decode failure, or scope release.
5. Communicate with the worker using Effect RPC worker protocol and strict
   Schema values.
6. Add `SandboxCapabilityBroker` with an explicit manifest allowlist. It
   accepts inert intents and never exposes ambient functions to the realm.
7. Treat QuickJS as a logic sandbox, not an operating-system sandbox; no
   native, shell, or Pi extension execution is included.

## Task 6: Split Pi into Guardian and Shaper trust domains

Files:

- `server/pi-runtime.ts`
- `server/pi-runtime.test.ts`
- `server/agent-supervisor.ts`
- `server/agent-supervisor.test.ts`
- `server/shaper-tools.ts`
- `server/shaper-tools.test.ts`
- `server/guardian-tools.ts`
- `server/guardian-tools.test.ts`
- `server/runtime.ts`

Tests first:

1. Acquire one shared `ModelRuntime` but distinct Guardian and Shaper
   `SessionManager`, `SettingsManager`, and `ResourceLoader` instances.
2. Verify the Guardian loader has immutable bundled instructions and disables
   extensions, skills, prompt templates, themes, and context files.
3. Verify the Shaper also disables ambient resources and receives only typed
   interface read/propose/validate/preview tools.
4. Verify neither session receives shell, filesystem, process, browser,
   product API, extension, or credential tools.
5. Verify interruption disposes subscriptions and both sessions, and settings
   are flushed without persisting prompts or responses.
6. Verify Guardian unavailability cannot prevent deterministic rollback.
7. Verify a fake deterministic Shaper Layer can drive browser tests with no
   provider credentials.

Implementation:

1. Add `AgentSupervisor` as the sole scoped owner of the shared model runtime
   and both Pi sessions.
2. Create each session with its own managers and `DefaultResourceLoader`,
   `noTools: "all"` plus only the narrow custom tools for that trust domain.
3. Keep the Guardian system prompt bundled and immutable. It may inspect
   validation/recovery summaries and request already-defined recovery actions;
   it cannot write the journal.
4. Let the Shaper propose schema values only. The shaping kernel validates and
   journals them before preview; Pi never writes active state.
5. Retain Pi as the sole model/provider authentication owner and redact model
   output exactly as in the current public model summaries.

## Task 7: Expose one Effect RPC application boundary

Files:

- `server/rpc-handlers.ts`
- `server/rpc-handlers.test.ts`
- `server/rpc-stdio.ts`
- `server/rpc-stdio.test.ts`
- `server/app.ts`
- `server/app.test.ts`
- `server/index.ts`
- `server/sidecar.ts`
- `src/lib/flect-client.ts`
- `src/lib/browser-transport.ts`
- `src/lib/tauri-transport.ts`
- `src/lib/tauri-transport.test.ts`
- `src/lib/api.ts`
- `src/lib/api.test.ts`

Tests first:

1. Exercise finite model, interface, revision, proposal, accept, reject,
   rollback, and health operations through the RPC group with test Layers.
2. Stream ordered agent and shaping events and verify sequence
   deduplication/reconnection behavior.
3. Round-trip framed NDJSON through stdio without writing diagnostics to
   stdout.
4. Verify the browser adapter maps HTTP/SSE to the same client contract.
5. Mock Tauri `invoke` and `listen` and verify the custom
   `RpcClient.Protocol` routes requests and streaming responses, unregisters
   listeners on scope close, and returns typed transport failures.

Implementation:

1. Implement the RPC handlers once over `AgentSupervisor` and `ShapingKernel`.
2. Host the same group through:
   browser-facing Effect HTTP/SSE and sidecar-facing
   `RpcServer.layerProtocolStdio` plus NDJSON serialization.
3. Implement a custom Tauri client `RpcClient.Protocol`:
   `send` invokes a narrow Rust `rpc_send` command with an encoded request;
   `run` listens to one private `flect://rpc` event and dispatches decoded
   server frames.
4. Detect Tauri only at the composition root using the official API marker;
   platform code remains outside domain and React modules.
5. Add `server/sidecar.ts` as the Bun compile entrypoint. Its stdout is
   exclusively RPC framing; diagnostics use stderr and exclude user/provider
   payloads.

## Task 8: Package the private sidecar in a hardened Tauri macOS host

Files:

- `scripts/build-sidecar.ts`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/build.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/icons/**`

Tests and implementation:

1. Generate Tauri 2 scaffolding with bundle identifier `dev.akua.flect`,
   product name `Flect`, one main window, and `frontendDist: "../dist"`.
2. Configure the isolation pattern, a restrictive CSP, and
   `wasm-unsafe-eval` only for the sandbox WebAssembly requirement.
3. Give the WebView only core window/event plus the custom `rpc_send`
   command. Do not grant shell execution, filesystem, process, environment,
   or unrestricted URL authority.
4. Compile `server/sidecar.ts` with Bun to
   `src-tauri/binaries/flect-runtime-aarch64-apple-darwin`; do not require Bun
   on the installed machine.
5. Configure that exact binary as `externalBin`.
6. In Rust, start the sidecar during setup with the backend-only shell plugin,
   retain the child behind synchronized state, forward stdout NDJSON as the
   private `flect://rpc` event, write only validated JSON lines from
   `rpc_send`, report stderr safely, and kill the child on application exit.
7. Add Rust unit tests for maximum message size, newline framing, rejection of
   malformed JSON, and unavailable-child errors.
8. Run:

   ```bash
   bun run build:sidecar
   bun run build
   cargo test --manifest-path src-tauri/Cargo.toml
   bun run build:desktop -- --bundles app
   ```

## Task 9: Add deterministic real-browser UI tests

Files:

- `playwright.config.ts`
- `tests/e2e/launcher.spec.ts`
- `tests/e2e/shaping.spec.ts`
- `tests/e2e/safe-mode.spec.ts`
- `tests/e2e/responsive.spec.ts`
- `tests/e2e/sandbox.spec.ts`
- `server/test-mode.ts`

Tests:

1. Start the real Bun runtime and Vite production preview through Playwright
   `webServer`; use an explicit test-mode Layer selected only by a non-production
   environment variable.
2. In real Chromium:
   open the launcher, submit a prompt, receive streamed fake agent output,
   open shaping, request a deterministic interface change, preview it, accept
   it, reload, roll back, and verify the prior document returns.
3. Reject a proposal and verify the active UI never changes.
4. Inject corrupt persisted state and verify the compiled launcher and
   recovery notice appear.
5. Run a sandbox denial and timeout fixture through the visible shaping flow;
   verify the extension is disabled after the threshold and safe mode remains
   usable.
6. Test desktop and mobile viewport layouts, keyboard-only operation,
   reduced-motion mode, focus order, accessible names, and no horizontal
   overflow.
7. Save screenshots, trace, console, and network diagnostics only on failure.
   Treat unexpected console errors, page errors, or failed application
   requests as test failures.
8. Run:

   ```bash
   bunx playwright install chromium
   bun run test:e2e
   ```

## Task 10: Verify, install, open, inspect, and document the product

Files:

- `README.md`
- `VISION.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `DESIGN.md`
- `docs/superpowers/specs/2026-07-29-flect-platform-and-agent-architecture-design.md`

Verification:

1. Update documentation to distinguish implemented behavior from future
   architecture. Document:
   browser and desktop startup, Pi authentication ownership, Guardian/Shaper
   isolation, revision recovery, sandbox threat boundary and non-goals, safe
   mode, native packaging, and real-browser test commands.
2. Add the sandbox, private-sidecar, and automated-browser invariants to
   `AGENTS.md` without duplicating contributor procedures.
3. Run the complete local gate:

   ```bash
   bun run lint
   bun run typecheck
   bun run test
   bun run test:e2e
   bun run build
   cargo test --manifest-path src-tauri/Cargo.toml
   bun run build:desktop -- --bundles app
   git diff --check
   ```

4. Run a credentialed Pi smoke through the installed sidecar using the
   existing Pi login state. Do not persist, log, fixture, or screenshot prompt
   or response content.
5. Remove any prior `/Applications/Flect.app` only after resolving the exact
   target, copy the newly built app bundle there, launch it with macOS `open`,
   and verify the process and main window are live.
6. Inspect the running browser UI with `chrome-devtools-axi`, including a
   narrow viewport, and inspect the installed native window. Confirm no
   unexpected console errors, no privileged localhost listener in the desktop
   process, and successful private sidecar health.
7. Review the diff, generated artifacts, package contents, and tracked files
   for credentials or provider/user payloads.

## Completion evidence

The handoff must state the exact commands and outcomes for:

- Effect/unit/integration tests;
- Rust host tests;
- real Chromium Playwright tests;
- TypeScript and Biome checks;
- browser and native production builds;
- credentialed Pi smoke;
- installed bundle path and running macOS process/window;
- private-sidecar and sandbox boundary checks; and
- any deliberately deferred platform work.

No success claim is based on documentation or source inspection alone.
