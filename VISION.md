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
- a chat sidebar attached to an existing application; or
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

The repository currently implements the protected conversational foundation,
not arbitrary self-modifying code. A local Effect runtime embeds Pi for
authenticated model discovery and tool-free sessions. The browser consumes
strict contracts and streamed events through a single Effect
`ManagedRuntime`. A compiled launcher and `?safe=1` recovery path remain outside
customized interface state.

This deliberately narrow slice proves the model, credential, streaming, and
recovery boundaries on which sandboxed interface generation can safely build.
