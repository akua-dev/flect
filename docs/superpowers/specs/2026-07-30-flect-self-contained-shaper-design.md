# Flect self-contained application-agent and Shaper design

## Status

Approved conversationally on 2026-07-30. Written-spec review is pending.

## Outcome

Flect becomes a self-contained, browser-portable application and authoring
shell. Every Flect experience has an App Agent through which a person can use
the product's approved APIs and capabilities. Entering edit mode starts a
separate Shaper that can load explicitly enabled Pi extensions, edit a real Git
workspace, build the interface, and preview a proposed change without requiring
a system Git installation or a terminal login.

The release-quality outcome combines six related changes:

1. a composer and provider/model picker selectively ported from T3 Code;
2. Pi authentication managed from inside Flect;
3. one App Agent for using the running product;
4. one extensible Shaper for editing it, supervised by a protected Guardian;
5. portable Pi extensions packaged inside shareable `.flect` capsules; and
6. a Git-backed OPFS workspace built with `@rolldown/browser`.

The protected launcher, deterministic validation, capability enforcement, and
last-known-good recovery stay outside the user-modifiable workspace.

## Product decisions

### Three agent roles

Flect has three distinct Pi agent roles:

- **Guardian** is the lower protected recovery agent.
- **Shaper** is the edit-mode agent for interface authoring, Git worktrees,
  builds, repairable source changes, and explicitly enabled authoring
  extensions.
- **App Agent** is the run-mode agent through which a person uses the current
  Flect application, talks to its domain, and calls its approved product and
  API capabilities.

A shared Pi model boundary owns provider discovery and authentication. Each
role keeps an independent Pi session, `SessionManager`, `ResourceLoader`, and
resource configuration. App Agent and Shaper never share mutable conversation
state, tools, prompts, or extensions.

Every Flect application receives the protected base App Agent even when its
capsule declares no custom agent package. A capsule may customize the App
Agent's public instructions, commands, widgets, and portable Pi extensions,
but it cannot remove the protected route to the base agent or grant itself
capabilities.

Run mode is the normal product experience. Edit mode is an explicit transition
that starts or reveals Shaper. App Agent may offer to hand an interface-change
request to Shaper, but it cannot silently acquire editing authority.

### Git is the source history

Flect does not invent another source version-control system. A Flect workspace
is a Git repository. Git commits and branches own source history, attribution,
diffs, proposals, and rollback targets.

Flect retains only the protected activation metadata Git cannot safely own:

- active accepted commit;
- last-known-good commit;
- active compiled capsule hash;
- build and validation receipt;
- enabled capability and extension identifiers; and
- startup and render failure counters.

This record is a recovery pointer, not a parallel revision history.

### Embedded Git only

Flect never assumes a `git` executable is installed. Browser and desktop hosts
use the same pinned libgit2 WebAssembly artifact.

Flect owns a reproducible build of a pinned upstream libgit2 revision rather
than depending on an unverified system binary or an abandoned wrapper package.
The build exports only the repository, object, reference, diff, merge, and
worktree operations required by the product.

If the browser filesystem integration cannot pass the worktree, crash
recovery, and persistence tests in supported browsers, the embedded-Git slice
does not silently fall back to system Git. The design must be corrected before
shipping.

### External Pi extensions are explicit trusted code

Flect discovers external Pi extensions without importing or executing them.
The user explicitly enables an extension for a workspace and role before App
Agent or Shaper loads it.

Ordinary Pi extensions are JavaScript modules and are not automatically made
safe by Pi tool configuration. The enable flow therefore distinguishes:

- a **Flect capability extension**, which runs through Flect's brokered,
  schema-defined capability boundary; and
- an **external Pi extension**, which is trusted local code and receives the
  authority of its isolated agent host.

The interface displays source, resolved path or package identity, version when
available, requested integration surface, compatibility, and the trust
consequence before enabling an external extension.

Guardian never loads external extensions. An extension cannot enter the
protected launcher, Guardian process, recovery metadata, credential broker, or
capability-grant authority.

### Capsules contain portable Pi extensions

A `.flect` capsule is a complete, offline-installable product experience. It
may contain portable Pi extensions for App Agent and Shaper rather than
depending on an external package registry or a matching global Pi
installation.

