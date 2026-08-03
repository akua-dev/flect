---
name: Flect
description: The interface that takes your shape.
colors:
  void: "oklch(0.095 0 0)"
  canvas: "oklch(0.125 0.004 340)"
  surface: "oklch(0.165 0.006 340)"
  surface-raised: "oklch(0.205 0.008 340)"
  ink: "oklch(0.955 0.006 340)"
  muted: "oklch(0.690 0.012 340)"
  quiet: "oklch(0.500 0.012 340)"
  line: "oklch(0.300 0.010 340)"
  flect-rose: "oklch(0.630 0.180 340)"
  flect-rose-hover: "oklch(0.690 0.170 340)"
  ready: "oklch(0.780 0.120 158)"
  danger: "oklch(0.660 0.170 27)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, sans-serif"
    fontSize: "2rem"
    fontWeight: 590
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 430
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 520
    lineHeight: 1.25
    letterSpacing: "-0.005em"
rounded:
  control: "8px"
  surface: "12px"
  prompt: "16px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    size: "40px"
  button-primary-hover:
    backgroundColor: "{colors.flect-rose-hover}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    size: "40px"
  prompt-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.prompt}"
    padding: "16px"
---

# Design System: Flect

## 1. Overview

**Creative North Star: "The Midnight Drafting Desk"**

Flect feels like working at a black anodized drafting desk after everything
unnecessary has been cleared away. The interface recedes so the person's intent
and the surface being shaped remain central. One restrained rose signal carries
identity; it appears as a precise indication of agency, never as ambient
decoration.

The system is familiar enough to trust immediately and exact enough to feel
first-party. It rejects widget-dashboard density, chatbot sidecars,
terminal cosplay, neon AI gradients, and decorative glass. Controls use known
affordances, short labels, and restrained state motion.

**Key Characteristics:**

- Near-black neutral architecture with one precise rose signal.
- System typography tuned for calm density and high legibility.
- Tonal layering before shadows; boundaries appear only when useful.
- A centered shaping prompt that expands naturally into a conversation.
- Protected recovery controls that remain quiet but always reachable.

## 2. Colors

The palette is monochrome at rest and reveals color only when state or agency
needs to be communicated.

### Primary

- **Flect Rose** (`oklch(0.630 0.180 340)`): focus, active shaping state,
  selected controls, and the rare brand signal.
- **Flect Rose Hover** (`oklch(0.690 0.170 340)`): interactive emphasis when a
  primary action needs more presence.

### Secondary

- **Ready Mint** (`oklch(0.780 0.120 158)`): runtime readiness and successful
  completion. Always paired with a label or accessible name.
- **Failure Red** (`oklch(0.660 0.170 27)`): actionable failures and destructive
  status only.

### Neutral

- **Void** (`oklch(0.095 0 0)`): application background.
- **Canvas** (`oklch(0.125 0.004 340)`): conversation canvas and protected
  shell.
- **Surface** (`oklch(0.165 0.006 340)`): the prompt and primary controls.
- **Raised Surface** (`oklch(0.205 0.008 340)`): hover, menus, and temporary
  elevation.
- **Ink** (`oklch(0.955 0.006 340)`): primary text and high-emphasis icons.
- **Muted** (`oklch(0.690 0.012 340)`): secondary text with readable contrast.
- **Quiet** (`oklch(0.500 0.012 340)`): disabled detail and decorative marks,
  never essential copy.
- **Line** (`oklch(0.300 0.010 340)`): structural separators.

### Named Rules

**The One Signal Rule.** Flect Rose occupies less than ten percent of a screen.
Its rarity makes agency unmistakable.

## 3. Typography

**Display Font:** SF Pro Display (with system sans-serif fallbacks)

**Body Font:** SF Pro Text (with system sans-serif fallbacks)

**Label/Mono Font:** SF Mono only for literal identifiers or diagnostic detail.

**Character:** One familiar system family keeps the product quiet and coherent.
Personality comes from precise weight, tracking, rhythm, and copy rather than a
decorative display face.

### Hierarchy

- **Headline** (590, 32px, 1.15): empty-state invitations and major surface
  titles.
- **Title** (560, 17px, 1.3): conversation or panel titles.
- **Body** (430, 16px, 1.5): prompts, responses, and instructional copy, capped
  at 70ch.
- **Label** (520, 13px, 1.25): controls, model names, and compact status.
- **Detail** (500, 11px, 1.3): keyboard hints and diagnostics only.

### Named Rules

**The Quiet Weight Rule.** Use weight before size to establish product
hierarchy. Nothing in the working shell needs to shout.

## 4. Elevation

Flect is flat by default. Depth comes from adjacent tonal surfaces and
occlusion. A focused prompt may use one compact structural shadow; menus may use
a tighter shadow because they temporarily sit above the working plane.

### Shadow Vocabulary

- **Prompt Lift** (`0 6px 8px oklch(0.02 0 0 / 0.24)`): focused or active prompt
  only, without a simultaneous decorative border.
- **Menu Lift** (`0 8px 8px oklch(0.02 0 0 / 0.32)`): temporary popovers and
  menus.

### Named Rules

**The Flat-Until-Active Rule.** Resting surfaces use tone. Elevation appears only
to communicate focus, movement, or temporary hierarchy.

## 5. Components

### Buttons

- **Shape:** circular for icon-only controls; 8px for labeled controls.
- **Primary:** Ink fill with Void content, reversing to Flect Rose when active.
- **Hover / Focus:** 180ms tonal transition and a visible 2px Flect Rose focus
  ring with offset.
