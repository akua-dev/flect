# Flect accessibility, reflow, and appearance design

Date: 2026-08-01
Status: accepted for implementation
Tracks: GitHub issue #22, FQ-18.1–FQ-18.9 and selected FQ-19

## Outcome

The protected Flect shell and Shape–Use workbench remain understandable and
operable with a keyboard, assistive technology, 200 percent zoom and text
scaling, reduced motion, forced colors, compact touch layouts, and deliberate
light and dark system appearances. Shaped product content cannot obscure the
protected target, candidate decision, permission, or recovery route.

## Semantic contract

Native HTML remains the first choice. Every interactive control has one stable
accessible name, a visible focus treatment, and a keyboard path. Dialog-like
model selection traps focus, Escape closes overlays, sheets trap focus while
open, and closing or collapsing restores focus to the initiating control.

One visually hidden, polite workbench announcement summarizes meaningful state
changes only:

- current target and owning role;
- candidate preview availability and Keep/Reject decision;
- active response and cancellation state;
- protected recovery entry; and
- a storage recovery reason when present.

Messages remain a `role=log`; tool activity exposes textual phase and duration,
not color alone. Validation and blocking errors remain visible near the action
and use alert/status semantics. The announcement does not repeat token deltas,
tool output, model content, or every layout transition.

## Appearance contract

Flect supports two automatic appearances selected by
`prefers-color-scheme`: dark and light. Both use the same semantic token names,
focus geometry, component hierarchy, and state behavior. The light palette is
warm-neutral with restrained rose accents; it is not an inverted dark theme.

The root advertises the active native color scheme. Form controls, canvases,
surfaces, muted text, lines, focus, success, danger, backdrops, shadows, code,
and shaped document primitives consume semantic tokens. Markdown syntax uses
Shiki dual themes so highlighted code follows the shell without rerendering.

Forced-colors mode removes decorative shadows/backdrops, preserves system
colors, retains visible borders and focus, and never hides status text. Reduced
motion collapses non-essential transition and animation durations while
keeping textual state feedback.

## Reflow contract

At an effective 320 CSS pixels and at 200 percent zoom or root text scaling:

- the document has no horizontal page overflow;
- one protected composer remains reachable;
- the agent surface becomes a full-width sheet;
- all content regions scroll internally where necessary;
- target, model, decision, safe-mode, and collapse controls remain reachable;
- text wraps instead of being clipped by fixed heights; and
- code and tables may scroll inside their own labeled instruments without
  widening the page.

Touch controls remain at least 44 by 44 CSS pixels at compact breakpoints.

## Automated proof

`@axe-core/playwright` runs WCAG 2.2 A/AA checks against blank, candidate,
accepted, safe, Diagnostics, model chooser, compact, light, and dark states in
the production build. Production Chromium additionally checks:

- keyboard-only Shape → candidate Use → Shape → Keep → accepted Use → safe
  mode and recovery;
- 320 px width;
- 200 percent page scale and 200 percent root text;
- reduced motion;
- forced colors where Chromium supports it;
- both system appearances and semantic contrast; and
- page/shell geometry with no horizontal document overflow.

Automated checks do not replace a macOS VoiceOver walkthrough. The dated proof
report records the exact automated coverage and keeps VoiceOver or visual
review residuals explicit.
