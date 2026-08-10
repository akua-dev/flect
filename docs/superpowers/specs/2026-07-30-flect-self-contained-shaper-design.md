# Flect self-contained application-agent and Shaper design

## Status

Approved conversationally on 2026-07-30. The Rifty-backed execution substrate,
browser agent shell, Bun-compatible command, package mutation, preview broker,
and Pi request/result bridge are implemented. Canonical OPFS/libgit2 Git,
portable capsules, a separate App Agent, extension enablement, and accepted
generated UI activation remain later slices.

## Outcome

Flect becomes a self-contained, browser-portable application and authoring
shell. Every Flect experience has an App Agent through which a person can use
the product's approved APIs and capabilities. Entering edit mode starts a
separate Shaper that can load explicitly enabled Pi extensions, edit a real Git
workspace, build the interface, and preview a proposed change without requiring
a system Git installation or a terminal login.

The release-quality outcome combines eight related changes:

1. a composer and provider/model picker selectively ported from T3 Code;
2. Pi authentication managed from inside Flect;
3. one App Agent for using the running product;
4. one extensible Shaper for editing it, supervised by a protected Guardian;
5. portable Pi extensions packaged inside shareable `.flect` capsules;
6. a browser execution substrate assembled from pinned Rifty leaf packages;
7. a real Git-backed OPFS workspace with a restricted
   `@rolldown/browser` acceptance build; and
8. one full Bash surface per agent, routed into a role-specific sandbox.

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

### Rifty is the execution substrate, not the trust boundary

