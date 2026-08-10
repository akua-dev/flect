# Sharing and personal forks

Flect can review portable `.flect-share` archives from a local file, a
credential-free HTTPS URL, an exact public Git descriptor commit, or a named
private adapter supplied by a trusted host. Every source converges on the same
inactive review. Opening it never replaces the accepted app.

A share may contain experiences, components, themes, workflows, and portable
extensions. Flect checks the archive, manifest, source paths, compatibility,
provenance, signature state, dependencies, migrations, and requested authority
before any artifact reaches its existing preview or activation boundary. A
signature identifies a claim; it never grants a capability.

## Retain, personalize, and update

Retaining a source imports only its exact reachable Git objects and creates
opaque namespaced `base`, `upstream`, and user-owned `fork` refs in Flect's
OPFS-backed repository. It imports no credentials or grants. The accepted app
continues to run until the user explicitly previews and activates selected parts.

Shaper can personalize a retained fork from its browser-portable Bash sandbox:

```sh
flect share inspect dev.flect.weather
flect share checkpoint dev.flect.weather \
  --at <exact-fork-commit> \
  --write components/weather/personal-note.md ./personal-note.md \
  --message 'Personalize weather workspace'
```

`--write` and `--remove` may repeat. Paths must remain inside the shared source,
the expected commit provides optimistic concurrency, and the command advances
only that share's guarded fork. App Agent cannot run it. The checkpoint does
not activate UI, accept a proposal, import authority, or modify recovery.

When an exact upstream update arrives, Flect fast-forwards an untouched fork or
computes a bounded three-way merge. A clean personalized merge is a real Git
commit with the personal fork and exact upstream revision as its two parents;
the Worker verifies both the parents and the complete resolved tree before the
candidate ref moves. The user still previews and activates it through the normal
protected decision.

Conflicting updates remain inactive and activation stays disabled. Flect preserves
the base, upstream, fork, and bounded conflict paths. The review offers three
explicit choices: continue with the retained fork, resolve the conflict with
Flect, or discard the update. Continue still creates an inactive candidate for Preview
and activation; it does not silently discard the update.

Resolve with Flect materializes only the recorded conflict versions below
`/workspace/.flect/share-conflicts/<share-id>`. Shaper writes exactly one result
or removal for every listed path and submits the exact guarded refs:

```sh
flect share resolve dev.flect.weather \
  --base <exact-base-commit> \
  --upstream <exact-upstream-commit> \
  --fork <exact-fork-commit> \
  --write components/weather/index.ts \
    /workspace/.flect/share-conflicts/dev.flect.weather/resolved/components/weather/index.ts \
  --message 'Resolve weather conflict'
```

Flect's bounded byte-level three-way comparison is the portable conflict
policy. It does not depend on engine-specific merge heuristics: wasm-git may
auto-merge a source file that another Git build reports as conflicted. Exact
ref guards, the reviewed conflict set, the complete resolved tree, and the two
verified commit parents remain mandatory in either case. Restart restores the
inactive resolved candidate. Flect never asks a model to silently choose or
activate a merge result.

## Export, remove, and delete

Export emits a deterministic `.flect-share` containing the exact guarded fork
or prepared candidate history. Derived exports clear publisher signatures and
bind provenance to the exported commit. The embedded repository opens in
ordinary Git and is checked by Flect's production workflow with `git fsck`.

Removing a share detaches its active parts from the app but retains the local
fork and export. Deleting local data is a separate, explicitly confirmed action
available only after removal. It deletes only that namespaced share ref;
unrelated repositories, grants, settings, and accepted interface state remain.

## Host and browser boundaries

The browser implementation uses OPFS, a single Wasm/libgit2 Worker, and Web
Locks; it does not require native Git, Bun, or a host shell. Private source
adapters are closure-private host capabilities registered before startup and
return only archive bytes for an opaque reference. Their credentials never
enter DOM, Git, Flect state, logs, prompts, or exports.

HTTPS sources currently require direct CORS-readable responses and reject
credential-bearing URLs. Public Git requires an exact 40-character commit and
a CORS-capable HTTPS Git server. Real-time collaboration, publisher signature
verification, a public component registry, and automatic conflict resolution
are not implied by the current sharing lifecycle.

See [the trust model](trust-model.md) for authority boundaries and
[the command reference](local-control.md) for agent and outside-control
surfaces.
