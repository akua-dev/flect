# Flect

> The interface that takes your shape.

[![Flect quality](https://github.com/akua-dev/flect/actions/workflows/quality.yml/badge.svg)](https://github.com/akua-dev/flect/actions/workflows/quality.yml)

![Flect adapting across product interfaces](assets/flect-hero.png)

Flect is an open-source, agent-native interface shell. You describe what you
need, the agent builds and repairs it, and the running interface remains the
place where you keep shaping the work.

The agent is not a chatbot beside a static application. It is the programmable
backbone of the interface. Git quietly protects the work underneath, while
typed capabilities keep outside effects inspectable, approved, and revocable.

## A glimpse of the final Flect

Mara opens Flect because her logistics company has outgrown its spreadsheet.
There is no project wizard or framework selector, just an empty canvas and one
question: _What do you need?_

She asks for a live view of today's deliveries. Flect requests read-only access
to the delivery API, then a working interface appears. Mara selects a late
delivery badge and asks the agent to make it calmer. The valid change appears
directly on the running canvas. She drags the driver summary above the map and
Flect updates the ordinary source project behind it.

When a later edit fails to build, the working interface never disappears. The
agent reads the source and runtime diagnostics, repairs the problem, and keeps
going. History shows human descriptions such as _Improved the small-screen
layout_, not a wall of Git terminology. Mara can Undo or restore any earlier
state immediately; her developer can still open the same work as a normal Git
repository.

Flect mostly disappears. What remains is software that is alive,
understandable, and owned by the person using it.

Read the complete story and product boundary in [VISION.md](VISION.md).

## The product promise

- The running interface is the canvas; there is no mandatory preview or review
  ceremony for a valid local UI edit.
- One continuous agent conversation can create, inspect, modify, and repair the
  frontend while it is running.
- People can edit by describing an outcome, selecting what they see, or using
  direct manipulation where it is safe and unambiguous.
- A persistent incremental workspace keeps the agent, compiler, running
  canvas, Git history, and exported source on one canonical revision.
- The last-known-good interface remains usable when an edit or build fails.
- History feels like Undo, Redo, and Restore. Ordinary Git remains available as
  progressive disclosure and as the portable source of truth.
- External effects remain behind typed, bounded capabilities. Flect asks for
  confirmation when authority changes, not for every visual iteration.
- Every supported host feels first-party to its platform. Shared product logic
  never excuses lag, fake native controls, mismatched appearance, or generic
  WebView behavior.

## Project status

Flect is under active development. The destination above is the product
direction, not a claim that every part already ships.

The current repository and v0.2.0 macOS build implement an earlier protected
vertical slice. It proves Pi-backed model access, streamed turns, deterministic
validation, attributable revisions, last-known-good recovery, bounded browser
workspaces, and matching browser/native runtime boundaries.

That slice still exposes Edit/Run modes, Shaper/App Agent roles, explicit
Keep/Reject decisions, and a separate safe-mode surface. Those are current
implementation artifacts being replaced, not the intended final workflow.
The active delivery plan is tracked by the
[Flect 1.0 epic](https://github.com/akua-dev/flect/issues/1) and the
[Flect project](https://github.com/orgs/akua-dev/projects/8).

The immediate product work is:

- [the running interface as the live editing canvas](https://github.com/akua-dev/flect/issues/32);
- [a persistent incremental frontend workspace](https://github.com/akua-dev/flect/issues/33);
- [typed tools for the agent to inspect and repair the running frontend](https://github.com/akua-dev/flect/issues/34);
- [element selection and direct manipulation](https://github.com/akua-dev/flect/issues/35); and
- [first-party native behavior on every supported host](https://github.com/akua-dev/flect/issues/36).

## Try the current developer preview

![Current Flect developer-preview demo](assets/demo/flect-v0.2-demo.webp)

### Apple Silicon macOS

The current native preview requires Apple Silicon and macOS 12 or newer. It
contains its own Pi runtime; no terminal login or separate Pi installation is
required.

[Download Flect v0.2.0 for Apple Silicon macOS](https://github.com/akua-dev/flect/releases/latest/download/Flect_0.2.0_aarch64.dmg)
·
[SHA-256 checksum](https://github.com/akua-dev/flect/releases/latest/download/Flect_0.2.0_aarch64.dmg.sha256)
·
[Release evidence](https://github.com/akua-dev/flect/releases/latest/download/Flect_0.2.0_aarch64.release.json)

Download the DMG and checksum into the same directory and verify them:

```bash
cd ~/Downloads
shasum -a 256 -c Flect_0.2.0_aarch64.dmg.sha256
```

Open the DMG and drag Flect into Applications. The v0.2.0 app is ad-hoc signed
and unnotarized, so Gatekeeper may block the first launch. After verifying the
checksum, use Finder's **Open** action from the context menu. If quarantine
still blocks the app:

```bash
xattr -dr com.apple.quarantine /Applications/Flect.app
```

Launch Flect, open the model chooser, and connect a provider under **Pi
providers**. Provider credentials stay in Pi's private local store. Sensitive
manual values open in a separate one-use loopback page that Flect's interface
cannot read.

Native update review and ownership-safe uninstall preparation live under
**Diagnostics**. Development builds do not contain an update trust key; public
builds fail closed unless the signed updater and Apple trust evidence are
complete. See [Updates and uninstall](docs/updates-and-uninstall.md).

### Browser and source

```bash
git clone https://github.com/akua-dev/flect.git
cd flect
bun install
bun run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite serves the UI there;
the origin-restricted local Pi runtime listens on `127.0.0.1:3210`. Connect a
provider from the model chooser. Provider credentials remain in Pi and never
enter React state, workspace snapshots, control APIs, browser storage, or
shaped interfaces.

## What the current slice proves

- in-product Pi provider discovery, authentication, model selection, streamed
  turns, cancellation, and redacted public failures;
- an Effect-owned workspace controller with schema-validated interface state,
  deterministic last-known-good recovery, and a protected composer;
- a canonical browser-portable Git repository in OPFS, guarded revision refs,
  persistence across reloads, and complete ordinary-Git export;
- bounded static and single-entry Vite JavaScript, TypeScript, and React import,
  a Worker compiler, integrity-checked package resolution, and offline cache;
- deterministic `.flect` capsule import/export, protected provenance and
  capability review, portable sharing, and user-owned forks;
- a typed product-capability registry plus the packable
  [`@flect/product`](packages/product/) SDK and reference integrations;
- an opt-in local `flect` CLI, JSON/SSE, and MCP control surface using the same
  workspace controller as visible UI actions;
- responsive light/dark, forced-colors, reduced-motion, keyboard, Markdown,
  accessibility, and bounded conversation-continuity behavior;
- browser HTTP/SSE and native private-stdio transports behind the same Effect
  capabilities; and
- optional pure extension logic in a disposable QuickJS/Wasm worker that can
  return inert, schema-decoded intents only.

The native app does not start the browser development server. It launches a
compiled Bun/Pi sidecar and communicates through private NDJSON stdio exposed
to the webview by one narrow Tauri command. When the user enables outside
control, that sidecar additionally exposes the authenticated loopback broker.

## Adopt Flect in a product

`@flect/product` is the separately versioned, browser-portable Effect SDK for
product teams. It defines strict product metadata, recommended `.flect`
experiences, named unary and event operations, compatibility and declarative
migrations, inference ownership, user-state separation, and deterministic
adoption diagnostics. It also exports policy-fixed HTTP/GraphQL and bounded
event host Layers.

Build and verify the current `0.1.0` preview tarball locally:

```bash
bun run product:package
npm install ./dist-product-sdk/flect-product-0.1.0.tgz effect@4.0.0-beta.102
```

This command installs the tarball into a clean temporary consumer, typechecks
it, and runs the smallest offline integration. It does not publish to npm.
Start with the [SDK quickstart](packages/product/README.md), then compare the
[offline, browser-direct, and brokered references](examples/product-sdk/).

Flect still owns all grants, protected review, capsule activation, workspace
Git, safe mode, and recovery. Products supply only named, bounded closures.
Product denial overrides approval; credentials stay inside trusted host
closures; model-provider or inference-owner choice cannot change product
authorization. Product connection records remain separate from personal forks
and exports, and detach preserves that user-owned work.

## Security and product boundary

> Interfaces may reshape the user experience, but may affect the outside world
> only through inspectable, approved, and revocable capabilities.

The generated frontend and browser agent workspace are defense-in-depth
execution realms, not operating-system sandboxes. They cannot invoke a host
shell, native process, system Bun, ambient filesystem, or ambient network.
Credentials remain outside user-generated source and model-visible project
state.

Flect now exports and imports verified declarative `.flect` capsules through a
reviewable candidate flow. It also imports, isolates, persists, restores, and
byte-preservingly re-exports compiled HTML capsules with verified local CSS,
classic scripts, images, fonts, and media in supported browsers.
Arbitrary Vite plugins/config transforms, CSS modules/preprocessors and asset
URL rewriting, multi-entry routing, Vue/Svelte adapters, archive/Git import,
general capsule personal-fork lineage and compatible merge, a component
registry, custom duration/rate editing in the protected permission UI,
database adapters, privileged native
product transport, remote
runtimes, a published signed updater, notarization, a
macOS App Sandbox entitlement, and Intel, Windows, and Linux packages are not
yet shipped.

See the [capability and sandbox trust model](docs/trust-model.md) for the
authority boundary and the
[browser Bun compatibility matrix](docs/bun-compatibility.md) for supported
commands and deliberate omissions.

## Import an existing interface

Open the composer’s **Actions** menu and choose **Import app project**. Select
one directory with a root `index.html`. Flect currently recognizes plain static
sites and standard Vite browser entrypoints, including React JSX/TSX. It checks
paths and compatibility without executing source, excludes secret-shaped and
generated dependency files before reading them, checkpoints recognizable
source into embedded Git, and builds the exact isolated proposal locally.
When runtime dependencies need resolution, Flect generates or verifies an npm
v3 lock, checkpoints it into the candidate's ordinary Git source, supersedes
the guarded proposal, and compiles only that locked commit.
The current boundary accepts at most 255 source files (the capsule reserves one
metadata entry), 32 MiB total, and 100 characters per portable relative path.
Named unsupported Vite plugins, `resolve.alias`, and `node:` built-ins are
reported before a candidate exists, with a browser-portable alternative.

The resulting app opens as a candidate. Review its source revision, artifact
digest, adaptations, ignored files, capabilities, and compatibility; exercise
the isolated UI; then choose **Keep change** or **Reject**. A kept build exports
as a complete `.flect` capsule and runs without Vite, npm, or a Flect-hosted
service. Vite config and package scripts are preserved as source but never run;
only runtime dependencies enter the portable package graph.

## Architecture, product, and vision

- [Vision, final product story, and intentional non-capabilities](VISION.md)
- [Users, positioning, and product principles](PRODUCT.md)
- [Visible design system](DESIGN.md)
- [Implemented architecture](ARCHITECTURE.md)
- [Capability and sandbox trust model](docs/trust-model.md)
- [Current performance and platform-native baseline](docs/verification/2026-08-10-performance-and-native-feel-baseline.md)
- [Astro activation-shell architecture decision](docs/decisions/0003-astro-activation-shell.md)
- [Local agent control](docs/local-control.md)
- [Product capability adoption](docs/product-capabilities.md)
- [Browser Bun compatibility](docs/bun-compatibility.md)
- [Performance and memory budgets](docs/performance.md)
- [Session continuity and recovery](docs/recovery.md)
- [Updates and uninstall](docs/updates-and-uninstall.md)
- [Contributor guide](CONTRIBUTING.md)
- [Flect delivery project](https://github.com/orgs/akua-dev/projects/8)

## Verify and contribute

```bash
bun install --frozen-lockfile
bun run check:all
```

`check:all` runs Effect preparation, lint, type checking, unit and contract
tests, production Chromium workflows, Rust formatting and tests, and the native
application build. The credential-free GitHub quality workflow runs this same
command on every pull request and every change to `main`; it uploads only
bounded Playwright failure evidence. `bun run test:pi-smoke` is separate
because it makes one real private turn with the developer's existing Pi
provider login.

Release maintainers can reproduce the screenshots, demo, and hero with
`bun run media:release`, then produce the DMG, checksum, MP4, and a
machine-readable evidence manifest with `bun run release:package`. Public mode
also produces the signed Tauri archive and static `latest.json`. The package
gate verifies the mounted DMG, exact executable inventory and architecture,
deep/strict signing, hardened runtime, and observed Gatekeeper/stapling state.
Public mode (`FLECT_PUBLIC_RELEASE=1`) additionally requires updater signing
material from the release environment and fails closed unless source, Developer
ID, notarization, updater signature verification, and independent
reproducibility proof are all present. Tauri's current Isolation Pattern intentionally generates fresh
per-build security material, so independent native-content reproducibility is
recorded as blocked rather than claimed. The media pipeline additionally needs
FFmpeg and the WebP tools `cwebp`, `dwebp`, and `img2webp`.

## License

Flect is licensed under the [Apache License 2.0](LICENSE).
