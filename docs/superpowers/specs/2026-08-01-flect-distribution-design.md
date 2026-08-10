# Flect trusted distribution design

Date: 2026-08-01
Status: accepted for implementation
Tracks: GitHub issue #23 and FQ-01.1, FQ-01.6, FQ-20.2, FQ-22.2,
FQ-22.3, FQ-24.8

## Outcome

One release command produces an Apple Silicon DMG, checksum, demo, and
machine-readable evidence manifest. Public mode also produces a signed Tauri
updater archive, signature, and static GitHub Release manifest. Development artifacts remain honestly
ad-hoc or development signed. Public artifacts fail closed unless the exact
source is clean and tagged, Developer ID signing is present, hardened runtime
is enabled, Gatekeeper accepts the app, and a notarization ticket is stapled.

No signing, Apple, provider, or update credential enters Git, argv, logs, the
manifest, or a generated artifact.

## Trust modes

The default `development` mode supports local dogfood. It verifies bundle
structure, exact arm64 executables, DMG integrity, deep/strict code-signing
validity, checksum correctness, and mounted contents. It records the observed
signature, Gatekeeper, and stapling state without upgrading those observations
into a public-trust claim.

`FLECT_PUBLIC_RELEASE=1` selects `public` mode. It additionally requires:

- a clean worktree at exact tag `v0.2.0`;
- independently verified reproducible application content;
- a Developer ID Application authority and non-empty Team ID;
- hardened-runtime code-signing flags;
- Gatekeeper acceptance;
- a valid stapled notarization ticket; and
- all normal layout, architecture, checksum, and DMG checks.
- a configured public updater key and private signing-key presence;
- a Minisign-verified updater archive and the fixed GitHub HTTPS artifact URL.

The Tauri configuration does not pin `-` as the signing identity. With no
approved certificate it may still create a local ad-hoc artifact; an imported
CI certificate can be inferred through Tauri's supported environment without
editing tracked configuration.

## Evidence manifest

`dist-release/Flect_0.2.0_aarch64.release.json` contains no timestamp and uses
stable key ordering. It records:

- source commit, exact tag or null, and dirty state;
- Bun, Rust, Cargo, Tauri, Xcode, and FFmpeg versions;
- SHA-256 values for lockfiles and release inputs;
- artifact names, byte sizes, and SHA-256 values;
- exact public/private executable inventory and arm64 architecture;
- observed signing kind, Team ID, hardened runtime, Gatekeeper, and stapling;
  and
- a normalized unsigned application-content digest plus the current
  reproducibility-verification state.
- updater archive/public-key digests and target, without key content.

The unsigned-content digest is calculated from a temporary copied app after
removing nested and outer code signatures. It hashes sorted relative paths,
entry kinds, executable modes, symlink destinations, and file bytes. It is an
exact identity for that unsigned application, not by itself proof that another
build will match it.

Two consecutive builds were compared during implementation. The private Bun
runtime and bundle metadata matched, but Tauri's Isolation Pattern intentionally
generated a new isolation schema UUID, transport key, AES-GCM key, and derived
Mach-O UUID. Because those 83 changed bytes are functional security material,
the release pipeline does not mask them. `compare-release-builds.ts` removes
only actual code signatures and `_CodeSignature`, then reports exact tree
digests, changed paths, and bounded byte offsets. The evidence manifest records
`tauri-isolation-per-build-randomness` when that exact comparison differs, and
public mode fails closed until an independently reviewed reproducible-isolation
strategy exists.

## Platform and sandbox boundary

The supported native target remains arm64 macOS 12 or newer. Hardened runtime
is required and already compatible. App Sandbox is not enabled in this slice:
Flect intentionally launches its private runtime child, binds a loopback
control service, installs an explicitly requested user-owned shell link, and
provides brokered browser Bash. Sandboxing those host responsibilities needs a
separate entitlement and helper architecture review; silently enabling App
Sandbox would break the product contract.

The browser/source path stays independent of Apple signing infrastructure.

## Honest residuals

This workstation has an Apple Development identity but no Developer ID
Application identity. It has no stapled ticket for the local app, and
Gatekeeper correctly rejects the local artifact. A clean-machine install,
public notarization, independent native-content reproducibility, update
preservation, and uninstall walkthrough therefore remain issue #23 evidence
and may not be claimed by local development proof.
