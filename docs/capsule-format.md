# `.flect` capsule format

Status: version 1

A `.flect` file is a deterministic, offline-installable product-interface
artifact. Every Flect host uses this contract. A capsule is data: decoding it
does not execute code, grant capabilities, authenticate a product, or activate
an interface.

## Archive

The container is an uncompressed POSIX `ustar` archive. It has normalized
ownership, permissions, and timestamps. `flect.json` is the first entry. Every
payload follows in bytewise lexical path order, then two zero blocks. Identical
manifest input and payload bytes must produce byte-identical archives.

Version 1 permits at most 256 payload files, 8 MiB per file, and 32 MiB for the
complete archive. Paths are relative slash-separated names of at most 100 UTF-8
bytes. Absolute paths, empty components, `.`/`..`, `.git`, links, devices,
duplicate entries, extra archive data, and unsupported tar entry types are
invalid.

## Manifest

`flect.json` is strict UTF-8 JSON. Unknown fields are invalid.

- `formatVersion`: `1`.
- `id`, `name`, `version`: stable reverse-domain identifier, display name, and
  semantic artifact version.
- `entrypoints`: stable identifiers and payload paths for compiled web entry
  documents.
- `files`: path, byte count, and lowercase SHA-256 for every payload, in archive
  order.
- `capabilities`: requested capability identifiers and whether the product
  considers each required. These are requests, never grants.
- optional `extensions`: bounded portable App Agent and Shaper extension
  packages described below. Declarations are requests and inert metadata;
  decoding never activates them.
- `compatibility`: supported Flect range, capsule schema version, and platforms.
- `provenance`: publisher label, source reference, source revision, and builder.
- optional `build`: the exact source revision plus SHA-256 input, artifact, and
  optional verified dependency-graph digests for a restricted source build.
- optional `lineage`: a local-fork marker binding the parent signed-content
  digest, source, and revision. Forking deliberately removes upstream
  signatures.
- `signatures`: detached Ed25519 records containing the publisher key ID,
  canonical signed-content SHA-256, UTC signing time, and signature. Presence or
  validity establishes provenance only; it never grants a capability.

Every entrypoint must name a declared payload. Every payload byte count and hash
is verified before a decoder returns a capsule.

## Portable extension packages

Version 1 may declare at most 32 portable packages. A package contains a stable
ID, display name, description, semantic version, verified bundle path, one or
both target roles (`app`, `shaper`), compatible Flect range, portable Extension
API version `1`, supported hosts, requested capabilities, bounded public
instructions, command/tool discovery metadata, host-capped resources, and
publisher/source/revision provenance. Guardian is not a package role.

Each bundle is a declared capsule payload and its lowercase SHA-256 must match
the package provenance record. An optional source map must likewise name a
declared payload and match its declared digest. Duplicate package, role,
capability, command, or tool IDs are invalid. Missing bundles, mismatched
digests, unsupported API versions, excessive resource requests, and unknown
fields fail capsule decoding before any code can run.

The package resource declaration cannot exceed 100 ms execution time, 16 MiB
memory, 1 MiB input, 1 MiB output, or 20 inert intents per call. Hosts may apply
stricter limits. The verified executable bundle is capped at 256 KiB, matching
the worker request boundary; a larger bundle is rejected during capsule
verification rather than staged as an unusable package. These values are
ceilings, not authority.

Packages contain no grants, decisions, credentials, conversations, local paths,
or mutable installation state. Installation review and role activation remain
protected host decisions. Portable bundles execute only through Flect's
QuickJS worker and capability broker; ordinary external Pi extensions remain a
separate explicitly trusted host-code path. The lifecycle and isolation design
is recorded in
[`docs/superpowers/specs/2026-08-02-flect-portable-extension-lifecycle-design.md`](superpowers/specs/2026-08-02-flect-portable-extension-lifecycle-design.md).

## Review and activation

Import opens a candidate; it never activates the capsule directly. The
protected Flect shell shows the publisher, artifact version, source revision,
signature count, contents, supported platforms, and every requested capability
before activation is available. A capability marked `required` is a hard activation
precondition. Until a trusted broker reports that it can grant that capability,
Flect leaves the isolated preview available for inspection but disables Activate at
the UI boundary and rejects acceptance again in the controller. Optional
capabilities remain ungranted unless a later explicit grant flow says otherwise.

The protected review projects the canonical requested, available, granted,
denied, expired, or revoked lifecycle together with the separate fact of host
availability. A trusted host may register a stable product operation whose
required capability matches the manifest request. Registration and decisions
remain trusted host state; neither is copied into the archive.