Flect adopts selected leaf packages from
[Rifty](https://github.com/vanilla-wave/rifty) rather than implementing another
browser-local Node-compatible runtime, process kernel, package installer, WASI
host, and preview router from scratch.

The research snapshot evaluated Rifty repository commit
`207e0ee9f108d6457e2448c956b84c2758e62671` and the published `0.2.0`
packages. Before implementation, Flect pins exact package versions and source
commits, verifies their artifacts, and records the resulting dependency and
license inventory. Floating `0.x` ranges are prohibited.

The first implemented slice adopts these Rifty leaf packages behind its own
Effect services:

- `@riftydev/vfs` for compatible memory and OPFS filesystem primitives;
- `@riftydev/runtime-js` for the bounded Node-compatible authoring runtime;
- `@riftydev/runtime-wasi` for reviewed WASI Preview 1 command modules;
- `@riftydev/npm-client` for package resolution, integrity verification,
  extraction, linking, and an explicitly controlled cache.

The first slice uses a Flect-owned typed service-worker preview broker.
OPFS-backed Rifty VFS adoption remains part of the canonical workspace slice.

Flect does not initially adopt:

- the `@riftydev/sdk` umbrella or its realm-global `createSandbox()` lifecycle;
- `@riftydev/kernel`, `@riftydev/net`, `@riftydev/service-worker`, or
  `@riftydev/ts-language-service`;
- `@riftydev/shell`, because the model-facing shell remains pinned
  `just-bash`;
- `@riftydev/git`, because its current isomorphic-git surface deliberately
  excludes worktrees and other Flect-required repository behavior; or
- Rifty's playground UI, application state, AI roadmap, or product identity.

Every Rifty Promise, Worker, message, error, filesystem value, process event,
and preview event enters the Flect application only through a small
`BrowserExecution` Effect service and named live and test Layers. Layer
acquisition owns the runtime realm and all Workers through `Scope` and
`Effect.acquireRelease`; interruption closes child processes and message
bridges. Effect Schema owns command, filesystem, process, package, and preview
messages. React never calls a Rifty package directly.

Rifty explicitly describes its runtime as cooperative browser-local execution,
not hostile-code containment. Flect therefore does not treat a Rifty Worker,
cross-origin isolation, or `SharedArrayBuffer` as a security boundary.

The protected shell, credentials, capability grants, Guardian, activation
state, and canonical Git repository remain outside the Rifty execution realm.
Untrusted authoring processes receive only a disposable mirror of one proposal
worktree. They never receive an OPFS handle for the canonical repository. A
bounded, validated file delta is the only path back into `GitWorkspace`.

The execution realm runs on a separate sandbox origin where the host can
enforce a restrictive CSP. Ambient outbound network, parent DOM, Flect-origin
storage, credentials, and native bridges are unavailable. Package acquisition
and approved remote access cross separate typed host brokers. A deployment
that cannot provide this origin and CSP boundary may offer the restricted
schema-defined editor, but it must not silently enable the Node-compatible
authoring runtime.

Running arbitrary project build plugins or package lifecycle scripts remains
an explicitly trusted authoring mode. Portable capsules, their default build,
and their run mode do not require that trust.

### Embedded Git only

Flect never assumes a `git` executable is installed. Browser and desktop hosts
use the same pinned libgit2 WebAssembly artifact.

Flect starts from a reproducible, source-pinned
[wasm-git](https://github.com/petersalomonsen/wasm-git) build of libgit2 rather
than depending on a system binary or inventing a JavaScript Git object model.
The evaluated source snapshot was
`6250484764878a35ba374836465cbf2e54364994`, corresponding to
`wasm-git@0.0.17` and libgit2 `1.9.4`.

The upstream `lg2` command surface already covers the repository operations
Flect needs most often, but it does not currently expose a `worktree`
subcommand. Flect adds or upstreams that bounded command using libgit2's
existing
[worktree API](https://libgit2.org/docs/reference/main/worktree/index.html).
The resulting artifact exports only the repository, object, reference, diff,
merge, remote, and worktree operations required by Flect. Unsupported Git
flags and commands fail explicitly.

One trusted `GitWorkspace` Worker is the sole writer of Git metadata. Its
Effect service serializes repository and worktree mutations, permits only
safe concurrent reads, reopens and validates OPFS state after interruption,
and emits attributable operation receipts. Wasm commands, Rifty processes,
capsule code, and Pi extensions cannot mutate `.git` directly.

The distributed artifact and every modification to its libgit2 or `lg2`
sources must retain the upstream GPLv2-with-linking-exception notices and pass
the release dependency-license audit.

If the browser filesystem integration cannot pass the worktree, crash
recovery, and persistence tests in supported browsers, the embedded-Git slice
does not silently fall back to system Git. The design must be corrected before
shipping.

### Browser-native Bash, small model-facing surface

App Agent, Shaper, and Guardian each receive Pi's normal `bash` tool backed by
Flect-controlled `BashOperations`. Flect does not register every product
operation, filesystem action, Git action, and utility as a separate
model-visible tool.

"Full Bash power" means a broad Bash-compatible language and virtual Unix
userland, not arbitrary native processes or the host user's shell. The first
backend is a pinned `just-bash` browser build running entirely on the client.
It supplies pipelines, redirection, functions, loops, variables, standard file
and text commands, ripgrep, sed, awk, jq, diffs, and bounded execution. Flect
does not enable its Node-only filesystem, Python, SQLite,
JavaScript-execution, or direct-network integrations.

Two schema-backed custom commands provide on-demand discovery and invocation
without expanding the model prompt:

```text
flect help
flect capabilities list
flect capabilities describe <operation>
flect capabilities call <operation> --input <json>
flect extensions list
flect extensions describe <extension>/<operation>
flect extensions call <extension>/<operation> --input <json>
flect commands list
flect commands describe <command>
flect ui context
flect ui emit --input <json>
flect recovery ...
bun run <entry>
bun build <entry>
bun install
bun add <package>
bun remove <package>
bun stop
git status
git diff
git add ...
git commit ...
```

Each subcommand crosses the same Effect Schema and capability broker used by
the graphical shell. A role sees only applicable subcommands and operations.
Skills can teach discovery patterns, while full operation descriptions stay
out of model context until the agent asks for them.

Compatible extension operations are shell commands by default. Flect keeps
their complete schemas out of the model's initial tool list and resolves
`describe` or `call` through the role's approved extension host. An extension
must separately declare and justify any directly model-visible tool it cannot
represent through the shell; installation shows that added context cost before
approval.

The custom `git` command preserves familiar Git CLI interaction while calling
the same libgit2-Wasm `GitWorkspace` service that owns the real OPFS repository
and worktrees. It is a CLI-shaped capability, not a second Git implementation
or simulated revision store. Unsupported flags or subcommands fail explicitly.

`bun` is also a reserved Flect command and cannot be replaced by a capsule or
extension. It provides a deliberately bounded Bun-compatible browser
experience, not the native Bun executable:

- `bun run` and `bun build` resolve the mirrored workspace module graph,
  transpile supported JavaScript and TypeScript, and execute only through the
  scoped Rifty Worker runtime;
- `bun install`, `bun add`, and `bun remove` call the Rifty npm client through
  Flect's integrity-checking, origin-restricted package broker;
- `bun stop` interrupts and disposes the role-owned execution scope;
- `Bun.serve({ fetch })` and server-shaped default exports may register with
  Flect's isolated preview broker, but do not bind a real socket; and
- unsupported commands and APIs fail with an explicit compatibility message.

The baseline does not promise `Bun.spawn`, `Bun.$`, `Bun.file`, `Bun.write`,
`bun:sqlite`, raw TCP, native addons, lifecycle scripts, or host-process
execution. The browser and desktop WebView expose the same compatibility
surface; Flect never expects a system Bun installation.

Burrow demonstrates this UX by pairing `just-bash` with a `bun` command, a Bun
transpiler Wasm module, browser Workers, a custom package manager, and a
service-worker preview bridge. Flect reuses that architecture pattern rather
than its package manager, Git model, or opaque binary. The evaluated Burrow
`bun.wasm` has SHA-256
`4dddd6083635da83d7eb2a41aeaa6b44f428909d612b2f5f35b52bf3bf556630`, but
Burrow does not tie that checked-in artifact to a reproducible Bun source
commit. Flect therefore must not vendor it as trusted input. A Bun transpiler
artifact enters Flect only after its exact source revision, build recipe,
license, output hash, and browser tests are recorded. Until that gate passes,
the compatible command uses the reviewed Rifty module transformation path and
reports that it does not claim exact Bun transpilation semantics.

The `SandboxedShell` Effect service owns realm lifecycle, the scoped virtual
filesystem, Bash execution, interruption, output and resource limits, command
registration, and cleanup. Pi's runtime may remain local or remote, but its
`bash` call crosses the existing Flect transport back to the browser-resident
shell. Shell execution therefore works identically in a normal browser and the
desktop WebView without shipping a VM, container, operating-system image, or
native executable.

Before adoption, the exact pinned `just-bash` browser artifact must pass
Flect's Vite/Rolldown production-build and real-browser tests. The current
package's browser entry leaves `node:zlib` external for archive support, so
Flect must either use a reviewed browser implementation, disable those archive
commands, or land an upstream fix. It must not add a Node polyfill bundle or
silently fall back to host execution.

The 2026-07-30 spike compared `just-bash@3.2.0` with
`@everruns/bashkit-wasm@0.14.4`. The published `just-bash` browser bundle was
about 1.2 MB minified and 340 KB gzip, exposes a complete async filesystem
interface, and supports `AbortSignal`. Bashkit's Wasm artifact was about 5.9 MB
and 2.26 MB gzip, uses an internal VFS, and documents no reliable browser
wall-clock deadline. Bashkit remains a fallback if the isolated `just-bash`
boundary fails adversarial tests. A Linux micro-VM was rejected for the
default path because its runner and guest image would make Flect heavier and
would move execution out of the browser.

### Portable Wasm commands

Flect can expose substantial command-line programs without installing native
executables or registering thousands of model-visible tools. A portable
command package contains:

```text
commands/
  <command>/
    manifest.json
    command.wasm
    provenance.json
```

The manifest declares:

- command name, version, publisher, source, content hash, and license;
- ABI (`wasi-preview1` initially, with `wasi:cli/command` as the later
  component-model target);
- target roles;
- argument, environment, stdin, stdout, and stderr limits;
- preopened filesystem roots and read/write mode;
- approved host capabilities and network origins, normally none;
- wall-time, memory, process, and output limits; and
- compatibility with the active Flect and command-runtime versions.

`BrowserExecution` runs each reviewed module in a disposable Worker through the
Rifty WASI host. The module receives only declared preopens and values. Flect
does not emulate `fork`, a process tree, raw sockets, a kernel, or arbitrary
host syscalls. Just-bash owns pipelines and redirection and invokes external
commands through the typed command broker.

Reserved commands including `bash`, `flect`, and `git` cannot be shadowed by a
capsule or extension. `git` remains the trusted CLI adapter to
`GitWorkspace`; it is not an arbitrary Wasm package with direct repository
write access.

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
commands/
  <command>/
    manifest.json
    command.wasm
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
- namespaced shell commands, widgets, dialogs, and event hooks it contributes;
  a new model-visible tool requires separate justification; and
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
        |      |      recovery-shell profile
        |      |
        |      +-- App Agent process
        |      |      normal run mode
        |      |      capsule App Agent package
        |      |      approved product/API capabilities
        |      |      explicitly enabled runtime extensions
        |      |      app-shell profile
        |      |
        |      +-- Shaper process
        |             explicit edit mode
        |             Git/build/preview capabilities
        |             explicitly enabled authoring extensions
        |             scoped workspace capabilities
        |             authoring-shell profile
        |
        +-- SandboxedShell host
        |      opaque-origin iframe per active role
        |      disposable interpreter Worker
        |      pinned just-bash interpreter
        |      role-specific virtual FS, commands, and quotas
        |
        +-- BrowserExecution host
        |      separate sandbox origin
        |      pinned Rifty leaf packages
        |      disposable source and dependency mirror
        |      Node-compatible authoring and WASI Workers
        |      package acquisition and preview bridges
        |
        +-- GitWorkspace worker
        |      pinned wasm-git/libgit2-Wasm
        |      OPFS repository and worktrees
        |      serialized metadata mutation
        |
        +-- BrowserBuild worker
        |      @rolldown/browser
        |      validated mirrored build filesystem
        |      acceptance artifact compiler
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
- The Rifty-backed `BrowserExecution` realm is a cooperative authoring runtime
  placed behind a separate sandbox origin and restrictive CSP. It receives a
  disposable mirror, not the canonical Git worktree or protected OPFS root.
  Its JavaScript runtime, Worker separation, and cross-origin isolation are not
  treated as hostile-code containment.
- Package resolution and download occur through a trusted, origin-restricted
  broker with integrity verification. Lifecycle scripts are disabled in the
  portable path. The sandbox receives only verified package bytes selected for
  the current proposal.
- Reviewed WASI commands execute in disposable Workers with manifest-declared
  preopens and capabilities. They cannot obtain ambient browser APIs or
  replace reserved `bash`, `flect`, or `git` commands.
- App Agent and Shaper run in separate scoped Pi hosts with separate
  `SessionManager` and `ResourceLoader` instances. A portable extension is
  bridged into its approved role; its code is not promoted into the protected
  runtime process.
- Each Pi host routes its `bash` tool to a distinct browser-resident
  `SandboxedShell`. The interpreter runs in a disposable Worker created inside
  an `<iframe sandbox="allow-scripts">` without `allow-same-origin`. A
  restrictive CSP denies network, navigation, storage-bearing origins, and
  unreviewed script sources. Terminating the Worker is the hard cancellation
  boundary.
- The shell's async filesystem adapter crosses a typed message bridge. The
  parent resolves paths under exactly one role root and performs approved
  operations through `GitWorkspace` or a bounded in-memory filesystem. The
  opaque shell realm never receives an OPFS handle, model credential, host
  environment, product credential, or parent object reference.
- App Agent receives a writable ephemeral scratch directory, a bounded
  read-only projection of public capsule context, and its approved `flect
  capabilities` commands. It does not receive interface source or the Git
  repository.
- Shaper receives a virtual filesystem rooted at exactly one OPFS proposal
  worktree plus the brokered `git`, build, preview, and authoring commands. It
  does not receive product capabilities or product credentials.
- Guardian receives a bounded observation bundle and, only when source repair
  is required, a virtual filesystem rooted at a disposable recovery worktree.
  It does not receive App Agent product data, the accepted workspace as
  writable, or ordinary capsule extensions.
- An external, non-portable Pi extension executes in the selected role's
  disposable runtime process as explicitly trusted code. Flect labels this
  path as unsandboxed relative to the portable extension boundary.
- Git, execution, and build workers receive only scoped repository, mirrored
  source, package, command, or build messages and cannot reach model, product,
  credential, DOM, or activation authority.

The same compartment protocol is used in the browser and desktop WebView.
Flect does not run Bun, a host process, or an operating-system image in a
browser. Its Rifty dependency exposes a bounded Node-compatible JavaScript
surface and WASI host, not a native Node or POSIX guarantee. Flect does not
depend on WebContainer. If a host cannot enforce a requested portable
extension, command, execution, or UI capability, installation fails closed or
opens the capsule with that component disabled.

Direct network is absent. Approved product access exists only through the
schema-backed `flect capabilities` command. Interpreter command count, loop
iterations, recursion, glob work, strings, arrays, files, filesystem bytes,
wall time, stdout, and stderr are bounded. Effect `Scope` revokes every bridge
capability and terminates the Worker on cancellation or disposal.

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
capability adapters. A portable extension can contribute command metadata and
Effect Schema request and response contracts, but it cannot gain ambient
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
- returns bounded, redacted results through `flect capabilities call`.

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
3. `SandboxedShell` exposes that worktree as `/workspace` through a
   path-confined async filesystem adapter; it does not expose the `.git`
   directory or an OPFS handle.
4. Shaper receives one Bash tool and uses ordinary shell commands plus the
   brokered `git` command.
5. File commands write directly through `GitWorkspace` to the proposal
   worktree. The `git` command invokes bounded libgit2-Wasm operations against
   the same worktree and creates attributable checkpoint commits.
6. Flect verifies the expected parent, paths, authorship, size, object graph,
   and proposal ref before accepting each checkpoint.
7. `BrowserBuild` mirrors the verified proposal worktree into Rolldown's
   filesystem and builds it in a worker.
8. Flect validates the emitted capsule and opens it in the isolated preview.
9. Accept advances the accepted ref to the validated proposal commit and
   records the protected activation receipt.
10. Reject removes the proposal ref, worktree, and shell realm after retaining
    the requested diagnostic metadata.
11. Rollback activates a prior validated accepted commit.

The shell cannot address another worktree, repository internals, or activation
metadata. An uncommitted, unbuilt, invalid, stale-base, oversized, or
capability-incompatible proposal cannot become active.

### Build integration

`@rolldown/browser` builds React, TypeScript, JSX, JavaScript, and supported
assets from a mirrored in-memory build filesystem. OPFS remains the source of
truth; the Rolldown filesystem is disposable. The evaluated 1.2.1 release has
removed its experimental CSS bundling, so Flect's restricted adapter resolves
only mirrored local relative `.css` imports and emits their strict-UTF-8
contents in deterministic path order. CSS modules, preprocessors, remote
imports, and arbitrary Vite plugins remain outside this acceptance path.

Rifty serves a different purpose in the authoring loop. Its Node-compatible
runtime, package installer, process kernel, service-worker router, and Vite
compatibility may provide a fast disposable development preview for an
imported or actively edited project. That preview runs from a mirrored
proposal snapshot in the sandbox execution origin and cannot write the
canonical repository directly.

The Rifty preview is never the activation proof. Accepting a revision still
requires the restricted `BrowserBuild` compiler to rebuild the exact verified
Git proposal through the approved dependency graph, hash its artifact, validate
the capsule contract, and open the result in the opaque preview host. A project
that works only through an unapproved Vite plugin or lifecycle script remains
usable only in explicitly trusted authoring mode until a portable build path
exists.

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
plugins, native dependencies, arbitrary package scripts, and activation based
only on a development-server response are outside the portable slice.

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

Guardian may use Bash to inspect its bounded observation files, search source,
run inert diagnostics, edit its recovery worktree, and produce a repair commit.
Its `flect recovery` command can request only closed, schema-defined host
operations:

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
- Rifty package, Worker, OPFS, WASI, or service-worker startup failure ->
  restricted schema-defined authoring remains available with the unsupported
  execution capability visibly disabled; no WebContainer or host-process
  fallback.
- Browser execution policy violation, undeclared egress, or malformed process
  message -> terminate and dispose the entire proposal execution realm,
  preserve the canonical Git worktree, and emit a bounded typed diagnostic.
- Sandboxed shell startup or compatibility failure -> agent remains available
  for conversation with Bash disabled and a typed diagnostic; no host-shell
  fallback.
- Shell deadline or resource limit -> terminate the role Worker, discard
  unvalidated output, reopen its scoped filesystem, and offer a clean retry.
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

1. **Execution-substrate proof:** pin the exact Rifty source and package
   artifacts; adapt memory/VFS, kernel, Node-compatible runtime, WASI,
   package-install, and preview behavior behind `BrowserExecution`; prove
   separate-origin CSP enforcement, hard disposal, portable-build isolation,
   Chromium support, packaged macOS support, and license inventory. This slice
   is an adoption gate, not permission to import the Rifty umbrella API.
2. **Sandboxed shell proof:** pinned `just-bash` browser artifact, production
   bundle, opaque-origin iframe, disposable Worker, Pi `BashOperations`,
   role-scoped async filesystem, hard cancellation, and brokered `flect`
   command tests. Add the reserved Bun-compatible command after the Rifty
   execution proof: `run`, `build`, `install`, `add`, `remove`, `stop`, and the
   isolated preview bridge must pass without a system Bun installation.
3. **Embedded Git proof:** reproducible pinned wasm-git/libgit2-Wasm, trusted
   worker, OPFS adapter, serialized mutation broker, added worktree command,
   brokered `git` command, shell/worktree integration, repository reopen,
   commit, branch, diff, and real worktree tests.
4. **Composer, modes, and authentication:** T3-derived composer/provider
   picker, run/edit mode shell, in-Flect Pi login/logout, model refresh,
   favorites, and README cleanup.
5. **Capsule agent and command packages:** capsule manifest and integrity
   rules, protected base App Agent, capsule App Agent package, portable
   extension and WASI command formats, shell-command contributions, install
   review, and role-scoped grants.
6. **Supervised extensible agents:** independent App Agent and Shaper
   lifecycles, extension discovery and explicit role enablement,
   `AgentObservation`, Guardian triggers, containment, base-agent fallback, and
   extension-free Shaper restart.
7. **Authoring integration:** Shaper shell workflow, optional Rifty-backed
   development preview, restricted Rolldown acceptance build, isolated capsule
   preview, Git accept/reject/rollback, migration, and recovery.
8. **Product verification:** real-browser automation, native host tests,
   accessibility, release media, attribution, documentation, and dogfood.

Each slice lands only with its public behavior tests passing. The final outcome
is not considered complete until the integrated browser and packaged macOS app
have been exercised through capsule installation, login, Bash-driven App Agent
use, run-to-edit handoff, Bash-driven edit, build, preview, accept, role-scoped
extension failure, Guardian shell recovery, restart, and rollback.

## Testing

### Contract and Effect tests

- Decode every shell, filesystem, Git, auth, extension, observation, recovery,
  command-package, browser-process, package, preview, and build boundary with
  excess properties rejected.
- Test `GitWorkspace`, `BrowserExecution`, `WasmCommandRuntime`,
  `BrowserBuild`, `PiAuthentication`, `SandboxedShell`, `ShellFilesystem`,
  `ShellCommandBroker`, `CapsuleAgentPackage`, `AppAgentRuntime`,
  `ExtensionCatalog`, `AgentSupervisor`, and `GuardianRecovery` through test
  Layers.
- Use scoped workers and finalizer assertions to prove interruption and
  disposal.
- Prove secrets cannot enter encodable public events, logs, snapshots, Git, or
  errors.
- Prove Guardian receives a bounded read-only observation rather than a
  mutable App Agent or Shaper session object.
- Prove extensions cannot load before explicit enablement or enter Guardian.
- Prove App Agent has no Git or source-editing capabilities, Shaper has no
  product API capabilities, and an extension grant never crosses roles.
- Prove role shells expose only one Pi `bash` tool by default, and capability
  and extension schemas enter model context only after explicit shell
  discovery.
- Prove `bun` is reserved, unsupported subcommands fail explicitly, package
  mutations use the brokered Rifty npm client, and cancellation disposes every
  run Worker without touching canonical OPFS.
- Prove Rifty services are composed once at the runtime edge, every Worker and
  service-worker bridge is scoped, and React has no direct Rifty dependency.
- Prove an untrusted Rifty process sees only its disposable proposal mirror and
  cannot reach canonical OPFS, another workspace, Flect-origin storage,
  credentials, arbitrary network, Git metadata, or activation state.
- Prove a WASI command receives only declared preopens and that reserved
  commands cannot be replaced.

### Real-browser tests

Playwright runs against a production build in Chromium and verifies:

- the exact pinned Rifty packages bundle and boot behind `BrowserExecution`,
  while the tested CSP denies ambient egress and the runtime can be terminated
  without losing canonical source;
- verified package installation into a disposable mirror, a bounded
  Node-compatible command, a WASI command, and a service-worker-routed
  development preview;
- unsupported package lifecycle scripts, native dependencies, and undeclared
  network access fail closed;
- the pinned `just-bash` bundle loads without Node globals or polyfills in the
  opaque-origin shell host;
- the Bun-compatible `run`, `build`, `install`, `add`, `remove`, and `stop`
  commands execute through the browser sandbox, and the compatibility help
  does not claim unsupported native Bun APIs;
- pipelines, redirection, text processing, filesystem writes, output limits,
  cooperative cancellation, and forced Worker termination;
- path traversal, symlink escape, direct OPFS, storage, and direct-network
  access remain unavailable from every role shell;
- `.flect` capsule import, manifest and hash verification, extension review,
  approval or decline, restricted opening, and refresh restoration;
- OPFS repository creation, refresh restoration, export, and serialized
  mutation while disposable execution mirrors exist;
- wasm-git/libgit2 commit, branch, worktree, diff, accept, reject, and rollback;
- source edit, optional Rifty development preview, restricted Rolldown
  acceptance build, isolated capsule preview, and last-successful fallback;
- provider and model search, favorites, keyboard behavior, and compact layout;
- deterministic OAuth, device-code, API-key, cancellation, logout, and refresh
  flows through test Pi Layers;
- App Agent conversation, approved test-API invocation, inert UI intent, and
  explicit `RequestEditMode` handoff through Bash and `flect` commands;
- Shaper file edits and familiar `git status`, `diff`, `add`, and `commit`
  commands against the exact proposal worktree;
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
OPFS persistence, restart recovery, the same Rifty, WASI, browser-resident
shell, and acceptance-build paths, and absence of system Bash and Git
dependencies.

### Live smoke

An opt-in smoke uses the developer's existing Pi state to:

1. open Flect;
2. install or open a capsule containing a benign portable extension;
3. review its agent package, extensions, and capability requests;
4. perform or confirm in-app provider login;
5. select a model;
6. ask App Agent to discover and invoke an approved reversible operation
   through Bash;
7. request and confirm an edit-mode handoff;
8. make and commit a Shaper edit through Bash in a proposal worktree;
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
  capability isolation, the browser shell boundary, cooperative Rifty
  execution versus Flect containment, portable Wasm commands, Guardian
  authority, embedded Git, OPFS, and recovery explanations.
- Root `AGENTS.md` changes only after the shell boundary is implemented and
  proven. It then records that Bash is allowed solely through
  `SandboxedShell`; host shell, ambient filesystem, and direct network remain
  prohibited.
- T3-derived code and repository notices include the required MIT attribution.
- GitHub issues remain the executable acceptance criteria for capsule,
  authoring, capability, and ecosystem delivery.

## Non-goals

This design does not promise:

- arbitrary Node/Vite plugins in a browser;
- that Rifty, a Worker, cross-origin isolation, or `SharedArrayBuffer` provides
  hostile-code containment;
- full Node, POSIX, WASIX, native-process, or native-CLI compatibility;
- arbitrary native binaries or the host shell;
- unrestricted package scripts;
- automatic trust of external Pi extensions;
- silent capability grants;
- network access for generated UI;
- automatic Git remote push;
- SSH Git transport, credential helpers, hooks, signing, or every Git
  subcommand;
- system Git integration;
- recovery that depends on Guardian or a model;
- replacing product authentication or authorization; or
- loading arbitrary extensions into the protected launcher or Guardian.

## Retained research references

This section preserves the primary sources and conclusions used for the
2026-07-30 browser-runtime, shell, Git, and sandbox decision. A reference here
does not make the project a Flect dependency. Implementation must revalidate
the exact selected artifact before pinning it.

### Selected foundations

- [Rifty](https://github.com/vanilla-wave/rifty), evaluated at
  `207e0ee9f108d6457e2448c956b84c2758e62671`: closest open, self-hostable
  browser-local execution substrate. Selected leaf capabilities are VFS,
  Worker/process IPC, Node-compatible authoring, WASI Preview 1, package
  installation, local networking, service-worker preview routing, and later
  TypeScript language services. Its
  [trust model](https://github.com/vanilla-wave/rifty/blob/main/docs/public/trust-model.md)
  explicitly limits it to cooperative execution, which is why Flect retains
  its own origin, CSP, capability, canonical-workspace, and recovery
  boundaries.
- Rifty's pinned
  [`npm-client` README](https://github.com/vanilla-wave/rifty/blob/207e0ee9f108d6457e2448c956b84c2758e62671/packages/npm-client/README.md)
  and
  [lockfile reader](https://github.com/vanilla-wave/rifty/blob/207e0ee9f108d6457e2448c956b84c2758e62671/packages/npm-client/src/installer-lockfile-reader.ts)
  define the selected package-install call and its
  `<cwd>/package-lock.json` persistence contract.
- [wasm-git](https://github.com/petersalomonsen/wasm-git), evaluated at
  `6250484764878a35ba374836465cbf2e54364994`: selected source foundation for
  the embedded libgit2 artifact. Its browser builds cover OPFS with pthread,
  JSPI, and Asyncify variants and expose an `lg2` command surface.
- [libgit2 worktree API](https://libgit2.org/docs/reference/main/worktree/index.html)
  and
  [`git_worktree_add`](https://libgit2.org/docs/reference/main/worktree/git_worktree_add.html):
  source for the missing bounded worktree adapter.
- [just-bash](https://github.com/vercel-labs/just-bash), evaluated as
  `just-bash@3.2.0`: selected model-facing Bash parser and browser userland,
  subject to the production-bundle and `node:zlib` gate.
- [Rolldown](https://github.com/rolldown/rolldown), evaluated through
  `@rolldown/browser@1.2.1`, release tag `v1.2.1` at
  `93c535d8875daacde3afa84c0d4e9d26e87453e9`: retained as the restricted
  acceptance compiler even when Rifty supplies a faster Vite-compatible
  authoring preview. Its removed CSS bundling is replaced only by Flect's
  bounded local-CSS adapter.

### Adjacent implementations retained for patterns

- [Burrow](https://github.com/Dhravya/burrow), evaluated at
  `5db19587ed318df1f12010b3a49c6daee79732c7`: closest existing browser
  development-machine product using just-bash, isomorphic-git, a shared
  virtual filesystem, Worker execution, browser package installation,
  service-worker preview routing, and local AI. Retained as an implementation
  reference, not a dependency, because its memory/IndexedDB persistence and
  Git/worktree model do not satisfy Flect's canonical OPFS and supervision
  requirements. Its pinned
  [`bun` command](https://github.com/Dhravya/burrow/blob/5db19587ed318df1f12010b3a49c6daee79732c7/src/toolchain/commands.ts),
  [runtime bridge](https://github.com/Dhravya/burrow/blob/5db19587ed318df1f12010b3a49c6daee79732c7/src/toolchain/wasm.ts),
  and
  [compatibility matrix](https://github.com/Dhravya/burrow/blob/5db19587ed318df1f12010b3a49c6daee79732c7/COMPAT.md)
  are retained specifically for the compatible command, Worker execution,
  package-command, cancellation, and `Bun.serve` preview patterns. Its
  checked-in `bun.wasm` is not selected because the repository does not record
  a reproducible source revision and build recipe for that binary.
- [Agent in a Browser](https://github.com/tjfontaine/agent-in-a-browser),
  evaluated at `677a94ed83c908705b6a5f7c5a5cdbaa71f63010`: retained for its WASI
  Preview 2 command-component host, OPFS shims, JSPI and
  `SharedArrayBuffer`/`Atomics` fallback, browser command packages, command
  policy, and Playwright coverage. Its internal workspace packages were not
  published as reusable npm packages at evaluation time, its Git command is
  incomplete for Flect, and its root licensing must be clarified before any
  code reuse.
- [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git),
  evaluated at `5aff8afa3135eb15b8507619ea3cd30526ebbe69`: mature pure-JavaScript
  browser Git API and useful compatibility oracle. Not selected as canonical
  Git because its CLI is intentionally secondary, it does not create or
  manage linked worktrees, and its in-process locks are not a sufficient
  cross-Worker repository-mutation boundary.
- [Runno](https://github.com/taybenlor/runno), evaluated at
  `3c32435e7a07a59aac3f5497040c8c6317d1cff3`: retained as a small WASI
  Preview 1 host and browser-language sandbox reference. Its WASIX process,
  thread, network, and persistent-filesystem surfaces were incomplete for
  Flect.
- [browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim), evaluated
  at `b068ec2c22d68581c48f2592f8cca1681bf71a98`: retained as a small
  MIT/Apache low-level WASI Preview 1 reference. Its OPFS support is
  file-oriented rather than a complete Flect filesystem and command host.
- [Wasmer JS SDK](https://github.com/wasmerio/wasmer-js), evaluated at
  `fafb390806342eeae2253e41cccca3831309e369`: retained as an optional future
  heavy-command profile and WASIX reference. It requires cross-origin
  isolation, has a much larger runtime footprint, and is registry-oriented, so
  it is not Flect's portable baseline.
- [CoWasm](https://github.com/sagemathinc/cowasm), evaluated at
  `4e55390ad8f0933a0c8d027b7d8f67e6401233dd`: retained for browser POSIX,
  dynamic-library, subprocess, shell, Python, SQLite, and libgit2 porting
  patterns. It is a broad pre-alpha toolchain rather than a small embeddable
  Flect runtime.

### Git implementations evaluated but not selected

- [Gitoxide](https://github.com/GitoxideLabs/gitoxide): promising pure-Rust
  Git libraries, but the project warns that its `gix` and `ein` command-line
  interfaces are unstable and it did not provide the required production
  browser CLI and OPFS integration.
- [Ziggit](https://github.com/hdresearch/ziggit): advertises broad Git and
  worktree coverage, but its evaluated freestanding browser dispatcher
  implemented only a very small command subset. Native/WASI source presence
  was not accepted as proof of browser behavior.
- [samdenty/git.wasm](https://github.com/samdenty/git.wasm),
  [kirjavascript/git.wasm](https://github.com/kirjavascript/git.wasm),
  [Edge-Tools/git-wasm](https://github.com/Edge-Tools/git-wasm), and
  [simple-git-wasm](https://github.com/powercord-org/simple-git-wasm): retained
  as prior-art references only. They were stale, minimally integrated,
  generated-vendor artifacts, or too limited to own Flect's repository.

### Broader runtimes evaluated but not selected

- [WebVM](https://github.com/leaningtech/webvm), evaluated at
  `e58fef0c9a1c815617e57c6704eaaf7c79c3de1c`: supplies a full x86 Linux
  environment in the browser, but its CheerpX runtime and organizational
  self-hosting terms do not fit Flect's open, lightweight, self-contained
  baseline.
- [WebContainers](https://github.com/stackblitz/webcontainer-core): capable
  browser Node runtime, but the public repository is a client surface for a
  proprietary runtime and does not meet Flect's locally owned, open,
  self-hostable requirement.
- [BoxVM](https://github.com/overandor/boxvm): early browser/WASI container
  experiment whose durable storage and checkpointing remained roadmap work.
- [Hush](https://github.com/hack-pad/hush): browser-portable Go shell retained
  only as shell-language prior art; just-bash better matches Flect's selected
  async filesystem and cancellation surface.
- [Bashkit](https://github.com/everruns/bashkit), evaluated through
  `@everruns/bashkit-wasm@0.14.4`: retained as the fallback shell interpreter
  if just-bash fails isolation tests, but its larger artifact, internal VFS,
  and missing hard browser deadline made it the second choice.

### Standards and browser primitives

- [WASI](https://github.com/WebAssembly/WASI): portable system-interface
  standard used for reviewed command modules.
- [Component Model worlds](https://component-model.bytecodealliance.org/design/worlds.html)
  and
  [running components](https://component-model.bytecodealliance.org/running-components.html):
  basis for the later `wasi:cli/command` ABI and capability-by-import design.
- [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system):
  browser persistence primitive for the canonical repository, subject to
  origin partitioning, browser quota, eviction, secure-context, and Worker
  constraints.

## Acceptance

The design is complete when a new user can install or open Flect, authenticate
Pi from inside the product, select a provider and model through the T3-derived
picker, install a shareable `.flect` whose portable Pi extensions survive the
round trip, review and approve each role and capability, talk to App Agent in
run mode through one Bash tool, discover and perform an approved product
operation without loading its complete schema into initial model context,
explicitly hand a change to Shaper in edit mode, use familiar shell and Git
commands against its proposal worktree, inspect the real Git diff and isolated
build, accept or reject it, restart without losing the workspace, and recover
from an induced App Agent, Shaper, or extension failure through Guardian and
deterministic safe mode—all without installing Bash, Git, a separate Pi client,
or using a terminal.
