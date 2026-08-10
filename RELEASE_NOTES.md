# Flect v0.2.0

Flect v0.2.0 ships the first portable, role-aware product foundation: describe
an interface in Shape, review the validated candidate, keep it, then use the
resulting experience through its separate App Agent. The release also includes
browser-portable OPFS/Git workspaces, sandboxed Bash/Bun role mirrors,
reviewable `.flect` capsules and imports, portable product capabilities, and
the packable `@flect/product` SDK with reference products.

## Role-aware interface shell

- A blank workspace starts with one centered, T3Code-inspired Shaper composer.
  The same mounted composer moves into an adaptive conversation rail when the
  interface appears.
- Shape/Shaper, candidate Use/Preview App Agent, and accepted Use/App Agent
  have visibly separate authority, Pi sessions, histories, drafts,
  cancellation, and browser-shell workspaces.
- The rail is resizable inline on wide screens, a right sheet at medium widths,
  and a full-width accessible sheet on compact screens.
- Searchable, provider-grouped Pi model selection includes favorites, keyboard
  operation, and explicit role identity before every send.
- Keep, reject, rollback, collapse, safe mode, focus restoration, and reduced
  motion remain part of the compiled protected shell.

## Runtime and sandbox

- Guardian, App Agent, and Shaper run as three independent primary Pi sessions;
  candidate Use acquires a separate Preview App Agent session set.
- App, Preview App, and Shaper shell requests are explicitly role-tagged through
  browser HTTP and private native RPC.
- Each interactive role receives its own just-bash/Rifty browser workspace;
  neither receives ambient host Bash, filesystem, process, or network access.
- The Effect shaping kernel and schema-validated renderer remain authoritative
  over every proposed interface.

## Install on macOS

The native preview supports Apple Silicon Macs running macOS 12 or newer.
Download `Flect_0.2.0_aarch64.dmg`, verify it with
`Flect_0.2.0_aarch64.dmg.sha256`, and drag Flect into Applications.

Launch Flect, open the model chooser, and connect a provider under **Pi
providers**. Provider credentials remain in Pi's private local store; sensitive
manual values use a separate one-use loopback page that Flect cannot read.

This build is ad-hoc signed and unnotarized. macOS Gatekeeper may block the
first launch. After verifying the checksum, use Finder’s **Open** action from
the context menu. If quarantine still blocks the app, remove it explicitly:

```bash
xattr -dr com.apple.quarantine /Applications/Flect.app
```

## Run from source

The same shell works in a browser:

```bash
git clone https://github.com/akua-dev/flect.git
cd flect
bun install
```

Run `bun run dev`, open `http://127.0.0.1:5173`, and connect a provider from
the model chooser under **Pi providers**.

Release assets:

- `Flect_0.2.0_aarch64.dmg`
- `Flect_0.2.0_aarch64.dmg.sha256`
- `flect-v0.2.0-demo.mp4`

## Current boundary

This release does not yet ship Vue/Svelte adapters, general multi-entry
routing, arbitrary Vite plugins or transforms, CSS modules or preprocessors,
archive/Git project import, a public component registry, general capsule
personal-fork lineage and compatible merge, database adapters, privileged
native product transport, remote runtimes,
notarization, the macOS App Sandbox entitlement, or Intel, Windows, and Linux
packages. The documented release artifact remains an ad-hoc signed,
Apple-Silicon macOS preview.

See [VISION.md](VISION.md) for the destination and
[docs/trust-model.md](docs/trust-model.md) for the authority model.