The capsule contains:

```text
flect.json
ui/
  src/
  public/
  dependencies.json
agents/
  app-agent.json
  shaper.json
extensions/
  <extension-id>/
    manifest.json
    bundle.mjs
    provenance.json
assets/
```

Each bundled extension is content-addressed and declares:

- stable identifier, version, publisher, and source provenance;
- compatible Flect, Pi Extension API, and capsule schema versions;
- target role: App Agent, Shaper, or both;
- required and optional Flect capabilities;
- whether it uses only the portable Extension API subset;
- browser and desktop compatibility;
- commands, widgets, dialogs, tools, and event hooks it contributes; and
- bundled dependency and source-map hashes.

Capsules include prebuilt extension modules and all portable runtime
dependencies. Installation never runs package-manager lifecycle scripts or
fetches undeclared executable code.

Bundling does not imply trust. Capsule installation presents its agent
extensions and capability requests. No bundled extension executes until the
user approves the applicable role and grants. A capsule whose App Agent
extension is declined still opens in restricted mode with the protected base
App Agent and only already granted capabilities.

Community members can inspect, fork, modify, sign, and share capsules with
their agent extensions intact. Credentials, capability grants, user
conversations, and provider state are never included in a capsule.

The installer may copy an approved, content-addressed bundled extension into
the user's local extension catalog for reuse by other workspaces. Reuse never
copies the originating capsule's grants: every workspace and target role still
requires explicit activation and capability approval.

## Runtime topology

```text
Flect shell (React)
        |
        v
Effect application kernel
        |
        +-- Protected supervisor
        |      |
        |      +-- Pi model/auth boundary
        |      |
        |      +-- Guardian Pi
        |      |      extension-free
        |      |      read-only agent observations
        |      |      closed recovery capabilities
        |      |
        |      +-- App Agent process
        |      |      normal run mode
        |      |      capsule App Agent package
        |      |      approved product/API capabilities
        |      |      explicitly enabled runtime extensions
        |      |
        |      +-- Shaper process
        |             explicit edit mode
        |             Git/build/preview capabilities
        |             explicitly enabled authoring extensions
        |             scoped workspace capabilities
        |
        +-- GitWorkspace worker
        |      libgit2-Wasm
        |      OPFS repository and worktrees
        |
        +-- BrowserBuild worker
        |      @rolldown/browser
        |      mirrored build filesystem
        |
        +-- Preview host
               isolated capsule iframe
```

The desktop host packages the same web application and WebAssembly artifacts.
It does not switch to native Git. The browser host uses the same workspace
contracts and does not need WebContainer or a proprietary hosted runtime.

Pi continues to live behind a local or explicitly configured remote runtime
boundary; browser application code does not import Pi packages.

App Agent remains available as part of the product experience whether the
custom interface displays a rail, compact composer, command surface, or another
shapeable presentation. The compiled shell retains a protected fallback
composer so a capsule cannot remove every path to App Agent, edit mode,
permissions, and recovery.

### Execution compartments

"Sandboxed" means a concrete compartment with a denied ambient authority, not
merely a Pi tool allowlist:

- The protected shell and Effect kernel own trust decisions, capability
  grants, typed bridges, activation, and recovery.
- A compiled capsule UI runs in a sandboxed, opaque-origin iframe. It has no
  same-origin access, parent DOM access, storage, top navigation, popups,
  downloads, or network by default. It exchanges inert view state, UI events,
  and capability intents through an Effect Schema-validated message protocol.
- Each portable capsule extension runs in its own browser-native isolated
  JavaScript realm with storage and network denied by CSP and host policy. It
  communicates only through a versioned portable Pi Extension API bridge.
  Extensions cannot address one another directly.
- App Agent and Shaper run in separate scoped Pi hosts with separate
  `SessionManager` and `ResourceLoader` instances. A portable extension is
  bridged into its approved role; its code is not promoted into the protected
  runtime process.
- An external, non-portable Pi extension executes in the selected role's
  disposable runtime process as explicitly trusted code. Flect labels this
  path as unsandboxed relative to the portable extension boundary.
- Git and build workers receive only scoped repository or build messages and
  cannot reach model, product, credential, DOM, or activation authority.

