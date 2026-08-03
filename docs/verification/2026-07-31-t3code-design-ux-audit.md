# T3 Code design and UX verification

Date: 2026-07-31

## Scope and evidence

This audit compares Flect `v0.2.0` at commit
`32d20f5dcb82af6cd53db9188bb029dd0d4012e4` with the local T3 Code checkout at
commit `d19039aeef6942e6eb204856c43b5354c0333e2d`. The comparison uses the actual
source rather than screenshots or memory.

Primary T3 Code references:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ModelPickerContent.tsx`
- `apps/web/src/components/chat/ModelPickerSidebar.tsx`
- `apps/web/src/components/chat/ModelListRow.tsx`
- `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
- `apps/web/src/components/composerFooterLayout.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/DraftHeroHeadline.tsx`
- `apps/web/src/components/chat/draftHeroTransition.ts`

Primary Flect references:

- `src/components/composer.tsx`
- `src/components/model-menu.tsx`
- `src/components/agent-rail.tsx`
- `src/components/role-aware-shell.tsx`
- `src/styles.css`

The rendered checks used Flect's production Vite build and deterministic public
runtime in real Chromium at 1180 × 781, 900 × 700, and 720 × 780. The audit
also inspected focus, element bounds, horizontal overflow, console output,
network failures, computed color contrast, and reduced-motion implementation.

## Anti-pattern verdict

Pass. Flect does not read as a generic generated-AI dashboard. It has one
recognizable instrument, restrained color, deliberate role visibility, tonal
depth, familiar controls, and no decorative gradients, glass-card grid, or
invented navigation. Its T3 Code influence is structural rather than a copied
product identity.

## Pre-correction health score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 2/4 | Strong semantics and Lighthouse result, but preview focus, quiet-text contrast, and compact target sizing need correction |
| 2 | Performance | 3/4 | Interaction and motion are bounded; the production main bundle remains large |
| 3 | Responsive design | 3/4 | Inline rail and both sheet modes reflow without overflow; compact hit areas miss the approved 44 px target |
| 4 | Theming | 3/4 | Flect uses a coherent token system; one essential secondary-text use falls below AA contrast |
| 5 | Anti-patterns | 4/4 | Distinctive, restrained product UI with no material AI-design tells |
| **Total** |  | **15/20** | **Good — correct the interaction gaps before calling the T3-derived UX verified** |

Lighthouse reported 100 for accessibility, best practices, SEO, and agentic
browsing. Those automated results do not cover the state-transition and
pointer-target defects found by direct interaction.

## Post-correction verdict

Verified. Flect now carries the T3 Code interaction patterns that fit its
product model without importing T3 Code's coding-only controls or weakening
Flect's role and recovery boundaries.

| # | Dimension | Score | Verified result |
|---|---|---:|---|
| 1 | Accessibility | 4/4 | Preview focus moves to **Keep change**, unresolved previews lock role switching, essential qualifiers exceed 4.5:1, and compact targets are at least 44 px |
| 2 | Performance | 3/4 | State transitions remain bounded; production JavaScript still needs deliberate code splitting |
| 3 | Responsive design | 4/4 | Inline rail, right sheet, and full-height sheet have no page overflow; the model picker remains inside the viewport |
| 4 | Theming | 4/4 | Existing tokens now preserve AA contrast for functional secondary text |
| 5 | Anti-patterns | 4/4 | The UI remains recognizably Flect rather than becoming a T3 Code skin |
| **Total** |  | **19/20** | **Verified — the remaining point is the separately documented bundle-size follow-up** |

The correction adds the provider rail, favorites-first provider filtering,
search across providers, bounded scroll fades, stable model-search identity,
dialog/radio semantics, preview decision focus, preview role locking, compact
touch targets, and corrected functional-text contrast.

Direct Chromium verification also exposed one issue that was not apparent in
the static source comparison: focusing model search could scroll the hidden
application shell horizontally because the picker opened beyond the rail.
The picker now aligns inward. A browser regression test verifies both
`role-shell.scrollLeft === 0` and that the picker bounds stay inside the
viewport.

Fresh verification after correction:

- `bun run check:all`
- 275 Vitest tests passed, with one intentionally skipped
- 10 production-Chromium tests passed
- 8 Rust desktop tests passed
- the signed-ad-hoc macOS application bundle built successfully
- the verified bundle was installed at `/Applications/Flect.app`; launch
  created its 1180 × 781 native window, started the private runtime, issued
  `GetRuntime` and `ListModels`, and received valid Effect RPC exits
- real Chromium at 1180 × 800 and 720 × 780 reported no console errors, no
  horizontal overflow, correct preview focus, a contained model picker, and
  44 px essential compact controls

## Source-to-source comparison

