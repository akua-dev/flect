# Flect

> The interface that takes your shape.

Software has always asked people to adapt to interfaces designed by somebody
else. Products decide what is visible, how work is organized, and which paths
are possible. Customization usually stops at themes, preferences, and a fixed
catalog of widgets.

AI changes that bargain.

## The vision

Flect is an open-source, agent-native shell for interfaces that shape
themselves.

It is a local desktop application that can also run in the browser. Anyone can
install it and create useful interfaces from inside the interface itself. No
existing product or backend is required.

Product teams can also adopt Flect as the interface layer for a service, API,
or open-source project. They can ship a thoughtful default experience without
turning that experience into a permanent boundary. Every user remains free to
change how the product appears and behaves for them.

The agent is not a chatbot added beside a static application. It is the
programmable backbone of the interface. It understands the capabilities
available to it, can act through those capabilities, and can compose, modify,
and repair the interface while the user is using it.

## One shell, two starting points

Flect supports two equally important paths:

1. **Start with Flect.** Open a blank or minimal workspace, describe what you
   need, connect data or APIs when useful, and build the experience in place.
2. **Start with a product.** Open a product's recommended Flect experience and
   keep it as shipped, personalize it, or replace parts of it entirely.

Most people will use good defaults. The point is not to make everyone design
software. The point is to ensure that nobody is trapped by a fixed interface
when their needs differ.

## A day with Flect

The following story describes the destination. It is a product test for what
Flect should feel like, not a claim that the current developer preview already
implements every part.

Mara does not open Flect to write code. She opens it because the small
logistics company she runs has outgrown its spreadsheet.

The window appears immediately. There is no project wizard, framework
selection, or agent mode. There is an empty canvas and a quiet prompt:

> What do you need?

Mara asks for a live view of today's deliveries, with late orders first,
drivers grouped clearly, and urgent work impossible to miss.

The agent explains that it needs read-only access to deliveries and drivers.
Flect shows exactly what that capability permits and what it does not. Mara
approves it. Seconds later, the empty canvas becomes a working application.

Real deliveries appear. Cards move as statuses change. A small map shows where
drivers are. The application is already running; there is no separate preview
mode or review screen between Mara and a valid local UI change.

Mara selects the red _Late_ badge and asks the agent to make it calmer without
making urgent orders easier to miss. The agent changes the color, contrast,
spacing, and icon treatment while she looks at the result. It checks the
accessible contrast in the background and briefly explains why a paler red
would not be safe enough.

She drags the driver summary above the map. Flect understands the gesture as a
change to the real interface, not as temporary canvas state. The canonical
source changes, the running app updates incrementally, and a quiet history
checkpoint is created. No Save or Keep button interrupts her.

Later, the page feels crowded on Mara's laptop. She selects the delivery list
and says:

> On small screens, collapse completed deliveries and keep the driver names
> visible.

The agent can inspect the running layout, the selected element, its computed
styles, the source that produced it, and the current viewport. It makes the
change without asking Mara which file or framework component to edit.

Something breaks during the next request. The build status turns amber, but
the working application never disappears. Flect keeps the last-known-good
revision running while the agent reads the compiler diagnostic, finds the
incorrect component property, repairs it, and continues.

Mara sees one useful sentence:

> I hit a build error and fixed it. Your working version stayed available.

At the end of the afternoon, Mara realizes that she preferred the map from
three changes ago. She opens History. It does not look like a Git client. It
shows a small sequence of understandable changes:

- _Made late deliveries calmer_
- _Moved the driver summary above the map_
- _Improved the small-screen layout_
- _Changed map grouping_

She chooses the earlier map and restores it. The running canvas changes
immediately. Underneath, Flect performs an ordinary Git operation in an
ordinary repository. Nothing is trapped inside a proprietary design file.

The next morning, Mara reopens Flect. The application, conversation,
permissions, and history are where she left them. The shell is responsive
before the model or network has fully reconnected.

Her developer, Leo, opens the same project in his editor. He finds normal
source code, readable commits, standard dependencies, and no mysterious
generated format. He improves an API type and pushes the change. Flect picks it
up and keeps going.

A week later, Mara shares the application with her team. Reading deliveries is
already approved. Updating delivery status requires a new capability, so Flect
asks for the one confirmation that matters: whether the interface may gain
that outside authority. Mara grants it only to supervisors.

The interface can reshape itself. It cannot quietly gain power.

Months pass. The delivery view becomes the company's daily operating surface.
Mara still changes it by describing problems and manipulating what she sees.
Leo still owns understandable code. Git still records everything. The agent
handles the machinery between intention and implementation.

Flect itself mostly disappears. What remains is the feeling that software is
not a finished object handed to Mara. It is alive, understandable, and hers.

## Product boundary

> Interfaces may reshape the user experience, but may affect the outside world
> only through inspectable, approved, and revocable capabilities.

