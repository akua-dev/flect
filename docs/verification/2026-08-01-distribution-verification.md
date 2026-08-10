# Flect macOS distribution verification

> Historical local packaging evidence. The current native update, uninstall,
> and exact independent-build comparison evidence is in
> [`2026-08-03-native-update-uninstall-verification.md`](2026-08-03-native-update-uninstall-verification.md).

Date: 2026-08-01
Scope: local Apple Silicon development distribution
Tracks: issue #23; FQ-01.1, FQ-01.6, FQ-20.2, FQ-22.2, FQ-22.3,
FQ-24.8

## Result

The local release command produced and verified a development DMG, checksum,
demo MP4, and deterministic evidence-manifest structure. The installed app
launched from `/Applications/Flect.app` with its private runtime child and its
public AXI command responded through the installed executable.

This is not public-distribution proof. The source was dirty, the app is ad-hoc
signed, Gatekeeper rejected it, it has no stapled ticket, no Developer ID
Application identity exists on this workstation, and native-content
reproducibility is explicitly unverified.

## Automated and artifact evidence

- `bunx vitest run scripts/package-release.test.ts`: 8 tests passed. The suite
  gates version/layout, both executable architectures, development signing,
  hardened runtime, clean tagged source, reproducibility proof, Developer ID,
  Team ID, Gatekeeper, and stapling.
- `bun run typecheck`: passed.
- `bun run release:package`: passed after building the private runtime and
  Tauri app, generating both bundles, transcoding the demo, verifying the DMG,
  mounting it read-only, and running deep/strict signature verification on the
  mounted app.
- `shasum -a 256 -c Flect_0.2.0_aarch64.dmg.sha256` from `dist-release/`:
  `Flect_0.2.0_aarch64.dmg: OK`.
- Both `Contents/MacOS/flect` and `Contents/MacOS/flect-runtime` reported
  `arm64`; obsolete companion executables were absent.
- `codesign --verify --deep --strict` passed. Signature details reported
  `adhoc,runtime`, no Team ID, and bundle identifier `dev.akua.flect`.
- `spctl --assess --type execute` rejected the development app with exit 3,
  and `xcrun stapler validate` reported no ticket with exit 65. The evidence
  manifest records both observations as false.
- The only available code-signing identity was Apple Development; no Developer
  ID Application identity was present.

The final ignored manifest
`dist-release/Flect_0.2.0_aarch64.release.json` recorded:

- source commit `32d20f5dcb82af6cd53db9188bb029dd0d4012e4`, dirty state,
  and observed tag `v0.2.0`;
- target `aarch64-apple-darwin`, minimum macOS 12.0, exact toolchain versions,
  and SHA-256 values for release inputs and staged artifacts;
- DMG size 35,714,560 bytes and digest
  `a62b7db60597e8ece4c856a5539677922a336d34a54f540a6d57d40e2bd9314f`;
- normalized unsigned application digest
  `aa930e66e678dc98a826c3ff7c20e1ad4f72de7567710cec1942907f0f363714`;
  and
- reproducibility `verified: false`, blocker
  `tauri-isolation-per-build-randomness`.

## Reproducibility investigation

Two consecutive packages produced different normalized unsigned application
digests. A focused unsigned-file comparison showed stable bundle metadata and
private Bun runtime, while the public Tauri executable differed by 83 bytes.
Vendored dependency inspection and binary strings tied those bytes to Tauri
Isolation Pattern code generation: a fresh schema UUID, transport key,
AES-GCM key, and derived Mach-O UUID are generated for each build.

Those bytes are functional security material, not signature-envelope noise.
The verifier therefore does not mask them or claim that the builds match.
`FLECT_PUBLIC_RELEASE=1` requires independently verified reproducible content
and currently fails closed. Resolving that boundary needs an upstream or
separately reviewed deterministic-isolation design.

## Installed dogfood

The older development instance (app PID 68790 and its owned runtime PID 69749)
was terminated before relaunch. The previous `/Applications/Flect.app` was
moved to Trash, the verified DMG was mounted read-only, and its app was copied
into `/Applications` before detaching the image.

The installed bundle passed deep/strict signature verification and opened one
frontmost window. The final process tree contained exactly one app instance,
PID 91855 at `/Applications/Flect.app/Contents/MacOS/flect`, and its one private
runtime child, PID 91874 at
`/Applications/Flect.app/Contents/MacOS/flect-runtime`. Calling the installed
public executable with `--help` returned the bounded AXI command catalog.

## Honest residuals

Issue #23 remains open for Developer ID Application signing, Apple
notarization and stapling, Gatekeeper acceptance, independent native-content
reproducibility, a genuinely clean-machine walkthrough, update preservation,
uninstall evidence, and an App Sandbox/helper entitlement decision. No local
development observation is promoted into one of those public claims.