A decision binds the capsule scope ID, exact archive SHA-256, capability-request
digest, workspace when applicable, provenance revision, and the approved
operation/resource/data intersection and decision policy. Changing the archive,
request, workspace-bound context, or registered limits cannot widen an older
decision. See [`docs/product-capabilities.md`](product-capabilities.md) for the
adopter contract and complete lifecycle.

The host reconstructs the deterministic capsule with an empty signature array,
hashes those canonical bytes, and verifies the signature over a versioned
domain-separated payload containing that digest, key ID, and signing time.
Protected review distinguishes unsigned, verified, unknown-key, revoked,
expired, changed-after-signing, invalid, and locally-forked states. Host policy
may allow unverified local artifacts, require a valid configured key, or limit
installation to approved keys. Invalid/revoked/changed claims always fail
closed. Key rotation is expressed by validity windows and an optional
replacement key; revocation remains host policy, not mutable capsule state.
The trust decision reports explicitly that permission authority is unchanged.
The host also evaluates the declared semver range against Flect's package
version and checks the actual browser/native platform. An incompatible range or
unsupported host follows the same inspectable-preview, blocked-activation path.

Portable packages appear in the same protected review but remain visibly
separate from product capabilities and trusted external Pi extensions. Flect
shows package publisher/source/revision, declared roles, resource ceilings, and
required versus optional authority. App Agent and Shaper start off
independently. Each is enabled only by an explicit protected action, and
optional authority is off by default. An enabled candidate must complete one
bounded worker test before activation; a failed candidate must be disabled or fixed
before acceptance. The controller repeats this check even if customized UI is
bypassed.

Pins and local-fork revision markers survive as update conflicts. A raw update
to the single primary app is never silently combined: the user either accepts
the upstream archive or keeps the current fork. Provider-neutral shared sources
add the guarded personal-fork lifecycle on top of capsule artifacts: immutable
base, upstream, and fork Git refs drive a deterministic three-way file merge;
overlapping edits become explicit conflict paths and require a reviewed
resolution. Flect never silently combines or relabels package bytes.

Removing a shared source first detaches only that source's installed parts and
preserves its personal fork for export. Deleting local data is a separate,
guarded action that is refused while the source is installed. The primary
capsule store likewise removes only archives named by its strict binding file;
unknown files, unrelated Git history, workspace documents, grants, and other
storage namespaces are not deletion targets. Corrupt bindings fail closed
instead of broadening cleanup.

## Runtime intents

Compiled entrypoints have no network authority. Their only host bridge is
`globalThis.flect.post(...)` over an opaque-frame `MessagePort`. Each projected
document receives a new 128-bit cryptographic nonce; the host accepts the
ready/connect handshake only when its protocol version, type, and nonce all
match. The nonce authenticates the frame instance while the transferred port
becomes the bounded capability channel. Unrelated window messages, stale
frames, surplus pending ports, and late traffic are ignored or failed closed.
Version 1 accepts JSON-only intents of this shape:

```json
{
  "version": 1,
  "type": "intent",
  "id": "intent-projects1",
  "action": "projects.list",
  "input": { "limit": 20 }
}
```

The action is a stable host-registered operation ID, not a URL or tool name.
Flect constructs a capsule-bound command source, verifies that the current
accepted or candidate capsule declares the operation's capability, applies the
host grant, and invokes the protected adapter through the shared workspace
controller. A matching `flect:host` custom event returns either bounded JSON
output or one sanitized `unavailable`, `denied`, `failed`, or `invalid-result`
failure. The complete message is limited to 64 KiB and must repeat the intent
ID. Malformed, oversized, flooding, stale-frame, and mismatched replies fail
closed. Credentials, transport exceptions, response cookies, and unapproved
headers are not representable in this protocol. A source that misses the
bounded ready deadline is stopped without poisoning a later capsule revision.

## Compiled asset projection

For a compiled HTML entrypoint, Flect resolves capsule-relative stylesheet,
classic script, image, poster, font, audio, video, and CSS `url(...)` references
only against verified files in the same archive. Text assets are decoded as
strict UTF-8; binary assets become bounded `data:` URLs. Stylesheets and classic
scripts are inlined into one generated document, so the opaque frame needs no
host filesystem, object URL, package registry, CDN, or network access. Missing,
remote, malformed, and unsupported references remain unavailable under the
frame's deny-by-default CSP.

