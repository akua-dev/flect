# Capsule verification — 2026-08-01

Scope: current uncommitted implementation worktree; this is not release-tag
evidence.

## Proven

- Strict version-1 Effect Schema and deterministic normalized ustar encoding.
- Payload SHA-256/byte verification and bounded file/archive limits.
- Fail-closed unknown fields, unsafe paths, duplicates, unsupported versions,
  malformed headers, trailing data, and payload tampering.
- One canonical fixture opens through browser and desktop loading contracts.
- Production Chromium exports an accepted app, imports that exact `.flect`
  through a browser file chooser, and opens it as an isolated candidate with
  Preview App Agent and the ordinary keep/discard decision.
- Production Chromium rejects a malformed capsule, renders a bounded status,
  creates no candidate, preserves the accepted UI, and reports no unexpected
  console, page, request, or response failure.
- Shaper can request capsule import through its reserved browser `flect`
  command; App Agent is denied.
- A compiled HTML capsule previews and remains interactive only inside an
  opaque-origin iframe, promotes through Keep, and is bypassed by safe mode.
- Compiled capsule archives are content-addressed by SHA-256 in OPFS, with
  accepted, candidate, and last-known-good bindings committed only after the
  archive object exists. A fresh browser runtime reconstructs accepted and
  reviewable candidate presentation only after strict capsule decoding.
- Production Chromium reloads an accepted compiled capsule, preserves its
  interaction, and exports the original archive byte-for-byte. A separate
  production Chromium run reloads a compiled candidate for review and proves
  that Reject removes it without replacing accepted state.
- The protected review renders publisher, artifact version, source revision,
  signature state, contents, platforms, and all requested capabilities.
  Production Chromium proves an unavailable required capability disables Keep,
  focuses the still-available Reject action, and remains blocked again by the
  controller while the isolated preview stays inspectable.
- The review evaluates the manifest's semver range against the running Flect
  package and the declared platforms against the actual browser/native host.
  Production Chromium proves an out-of-range capsule remains inspectable but
  cannot be kept.
- Verified archive-local CSS, classic JavaScript, SVG/image, font/media, and CSS
  URL assets project into the opaque `srcdoc` without network or host-file
  authority. Production Chromium proves linked styling, a packaged SVG, and a
  packaged interactive script inside the network-denied frame.
- Production Chromium installs a routed HTTPS capsule with omitted credentials,
  full bounds/integrity decoding, and the ordinary protected review. Loader
  tests reject non-web schemes and oversized declared responses before
  activation.
- Production Chromium accepts version 1.0.0, installs a same-ID 1.1.0
  candidate, renders the explicit version comparison, and proves Reject returns
  to the unchanged accepted 1.0.0 frame. Updates never overwrite silently.
- Production Chromium selects an ordinary static-site directory, packages four
  original HTML/CSS/classic-JavaScript/SVG files without inspection-time
  execution, opens the standard review, and proves styling, media, and
  interaction in the isolated frame. Unit tests cover root normalization,
  ignored cache/VCS/secret-shaped files, forms, modules, remote URLs, storage,
  ambiguous entrypoints, and traversal rejection. Chromium accepts and exports
  the project, then decodes the resulting capsule to prove an ignored `.env`
  name and sentinel value never entered the artifact. The same test exports and
  verifies the ordinary Git repository, reads the original HTML from
  `flect/accepted:project/index.html`, and proves the secret file is absent from
  the accepted source tree.
- Six production Chromium isolation tests prove typed intent delivery, parent
  DOM/storage/Tauri/Pi/network denial, frame disposal, and fail-closed malformed,
  oversized, and flooding messages.

## Commands

```text
bun run typecheck
bunx vitest run shared/capsule.test.ts src/lib/browser-capsule-loader.test.ts server/desktop-capsule-loader.test.ts
bunx vitest run src/capsule/capsule-store.test.ts src/lib/workspace-controller.test.ts src/lib/git-interface-repository.test.ts
bunx playwright test tests/e2e/flect.spec.ts --grep capsule
bunx playwright test tests/e2e/flect.spec.ts --project=chromium --grep compiled
```

The latest combined focused gate passed 58 codec/loader/store/controller/Git/
frame/review/menu unit tests and 8 integrated production-Chromium capsule,
capability, compatibility, asset, URL-install, update, and acceptance tests.
The separate compiled-candidate restoration pair and 6 production-Chromium
frame-isolation tests also remain passing evidence.

## Open

Framework import/build and module graphs, capability grants and revocation,
signature verification/trust, fork lineage/merge, uninstall, portable
extensions, and native packaged-app file-picker proof remain open. Accepting a
candidate that was restored after a Wasm-Git worker restart also remains an
explicit recovery edge: the current pinned Git adapter can remove proposal
metadata without advancing the accepted snapshot commit.
