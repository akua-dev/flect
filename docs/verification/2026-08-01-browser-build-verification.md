# Restricted browser build verification — 2026-08-01

Scope: current uncommitted implementation worktree; this is not release-tag or
packaged-native evidence and does not claim general Vite compatibility.

## Proven

- `@rolldown/browser@1.2.1` is exact-pinned. Its release tag `v1.2.1` resolves
  to `93c535d8875daacde3afa84c0d4e9d26e87453e9`; the package is MIT licensed.
- `BrowserBuild` is an Effect service over strict request/response schemas.
- Builds fail before Worker creation when cross-origin isolation is absent.
- Each build runs in a fresh named Worker and termination is the release action
  for success, failure, deadline, or interruption.
- Source paths, entrypoint membership, duplicate paths, file count, per-file
  bytes, total input bytes, output count, and output bytes are bounded before a
  successful artifact can cross the Worker boundary.
- Successful artifacts carry the exact source revision plus deterministic
  SHA-256 input and artifact digests.
- A later failed build leaves the prior successful artifact available.
- `ProposalBuild` snapshots the exact expected proposal commit while guarding
  accepted and last-known-good refs, and mirrors only its `project/` tree.
- A successful artifact is persisted object-first in browser-native OPFS with
  a strict manifest, per-output hashes, and a content-addressed binding. Load
  verifies every file, byte count, hash, and aggregate artifact digest.
- A proposal with a root package manifest resolves through the
  integrity-checking package service; its verified graph replaces source-tree
  dependency files and its graph digest is carried into the compiler request
  and persisted build artifact.
- Because upstream Rolldown 1.2 removed experimental CSS bundling, Flect's
  adapter accepts only local relative `.css` imports from the mirrored file set
  and emits strict-UTF-8 CSS in deterministic path order. It provides no Vite
  plugin execution or remote CSS authority.
- Production Chromium against the Vite production build compiles a React 19
  TSX fixture and local CSS, renders it in an isolated preview, verifies its
  styling, exercises stateful interaction, then submits broken TSX and proves
  that the first artifact remains the last successful build. Both builds read
  real guarded embedded-Git proposal commits.
- The Chromium proof runs with `crossOriginIsolated === true`.
- Reloading the production page constructs a new runtime, restores the exact
  last-successful artifact from OPFS, and renders it again without rebuilding.
- The public **Import app project** directory chooser recognizes a standard
  Vite entrypoint without running Vite config or package scripts, checkpoints
  source into the embedded Git authoring/proposal path, and builds only the
  exact guarded proposal commit.
- Production Chromium imports a Vite TypeScript directory, renders and
  exercises its compiled candidate, exposes its source/artifact receipt in the
  protected review, Keeps it, reloads the persisted accepted capsule, and
  exports a complete capsule containing build outputs but not source.
- Production Chromium imports and exercises a standard React JSX directory,
  Keeps it, blocks the npm registry, then imports and rebuilds the same source
  successfully from the verified OPFS dependency cache with zero attempted
  registry requests.

## Commands

```text
bunx vitest run src/build/browser-build.test.ts src/build/browser-build-store.test.ts src/build/proposal-build.test.ts src/build/restricted-css.test.ts
bun run typecheck
bunx playwright test tests/e2e/browser-build.spec.ts
bunx playwright test tests/e2e/flect.spec.ts --grep "imports, builds, reviews|imports a Vite React"
```

## Open

- Add a durable build-progress/diagnostic model beyond the current bounded
  status notice and operation journal.
- Add CSS asset URLs, CSS modules, and only the specifically approved framework
  transforms; arbitrary Vite plugins and lifecycle scripts remain outside the
  portable path.
- Measure cold and warm build performance before asserting the product budget.
- Expose explicit degraded-memory status when OPFS is unavailable and prove the
  same persistence contract in supported packaged WebViews.
- Add Vue/Svelte, multi-entry/routing, asset URL, and reviewed Vite-config
  adapters without weakening the restricted acceptance compiler.
