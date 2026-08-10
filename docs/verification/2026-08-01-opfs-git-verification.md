# OPFS Git workspace verification

Date: 2026-08-01
Tracking: issue #25
Release class: local dirty implementation worktree; not published-release proof

## Proven in this slice

- `wasm-git@0.0.17` is exact-pinned. Its source commit is
  `6250484764878a35ba374836465cbf2e54364994`, embedding libgit2 `1.9.4` and
  Emscripten `6.0.3`.
- The Asyncify OPFS Worker and Wasm are bundled by Vite. Runtime Git does not
  require a CDN, host process, system Git, or an installed Bun binary.
- `GitWorkspace` is an Effect service with schema-decoded messages, stable
  typed failures, one scoped Worker, deadlines, interruption, bounded files,
  paths, commands, output, and repository export.
- Canonical checkpoints refresh the Worker's MEMFS cache from OPFS and verify
  expected refs under a workspace-specific Web Lock before writing and
  committing. Accepted, proposal, and last-known-good are ordinary guarded Git
  refs. A protected activation receipt is retained outside user-controlled Git
  state and ref disagreement fails closed.
- Worker failures cross structured clone as schema data, then become typed
  Effect errors in the caller. They do not rely on transporting JavaScript
  `Error` subclasses across the Worker boundary.
- The protected composer shows bounded accepted/candidate object IDs and lets
  the user download the complete repository, including `.git`.
- Native and embedded AXI callers can run `flect repository status` through
  the same reactive workspace snapshot; this grants no raw OPFS handle.
- Each interactive role now uses a separate namespaced OPFS working mirror
  through the pinned Rifty VFS and just-bash `IFileSystem` contract. The mirror
  exposes neither the canonical OPFS root nor `.git`, rejects links and
  traversal, maintains the synchronous path index just-bash requires, and
  falls back to bounded memory where OPFS is unavailable.
- `GitWorkspace.snapshotRef` atomically verifies guards and the expected ref,
  checks out that source inside the sole Git Worker, rejects links and excess
  input, and returns only bounded source files. App/Shaper receive an
  unshadowable role-bound Git command. App Agent mutation is denied; Shaper
  mutation is restricted to guarded `add -A`, `commit -m`, and `restore .`.

## Observable evidence

The following focused checks passed in the implementation worktree:

```text
bun run typecheck

bunx vitest run src/lib/git-interface-repository.test.ts
  2 tests passed, including stale protected-ref rejection

bunx vitest run \
  src/components/composer-actions-menu.test.tsx \
  src/hooks/use-workspace.test.tsx \
  src/app.test.tsx \
  src/lib/git-interface-repository.test.ts
  15 tests passed

bunx vitest run \
  src/shell/flect-command.test.ts \
  src/shell/persistent-workspace-fs.test.ts \
  src/shell/sandboxed-shell.test.ts \
  src/axi/command.test.ts \
  src/axi/program.test.ts
  focused role isolation, persistence, protected-path, and reserved-command
  checks passed

bunx playwright test tests/e2e/opfs-git.spec.ts --project=chromium
  real create/write/add/commit/branch/diff/conflict/reset/reopen/export passed
  exported repository passed native `git fsck --full`
  two independent pages raced the same expected ref: one succeeded and the
  stale writer received `stale-ref`; the winner's full guarded source snapshot
  returned the committed value

bunx playwright test tests/e2e/embedded-axi.spec.ts --project=chromium \
  --grep 'role workspace source persists|Shaper inspects'
  a role file survived a production-browser page restart through OPFS, and
  Shaper observed its actual proposal ref and 40-character object ID through
  unshadowable embedded Git

bunx playwright test tests/e2e/flect.spec.ts --project=chromium \
  --grep 'exports the shaped'
  protected UI exposed object IDs, downloaded the complete repository, and
  native Git found accepted, proposal, and last-known-good refs

bunx playwright test tests/e2e/flect.spec.ts --project=chromium \
  --grep 'outside agent drive'
  outside `flect repository status` observed the same reactive refs while the
  UI remained live
```

The normal Flect app also passed candidate creation/persistence and proposal
reload tests with the Git-backed repository, rather than only a diagnostic
page.

## Deliberate remaining boundary

- Production uses the portable Asyncify build. Automatic JSPI/pthreads
  selection and comparative proof remain open.
- Role mirrors persist in namespaced OPFS and remain separate from canonical
  Git metadata. Browser proof covers status, add, commit, restore, guarded
  authoring reconciliation, acceptance, and ordinary-Git export. Patch
  producing `git diff` remains unavailable because the pinned engine accepted
  the command but emitted no patch under browser proof.
- Import, round-trip continuation, repair UI/AXI, adversarial quota/object
  corruption/symlink/config tests, and packaged macOS restart/offline proof
  remain open.
- Vite still reports the upstream package's unreachable browser
  `node:module` detection branch as externalized. Real Chromium execution
  passes; the warning still needs an upstream-safe build integration decision.
