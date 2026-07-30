# ADR 0002: Provide Bun compatibility through the browser agent shell

- **Status:** Accepted and implemented
- **Date:** 2026-07-30

## Context

Flect agents need a familiar, composable command surface without a prompt full
of one-off tools. The same experience must run in a normal browser and a
desktop WebView, cannot assume native Bun or Git is installed, and must not
give generated code ambient host authority.

Burrow demonstrated a useful pattern: just-bash, a reserved `bun` command,
browser Workers, package installation, and service-worker previews. Its
checked-in Bun Wasm artifact did not have sufficient reproducible provenance
for Flect to ship.

## Decision

Flect gives Shaper one Pi custom tool named `bash`. Tool calls cross the typed
Flect transport to a browser-resident `SandboxedShell`. The shell uses pinned
just-bash, reserves `bun`, and composes Effect services for:

- esbuild-wasm compatible source transformation;
- Rifty JavaScript execution and VFS;
- Rifty npm resolution with a trusted integrity-checking registry broker; and
- a Flect-owned service-worker preview broker and opaque guest Worker.

The supported CLI is limited to `run`, `build`, `install`, `add`, `remove`,
and `stop`. Guardian remains tool-free. Canonical OPFS and embedded Git are not
part of this decision; the current shell workspace is disposable.

## Consequences

- Browser and desktop agents get one familiar shell surface without native
  process execution.
- Package and preview functionality remain available without WebContainers or
  a hosted VM.
- The implementation is larger than a schema-only editor and loads Wasm on
  first relevant use.
- Compatibility must be documented honestly; native Bun APIs and CLI families
  fail explicitly.
- Rifty and just-bash remain cooperative substrates. Security depends on
  isolation, typed brokers, bounds, capability denial, and deterministic
  recovery outside them.
- Compression commands and compressed ripgrep input are disabled so the
  browser bundle has no Node zlib dependency.

The exact supported surface and dependency provenance are maintained in
[`docs/bun-compatibility.md`](../bun-compatibility.md).
