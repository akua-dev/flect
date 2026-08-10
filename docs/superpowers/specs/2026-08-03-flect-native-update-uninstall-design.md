# Flect native update and uninstall design

Date: 2026-08-03
Status: accepted under the owner's standing instruction to continue PR work
Tracks: issue #23 and FQ-01.1, FQ-01.6, FQ-20.2, FQ-22.2, FQ-22.3,
FQ-24.8

## Outcome

The supported macOS app can check, review, install, and relaunch into a signed
Flect update without giving shaped UI, App Agent, Shaper, capsules, or
extensions release authority. Updating replaces only the application bundle
and preserves user-owned work and durable settings. Uninstalling removes only
explicitly selected Flect-owned installation state and retains user data by
default.

This design does not manufacture Apple, release-signing, or updater secrets.
Public distribution continues to fail closed until the approved credentials
are supplied through the release environment.

## Considered approaches

### Protected Tauri updater — selected

Use Tauri's maintained updater plugin behind a Flect-owned native adapter. The
compiled protected shell owns check, review, install, progress, and relaunch.
The release pipeline creates and verifies the signed updater archive and
static GitHub Release manifest.

This reuses the host lifecycle already responsible for the app bundle, keeps
one cross-platform application core, and preserves Flect's protected-shell
boundary.

### Sparkle

Sparkle is mature on macOS, but it would add a second native update framework,
another feed contract, and Swift/Objective-C lifecycle code for behavior Tauri
already supplies. It is not justified for the first supported host.

### Manual DMG replacement

Manual replacement remains a documented recovery path, but it does not satisfy
the product-quality requirement for an in-product update workflow.

## Authority boundary

Only the compiled Flect shell may surface update controls. A product interface
may display version information but cannot check, download, install, defer, or
relaunch an update. App Agent, Preview App Agent, Shaper, embedded Bash,
portable extensions, product adapters, imported source, and capsule frames
receive no update capability.

The native adapter is available only to the main protected window. It validates
the current installed bundle, target, architecture, version, endpoint response,
signature, and expected updater artifact before installation. The updater
signature is mandatory in every public build and is independent of Apple code
signing and notarization.

## Key and endpoint lifecycle

The update verification public key is safe to distribute but is supplied to
the public build through `FLECT_UPDATE_PUBLIC_KEY`; its SHA-256 digest, never a
private value, is recorded in release evidence. The private updater key is read
only by Tauri's supported `TAURI_SIGNING_PRIVATE_KEY` mechanism during public
packaging. The pipeline must reject a public build when either input is absent
or when the signed updater output is incomplete.

The first public endpoint is the static manifest attached to the latest GitHub
Release for `akua-dev/flect`. Production transport is HTTPS-only. Development
builds expose a typed `unavailable` state rather than accepting an unsigned or
local update endpoint.

## Update flow

1. Diagnostics shows the installed version and an unobtrusive **Check for
   updates** action.
2. Check returns `current`, `available`, or a bounded typed failure. No update
   is installed automatically.
3. An available update shows version, notes, target, and download size before
   the user confirms.
4. Download and signature verification report bounded progress in the
   protected shell.
5. Immediately before install, Flect disables outside control, removes the
   ephemeral control descriptor, flushes durable role/workspace state, and
   records an update journal entry containing no credentials.
6. Tauri installs the verified archive and relaunches the app.
7. Startup verifies the new version, repairs only a stale Flect-owned shell
   link, restores the same accepted workspace and settings, and clears the
   completed journal entry.

An interrupted update either leaves the old bundle operational or starts the
new verified bundle; it never rewrites user repositories, grants, extensions,
provider authentication, or browser storage as part of bundle replacement.

## Uninstall ownership model

Flect distinguishes three classes instead of treating the home directory as
one deletion target:

- **Installation:** `/Applications/Flect.app`; removed by moving the app to
  Trash.
- **Owned integrations:** the fixed `~/.local/bin/flect` link and
  ownership-marked agent integrations; removable only when their current
  content is still Flect-owned.
- **User data:** browser/WebKit storage, OPFS Git workspaces, provider-owned
  authentication, exported files, and durable Flect settings; retained by
  default.

The protected **Prepare to uninstall** action disables outside control and
offers removal of owned integrations. It never deletes foreign links, foreign
configuration blocks, exports, repositories, or provider credentials. A
separate explicit **Delete Flect data** action must enumerate the exact
Flect-owned roots, require a final destructive confirmation, refuse while an
export is running, and explain that external exports and provider-owned
credentials are outside its scope.

The public CLI may inspect and prepare uninstall state, but must not recursively
delete the app, a home directory, an unresolved environment path, or a broad
glob. macOS Trash remains the recoverable application-removal mechanism.

## Effect and host boundaries

The TypeScript core defines a `NativeUpdate` `Context.Service`, tagged errors,
closed `Schema` contracts, and a deterministic state machine. Browser Flect
provides an `unavailable` layer with the same contract. Tauri transport is one
adapter; React consumes only the service and state, not updater plugin APIs.

The Rust host owns the narrow updater invocation and main-window restriction.
Release mechanics remain Bun/TypeScript. No repository shell script, daemon,
shadow updater state, or background controller is introduced.

## Failure behavior

- Offline, malformed manifests, incompatible targets, invalid signatures, and
  unavailable public keys fail before installation and preserve the running
  app.
- A foreign shell link or integration is reported as a conflict and preserved.
- Stale update operations cannot install after a newer check or version change.
- Browser Flect reports that native app updates are unavailable and continues
  to work independently.
- Signing, notarization, Gatekeeper, stapling, or updater-evidence failure
  blocks public release rather than degrading to an unsigned path.

## Proof

Contract tests cover schemas, state transitions, stale operations, browser
fallback, ownership classification, foreign-link preservation, and redacted
errors. Rust tests prove the main-window and fixed-endpoint boundary. Packaging
tests require updater archive, signature, static manifest, public-key digest,
and exact executable inventory in public mode.

A local fixture server proves check/download/progress/signature rejection
without becoming a production endpoint. Native dogfood replaces a staged older
fixture bundle, verifies accepted work and settings survive, prepares uninstall,
preserves user data and a foreign link, reinstalls the exact current bundle,
and leaves one normal Flect window open. Developer ID, notarization, stapling,
and clean-machine claims remain blocked until their external evidence actually
passes.
