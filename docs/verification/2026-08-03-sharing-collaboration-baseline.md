# Sharing and collaboration baseline — 2026-08-03

## Scope

This frozen baseline evaluates the issue #29 slice before collaboration
behavior changes. It covers `FQ-17.1`, `FQ-17.4`, `FQ-17.5`, and `FQ-23.1`
through `FQ-23.7` against the dirty PR worktree on
`codex/flect-self-contained-shaper`, based on commit
`32d20f5dcb82af6cd53db9188bb029dd0d4012e4`.

The supported hosts in scope are production Chromium and the locally packaged
arm64 macOS app. This is not published-release evidence. No source behavior was
changed while producing this baseline.

## Current evidence

- [`2026-08-01-opfs-git-verification.md`](2026-08-01-opfs-git-verification.md)
  proves canonical browser-native Git, guarded refs, conflicts, ordinary
  repository export, and native `git fsck` of the export.
- [`2026-08-01-capsule-verification.md`](2026-08-01-capsule-verification.md)
  proves deterministic local/URL capsule import, inactive protected review,
  provenance/compatibility/authority inspection, explicit updates, Reject, and
  accepted-state preservation.
- [`2026-08-02-portable-extension-lifecycle-verification.md`](2026-08-02-portable-extension-lifecycle-verification.md)
  proves role-scoped extension provenance, review, pins, fork markers, update
  conflicts, activation, disablement, and owned-state removal.
- [`2026-08-03-product-sdk-verification.md`](2026-08-03-product-sdk-verification.md)
  proves product connections cannot erase a user fork/export and detach removes
  only the connection record.

## Classification

| Criterion | State | Current observable behavior and missing proof |
| --- | --- | --- |
| `FQ-17.1` | implemented | Canonical workspaces are local OPFS Git repositories and export with full history. The complete share/import/update/removal ownership loop is not proven. |
| `FQ-17.4` | proven | Product detach preserves user fork/export state, and portable extension updates preserve fork markers instead of treating product or publisher state as ownership. |
| `FQ-17.5` | partial | Capsule and complete repository export exist. A documented public deletion workflow that distinguishes installed bindings, user repositories, and unrelated state is absent. |
| `FQ-23.1` | partial | Complete experiences and capsule-carried extensions can be shared. Independent component, theme, workflow, and extension artifacts do not yet have one share contract and workflow. |
| `FQ-23.2` | partial | Capsule and extension review show provenance, compatibility, signature presence, and requested authority. Source/Git changes, migrations, and every artifact class are not covered. |
| `FQ-23.3` | partial | Extension pins/fork markers survive updates as explicit conflicts, but compatible Git reconciliation preserving personal source changes is absent. |
| `FQ-23.4` | partial | Interface and capability changes are attributable through revisions and Git. There is no complete inactive team review of source, agent instruction, extension, authority, and migration deltas. |
| `FQ-23.5` | partial | Exports preserve source attribution and local fork markers do not grant authority. A complete Git-preserving fork contract and public workflow are absent. |
| `FQ-23.6` | partial | Local files and public CORS-readable URLs avoid a marketplace. Explicitly configured private sources with credential-private host adapters are absent. |
| `FQ-23.7` | partial | Untrusted capsules and extensions open in protected inactive review. Git repositories and independent shareable artifact classes do not yet share that fail-closed quarantine path. |

## Smallest independently reviewable gaps

1. Define one deterministic share archive and source-adapter contract that can
   represent all five artifact classes without granting authority.
2. Import every source into a disposable quarantine Git workspace and produce
   one strict inactive review model before touching canonical state.
3. Preserve lineage and personal work through guarded fast-forward or explicit
   three-way merge candidates; expose conflicts without silent model merging.
4. Route activation and removal through the existing protected controller,
   capsule, extension, capability, and repository boundaries.
5. Prove local file, URL, public Git, and named private adapters in Chromium and
   the packaged app, then supersede this baseline with dated evidence.

Issue #29 owns these gaps. Signing identity verification remains issue #11;
remote synchronized runtimes remain issue #13. Neither is silently absorbed
into the collaboration authority model.