Browser hosts load that exact document from a self-contained base64 `data:`
URL. The packaged Tauri host keeps it only in a bounded in-memory registry and
serves the exact token through the local `flect-capsule` custom protocol with
`no-store`, no-referrer, and no-sniff response policy. This is an internal
process transport, not network authority or persisted capsule state. It avoids
weakening the protected host's CSP when WebKit applies the parent policy to
inline scripts in `srcdoc` or `data:` frames. Native registration accepts only
128-bit hexadecimal tokens, at most eight live documents, and at most 16 MiB
per generated document; release removes the exact token. Missing and unknown
tokens return no document.

Both routes execute the document in an iframe sandbox that grants scripts but
not same-origin authority. The child keeps its own deny-by-default CSP, and the
Tauri shell does not add `unsafe-inline`. The host canvas supplies a readable
light baseline for unstyled portable products without changing authored
styles. The archive limits above remain the canonical product-artifact limits;
the native document limits bound only the generated projection transport.

This is an artifact runtime, not the source builder. The restricted
`BrowserBuild` service compiles browser-local JavaScript, TypeScript, JSX/TSX,
React, and local CSS in a disposable Worker from an exact guarded Git proposal.
Its package resolver produces and caches an integrity-bearing npm v3 lock. A
successful framework capsule records source revision, input digest, artifact
digest, and optional dependency-graph digest in its `build` receipt, then ships
only the portable HTML shell, verified build outputs, and inert import report.
It does not ship source or require the builder at runtime. Import maps,
`srcset`, CSS asset URLs/modules/preprocessors, arbitrary Vite plugins, and
additional framework adapters remain separate compatibility work.

## URL installation

The protected actions menu accepts an HTTPS `.flect` URL; loopback HTTP is
allowed only for local development. Flect sends no credentials, bypasses the
HTTP cache, follows ordinary browser redirects/CORS, aborts after 20 seconds,
and bounds both declared and streamed response bytes to 32 MiB. Downloaded
bytes pass through the same strict decoder and payload-hash checks as a local
file, then open the same reviewable candidate. Browser CORS policy is an honest
host boundary: a publisher must make the artifact readable to the user's
browser or the install fails without changing accepted state.

When the candidate and installed capsule IDs match, the protected review names
the exact installed-to-candidate version transition. The installed archive and
accepted revision remain authoritative until explicit activation; Discard restores the
installed presentation without mutation. A different capsule ID is presented
as an explicit replacement rather than an update. Compatible three-way merging
of a personalized capsule fork is not yet implemented; the separate sharing
fork lifecycle is documented in [`docs/sharing.md`](sharing.md).

## Project directory import

The protected actions menu can select an ordinary static-site or standard Vite
browser project directory with one root `index.html`. Flect validates every
relative path before reading source,
ignores `.git`, `node_modules`, `.DS_Store`, `.env` variants, package-manager
auth files, private-key names, and key/certificate extensions before reading
their contents, applies the capsule file/byte limits, and never executes
project source, Vite config, package scripts, or development dependencies
during inspection. Static inputs package directly. A local module entrypoint is
checkpointed as recognizable source in embedded Git and compiled only from the
exact guarded proposal before the resulting artifact enters the same review
and candidate flow. A directory import may contribute at most 255 source files
because Flect reserves one of the capsule's 256 payload entries for the import
report; relative paths share the capsule's 100-character limit. Ambiguous
roots, traversal, reserved metadata collisions, named unsupported Vite plugins,
`resolve.alias`, and `node:` built-ins fail before a candidate is created and
name the portable alternative.

The versioned compatibility report identifies the project class, root
entrypoint, included-file count, ignored paths, adaptations, forms, remote
URLs, storage, and workers. It is carried as inert capsule metadata and shown
in protected review together with the build receipt.
Unsupported authority/runtime assumptions become visible manifest requests and
required ones block activation. Multi-page routing, archive/Git inputs,
content-aware secret scanning and a complete preserved/adapted/unsupported
per-feature matrix remain open. Supported files
are checkpointed first on the isolated `flect/authoring` branch and flow through
the proposal into `flect/accepted` only on Activate; exported ordinary Git contains
the recognizable `project/` source tree.

## Prohibited state

Credentials, tokens, cookies, provider sessions, capability grants, user
conversations, local paths, host settings, mutable runtime state, and recovery
metadata have no representation in version 1. Strict decoding rejects attempts
to add them to the manifest.

## Migration

Decoders accept only versions for which they implement an explicit migration.
Version 1 is canonical and has no predecessor. A future version must add a
pure, bounded `N -> N+1` manifest migration, retain integrity verification of
the original archive, document semantic changes, and ship golden fixtures.
Unknown versions fail closed; they are never interpreted as the latest version.

The executable Effect Schema and codec live in `shared/capsule.ts`. This
document describes that source of truth; tests in `shared/capsule.test.ts`
provide determinism, strictness, and integrity evidence.