Flect is intended to become a universal sandboxed interface shell, not an
unrestricted application or operating-system runtime. The customizable
experience may use arbitrary compiled web UI and isolated pure logic. Network,
filesystem, database, model, product, and native effects remain behind typed
capabilities controlled by the user and the authority that exposes them.

The protected fallback follows a different rule: it remains deliberately
small, schema-defined, and independent from user code so that recovery does
not depend on the interface being recovered.

### What Flect enables

Flect will let people:

- create a complete interface conversationally from a blank or minimal
  workspace;
- reshape the running interface through prompts and direct manipulation,
  including the normal agent composer and rail;
- import and adapt supported React, Vue, Svelte, HTML, and CSS source projects
  into portable Flect experiences;
- author, build, and run interfaces locally in a normal browser without a
  proprietary hosted development runtime;
- install compiled `.flect` capsules that continue to run without their build
  tool or package registry;
- connect REST, GraphQL, event streams, local data, files, databases, and
  product APIs through explicit capability adapters;
- use raw SQL only when an owner deliberately exposes an appropriately scoped
  SQL capability;
- ask the built-in agent to use approved product capabilities as well as shape
  their presentation;
- explicitly pair a local outside agent that can inspect, operate, debug, and
  subscribe to the same live workspace through the same user-visible command
  and recovery boundaries;
- use model access they control through Pi or another approved runtime instead
  of requiring every product to operate an inference service;
- begin without an existing product backend and create local, offline-capable
  personal tools;
- install, inspect, fork, revise, remove, and share complete experiences,
  components, themes, and workflows;
- keep a product's recommended experience unchanged or personalize it without
  changing the product for other users;
- run the shared interface in browsers and desktop hosts, extend it to mobile,
  and add genuinely native platform experiences through narrow Swift, Kotlin,
  or Rust capabilities; and
- see valid local changes in the running interface immediately, compare and
  version them, undo or restore them, and recover every attributable revision.

These primitives can produce dashboards, internal tools, API consoles,
research environments, personal workspaces, agent control surfaces, and many
conventional SaaS interfaces. Those examples are uses of Flect rather than a
fixed catalog that limits it.

### What Flect deliberately does not allow

A shared interface, component, or extension cannot:

- execute unrestricted shell commands, native binaries, backend daemons, or
  host processes;
- read arbitrary files, databases, browser storage, operating-system
  resources, or credentials;
- make unrestricted network requests or call product capabilities it has not
  been granted;
- access Pi credentials, model-provider tokens, or another product's secrets;
- bypass product authentication, authorization, rate limits, or API policy;
- grant itself capabilities or silently expand a previous grant;
- modify the protected recovery shell, capability broker, validation rules, or
  required recovery journal;
- erase attribution required to explain and recover a change;
- replace the last-known-good interface with an invalid or unattributed
  revision; or
- become trusted merely because it was generated by a model or signed by a
  publisher.

Recovery cannot depend on a model being available. The agent may assist
diagnosis and repair when it is available, but validation, permission
revocation, last-known-good rollback, and the minimal recovery path remain
deterministic protected-core behavior.

### What Flect does not promise

Flect does not promise that:

- a closed website can be reproduced reliably from only its public URL;
- every Node package, native dependency, or Vite plugin can run in a browser;
- a web component automatically becomes a first-class SwiftUI, AppKit,
  Android, or Windows control;
- an interface can invent data or operations a product has not exposed;
- Flect replaces a product's backend, database, business logic, authorization,
  or security model;
- platform-specific integrations behave identically on every device; or
- Flect becomes a cloud hosting platform, container service, unrestricted IDE,
  or operating-system replacement.

## Principles

### The core stays small

Flect follows the extension philosophy proven by tools such as Pi: keep the
core simple, stable, and legible; let capabilities, components, and opinions
live in extensions.

### The interface stays alive

Customization is not a separate design phase followed by an export. The
running interface is the canvas. Users change it through conversation and
direct manipulation, see the result immediately, and continue from there.

### Every host feels native

Platform-native quality is a release condition, not optional polish. Flect
shares its agent, workspace, history, capability, and recovery contracts across
hosts; it does not force every host into one lowest-common-denominator shell.

The browser must behave like an excellent web application. The macOS app must
respect macOS windowing, menus, focus, keyboard shortcuts, trackpad behavior,
appearance, accessibility, and lifecycle expectations. Future iOS and Android
hosts must adopt their own navigation, back, keyboard, touch, safe-area,
haptic, and system-surface conventions before they can be called supported.

Shared web UI is an implementation option, not an excuse for imitation. When a
WebView cannot meet a platform's behavior, latency, accessibility, or visual
quality, the protected host shell provides a native surface through a narrow
adapter. Flect does not ship a fake macOS control, a desktop-shaped mobile UI,
or browser behavior hidden behind simulated application chrome.

No supported host may exhibit input lag, scroll hitching, avoidable full-page
reloads, layout jumps, mismatched system appearance, or motion that fights the
platform. These claims are proven on real supported browsers and devices, not
only with screenshots or a shared DOM test.

