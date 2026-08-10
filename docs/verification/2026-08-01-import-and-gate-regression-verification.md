# Import boundary and release-gate regression verification — 2026-08-01

Scope: the uncommitted `codex/flect-self-contained-shaper` worktree after the
complete `check:all` gate. This is browser, contract, native-unit, and local
packaged-app evidence. It is not signing, notarization, or clean-machine
distribution evidence.

## Findings corrected

- Directory import previously let a source file collide with
  `metadata/import-report.json`, accepted 256 source files before adding its
  reserved report, and deferred capsule paths longer than 100 characters to a
  generic packaging failure. Preflight now rejects each case with the exact
  portable limit and recovery action.
- Vite `resolve.alias` and `node:` built-ins were ignored until compilation.
  Preflight now names the unsupported feature and directs the maker to relative
  imports, browser APIs, or an explicit typed product capability.
- The Actions dialog placed a live status directly inside `role=menu`, which
  violated ARIA required-child semantics. The status is now a dialog sibling of
  the menu.
- The light-appearance primary hover state rendered dark text on dark rose at
  1.84:1. The semantic cross-theme foreground now meets the mandatory contrast
  gate.
- Browser tests cleared localStorage without reconciling canonical OPFS/Git,
  causing a correct fail-closed recovery state to contaminate later evidence.
  Test setup now disposes and removes embedded Git and OPFS state, then uses a
  fresh isolated test workspace through the real repository service.
- A newly opened blank workspace created its Git directory without creating
  the built-in accepted revision and matching activation receipt. Reloading
  before the first edit therefore failed closed as if state had been damaged.
  First load now commits and binds the built-in revision before returning the
  workspace, while legacy workspaces still take their explicit migration path.

## Passing evidence

```text
bunx vitest run src/lib/web-project-import.test.ts
# 9 passed

bun run check
# Effect/Rifty/generated-skill/Biome/TypeScript green
# 104 test files passed, 1 intentionally skipped
# 563 tests passed, 1 intentionally skipped

bunx playwright test tests/e2e/accessibility.spec.ts
# 5 passed: blank, candidate, actions, Diagnostics, model, accepted, safe,
# dark, light, zoom-equivalent, narrow, forced-colors, and reduced-motion

bunx playwright test tests/e2e/flect.spec.ts --grep \
  'normalizes an interrupted|rejects a stale draft|preserves the prior continuity|connects a Pi provider|supports keyboard shaping'
# 5 passed

bun run check:all
# Effect/Rifty/generated-skill/Biome/TypeScript green
# 104 test files passed, 1 intentionally skipped
# 563 tests passed, 1 intentionally skipped
# 58 production-Chromium tests passed
# 18 native Rust tests passed
# local ad-hoc-signed Flect.app bundle built successfully
```

The first complete gate attempt was intentionally retained as failure evidence:
it found the ARIA/contrast regressions and the invalid test-state assumption.
The corrected complete gate is green. Public signing and notarization,
clean-machine distribution, VoiceOver, and the wider framework compatibility
matrix remain tracked separately and are not implied by this result.
