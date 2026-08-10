# Flect OPFS Git workspace implementation plan

Date: 2026-08-01
Approved design: `docs/superpowers/specs/2026-07-30-flect-self-contained-shaper-design.md`
Tracking: Flect issue #25

This plan extracts the approved embedded-Git slice into testable deliveries. It
does not replace the product-quality contract or architecture documentation.

## Dependency decision and provenance

- [x] Inspect current `wasm-git` package and its exact published source.
- [x] Pin `wasm-git@0.0.17`, source commit
  `6250484764878a35ba374836465cbf2e54364994`, which embeds libgit2 `1.9.4` and
  Emscripten `6.0.3` artifacts.
- [x] Confirm that the OPFS loader runs only in a module Worker and selects
  pthreads, JSPI, or Asyncify without requiring system Git.
- [x] Confirm the shipped `lg2` surface: init, add, checkout with branch
  creation, commit, diff, merge, reset, log, status, tags, fetch, and push.
- [x] Record the important limitation: the published executable has no
  `worktree`, `archive`, or `bundle` command. The first portable proposal model
  therefore uses protected proposal branches with serialized checkout; export
  contains the complete ordinary repository including `.git`. Flect must not
  claim concurrent linked-worktree support until its reviewed libgit2 adapter
  exists.

Primary references:

- [wasm-git source](https://github.com/petersalomonsen/wasm-git/tree/6250484764878a35ba374836465cbf2e54364994)
- [wasm-git OPFS loader](https://github.com/petersalomonsen/wasm-git/blob/6250484764878a35ba374836465cbf2e54364994/lg2_opfs_auto.js)
- [wasm-git lg2 command table](https://github.com/petersalomonsen/wasm-git/blob/6250484764878a35ba374836465cbf2e54364994/libgit2patchedfiles/examples/lg2.c)
- [libgit2 1.9.4](https://github.com/libgit2/libgit2/tree/v1.9.4)
- [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

## 1. Prove the embedded engine in production Chromium

- [x] Add a failing browser test for create, write, add, commit, branch,
  divergent edit, diff, merge/conflict, reset/rollback, refresh/reopen, and
  complete-repository export.
- [x] Bundle the pinned worker and Wasm artifacts through Vite without CDN or
  runtime network dependency.
- [x] Prove OPFS persistence in the non-isolated Asyncify fallback.
- [ ] Select and prove the best available production-build variant without
  weakening the portable fallback.
- [x] Verify exported repository object IDs with native Git in the test
  harness; native Git is proof tooling, never a Flect runtime dependency.

## 2. Introduce the Effect-owned Git capability

- [x] Define schema-decoded worker requests/results and stable typed errors for
  unsupported, unavailable, invalid path/ref, conflict, corruption, quota,
  stale ref, oversized repository, interruption, and worker failure.
- [x] Implement one scoped `GitWorkspace` Worker and an Effect service that is
  the only application writer of canonical repository state.
- [x] Serialize mutations, permit only bounded safe reads, validate all paths
  and refs, enforce limits, and interrupt/terminate the Worker through Scope.
- [x] Add contract tests with test Layers and observable worker behavior,
  including a real two-page stale-ref race and structured Worker failures.

## 3. Make repository ownership observable

- [x] Initialize a real canonical workspace repository on blank first run.
- [x] Represent accepted, candidate, and last-known-good states with guarded,
  verified refs while retaining the activation receipt outside user-controlled
  Git state.
- [x] Add complete-repository export through the public controller and
  protected composer action.
- [ ] Add public controller/AXI status, diff, history, rollback, and
  repository-repair operations.
- [ ] Show current branch/revision, candidate isolation, conflict state, and
  recovery actions in the protected Flect shell.

## 4. Broker ordinary Git semantics to agents

- [x] Persist each role's isolated just-bash working mirror in its own bounded
  OPFS namespace, with a memory fallback where OPFS is unavailable; prove page
  restart persistence in production Chromium.
- [x] Register role-bound, unshadowable `git status`, `branch`, `rev-parse`, and
  `log` inspection in App/Shaper `SandboxedShell` without exposing an OPFS
  handle, `.git` internals, host process, or system executable. Prove Shaper
  observes the actual proposal ref and OID in production Chromium.
- [x] Add a guarded full-ref source snapshot operation and prove it against a
  real Wasm/libgit2 checkpoint in production Chromium.
- [x] Extend the reserved command with bounded status, add, commit, and restore
  operations through the sole `GitWorkspace` writer; App Agent mutation stays
  denied.
- [ ] Add patch-producing diff after a browser-capable embedded Git variant
  proves correct output; the pinned engine currently emits an empty patch.
- [ ] Constrain Shaper to its proposal branch and require expected-parent
  checks before each checkpoint or acceptance.
- [ ] Prove traversal, symlink, config/attributes, ref-race, object corruption,
  oversized input, storage exhaustion, cancellation, and role-boundary denial.

## 5. Dogfood and reconcile proof

- [ ] Exercise the same repository in production Chromium and the packaged
  macOS app, including restart and offline behavior.
- [x] Export, open, and inspect the repository with native Git in the browser
  harness; continuing and round-tripping it remain pending.
- [ ] Update verified architecture, trust model, local-control reference,
  README entry points, dated quality evidence, issue #25, and project status.
- [ ] Run the full no-mistakes and release gates before delivery.
