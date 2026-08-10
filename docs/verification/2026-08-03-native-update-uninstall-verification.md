# Flect native update and uninstall verification

Date: 2026-08-03
Scope: current uncommitted PR worktree and local Apple-silicon development app
Tracks: issue #23

## Result

Flect now has a protected native update workflow and an ownership-safe uninstall
workflow in its Effect application architecture. The browser explicitly lacks
native update authority. The installed development app shows the update key as
unavailable, exposes the exact retained-data contract, and projects the same
uninstall plan through its built-in `flect` command.

This is not public-release proof. The app is ad-hoc signed, Gatekeeper rejects
it, no notarization ticket is stapled, no updater release key was used, and two
independent native builds still differ in Tauri Isolation security material.

## Automated evidence

- `bun run check`: 154 test files passed and one skipped; 829 tests passed and
  one skipped. Effect checkout, Rifty licenses, generated Flect Skill, product
  quality coverage, Biome, TypeScript, and Vitest all passed.
- `bunx playwright test tests/e2e/native-update.spec.ts --project=chromium
  --repeat-each=3`: 6/6 passed. It covers the browser-unavailable boundary,
  absence of update authority, axe, compact reflow, 200% text, forced colors,
  and reduced motion.
- `bunx playwright test --project=chromium`: 79/79 production Chromium tests
  passed in 3.8 minutes after the final native CLI composition fix.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 25/25 Rust tests passed.
- Updater/package/comparison focus: 16/16 tests passed. Fixture Minisign
  verification rejects a changed archive; the static manifest, exact archive
  inventory, public-key digest, fixed HTTPS URL, and credential absence all
  fail closed independently.
- Signed fixture update dogfood: 1/1 passed. A task-scoped 0.1.0 app consumed a
  genuine Ed25519/Minisign-signed 0.2.0 tarball from a loopback-only test
  adapter, installed it, and executed the staged app entrypoint. Workspace,
  settings, grants, and extension canaries remained byte-identical. A signed
  0.3.0 archive with a deliberately corrupted signature was rejected before
  replacement; the installed bundle tree and all durable state hashes remained
  exact.
- Uninstall/AXI/UI focus: 40/40 tests passed before the native CLI composition
  dogfood; the subsequent CLI gap was fixed and 26/26 focused regression tests
  passed.

## Reproducibility evidence

Two ordinary ad-hoc signed app builds were copied independently. The comparator
removed only their real code signatures and `_CodeSignature` envelopes. It did
not patch, zero, ignore, or replace an Isolation UUID or executable byte.

The exact result was:

```text
verified: false
firstTreeSha256: 4b46f15cdc7cb2b1f38ff8ba3455595da8dee1ed54bfa6198c02c1db4381b045
secondTreeSha256: 3a34a2c2969f615d45c0d282035bf9c8f8eb1b2e37e742dcb20048f7da256a8b
changedPaths: [Contents/MacOS/flect]
bounded changed offsets: 32 reported
```

The private runtime and every other unsigned tree entry matched. Public
packaging therefore remains blocked by
`tauri-isolation-per-build-randomness`, as designed.

## Native update boundary

- Rust registers `tauri-plugin-updater` only when
  `FLECT_UPDATE_PUBLIC_KEY` is nonblank at build time.
- The main window is the only accepted caller. The endpoint is fixed to
  `https://github.com/akua-dev/flect/releases/latest/download/latest.json`.
- Candidates remain in Rust behind opaque single-use tokens; a newer check
  invalidates an older token.
- Public packaging creates `Flect.app.tar.gz`, its `.sig`, and `latest.json`
  only in public mode. It verifies the archive's actual Ed25519/Minisign
  signatures and records no private value.
- The installed development UI visibly reported: “This development build has
  no trusted update key.”

## Uninstall ownership dogfood

A task-scoped home contained a Flect-owned shell link, a Flect-owned Codex hook,
an unrelated Claude configuration, a foreign OpenCode plugin, workspace data,
and an exported file. The installed public command reported the owned items as
`pending`, the foreign plugin as `preserved-conflict`, and retained data
explicitly. `flect setup uninstall prepare --json` returned `removed` only for
the Flect-owned link and hook.

SHA-256 values for the foreign Claude file, foreign OpenCode plugin, workspace
canary, and export canary were byte-identical before and after preparation. The
owned shell link and generated Codex hook were absent afterward. No recursive
delete or app-removal operation exists.

Dogfood also found and fixed one integration defect: the native CLI advertised
the uninstall commands before its private runtime composed the `Uninstall`
Layer. The rebuilt installed executable now returns the bounded plan from
`/Applications/Flect.app/Contents/MacOS/flect --json setup uninstall inspect`.

## Installed exact app

The previous app was moved recoverably to
`~/.Trash/Flect-before-cli-uninstall-20260803-101900.app`; the preceding backup
also remains at
`~/.Trash/Flect-before-native-update-uninstall-20260803-101600.app`.
The final source bundle was copied to `/Applications/Flect.app`.

Source and installed executable SHA-256 values match exactly:

```text
flect:         785327f970783103fbc938a29234b7fc7f712d673d2281bf919529952550d353
flect-runtime: d135c02be40e50c40e490dd1fdfe91c8144024d42e6231004a8fb1682b1612dd
```

Both executables are thin `arm64`. Deep/strict code-sign verification passed;
the observed bundle is `adhoc,runtime`, Team ID is unset, Gatekeeper rejected
it, and no stapled ticket exists. Final runtime inspection showed one Flect app
process, one private runtime, one normal window, Pi ready, Local control off,
and no control descriptor.

Visual evidence:

- [Installed update boundary](assets/2026-08-03-native-update-uninstall-diagnostics.png)
- [Installed uninstall and retained-data surface](assets/2026-08-03-native-update-uninstall-diagnostics-final.png)

## Honest residuals

Issue #23 must remain open for Developer ID Application signing, notarization,
Gatekeeper acceptance, stapling, a signed update between real public builds,
clean-machine verification, and a reviewed resolution to Tauri Isolation
per-build randomness. The task-scoped signed fixture path is proven; public
distribution trust is not. No update artifact was published and no release,
commit, push, or merge occurred in this work.
