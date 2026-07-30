# Flect self-contained Shaper design

## Status

Approved conversationally on 2026-07-30. Written-spec review is pending.

## Outcome

Flect becomes a self-contained, browser-portable authoring shell whose
user-facing Pi agent can authenticate, load explicitly enabled Pi extensions,
edit a real Git workspace, build the interface, and preview a proposed change
without requiring a system Git installation or a terminal login.

The release-quality outcome combines four related changes:

1. a composer and provider/model picker selectively ported from T3 Code;
2. Pi authentication managed from inside Flect;
3. one extensible user-facing Shaper supervised by a protected Guardian; and
4. a Git-backed OPFS workspace built with `@rolldown/browser`.

The protected launcher, deterministic validation, capability enforcement, and
last-known-good recovery stay outside the user-modifiable workspace.

## Product decisions

### Two agent roles

Flect has two Pi agent roles, not a third general chat agent:

- **Guardian** is the lower protected recovery agent.
- **Shaper** is the higher user-facing agent for conversation, interface
  authoring, product capabilities, and explicitly enabled Pi extensions.

A shared Pi model boundary owns provider discovery and authentication. Each
agent keeps an independent Pi session and resource configuration.

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
The user explicitly enables an extension for a workspace before the Shaper
loads it.

Ordinary Pi extensions are JavaScript modules and are not automatically made
safe by Pi tool configuration. The enable flow therefore distinguishes:

- a **Flect capability extension**, which runs through Flect's brokered,
  schema-defined capability boundary; and
- an **external Pi extension**, which is trusted local code and receives the
  authority of its isolated Shaper host.

The interface displays source, resolved path or package identity, version when
available, requested integration surface, compatibility, and the trust
consequence before enabling an external extension.

Guardian never loads external extensions. An extension cannot enter the
protected launcher, Guardian process, recovery metadata, credential broker, or
capability-grant authority.

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
        |      |      read-only Shaper observations
        |      |      closed recovery capabilities
        |      |
        |      +-- Shaper process
        |             user-facing Pi session
        |             explicitly enabled extensions
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

An Effect supervisor watches deterministic Shaper and workspace signals
continuously. It does not spend model tokens merely to poll.

The supervisor publishes a bounded `ShaperObservation` stream containing:

- Shaper lifecycle and heartbeat state;
- prompt and response events required to understand the failed turn;
- extension discovery, load, start, and runtime failures;
- tool calls and typed tool failures;
- Git checkpoint, diff summary, and proposal state;
- build and validation diagnostics;
- active extension identities;
- accepted and last-known-good commit identities; and
- interruption, timeout, and disposal events.

Credentials, authorization headers, secret prompt values, raw provider
payloads, unrestricted filesystem content, and unbounded model output are
excluded. The observation projection is read-only, bounded by event count and
encoded byte size, and crosses the Guardian boundary through Effect Schema.

Guardian does not receive the Shaper's mutable `SessionManager` or resource
loader. A faulty extension therefore cannot mutate Guardian state or forge the
supervisor's canonical lifecycle events.

### Triggers

The supervisor asks Guardian for a diagnosis when it observes:

- Shaper process crash or failed startup;
- extension load or startup failure;
- repeated typed tool failure;
- failed or invalid build after a Shaper edit;
- invalid interface or capsule output;
- a stalled operation past the configured deadline;
- repeated render failure attributed to one proposal or extension; or
- an explicit user recovery request.

### Recovery authority

Guardian can request only closed, schema-defined recovery operations:

- interrupt the active Shaper operation;
- restart Shaper;
- restart Shaper with external extensions disabled;
- quarantine a named extension for the workspace;
- discard an unaccepted proposal worktree;
- restore the accepted or last-known-good commit;
- create a recovery branch and worktree;
- apply a bounded source patch to that recovery worktree;
- request build and validation; and
- present a validated recovery proposal.

Flect, not Guardian, authorizes and performs those operations. Guardian cannot
modify its own instructions, grant capabilities, read credentials, edit the
safe launcher, load user extensions, mutate protected activation metadata
directly, or silently accept an ordinary interface redesign.

Containment operations such as interruption, restart, temporary quarantine,
discarding an unaccepted worktree, and restoring an already validated
last-known-good commit may run automatically and remain visible in activity
history. A generated source repair builds in a recovery worktree and requires
the normal validation and preview boundary before activation.

