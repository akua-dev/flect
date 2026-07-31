# Flect v0.2.0

Flect v0.2.0 replaces the developer launcher with the first complete
role-aware interface loop: describe a product in Edit, review the validated
result, keep it, then use the resulting experience through its separate App
Agent in Run.

## Role-aware interface shell

- A blank workspace starts with one centered, T3Code-inspired Shaper composer.
  The same mounted composer moves into an adaptive conversation rail when the
  interface appears.
- Edit/Shaper and Run/App Agent have visibly separate authority, Pi sessions,
  histories, drafts, cancellation, and browser-shell workspaces.
- The rail is resizable inline on wide screens, a right sheet at medium widths,
  and a full-width accessible sheet on compact screens.
- Searchable, provider-grouped Pi model selection includes favorites, keyboard
  operation, and explicit role identity before every send.
- Keep, reject, rollback, collapse, safe mode, focus restoration, and reduced
  motion remain part of the compiled protected shell.

## Runtime and sandbox

- Guardian, App Agent, and Shaper now run as three independent Pi sessions.
- App and Shaper shell requests are explicitly role-tagged through browser HTTP
  and private native RPC.
- Each interactive role receives its own just-bash/Rifty browser workspace;
  neither receives ambient host Bash, filesystem, process, or network access.
- The Effect shaping kernel and schema-validated renderer remain authoritative
  over every proposed interface.

## Install on macOS

The native preview supports Apple Silicon Macs running macOS 12 or newer.
Download `Flect_0.2.0_aarch64.dmg`, verify it with
`Flect_0.2.0_aarch64.dmg.sha256`, and drag Flect into Applications.

Flect uses the provider login already managed by Pi. Before opening Flect for
the first time, run `bunx pi`, use `/login` to authenticate a supported model
provider, then quit Pi.

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
bunx pi
```

Use `/login` inside Pi, quit Pi, then run `bun run dev` and open
`http://127.0.0.1:5173`.

Release assets:

- `Flect_0.2.0_aarch64.dmg`
- `Flect_0.2.0_aarch64.dmg.sha256`
- `flect-v0.2.0-demo.mp4`

## Current boundary

This preview does not yet ship portable `.flect` capsules, canonical OPFS/Git
workspaces, arbitrary React or JavaScript UI imports, a public component
registry, in-Flect provider login, native extensions, product/API capability
adapters, remote runtimes, automatic updates, Intel, Windows, or Linux
packages. It is not notarized and does not use the macOS App Sandbox
entitlement.

See [VISION.md](VISION.md) for the destination and
[docs/trust-model.md](docs/trust-model.md) for the authority model.