| Behavior | T3 Code source pattern | Flect result before correction |
|---|---|---|
| Stable composer | One rounded editor and footer instrument | Matches |
| Blank-state hero | Centered headline and composer | Matches, with Flect-specific copy |
| Layout transition | Measured FLIP-style movement with reduced-motion bypass | Matches; Flect moves into its product-specific right rail |
| Multiline input | Bounded growth, internal scroll, Enter send, Shift+Enter newline, IME guard | Matches |
| Primary action | One send/stop position with accurate accessible state | Matches |
| Responsive footer | Important controls remain; labels compact before actions | Matches structurally |
| Model discovery | Searchable picker with provider rail, favorites-first view, bounded scrolling, and scroll affordance | Partial: search, provider grouping, favorites, selection, and keyboard traversal exist; provider rail, favorites-first view, and scroll fade do not |
| Keyboard dismissal | Escape closes overlays and restores trigger focus | Matches |
| Responsive shell | Structural desktop/tablet/mobile transition | Matches Flect's approved rail/sheet model without horizontal overflow |
| Product-specific controls | T3 coding controls appear only where backed by coding capabilities | Correctly omitted in Flect |

Flect intentionally does not copy T3 Code's project selector, worktrees,
terminal context, file mentions, plans, provider traits, approvals, or account
model. Those omissions follow the approved Flect role-aware shell design.

## Findings

### P1 — Preview transition leaves keyboard focus on the document body

- **Location:** `src/components/agent-rail.tsx`
- **Category:** Accessibility / interaction
- **Impact:** A keyboard or assistive-technology user submits the first shaping
  request, the preview disables the composer, and focus becomes unlocated
  instead of moving to the next required decision.
- **Standard:** WCAG 2.4.3 Focus Order and the approved shell focus contract.
- **Evidence:** Real Chromium reported `document.activeElement ===
  document.body` after the deterministic first-shape flow.
- **Correction:** Move focus to **Keep change** when a preview first becomes
  actionable.

### P1 — Essential quiet text is below AA contrast on the composer surface

- **Location:** `src/styles.css`, `.role-switcher__agent` and
  `.model-menu__source`
- **Category:** Accessibility / theming
- **Impact:** The visible agent and Pi-source qualifiers are harder to read,
  especially at their 11–12 px sizes.
- **Standard:** WCAG 1.4.3 Contrast (Minimum).
- **Evidence:** `--quiet` on `--surface` measured 4.14:1; the requirement is
  4.5:1.
- **Correction:** Use the existing `--muted` token for essential secondary
  text instead of redefining the decorative quiet token.

### P1 — Run appears available while a preview requires an Edit decision

- **Location:** `src/components/agent-rail.tsx`
- **Category:** Interaction / information architecture
- **Impact:** The Run control looks actionable but the shell immediately forces
  the unresolved preview back to Edit, creating a misleading no-op.
- **Correction:** Disable role switching while a preview is unresolved, just as
  it is disabled during an active operation.

### P2 — Compact controls miss Flect's approved 44 px touch-target floor

- **Location:** `src/styles.css`
- **Category:** Responsive / accessibility
- **Impact:** The right and full-width sheets retain 28–36 px control heights,
  making primary controls unnecessarily difficult on touch devices.
- **Evidence:** Real Chromium measured Edit/Run at 28 px, Actions and model at
  32 px, and Send at 36 px in compact layouts.
- **Correction:** Preserve dense desktop geometry and expand hit targets to
  44 px under coarse-pointer/mobile conditions.

### P2 — Model picker stops short of the approved T3 Code interaction model

- **Location:** `src/components/model-menu.tsx`
- **Category:** Interaction / responsive
- **Impact:** Multiple Pi providers become slower to scan, favorites do not
  provide a dedicated first view, and long lists have no edge affordance.
- **Correction:** Add the approved provider rail, favorites view, search-across-
  providers behavior, and bounded scroll fades without importing T3 Code's
  account or coding-provider model.

### P3 — Model search field has no stable form identifier

- **Location:** `src/components/model-menu.tsx`
- **Category:** Forms / browser quality
- **Impact:** Chrome reports a form-field quality issue even though the field
  has an accessible name.
- **Correction:** Give the search field a stable generated `id` and a `name`.

### P2 — Production JavaScript is large

- **Location:** production Vite output
- **Category:** Performance
- **Impact:** Cold browser startup pays for a 1.89 MB main chunk (544 KB gzip)
  plus large execution workers and WebAssembly assets.
- **Correction:** Keep the current verification scope focused on UX; schedule
  code splitting around the execution diagnostics and sandbox substrate rather
  than mixing it into the composer correction.

## Positive findings

- The same composer DOM node survives the centered-to-rail transition.
- Flect preserves separate drafts, histories, labels, and authority for App
  Agent and Shaper.
- Enter, Shift+Enter, IME composition, send, stop, disabled reasons, and
  bounded autosizing are covered by observable tests.
- The model picker already supports search across model/provider fields,
  selection state, favorites, Escape, outside click, Home/End, and arrow-key
  traversal.
- The 400 px rail is keyboard- and pointer-resizable from 340–520 px.
- Tablet and mobile sheets trap focus, close with Escape, restore focus, and
  produce no horizontal page overflow.
- Motion is short, state-driven, and removed under `prefers-reduced-motion`.
- The installed product's T3 influence is correctly limited to interaction
  patterns that serve Flect's own product model.

## Correction boundary

The correction pass may change only the protected shell's focus behavior,
role availability, model-picker presentation/semantics, and responsive hit
areas. It must not port T3 Code's coding-only controls, alter Flect's Effect
application architecture, weaken protected recovery, or introduce provider
credentials into browser state.
