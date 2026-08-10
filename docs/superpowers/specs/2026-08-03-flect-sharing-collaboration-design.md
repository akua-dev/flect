# Flect sharing and collaboration design

**Status:** Selected for issue #29 implementation
**Date:** 2026-08-03
**Quality scope:** FQ-17.1, FQ-17.4, FQ-17.5, and FQ-23.1 through FQ-23.7

## Product outcome

People can export, privately share, inspect, install, fork, modify, update,
merge, reject, and remove Flect experiences, components, themes, workflows, and
portable extensions without a mandatory marketplace. Every source arrives
inactive. Flect shows its provenance, compatibility, Git changes, agent-facing
changes, requested authority, migrations, and signature status before any
activation decision.

Personal work remains a user-owned Git lineage. Compatible upstream changes can
be merged through an explicit review candidate. Conflicts are deterministic
three-way source conflicts with ordinary Git lineage and are never hidden
behind a model-generated merge. Publisher
identity, product origin, signatures, and popularity never grant authority.

## Selected architecture

Flect adds a deterministic .flect-share envelope around an ordinary Git
repository plus one or more typed artifact descriptors. .flect remains the
portable runtime capsule; it does not become a collaboration database. Every
local file, HTTPS URL, public Git URL, or named private adapter normalizes to the
same ShareCandidate in a disposable quarantine workspace. Only a protected
controller decision may import guarded Git refs or stage an existing capsule or
extension candidate.

This is preferred over two alternatives:

1. Extending capsule version 1 or introducing capsule version 2 for source
   history would couple offline runtime activation to collaboration state and
   force an unnecessary migration of a working portable-app contract.
2. A central Flect sync or registry service would make private sharing and
   browser ownership depend on proprietary infrastructure and would still not
   remove the need for local Git conflict handling.

## Deterministic share envelope

The version-1 .flect-share file is a normalized uncompressed POSIX ustar
archive. share.json is first. repository.tar is second. Embedded .flect
artifacts follow in bytewise lexical path order. Ownership, permissions, and
timestamps are normalized so identical inputs produce byte-identical output.

The complete archive is limited to 64 MiB and 20,256 entries across nested
archives. The embedded repository retains the current 32 MiB and 20,000-file
export limits. Every capsule retains its own 32 MiB, 256-file, and 8
MiB-per-file limits. Unknown fields, duplicate paths, links, devices, traversal,
absolute paths, trailing data, digest mismatches, and unsupported versions fail
before a candidate exists.

share.json is strict Effect Schema version 1 and contains:

- a stable share ID, display name, semantic version, and compatibility range;
- the repository archive SHA-256 and exact upstream Git object ID;
- optional base and fork lineage object IDs;
- publisher label, source reference, source revision, and builder label;
- detached signature records as claims, never grants;
- one to 64 artifact descriptors; and
- an optional ordered migration declaration whose steps stay inert until an
  existing typed migration capability executes them.

Its repository field is an explicit union. The embedded form names
repository.tar, its digest, and the exact payload commit and is mandatory in a
.flect-share archive. The Git form names only that payload commit and is valid
only as .flect/share.json inside a cloned source repository. A public Git source
separately pins the descriptor commit that contains .flect/share.json. This
two-commit distinction is required because a tracked manifest cannot contain
the hash of the commit that contains itself. Flect reads the inert manifest at
the pinned descriptor commit, then checks out and validates the exact payload
commit named by the manifest. A local .flect-share already carries the manifest
and therefore does not require another copy inside its payload history.
Normalization exports the validated payload repository, computes the embedded
digest, and produces the same internal candidate record. A Git descriptor
references capsules under artifacts/ at the payload commit; archive encoding
copies those verified bytes to the equivalent top-level artifact path.

Each descriptor has a stable ID, one kind (experience, component, theme,
workflow, or extension), semantic version, source root, and content digest.
Experience and extension descriptors reference a verified embedded .flect
capsule. Component, theme, and workflow descriptors describe bounded source
roots under components/, themes/, or workflows/. They cannot target .git,
.flect, protected snapshot paths, another artifact root, or an absolute path.
These artifacts remain inert until projected into a normal candidate and built
or interpreted through existing Flect capabilities.