The same compartment protocol is used in the browser and desktop WebView.
Flect does not emulate Node or run Bun in a browser, and does not depend on
WebContainer. If a host cannot enforce a requested portable extension or UI
capability, installation fails closed or opens the capsule with that component
disabled.

## App Agent run mode

App Agent is the agent interface of the running product, not an editor bolted
beside it. It receives:

- the capsule's bounded public product description and App Agent instructions;
- the current validated interface context;
- the user's current view or selection when the interface explicitly shares
  it;
- capsule-bundled App Agent extensions approved during installation;
- external Pi extensions explicitly enabled for App Agent; and
- only the product and API capabilities the user or product authority granted.

An API-backed product can therefore ship a `.flect` capsule instead of building
another inference service or assistant UI. The user selects a Pi model they
already control, while the product continues to own authentication,
authorization, rate limits, data policy, and the exact API operations exposed
through capability adapters.

App Agent can invoke approved domain operations, explain current product data,
coordinate workflows, and update shapeable presentation state through inert
UI intents. It cannot edit source, create Git worktrees, change capsule code,
grant capabilities, or alter recovery state.

### Product and API capabilities

A capsule can declare product operations through schema-defined Flect
capability adapters. A portable extension can contribute the tool description
and Effect Schema request and response contracts, but it cannot gain ambient
`fetch`, read product credentials, or choose arbitrary destinations.

Installation resolves each declared operation to an adapter and presents its
origin, methods, data classes, side-effect level, and authentication
requirement. A protected capability broker:

- restricts requests to approved origins and operations;
- validates arguments and responses at the boundary;
- owns product-authentication material outside the capsule, Pi session, model
  context, UI document, and Git repository;
- distinguishes read, reversible write, and consequential write operations;
- requires confirmation where the capability policy demands it;
- attaches idempotency protection when the product contract supports it; and
- returns bounded, redacted results to App Agent.

In a browser, direct adapters work only where the product's origin and CORS
policy permit them. An explicitly configured Flect runtime can broker an
otherwise unavailable product API, but it remains subject to the same
origin-specific grant and credential boundary; Flect never becomes an
unrestricted generic proxy.

When the user requests a durable interface or source change in run mode, App
Agent emits a typed `RequestEditMode` handoff containing the user's instruction
and explicitly shared context. The user confirms the transition. Shaper starts
in a proposal worktree and receives that handoff without inheriting App Agent's
private conversation history or runtime tools.

Closing edit mode disposes or suspends Shaper and returns focus to the existing
App Agent session. Accepting a new capsule revision recreates App Agent only
when its instructions, extensions, capabilities, or compatibility contract
changed; ordinary UI-only updates preserve the session.

## Embedded Git workspace

### Storage

OPFS is the canonical local workspace store in both a normal browser and the
Tauri WebView. Each workspace contains:

```text
/<workspace-id>/
  repository/
    .git/
    flect.json
    src/
    public/
  worktrees/
  builds/
  recovery/
```

The Git and build workers receive no ambient DOM, model, credential, product,
or native authority. Effect `Scope` owns their creation, interruption, and
termination.

The `GitWorkspace` Effect service owns:

- create, import, open, export, and delete;
- repository initialization and integrity checks;
- branches, commits, tags, refs, diffs, and status;
- proposal worktree creation and disposal;
- accepted and last-known-good commit resolution;
- atomic OPFS flush and reopen validation;
- bounded file, object, path, and repository limits;
- author and agent provenance; and
- typed failures for unsupported, corrupt, unavailable, quota, conflict, and
  interrupted operations.

No React component calls libgit2 or OPFS directly.

### Proposal flow

The accepted interface is represented by an accepted Git commit. A Shaper
change proceeds as follows:

1. Flect creates `flect/proposal/<proposal-id>` at the exact accepted commit.
2. libgit2 creates an isolated proposal worktree.
3. Shaper receives workspace tools scoped to that worktree.
4. Every Shaper edit affects only the proposal worktree.
5. Flect commits attributable checkpoints while the turn progresses.
6. `BrowserBuild` mirrors the worktree into Rolldown's filesystem and builds
   it in a worker.
