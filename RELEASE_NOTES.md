# Flect v0.1.0

Flect v0.1.0 is the first public developer preview of the protected,
agent-native interface shell.

## Install on macOS

The native preview supports Apple Silicon Macs running macOS 12 or newer.
Download `Flect_0.1.0_aarch64.dmg`, verify it with
`Flect_0.1.0_aarch64.dmg.sha256`, and drag Flect into Applications.

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

## What is included

- the protected Flect composer with Pi model selection, send, stop, and real
  interface actions;
- separate Pi Guardian and Shaper sessions behind the local runtime boundary;
- schema-validated proposal, preview, keep, reject, rollback, and safe-mode
  flows;
- durable revision recovery and a protected default composer;
- browser and native transports over the same Effect capabilities; and
- a QuickJS/Wasm logic sandbox for inert, capability-checked extension intents.

Release assets:

- `Flect_0.1.0_aarch64.dmg`
- `Flect_0.1.0_aarch64.dmg.sha256`
- `flect-v0.1.0-demo.mp4`

## Current boundary

This preview does not yet ship arbitrary React or JavaScript UI imports,
portable `.flect` capsules, a public component registry, native extensions,
product/API capability adapters, remote runtimes, automatic updates, Intel,
Windows, or Linux packages. It is not notarized and does not use the macOS App
Sandbox entitlement.

See [VISION.md](VISION.md) for the destination and
[docs/trust-model.md](docs/trust-model.md) for the authority model.
