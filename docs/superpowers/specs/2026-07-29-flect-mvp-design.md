# Flect MVP design

Date: 2026-07-29

## Purpose

The first Flect milestone must make the vision tangible without pretending the
entire self-modifying interface platform already exists. It will deliver a
polished, usable agent launcher backed by Pi, a small typed interface contract,
and a protected recovery surface.

The milestone succeeds when someone with an existing Pi provider login can
open Flect locally, see the models available through Pi, choose one, send a
prompt, and receive a streamed response in an interface that already feels
like the foundation of the product.

## Product decisions

### Primary surface

Flect opens on a quiet, dark canvas rather than a dashboard or chat sidebar.
The first state contains:

- the prompt `What should we shape?`;
- a high-quality composer with the placeholder
  `Build, change, or connect anything`;
- controls for attachments and capabilities;
- an `Auto · via Pi` model control;
- voice and submit actions; and
- restrained links for opening an interface, extensions, and product
  connections.

The surface should feel calm, precise, and native. It should not imitate
operating-system chrome, use decorative AI gradients, or fill the empty state
with cards.

### Pi owns model access

Pi is Flect's local agent runtime and model/provider access layer. Flect does
not invent a second credential format or duplicate Pi's provider catalog.

The local runtime uses Pi's `ModelRuntime` and `createAgentSession()` SDK APIs.
It reads authentication through Pi's supported resolution path and presents
only non-secret provider and model metadata to the browser. Existing Pi OAuth
and API-key credentials remain owned by Pi and never enter browser storage or
frontend logs.

The first milestone consumes existing Pi authentication. If no provider is
available, Flect shows exact local setup guidance and a refresh action.
Provider-login flows embedded directly in Flect are a subsequent milestone;
their implementation must use Pi's provider-owned authentication contracts
rather than provider-specific logic in the UI.

### Customization and recovery

The launcher is itself a Flect interface and will eventually be customizable.
The MVP establishes the boundary needed for that future:

- customizable interface state is represented by a versioned, validated
  document;
- built-in shell and recovery code are not part of that document;
- malformed or unsupported interface state fails closed to the built-in
  launcher; and
- a stable safe-mode entry point loads without user extensions or customized
  interface state.

The MVP does not execute arbitrary generated interface code. Typed interface
documents are the first safe substrate; sandboxed code extensions can be
designed separately.

## Architecture

Flect starts as one TypeScript workspace with two process boundaries.

### Browser shell

The browser shell is a React application built with Vite. It owns rendering,
accessible interaction, transient conversation state, and the versioned
interface document. It does not read credentials, call model providers
directly, or execute generated code. React enters application workflows
through a single Effect `ManagedRuntime`; data access, decoding, streaming,
resource lifetime, and typed failures remain Effect programs.

The browser build is usable in a normal browser and is structured so the same
assets can later be packaged as a desktop application.

### Local runtime

A small Bun HTTP service binds to loopback only. It owns:

- Pi `ModelRuntime` creation;
- available-provider and available-model discovery;
- Pi session creation and lifecycle;
- prompt submission;
- conversion of Pi session events into Flect's transport contract; and
- redaction of runtime errors before they cross into the browser.

The runtime does not create shadow credential storage. It uses Pi's default
agent directory unless a future, explicit profile feature changes that
decision.

### Effect application architecture

Effect is Flect's application backbone rather than a utility dependency:

- Effect Schema classes are the one source of truth for request, response,
  event, interface-document, and public-error contracts.
- Pi, session runtime, browser transport, and browser storage are
  `Context.Service` capabilities with named production and test Layers.
- finite operations return `Effect`; agent turns and SSE bodies use `Stream`;
  subscriptions, prompt fibers, HTTP servers, and browser runtimes are scoped.
- expected failures are tagged and typed in the error channel; defects are
  reserved for violated invariants.
- Effect HTTP and platform integrations own Bun and browser network
  boundaries, while React remains the rendering and interaction layer.
- named operations carry structured logs and spans without recording prompts,
  responses, model credentials, or provider payloads.

All Effect packages are pinned to the same version. Flect adopts every
relevant Effect capability for the implemented product, but does not install
unrelated SQL, cluster, workflow, or telemetry exporters before a real
requirement exists.

### Shared contracts

Runtime payloads and interface documents use shared Effect Schema classes.
Unknown input is decoded with `Schema.decodeUnknownEffect` before entering
application state. The first transport contract contains:

- runtime health and Pi availability;
- non-secret model summaries;
- session creation;
- prompt submission;
- streamed text, lifecycle, and sanitized error events; and
- cancellation.

Contracts are versioned at their boundary. The frontend must tolerate unknown
event fields and reject unsupported major versions.

## Data flow

1. The browser requests runtime status and available models.
2. The runtime asks Pi's `ModelRuntime` for models with valid authentication.
3. The user chooses a model or leaves selection on `Auto`.
4. The browser creates a Flect session.
5. The runtime creates an in-memory Pi agent session with a minimal Flect
   system prompt and an explicit tool allowlist.
6. The browser submits a prompt and consumes the Effect `Stream` response.
7. Pi events are mapped to the stable Flect event contract; Pi internals and
   credentials never cross the boundary.
8. The browser renders conversation output while keeping the composer
   available for the next turn.

No provider call is made until the user submits a prompt.

## Failure and recovery behavior

- If the local runtime is unavailable, the launcher remains usable as a
  visual shell and explains how to start it.
- If Pi has no authenticated model, Flect shows setup guidance rather than a
  broken model menu.
- If model creation or streaming fails, the current prompt remains available
  for retry and the error is described without exposing raw credential or
  provider payloads.
- Cancellation stops the active Pi turn and returns the composer to a usable
  state.
- Safe mode bypasses customized interface state and extensions while
  preserving access to runtime diagnostics and model logout guidance.
- The browser never silently falls back to sending credentials or prompts to
  a hosted Flect service.

## Security boundaries

- The local runtime binds to `127.0.0.1`, not all interfaces.
- Runtime requests enforce the expected local origin.
- Secrets stay in Pi's credential mechanisms and are excluded from API
  responses, persisted interface state, telemetry, screenshots, and tests.
- Pi tools are denied by default. The initial conversational session has no
  filesystem or shell tools.
- Future product capabilities must be explicit, inspectable, and revocable.
- User-modifiable interface state cannot replace or intercept the protected
  recovery entry point.

## Repository shape

The MVP keeps the number of packages small:

- `src/` — browser shell and UI;
- `server/` — loopback Pi runtime;
- `shared/` — transport and interface schemas;
- `tests/` — integration and browser behavior;
- `docs/` — architecture, product decisions, and implementation plans; and
- `assets/` — repository and product imagery.

A split into publishable packages is deferred until a real external consumer
requires it.

## Verification

Automated verification includes:

- schema tests for valid and invalid runtime payloads;
- runtime tests using a fake Pi adapter, with no provider credentials;
- tests that API responses never contain credential fields;
- component tests for booting, ready, empty-auth, streaming, cancellation,
  error, and safe-mode states;
- keyboard and accessible-name coverage for composer controls;
- a production build; and
- a browser smoke test at desktop and narrow viewport sizes.

A credentialed Pi smoke test is manual and optional. It must not run in CI or
record prompts, responses, or credentials in fixtures.

## Deferred work

The first milestone deliberately defers:

- arbitrary generated JavaScript or V8 extension execution;
- an extension marketplace;
- product API capability negotiation;
- shared component publishing;
- synced workspaces;
- a native desktop wrapper;
- embedded provider OAuth flows; and
- autonomous interface repair.

Each item depends on the protected core and typed contracts established here.