7. Flect validates the emitted capsule and opens it in the isolated preview.
8. Accept advances the accepted ref to the validated proposal commit and
   records the protected activation receipt.
9. Reject removes the proposal ref and worktree after retaining the requested
   diagnostic metadata.
10. Rollback activates a prior validated accepted commit.

An uncommitted, unbuilt, invalid, stale-base, or capability-incompatible
proposal cannot become active.

### Build integration

`@rolldown/browser` builds React, TypeScript, JSX, JavaScript, CSS, and
supported assets from a mirrored in-memory build filesystem. OPFS remains the
source of truth; the Rolldown filesystem is disposable.

The `BrowserBuild` Effect service owns:

- transfer from a Git worktree;
- dependency-cache resolution;
- compilation and cancellation;
- bounded diagnostics;
- output hashing;
- isolated preview artifact production;
- last-successful-build retention; and
- worker cleanup.

Generated bundles do not receive network access by default. Node-only Vite
plugins, native dependencies, arbitrary package scripts, and a full Node Vite
development server are outside this slice.

## Guardian supervision

### Observation

An Effect supervisor watches deterministic App Agent, Shaper, extension-host,
capability, and workspace signals continuously. It does not spend model tokens
merely to poll.

The supervisor publishes a bounded `AgentObservation` stream tagged with the
originating role. It contains:

- App Agent and Shaper lifecycle and heartbeat state;
- capsule revision, agent-package identity, and active extension identities;
- extension discovery, load, start, and runtime failures;
- tool or capability call identity, timing, and typed failure;
- interruption, timeout, and disposal events;
- for Shaper only, the bounded prompt and response events required to
  understand the failed authoring turn;
- for Shaper only, Git checkpoint, diff summary, proposal, build, and
  validation diagnostics; and
- accepted and last-known-good commit identities.

Ordinary App Agent conversation content and returned product data do not enter
Guardian's passive observation stream. When a person explicitly asks Guardian
to diagnose an App Agent turn, Flect may attach a separately confirmed,
redacted, bounded projection of that turn.

Credentials, authorization headers, secret prompt values, raw provider
payloads, unrestricted filesystem content, and unbounded model output are
excluded. The observation projection is read-only, bounded by event count and
encoded byte size, and crosses the Guardian boundary through Effect Schema.

Guardian does not receive either agent's mutable `SessionManager` or resource
loader. It reads only Flect's canonical observation projection. A faulty
extension therefore cannot mutate Guardian state or forge the supervisor's
canonical lifecycle events.

### Triggers

The supervisor asks Guardian for a diagnosis when it observes:

- App Agent process crash or failed startup;
- Shaper process crash or failed startup;
- extension load, startup, or runtime failure in either role;
- repeated App Agent capability failure;
- repeated typed tool failure;
- failed or invalid build after a Shaper edit;
- invalid interface or capsule output;
- a stalled operation past the configured deadline;
- repeated render failure attributed to one proposal or extension; or
- an explicit user recovery request.

### Recovery authority

Guardian can request only closed, schema-defined recovery operations:

- interrupt the active operation in a named role;
- restart App Agent or Shaper;
- restart the affected role with its optional extensions disabled;
- restart App Agent with the protected base package;
- quarantine a named extension for one workspace and role;
- discard an unaccepted proposal worktree;
- restore the accepted or last-known-good commit;
- create a recovery branch and worktree;
- apply a bounded source patch to that recovery worktree;
- request build and validation; and
- present a validated recovery proposal.

Flect, not Guardian, authorizes and performs those operations. Guardian cannot
modify its own instructions, grant capabilities, read credentials, edit the
safe launcher, load user extensions, call product APIs as App Agent, mutate
protected activation metadata directly, or silently accept an ordinary
interface redesign.

Containment operations such as interruption, restart, temporary quarantine,
discarding an unaccepted worktree, and restoring an already validated
last-known-good commit may run automatically and remain visible in activity
history. A generated source repair builds in a recovery worktree and requires
the normal validation and preview boundary before activation.

If Guardian or every model provider is unavailable, deterministic containment,
protected-base App Agent restart, extension-free Shaper restart, repository
integrity checks, safe mode, and last-known-good restoration remain available.

## Pi authentication inside Flect

