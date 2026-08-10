# Flect accessibility and appearance implementation plan

Date: 2026-08-01
Design: `docs/superpowers/specs/2026-08-01-flect-accessibility-appearance-design.md`

## 1. Establish the automated audit gate

- [x] Add the pinned Axe Playwright adapter.
- [x] Add reusable production-state builders and a bounded WCAG 2.2 A/AA
  assertion.
- [x] Gate blank, candidate, accepted, safe, Diagnostics, model, compact,
  light, and dark states.

## 2. Complete semantics and announcements

- [x] Audit names, native roles, labels, dialogs, menus, disclosures, tables,
  status, errors, and disabled explanations.
- [x] Add one concise workbench announcement for role, candidate, active,
  cancellation, and recovery transitions.
- [x] Prove focus order, focus traps, Escape, and focus restoration through the
  public-beta loop.

## 3. Ship semantic light and dark appearances

- [x] Convert remaining literal shell colors/shadows to semantic tokens.
- [x] Add a deliberate system light palette and native color-scheme behavior.
- [x] Render Markdown syntax with dual light/dark Shiki themes.
- [x] Gate contrast and protected-state visibility in both appearances.

## 4. Prove reflow and adaptive behavior

- [x] Fix clipped or fixed-size text and control layouts exposed by 320 px,
  200 percent page scale, and 200 percent root text.
- [x] Add forced-colors and reduced-motion adaptations.
- [x] Prove no document overflow and one reachable protected composer in every
  tested state.

## 5. Verify and reconcile

- [x] Run focused component and production-browser tests.
- [x] Run `bun run check:all` and visually inspect exact dark/light/compact
  screenshots.
- [x] Record the keyboard walkthrough, attempt the macOS VoiceOver walkthrough,
  update the quality baseline and docs, and reconcile issue #22 without
  overclaiming residual manual evidence.