### Products expose capabilities

In an agent-native world, a product's durable value is its capabilities, data,
and domain knowledge—not a single prescribed arrangement of screens. Flect
gives those capabilities an adaptable surface.

### The AI interface comes with the shell

A product that adopts Flect does not need to bolt a separate assistant onto
every screen. The shell already gives the person a direct agent interface to
the product's approved capabilities. Products may provide their own inference
endpoint, but they do not have to: a user can choose a model and subscription
they already control through the local agent runtime.

This keeps model choice and inference cost flexible without weakening product
authorization. The product still decides which API capabilities exist; the
user decides which approved model helps them use those capabilities.

The dependable default is a dockable agent rail that can collapse into a
compact composer. It keeps conversation, active capabilities, permissions,
activity, results, and undo close to the interface being changed. That rail is
itself shapeable: users may move, redesign, extend, or replace it.

The protected core retains one fallback that customization cannot overwrite: a
known-safe way to open the agent, inspect or revoke capabilities, undo changes,
disable broken extensions, and recover the user-modifiable experience.

### Defaults remain valuable

Product designers still create excellent starting experiences. Flect does not
discard deliberate design; it makes that design forkable by each user without
requiring the product team to anticipate every workflow.

### Customization belongs to the user

Personal interfaces and extensions are client-side assets the user can inspect,
keep, revise, remove, and share. A product connection must not take ownership
of the user's workspace.

### Sharing compounds the ecosystem

People can share complete experiences or smaller components. Some will work
everywhere; others will target a particular API, service, profession, or
community. A useful customization should be installable without waiting for a
vendor release.

### Extensibility requires recovery

Self-modifying software must be difficult to brick. Generated and third-party
code runs with explicit capabilities inside a sandbox. Changes are attributable
and reversible. A protected recovery layer remains independent from the
user-modifiable experience so it can diagnose, repair, disable, or roll back a
broken extension.

## What Flect is not

Flect is not merely:

- a dashboard builder;
- a fixed widget system;
- a design-to-code exporter;
- a chat sidebar bolted onto an otherwise static application; or
- an interface made specifically for AgentOS.

Those can all be experiences built with Flect. They are not its boundary.

AgentOS is one natural adopter: it can use Flect to surface agents, work,
events, and organizational history. It should do so through the same public
foundation available to every other project.

## The destination

Flect succeeds when software can ship with an excellent interface without
shipping an immutable one.

The next generation of applications will not make every user accept the same
surface. They will provide a secure, extensible foundation through which the
interface can become personal, situational, and continuously useful.

Flect is that foundation.

## The current implementation

The repository now implements the continuous live-canvas loop in the browser
and the shared macOS Tauri frontend: one visible conversation and draft, no
Edit/Run or agent-role switcher, direct validated local UI changes without
Keep/Reject ceremony, responsive protected controls, quiet Git-backed history,
and deterministic last-known-good recovery. External capsules, shared code,
and authority changes remain explicit Activate/Discard decisions.

An Astro static document sits on Vite. Focus and pointer intent arm a tiny
coordinator; submitting the first prompt, using the keyboard shortcut, or
invoking an agent action hydrates a custom `client:flect` island. The protected
Flect workspace and its declarative CSS resource do not load for a view-only
visit. The compiler, package resolver, shell, Workers, and Wasm runtimes are
separately lazy. This makes the opened product useful without preloading its
authoring system while preserving the existing typed boundaries.

Internally, Guardian, accepted App Agent, Shaper, and candidate Preview App
Agent still use separate Pi sessions behind one private runtime boundary. The
Effect workspace controller accepts visible UI actions and explicitly
authorized local CLI, JSON/SSE, and MCP requests, publishes their changes
reactively, and retains bounded redacted diagnostic evidence. Effect Layers
own platform transports and optional native lifecycles; Effect concurrency
combinators own fan-out and cancellation across product, tooling, and release
code. Outside control remains off by default and cannot grant itself authority.

The current foundation includes a canonical browser-portable Git repository in
OPFS, capsule import and export, bounded source-project import, typed product
capabilities, a product-adoption SDK, in-product Pi authentication, portable
extensions, accessibility and appearance gates, and a native update/uninstall
boundary. Supported static and single-entry Vite JavaScript, TypeScript, and
React projects can be imported into isolated compiled candidates. Candidate
ceremony exists only where code or authority crosses a trust boundary.

The desktop app carries Pi traffic through a compiled sidecar over private
stdio. Optional pure extension logic runs in a disposable, resource-limited
QuickJS WebAssembly worker and returns only inert typed intents. The bounded
browser-portable shell described in
[`docs/bun-compatibility.md`](docs/bun-compatibility.md) grants no host shell,
native process, system Bun, or ambient network authority. The next stage keeps
those boundaries while making the agent, canonical frontend workspace, running
canvas, direct manipulation, and quiet Git history one coherent product
experience.