If Guardian or every model provider is unavailable, deterministic containment,
extension-free Shaper restart, repository integrity checks, safe mode, and
last-known-good restoration remain available.

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
recreates affected Shaper and Guardian sessions without exposing the removed
credential.

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
- explicit enable and disable per workspace;
- restart impact;
- load errors and Guardian recovery status; and
- extension-provided commands, dialogs, status, and widgets through typed
  Flect adapters where supported.

Disabling an extension disposes the active Shaper and creates a clean Shaper
without that extension. Guardian remains alive throughout.

## Existing-state migration

The current schema-defined `InterfaceDocument` remains the compiled safe
launcher and legacy source for the first migration.

When no Git workspace exists, Flect creates one initial repository commit from
the active validated interface and records its build as the first accepted
commit. Existing last-known-good state is retained until the Git workspace has
been reopened, rebuilt, and validated successfully.

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
- Shaper crash -> supervisor contains it and wakes Guardian.
- Extension-attributed crash -> quarantine, extension-free restart, and
  Guardian diagnosis.
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
2. **Composer and authentication:** T3-derived composer/provider picker,
   in-Flect Pi login/logout, model refresh, favorites, and README cleanup.
3. **Supervised extensible Shaper:** separate Shaper lifecycle, extension
   discovery and explicit enablement, observation stream, Guardian triggers,
   containment, and extension-free restart.
4. **Authoring integration:** Shaper workspace tools, Rolldown build,
   isolated preview, Git accept/reject/rollback, migration, and recovery.
5. **Product verification:** real-browser automation, native host tests,
   accessibility, release media, attribution, documentation, and dogfood.

Each slice lands only with its public behavior tests passing. The final outcome
is not considered complete until the integrated browser and packaged macOS app
have been exercised through login, edit, build, preview, accept, extension
failure, Guardian recovery, restart, and rollback.

## Testing

### Contract and Effect tests

- Decode every Git, auth, extension, observation, recovery, and build boundary
  with excess properties rejected.
- Test `GitWorkspace`, `BrowserBuild`, `PiAuthentication`, `ExtensionCatalog`,
  `ShaperSupervisor`, and `GuardianRecovery` through test Layers.
- Use scoped workers and finalizer assertions to prove interruption and
  disposal.
- Prove secrets cannot enter encodable public events, logs, snapshots, Git, or
  errors.
- Prove Guardian receives a bounded read-only observation rather than a
  Shaper session object.
- Prove extensions cannot load before explicit enablement or enter Guardian.

### Real-browser tests

Playwright runs against a production build in Chromium and verifies:

- OPFS repository creation, refresh restoration, and export;
- libgit2 commit, branch, worktree, diff, accept, reject, and rollback;
- source edit, Rolldown build, isolated preview, and last-successful fallback;
- provider and model search, favorites, keyboard behavior, and compact layout;
- deterministic OAuth, device-code, API-key, cancellation, logout, and refresh
  flows through test Pi Layers;
- extension discovery, explicit enablement, disablement, and incompatibility;
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
2. perform or confirm in-app provider login;
3. select a model;
4. enable a benign external Pi extension;
5. make a Shaper edit in a proposal worktree;
6. build and preview;
7. accept;
8. induce a controlled extension failure;
9. observe Guardian containment and recovery; and
10. roll back.

No live credential or provider payload is captured in test artifacts.

## Documentation

- `README.md` becomes a concise install, open, authenticate, and first-shape
  path with current screenshots and direct links.
- `ARCHITECTURE.md` changes only after each boundary is implemented and
  verified.
- `VISION.md` changes only if this design changes a promised capability or
  intentional non-capability.
- `DESIGN.md` receives the final composer and provider-picker tokens.
- `docs/trust-model.md` owns extension trust, Guardian authority, embedded Git,
  OPFS, and recovery explanations.
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
picker, explicitly enable a compatible Pi extension, ask Shaper to change a
source-based interface, inspect the real Git diff and isolated build, accept or
reject it, restart without losing the workspace, and recover from an induced
Shaper or extension failure through Guardian and deterministic safe mode—all
without installing Git or using a terminal.
