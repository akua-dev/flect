# Flect accessibility, reflow, and appearance verification

Date: 2026-08-01
Scope: GitHub issue #22; FQ-18.1–FQ-18.9 and FQ-19.7
Result: implemented and automated proof green; one manual VoiceOver residual

## Delivered behavior

- The workbench has one atomic, polite status for target/role, validated
  candidate decisions, active response/cancellation, and protected recovery.
- The transcript is a named, keyboard-scrollable log. Focus remains visible;
  compact sheets trap focus; Escape, collapse, menus, and modal dismissal
  restore it to the initiating control.
- The extension/recovery actions surface is a real modal dialog. Background
  targets become inert instead of remaining partly clickable beneath it.
- Safe mode no longer loses pointer authority beneath the docked rail. On
  compact layouts the same protected route remains in Actions.
- Dark and warm-neutral light appearances follow `prefers-color-scheme` from
  one semantic token system. Shiki emits pinned light/dark variants without a
  rerender.
- Forced colors use system values, reduced motion removes non-essential
  animation, and compact action rows reflow and scroll instead of clipping.

## Automated evidence

`bun run check:all` passed after implementation:

- Effect checkout and Rifty license/dependency checks;
- generated Flect skill consistency, Biome, and TypeScript;
- 499 unit/contract tests, with one intentional skip;
- 32 production Chromium tests;
- 18 Rust host tests; and
- a freshly built ad-hoc-signed `Flect.app` bundle.

The five dedicated production Chromium tests use
`@axe-core/playwright@4.12.1` with WCAG 2.0/2.1 A/AA and WCAG 2.2 AA tags. They
audit:

- blank Shape, candidate Use, accepted Use, and safe mode;
- the extension/recovery actions dialog, Diagnostics, and model chooser;
- automatic dark and light appearances;
- a 640 CSS px viewport equivalent to 200% zoom from a 1280 px baseline;
- 320 CSS px, 200% root text, forced colors, and reduced motion; and
- target size, one protected composer, safe-mode reachability, active color
  scheme, and zero page/shell horizontal overflow.

Existing production workflows additionally prove keyboard-only shaping,
model search, arrow-key rail resizing, compact Escape, collapse/reopen focus,
candidate Keep/Reject, safe recovery, and reduced-motion behavior.

## Visual and packaged-app dogfood

Exact dark, light, and 320 px/200%-text/forced-colors screenshots were rendered
from the production build and inspected. The compact inspection found and
corrected dense menu rows and a transparent inactive backdrop before this
report was finalized.

The freshly built bundle at
`src-tauri/target/release/bundle/macos/Flect.app` was launched as a new process.
After the final rebuild, the scoped dogfood instance was relaunched as process
68790; it exposed one 1180 × 781 on-screen window (CoreGraphics window 3053).
At the user's direction, two older Flect processes were then closed; 68790 is
the sole remaining Flect app instance and was left open.

The read-only macOS accessibility tree exposed these native WebView nodes and
names: Flect home, Safe mode, Preview App Agent, candidate conversation,
Revision decision, Keep change, Reject, Diagnostics, Message Preview App
Agent, Actions, Shape · Shaper, Use · App Agent, Model: Auto via Pi, and Send to
Preview App Agent. This proves the packaged WebView exports the protected
semantics to macOS accessibility APIs.

## Honest residual

The macOS VoiceOver preference reported off. It was not enabled because doing
so would take over the user's input and audio environment. Therefore this run
does not claim a spoken VoiceOver walkthrough, speech ordering, or rotor
quality. Issue #22 remains the owner of that bounded manual residual; the
observable AX tree and all automated WCAG/keyboard/reflow gates are green.

The bundle is ad-hoc signed and not notarized; distribution trust remains issue
#23 rather than an accessibility claim.
