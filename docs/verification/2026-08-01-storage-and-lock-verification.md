# Storage degradation and reviewable lock verification — 2026-08-01

Scope: the uncommitted `codex/flect-self-contained-shaper` worktree. This is
contract and production-Chromium evidence, not clean-machine release evidence.

## Storage degradation

- `CapsuleStore` reports `durable` only after OPFS initializes successfully;
  its memory fallback reports `session`.
- The public workspace snapshot carries source and compiled-capsule persistence
  independently.
- Diagnostics reports normal durable storage in production Chromium. A
  session-only compiled store changes the collapsed summary to
  **Session-only storage** and exposes an alert naming what reload will lose.

## Reviewable dependency lock

- `ProposalBuild` resolves dependencies from the exact guarded proposal and
  passes an existing source lock back to the resolver.
- A missing or changed lock is checkpointed as
  `project/package-lock.json` on `flect/authoring` and enters the proposal only
  through a Shaper supersede transaction.
- Compilation rereads the resulting guarded proposal commit.
- Dependency resolution, lock checkpoint, compilation, packaging, success,
  and sanitized failure are typed public build phases. Active work renders in
  the protected rail and the final receipt remains observable in the workspace
  snapshot.
- Production Chromium imports and keeps the React fixture, exports the complete
  repository, and ordinary system Git reads
  `flect/accepted:project/package-lock.json`. The proof asserts React `19.2.8`
  and a SHA-512 integrity value, then blocks the npm registry and rebuilds from
  the verified cache without a registry request.

## Commands

```text
bunx vitest run src/capsule/capsule-store.test.ts \
  src/components/diagnostics-panel.test.tsx \
  src/build/proposal-build.test.ts \
  src/lib/workspace-controller.test.ts
# 22 focused tests passed

bunx playwright test tests/e2e/accessibility.spec.ts --grep 'gates blank'
# 1 passed; durable storage state visible and WCAG scan green

bunx playwright test tests/e2e/flect.spec.ts --grep \
  'imports a Vite React project'
# 1 passed; accepted lock exported through ordinary Git and offline reuse green

bun run check:all
# Effect/Rifty/generated-skill/Biome/TypeScript green
# 104 test files passed, 1 intentionally skipped
# 567 tests passed, 1 intentionally skipped
# 58 production-Chromium journeys passed
# 18 native Rust tests passed
# local ad-hoc-signed Flect.app bundle built successfully
```

The complete gate is green after these additions. OPFS-disabled production
browser automation, cache-management UX, lock-conflict UX, and packaged-host
framework import remain open.

The freshly built bundle was installed locally, activated, and observed as one
exact app process, one owned runtime child, and one visible frontmost window.
That is local dogfood evidence only; it does not imply signing, notarization,
or clean-machine distribution.