Flect uses Pi's `ModelRuntime`; it does not implement another credential store
or provider protocol.

The runtime exposes only non-secret provider and authentication metadata:

- provider identifier and display name;
- supported authentication methods;
- configured or unavailable status;
- public source label;
- model summaries; and
- stored-credential presence and type.

Starting authentication creates one scoped login interaction. Flect maps Pi's
`AuthInteraction` events into typed UI states:

- information and links;
- authorization URL;
- device code;
- progress;
- text prompt;
- secret prompt;
- selection; and
- manual authorization code.

OAuth and device-code links open through an explicit HTTPS/loopback URL
boundary. Prompt responses are tied to one login and prompt identifier.
Cancellation interrupts the Pi login flow and releases every waiter.

OAuth, device-code, selection, and non-secret prompt state can render in the
ordinary Flect interface. API-key and other secret prompts use a separate
`CredentialPromptHost` capability so application React code never reads the
value:

- the local browser runtime serves a one-use, runtime-owned credential form on
  its loopback origin and posts directly to the pending Pi login;
- the packaged desktop host uses a dedicated native credential prompt and
  private sidecar channel; and
- a remote browser runtime must provide an equivalently reviewed,
  authenticated credential-entry boundary or expose only provider-hosted OAuth
  methods.

The credential surface has a restrictive CSP, no analytics or third-party
resources, no URL-carried secret, no autofilled Flect storage, and no response
body containing the submitted value. Secret input is immediately wrapped in
Effect `Redacted` at the runtime boundary and handed to Pi's pending
`AuthInteraction.prompt`. It never enters ordinary React state, local storage,
interface documents, Git, telemetry, fixtures, screenshots, logs, errors,
activity history, or public runtime responses.

Successful login refreshes provider/model state and makes model selection
available without terminal use. Logout calls Pi `ModelRuntime.logout` and
recreates affected App Agent, Shaper, and Guardian sessions without exposing
the removed credential.

## T3 Code composer port

T3 Code at commit `d19039aeef6942e6eb204856c43b5354c0333e2d` is MIT
licensed. Flect may adapt substantial implementation where useful, provided
the T3 copyright and MIT notice accompany copied portions.

Flect selectively ports:

- the stable rounded composer frame and surface structure;
- compact composer controls;
- responsive footer behavior;
- provider/model trigger;
- provider rail;
- searchable model list;
- favorites;
- selected and unavailable states;
- keyboard focus, traversal, dismissal, and shortcuts;
- bounded scrolling and scroll fades;
- send, stop, disabled, busy, and compact behavior; and
- component tests for those interactions.

Flect adapts the visual tokens to `DESIGN.md` and replaces T3-specific provider
contracts with Pi provider/model summaries.

### Run and edit mode experience

The high-quality composer is one shell component with explicit role-aware
states, not two unrelated chat implementations:

- **Run mode** opens by default and routes to App Agent. It presents the
  product's agent name, approved capabilities, current context-sharing state,
  and product commands without authoring controls.
- **Edit mode** is an explicit, visibly labelled transition and routes to
  Shaper. It adds proposal branch, dirty state, checkpoint, build, preview,
  diff, accept, reject, and return-to-app affordances.
- **Fallback mode** is owned by the protected Flect shell. It can always reach
  the protected base App Agent, permissions, edit-mode entry, diagnostics, and
  recovery even if the active capsule renders none of them.

The capsule may shape how App Agent appears in its normal product UI, including
a side rail, compact prompt, command palette, voice surface, or custom
extension widget. It cannot spoof the edit-mode indicator, silently route a
run-mode message to Shaper, or hide the protected fallback route. Model and
provider selection can be shared visually, but the active agent role and its
authority are always legible before send.

Flect does not port coding-only features without matching capabilities:

- file and folder mentions;
- terminal context;
- Git review comments;
- image annotations;
- plans and approval workflow;
- worktree project selection;
- coding-provider traits; or
- T3 connection and cloud-account concepts.

Those controls may appear later when backed by real Flect capabilities. No
ornamental control claims an unavailable feature.

### Model and provider experience

The picker groups authenticated models under Pi providers and supports
searching provider name, model name, and model identifier. It offers favorites
and exposes login, logout, and refresh actions without leaving Flect.