contentSha256 is the SHA-256 of a canonical JSON source receipt. Files below the
descriptor sourceRoot are sorted by portable path and represented by their
root-relative path, byte length, and individual SHA-256. The public
hashShareArtifactSource helper is the source of truth used by producers and by
quarantine, so path order and archive metadata cannot change the digest.

The envelope cannot represent grants, grant decisions, credentials, cookies,
provider sessions, conversations, local paths, product records, accepted-state
receipts, private operation evidence, or recovery metadata.

## Source adapters

ShareSourceResolver is an Effect service with four typed source variants:

- **Local file:** bytes selected through the protected browser or native file
  chooser. Selection grants no future filesystem access.
- **HTTPS URL:** a credential-free, CORS-respecting download with a 20-second
  deadline, no cache, ordinary redirects, streamed byte bounds, and the same
  strict decoder.
- **Public Git:** an HTTPS repository plus an explicit 40-character descriptor
  commit. Flect clones into quarantine through pinned browser Wasm Git, reads
  .flect/share.json at that exact revision, then checks out the distinct exact
  payload commit declared by the manifest. Floating branches are not accepted.
- **Named private adapter:** trusted host composition supplies a stable adapter
  ID and callback returning bounded bytes for a typed opaque reference.
  Authentication stays inside the host closure. Adapter exceptions, endpoints,
  headers, and credentials become one fixed public failure.

Browser-only Flect supports local files, credential-free URLs, and public Git.
A product or desktop host may add private adapters through a public Effect
contract. Flect never asks them for raw credentials or stores credentials in a
workspace.

## Quarantine and Git integrity

Every source gets a fresh scoped quarantine namespace and Worker. Decoding,
repository import, Git checkout, capsule verification, dependency inspection,
and review-model construction happen there. Quarantine has no
accepted-workspace handle, capability broker, Pi session, product credential,
extension host, customized UI, or network authority beyond the one selected
source operation. Scope close removes its OPFS namespace and terminates its
Worker.

Repository import accepts only the bounded Flect repository-tar subset. It
discards imported config, index, reflogs, and Flect-managed identity. It rejects
hooks, submodules, alternates, worktrees, replace refs, shallow files, unsafe
links, LFS pointers, invalid object/ref paths, and protected-ref names supplied
by the archive. Flect recreates a safe config and index, resolves the exact
declared commit, walks its reachable tree within source limits, and asks pinned
Git to check it out. Corrupt or unreachable objects fail closed with sanitized
typed errors.

After the user retains a candidate, the canonical Git Worker imports only
reachable validated objects and creates namespaced guarded refs:

    flect/shared/<share-key>/base
    flect/shared/<share-key>/upstream
    flect/shared/<share-key>/fork
    flect/shared/<share-key>/candidate

The share key is a stable lowercase digest derived from the share ID, not
untrusted display text. Imported history cannot move flect/accepted,
flect/last-known-good, flect/authoring, or proposal refs. A protected
installation record outside Git binds share/source/archive/artifact digests and
base/upstream/fork commits. It contains no authority.

Share ref mutation never checks out a nested share branch over the canonical
workspace. The repository performs a conservative byte-level three-way source
comparison; that deterministic result is the portable conflict policy rather
than an engine-specific auto-merge heuristic. The Worker detaches HEAD by exact
object ID, runs the Git merge in one guarded transaction, and writes only the
exact candidate ref after validating the resulting commit object. The pinned
wasm-git merge can stage a correct tree without retaining two-parent metadata,
so the protected Worker deterministically rewrites that loose commit with the
exact fork and upstream parents, validates its SHA-1 and object body, and then
advances the candidate ref. An unresolved review returns bounded conflict paths
without creating a candidate. An explicit resolution rechecks those paths and
refs, supplies the complete resolved tree, and creates the same verified
two-parent candidate even if wasm-git would auto-merge the bytes. Canonical and
unrelated refs are checked before and after the lifecycle.

