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
- author, build, and preview interfaces locally in a normal browser without a
  proprietary hosted development runtime;
- install compiled `.flect` capsules that continue to run without their build
  tool or package registry;
- connect REST, GraphQL, event streams, local data, files, databases, and
  product APIs through explicit capability adapters;
- use raw SQL only when an owner deliberately exposes an appropriately scoped
  SQL capability;
- ask the built-in agent to use approved product capabilities as well as shape
  their presentation;
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
- preview, accept, reject, compare, version, undo, and recover every
  attributable interface revision.

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
- modify the Guardian, safe launcher, capability broker, validation rules, or
  required recovery journal;
- erase attribution required to explain and recover a change;
- replace the accepted interface without a validated, attributable revision;
  or
- become trusted merely because it was generated by a model or signed by a
  publisher.

Recovery cannot depend on a model being available. The Guardian may assist
diagnosis and repair, but validation, safe mode, permission revocation, and
last-known-good rollback remain deterministic protected-core behavior.

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

## The first working slice

The repository now implements a protected vertical slice in the browser and a
macOS Tauri app. A user can ask the Shaper Pi to revise a schema-defined
interface, preview the validated result, keep or reject it, and recover through
last-known-good rollback or the compiled safe launcher.

Guardian and Shaper use separate in-memory Pi sessions behind one private
runtime boundary. The desktop app carries that runtime as a compiled sidecar
over stdio instead of exposing it on localhost. Optional pure extension logic
can run in a disposable, resource-limited QuickJS WebAssembly worker and return
only inert typed intents.

This slice intentionally does not run generated React, native extensions,
shell commands, or product API capabilities. It proves the model,
credential, shaping, preview, transport, logic-sandbox, and deterministic
recovery boundaries on which the larger ecosystem can safely build.