- **Ghost:** transparent at rest, Raised Surface on hover, never a faint outline
  box.

### Chips

- **Style:** tonal Surface or Raised Surface background with Ink or Muted text.
- **State:** selected chips use a low-chroma rose tint plus an explicit icon or
  label change.

### Cards / Containers

- **Corner Style:** 12px maximum.
- **Background:** Canvas, Surface, or Raised Surface according to hierarchy.
- **Shadow Strategy:** tonal by default; use the documented shadows only for
  active elevation.
- **Border:** hairlines are structural, not decorative.
- **Internal Padding:** 16–24px depending on information density.

### Inputs / Fields

- **Style:** a 16px prompt surface without a resting outline. The text area and
  its action rail read as one instrument.
- **Focus:** Flect Rose appears as a precise inner seam; Prompt Lift signals the
  active surface.
- **Error / Disabled:** errors use Failure Red plus direct recovery copy;
  disabled controls retain readable text and expose their reason.

### Navigation

Navigation stays sparse and uses familiar icon-plus-label controls. Active state
is conveyed by weight, tone, and accessible state, not a bright persistent
sidebar.

### The Shaping Prompt

The prompt is Flect's signature component: a centered work surface that begins
as an invitation, then becomes the stable composer beneath the conversation.
Its input, model source, attachment entry, voice entry, and submit/cancel state
share one visual grammar. The prompt itself is customizable; safe mode always
restores the compiled default.

The active target is explicit inside the composer before send: **Shape** changes
the interface and **Use** operates either the candidate or accepted product.
The adjacent identity names Shaper, Preview App Agent, or App Agent. Each target
keeps its own draft and conversation. Switching changes context; it never
submits text or relabels history.

### Adaptive Agent Rail

Flect does not bolt a second chat onto the product. The signature composer is
one mounted instrument whose position reflects the workspace phase:

- a blank workspace centers the Shape/Shaper composer beneath “What should we
  shape?”;
- the first message reveals the canvas and moves that same composer into the
  right conversation rail;
- a validated proposal adds a compact Keep/Reject decision immediately above
  the composer;
- a validated proposal defaults to candidate Use while Shape remains one
  explicit switch away;
- an accepted product defaults to Use/App Agent.

Above 980px, the rail is inline and resizable from 340–520px, with 400px as the
default. From 761–980px it becomes a full-height right sheet. At 760px and
below it becomes a full-width sheet. The sheet traps no one: Escape collapses
it, reopening restores focus to its first enabled control, and the protected
reopen control remains available on the canvas.

The transition uses measured layout motion for at most 220ms. Under
`prefers-reduced-motion: reduce`, layout changes are immediate. A role change,
resized rail, collapse, or breakpoint must never create a second composer,
horizontal page overflow, or hidden recovery control.

### Chat Markdown

Agent output uses the same SF/system family as the shell at `1rem` with a
`1.55` dark-surface line height and a maximum assistant measure of `70ch`.
Blocks follow a `0.65rem` rhythm. Headings use a compact fixed-rem hierarchy:
`1.25rem`, `1.125rem`, `1rem`, then `0.875rem` for levels four through six.
The final three levels retain their semantic rank while sharing one quiet
visual band to suit the narrow rail.

Code and tables are contained instruments, not new cards. They use the
existing Surface, Raised Surface, Line, Ink, and Muted tokens; code is
`0.875rem` mono and table content is `0.8125rem`. Their own viewports own
horizontal overflow, while copy, wrap, and expand actions stay dense on
desktop and reach `44px` at compact widths. Details remain native disclosures,
links use Flect Rose only as an interaction cue, and footnotes remain subdued.
The complete rendering and trust contract lives in
[`docs/superpowers/specs/2026-07-31-flect-chat-markdown-design.md`](docs/superpowers/specs/2026-07-31-flect-chat-markdown-design.md).

### Activity, Follow, and Diagnostics

Tool use is a compact instrument in the role timeline, not a generic assistant
sentence and not a developer-console dump. A card always names the tool and
shows queued, running, completed, or failed state. Duration stays visible;
bounded commands, output, exit status, preview links, validation paths, and
operation identifiers live in a native disclosure. Ready Mint and Failure Red
support the label but never carry meaning alone.

Conversation follow respects the reader. Content follows while the viewport is
within 48px of its bottom. Once the person scrolls away, streaming and tool
updates preserve that position and surface a quiet, keyboard-operable **Jump
to latest** control with an unread count. Switching roles restores each role's
own position. Following never focuses the timeline or composer.

Diagnostics is a protected disclosure above the composer. At rest it shows
only local-control state and connected-client count. When opened, it exposes
the explicit enable/revoke action and the latest correlated, redacted
operation evidence. It must remain legible and useful without turning the
ordinary product surface into infrastructure chrome.

## 6. Do's and Don'ts

### Do:

- **Do** keep the person's work and current prompt visually central.
- **Do** reserve Flect Rose for focus, selection, and active shaping.
- **Do** use known platform affordances with visible keyboard focus.
- **Do** make runtime failure explain the next action: reconnect or start the
  local runtime.
- **Do** keep safe mode reachable independently of user interface state.

### Don't:

- **Don't** turn Flect into a fixed widget dashboard.
- **Don't** present the agent as a second chatbot bolted onto a static
  application.
- **Don't** use terminal cosplay, neon gradients, decorative glass panels, or
  loud generative-AI activity chrome.
- **Don't** use radii above 16px on cards, sections, or prompt surfaces.
- **Don't** use controls whose novelty makes ordinary actions harder to
  recognize.
- **Don't** pair a decorative 1px border with a broad soft shadow.