## Review model

ShareReview is a strict, bounded, deterministic projection built from decoded
contracts and guarded Git results. The protected shell shows:

- file, URL, Git, or private-adapter origin;
- publisher, source, revision, archive digest, signature count, and signature
  status: unsigned, present-unverified, verified, or invalid;
- Flect and host compatibility;
- new, updated, replaced, forked, or conflicting lineage;
- added, modified, removed, and conflicted source paths;
- interface and build-receipt changes;
- public App Agent and Shaper instruction changes;
- extension additions/removals, role/resource changes, and test requirements;
- capability additions, removals, and scope changes;
- dependency-lock changes and unsupported source assumptions; and
- ordered migration additions or changes.

Signature verification is supplied by an optional narrow host service. Until
issue #11 provides one, well-formed signatures are present-unverified. Invalid
encodings or a configured verifier's invalid result block activation. Verified
identity changes presentation only; it does not satisfy grants, extension
enablement, product policy, compatibility, migration, or Keep.

Untrusted experience previews continue through the opaque-origin capsule
frame. Extensions remain inert until enabled and tested through the existing
QuickJS lifecycle. Component, theme, and workflow source is Git change and does
not execute in review.

## Fork, update, and merge

Installing upstream U0 records base = U0, upstream = U0, and fork = U0.
Choosing Fork creates a protected user branch at U0 and preserves attribution
without copying grants. Later Shape/source work may advance only that fork
through guarded Git checkpoints.

An update imports exact upstream U1 and proves its declared base belongs to the
retained lineage. Flect follows one deterministic path:

1. If fork equals base, prepare a fast-forward candidate from U0 to U1.
2. If fork and upstream changed disjoint content, prepare a real
   non-fast-forward merge commit on the candidate ref with both parents. Review
   shows upstream, personal, and merged diffs before Keep.
3. If the deterministic three-way comparison reports conflicts, preserve base,
   upstream, and fork, record bounded conflict paths, and disable Keep. The user
   can reject, keep using the fork, or open Shape to resolve an explicit
   candidate.
4. If lineage is missing, rewritten, corrupt, oversized, or incompatible, show
   a replacement review. It cannot inherit grants or silently claim the fork.

Reject removes only the candidate ref and quarantine state. Keep rechecks every
expected ref, digest, compatibility fact, extension test, migration, and
required grant in FlectWorkspaceController before advancing the selected
artifact through normal proposal/acceptance. A stale writer must review again.

## Activation by artifact kind

- **Experience:** the selected Git snapshot and verified capsule enter the
  existing candidate preview. Ordinary Keep/Reject remains the only activation
  path.
- **Component, theme, workflow:** the declared source root enters a guarded
  candidate proposal under its fixed namespace. It cannot overwrite protected
  metadata or activate itself. Shape may compose it before Keep.
- **Extension:** the verified package enters the existing candidate extension
  catalog. Role enablement, decisions, worker test, Keep, disable, pin, fork,
  and recovery remain unchanged.

Authority-affecting changes always invalidate or narrow older digest-bound
decisions. Grants are never imported, inferred from Git, inherited from a
signature, or widened by a merge.

## Protected user experience

The Actions menu gains a **Share and review** group:

- Export share archive
- Open shared file
- Open share URL
- Open public Git revision
- Open private source, only when a host adapter exists

Opening a source replaces only the inactive sharing candidate, after
confirmation if one exists. The accepted product stays visible and usable.
Review is a contained rail sheet with summary-first copy, disclosures for
Git/source/authority detail, complete keyboard operation, visible focus,
announced state changes, and no automatic scroll.

Primary actions are contextual: Install, Fork, Merge update, or Keep
replacement. Reject is adjacent and always available. Conflict states offer
Continue with my fork, Open conflict in Shape, and Reject update. No control
says a publisher is trusted or implies a signature grants access.

## Controller, AXI, and reactive state

