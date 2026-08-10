# Browser package cache verification — 2026-08-01

Scope: current uncommitted implementation worktree; this is not release-tag
evidence and does not claim general npm or Vite compatibility.

## Proven

- `BrowserPackageResolver` and `BrowserPackageCache` are separate Effect
  services with typed request, result, and failure contracts.
- The input cache key hashes the exact package manifest and optional lock.
- Cache misses use the existing pinned Rifty npm client in a disposable VFS.
  Tarball integrity is verified, archive traversal is rejected by the existing
  installer boundary, and package lifecycle scripts are never executed.
- The accepted lock is npm lockfile version 3. Every non-root entry must have
  an exact semantic version, SHA-512 integrity, and an HTTPS tarball URL from
  the configured registry origin.
- The lock and bounded `node_modules` graph receive independent and aggregate
  SHA-256 digests. Files are written object-first in OPFS before the
  input-to-graph binding advances.
- Cache reads revalidate the binding, manifest, lock digest, every file's path,
  size and digest, and the aggregate graph digest.
- A failed integrity check creates no cache binding.
- `ProposalBuild` replaces source dependency files with the verified resolved
  graph and binds the graph digest into the acceptance-build artifact.
- Production Chromium warms a fixture graph, disables browser networking,
  resolves the same input without another registry-provider call, then reloads
  into a new runtime and restores the graph from OPFS with zero registry calls.
- The public React project-import workflow resolves React 19 runtime
  dependencies, builds and Keeps the candidate, then repeats the directory
  import with the npm registry blocked. The second exact build succeeds with
  zero attempted registry requests and renders the React UI again.
- Portable import derives a package manifest containing only identity and
  runtime dependencies. Vite scripts and development tools remain preserved in
  Git source but cannot enter resolution or execute.

## Commands

```text
bunx vitest run src/build/browser-package-resolver.test.ts src/build/proposal-build.test.ts
bun run typecheck
bunx playwright test tests/e2e/browser-package.spec.ts
bunx playwright test tests/e2e/flect.spec.ts --grep "imports a Vite React"
```

## Open

- User-facing lock conflict, dependency provenance, cache inspection, eviction,
  repair, and removal UX.
- Peer/optional dependency policy and broader registry/package compatibility
  matrices.
- Broader framework/package matrices and user-facing resolution diagnostics.
- Supported packaged-WebView OPFS and offline proof.