Unauthenticated providers remain discoverable in the provider surface but
their models cannot be selected until login succeeds. Selecting a model
recreates the role sessions through the existing bounded lifecycle rather than
leaking one model into another session.

### Extension experience

The composer Actions surface includes an Extensions entry. The Extensions
surface supports:

- discovery without execution;
- compatibility and trust presentation;
- capsule-bundled and externally discovered sources;
- explicit enable and disable per workspace and target role;
- capability-grant review independent of code enablement;
- restart impact;
- load errors and Guardian recovery status; and
- extension-provided commands, dialogs, status, and widgets through typed
  Flect adapters where supported.

Enabling one extension for App Agent does not enable it for Shaper, or vice
versa. Disabling an extension disposes only the affected agent host and creates
a clean host without that extension. Guardian remains alive throughout.

## Existing-state migration

The current schema-defined `InterfaceDocument` remains the compiled safe
launcher and legacy source for the first migration.

When no Git workspace exists, Flect creates one initial repository commit from
the active validated interface, adds a default base-App-Agent declaration to
the capsule manifest, and records its build as the first accepted commit.
Existing last-known-good state is retained until the Git workspace has been
reopened, rebuilt, and validated successfully.

After migration, Git owns interface source history. The previous document
journal is read only for recovery migration and is not maintained as a second
history.

Safe mode never requires opening the Git repository.

## Error handling

- Invalid or corrupt OPFS repository -> compiled launcher and repository
  recovery options.
- libgit2-Wasm startup failure -> compiled launcher; no system Git fallback.
- Proposal worktree failure -> accepted worktree remains unchanged.
- Build failure -> retain the last successful build and show bounded
  diagnostics.
- Stale accepted commit -> typed conflict; rebuild the proposal from the new
  base.
- App Agent crash -> restart the same approved package, then fall back to the
  protected base App Agent if it fails again.
- Shaper crash -> supervisor contains it and wakes Guardian.
- Extension-attributed crash -> role-scoped quarantine, clean host restart,
  and Guardian diagnosis.
- App Agent capability failure -> preserve product state, expose the typed
  failure, and never escalate authority or retry a non-idempotent operation
  implicitly.
- Guardian failure -> deterministic containment and recovery continue.
- Login cancellation -> no credential change and no orphaned prompt waiter.
- Provider/model refresh failure -> retain the last public model snapshot and
  expose a retry.
- Unsupported browser features or exhausted storage quota -> typed,
  actionable status with export when possible.

Raw provider, extension, filesystem, libgit2, process, and Wasm failures do not
cross public boundaries without classification and redaction.

## Delivery slices

The program is implemented in dependency order:

1. **Embedded Git proof:** reproducible libgit2-Wasm, worker, OPFS adapter,
   repository reopen, commit, branch, diff, and real worktree tests.
2. **Composer, modes, and authentication:** T3-derived composer/provider
   picker, run/edit mode shell, in-Flect Pi login/logout, model refresh,
   favorites, and README cleanup.
3. **Capsule agent packages:** capsule manifest and integrity rules, protected
   base App Agent, capsule App Agent package, portable extension format,
   install review, and role-scoped grants.
4. **Supervised extensible agents:** independent App Agent and Shaper
   lifecycles, extension discovery and explicit role enablement,
   `AgentObservation`, Guardian triggers, containment, base-agent fallback, and
   extension-free Shaper restart.
5. **Authoring integration:** Shaper workspace tools, Rolldown build,
   isolated preview, Git accept/reject/rollback, migration, and recovery.
6. **Product verification:** real-browser automation, native host tests,
   accessibility, release media, attribution, documentation, and dogfood.

Each slice lands only with its public behavior tests passing. The final outcome
is not considered complete until the integrated browser and packaged macOS app
have been exercised through capsule installation, login, App Agent use,
run-to-edit handoff, edit, build, preview, accept, role-scoped extension
failure, Guardian recovery, restart, and rollback.

## Testing

### Contract and Effect tests

- Decode every Git, auth, extension, observation, recovery, and build boundary
  with excess properties rejected.