UI, embedded Bash, HTTP/SSE, MCP, and native actions use strict
FlectWorkspaceAction variants. The controller owns opening, quarantine, review,
fork, merge preparation, rejection, activation, export, removal, and deletion.
React renders its SubscriptionRef snapshot; adapters never mutate DOM, OPFS,
Git refs, extension state, or installation records directly.

The embedded/public AXI adds bounded deferred discovery:

    flect share list
    flect share inspect [<share-id>]
    flect share open-url <https-url>
    flect share open-git <https-url> --commit <object-id>
    flect share reject
    flect share export

Protected activation, merge acceptance, removal, and deletion remain explicit
controller decisions with the same source and authority checks as UI actions.
Outside local control stays off by default.

## Removal and deletion

**Remove from app** removes only installation binding, active artifact
projection, candidate refs, and artifact-scoped runtime/catalog state. It
preserves the user fork, source history, exportability, other artifacts,
product connections, and unrelated grants. Digest-bound grants for the removed
artifact become unusable because no active binding matches them.

**Delete my local share data** is a separate protected confirmation after
removal. It lists the exact share ID, refs, archive objects, and estimated
bytes. The user may export first. Deletion rechecks that no installed artifact
references the data, removes only namespaced refs and owned records, and
reports that unreachable objects may remain until bounded maintenance. It
never deletes the canonical workspace or another share. Browser deletion is
irreversible and says so.

## Effect architecture

External and persisted values use strict Effect Schema. ShareArchive,
ShareSourceResolver, ShareQuarantine, ShareRepository,
ShareSignatureVerifier, and ShareInstallationStore are Context.Service
capabilities with named Layers composed once at the runtime edge. Expected
failures use Schema.TaggedErrorClass and structural tag recovery.

Quarantine/source lifetimes use Scope and Effect.acquireRelease. Download and
Git progress use bounded Stream; candidate/install state uses SubscriptionRef;
serialized ref changes use the existing browser lock and sole Git Worker.
Interrupting work removes only owned quarantine state.

## Failure and recovery

Failures are typed as source, archive, repository, compatibility, signature,
authority, migration, stale-ref, conflict, quota, interrupted, or unavailable.
Public messages are fixed and actionable. Private adapter errors, credentials,
remote responses, Git internals, local paths, and thrown text never cross the
boundary.

A crash before canonical import leaves accepted state unchanged. A crash after
object import but before ref creation leaves only unreachable objects. A crash
after candidate-ref creation restores inactive review from the protected record
and exact refs. Keep is idempotent under expected-ref guards. Invalid persisted
sharing state is dropped into the built-in protected shell without discarding
accepted or fork refs.

## Proof plan

Contract and adversarial tests cover deterministic archives, strict schemas,
all artifact kinds and sources, credential privacy, malformed nested tar, Git
objects/refs/config/hooks/submodules/links, rewritten lineage, digest and
signature changes, authority deltas, migration changes, cancellation, quota,
stale refs, merge success/conflict, rejection, removal, and deletion scope.

Production Chromium covers export; local, URL, Git, and private-adapter open;
inactive review; install; fork modification; compatible update merge;
conflicting update; Shape resolution; Reject; restart; removal; export; and
explicit deletion. It asserts no unexpected network, console, page, focus,
scroll, accessibility, accepted-state, or credential failure.

Packaged macOS dogfood performs representative local/private sharing, review,
fork, merge/conflict, removal, and cold restart through public AX controls.

## Explicit boundaries

- No mandatory marketplace, Flect account, collaboration server, or identity
  provider is introduced.
- Real-time multi-user editing and remote synchronized workspaces remain issue
  #13.
- Publisher identity verification remains issue #11. Signature presence is not
  trust or authority.
- Git remotes needing browser-incompatible CORS or authentication require a
  named private adapter; Flect does not proxy arbitrary URLs.
- Submodules, LFS, hooks, worktrees, alternates, and rewritten history fail with
  an honest portable alternative.
- Flect never silently asks a model to resolve a merge conflict.