- Test `GitWorkspace`, `BrowserBuild`, `PiAuthentication`,
  `CapsuleAgentPackage`, `AppAgentRuntime`, `ExtensionCatalog`,
  `AgentSupervisor`, and `GuardianRecovery` through test Layers.
- Use scoped workers and finalizer assertions to prove interruption and
  disposal.
- Prove secrets cannot enter encodable public events, logs, snapshots, Git, or
  errors.
- Prove Guardian receives a bounded read-only observation rather than a
  mutable App Agent or Shaper session object.
- Prove extensions cannot load before explicit enablement or enter Guardian.
- Prove App Agent has no Git or source-editing capabilities, Shaper has no
  product API capabilities, and an extension grant never crosses roles.

### Real-browser tests

Playwright runs against a production build in Chromium and verifies:

- `.flect` capsule import, manifest and hash verification, extension review,
  approval or decline, restricted opening, and refresh restoration;
- OPFS repository creation, refresh restoration, and export;
- libgit2 commit, branch, worktree, diff, accept, reject, and rollback;
- source edit, Rolldown build, isolated preview, and last-successful fallback;
- provider and model search, favorites, keyboard behavior, and compact layout;
- deterministic OAuth, device-code, API-key, cancellation, logout, and refresh
  flows through test Pi Layers;
- App Agent conversation, approved test-API invocation, inert UI intent, and
  explicit `RequestEditMode` handoff;
- capsule and external extension discovery, explicit role enablement,
  disablement, capability review, and incompatibility;
- App Agent failure, instant supervisor observation, base-agent fallback, and
  preservation of product state;
- Shaper failure, instant supervisor observation, Guardian recovery proposal,
  quarantine, and extension-free restart;
- safe mode with corrupt repository and unavailable agents; and
- no unexpected console, page, network, or accessibility failures.

### Native tests

The packaged Tauri app uses the same Wasm Git and browser build path. Tests
verify its private Pi transport, URL opening boundary, sidecar/process cleanup,
OPFS persistence, restart recovery, and absence of a system Git dependency.

### Live smoke

An opt-in smoke uses the developer's existing Pi state to:

1. open Flect;
2. install or open a capsule containing a benign portable extension;
3. review its agent package, extensions, and capability requests;
4. perform or confirm in-app provider login;
5. select a model;
6. ask App Agent to invoke an approved reversible test operation;
7. request and confirm an edit-mode handoff;
8. make a Shaper edit in a proposal worktree;
9. build, preview, and accept;
10. induce a controlled role-scoped extension failure;
11. observe Guardian containment and recovery; and
12. roll back.

No live credential or provider payload is captured in test artifacts.

## Documentation

- `README.md` becomes a concise install, open, authenticate, first-use, and
  first-shape path with current screenshots and direct links.
- `ARCHITECTURE.md` changes only after each boundary is implemented and
  verified.
- `VISION.md` changes only if this design changes a promised capability or
  intentional non-capability.
- `DESIGN.md` receives the final composer and provider-picker tokens.
- `docs/trust-model.md` owns capsule and external extension trust, role and
  capability isolation, Guardian authority, embedded Git, OPFS, and recovery
  explanations.
- T3-derived code and repository notices include the required MIT attribution.
- GitHub issues remain the executable acceptance criteria for capsule,
  authoring, capability, and ecosystem delivery.

## Non-goals

This design does not promise:

- arbitrary Node/Vite plugins in a browser;
- unrestricted package scripts;
- automatic trust of external Pi extensions;
- silent capability grants;
- network access for generated UI;
- automatic Git remote push;
- system Git integration;
- recovery that depends on Guardian or a model;
- replacing product authentication or authorization; or
- loading arbitrary extensions into the protected launcher or Guardian.

## Acceptance

The design is complete when a new user can install or open Flect, authenticate
Pi from inside the product, select a provider and model through the T3-derived
picker, install a shareable `.flect` whose portable Pi extensions survive the
round trip, review and approve each role and capability, talk to App Agent in
run mode to perform an approved product operation, explicitly hand a change to
Shaper in edit mode, inspect the real Git diff and isolated build, accept or
reject it, restart without losing the workspace, and recover from an induced
App Agent, Shaper, or extension failure through Guardian and deterministic
safe mode—all without installing Git, a separate Pi client, or using a
terminal.
