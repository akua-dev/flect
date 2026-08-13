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
  primary: "oklch(0.922 0 0)"
  primary-hover: "oklch(0.870 0 0)"
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
    backgroundColor: "{colors.primary-hover}"
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
and the surface being shaped remain central. A neutral hierarchy carries the
interface; state is communicated with contrast, type, icons, and copy rather
than a decorative product accent.

The system is familiar enough to trust immediately and exact enough to feel
first-party. It rejects widget-dashboard density, chatbot sidecars,
terminal cosplay, neon AI gradients, and decorative glass. Controls use known
affordances, short labels, and restrained state motion.

**Key Characteristics:**

- Shadcn's neutral light and dark defaults, with no product accent color yet.
- System typography tuned for calm density and high legibility.
- Tonal layering before shadows; boundaries appear only when useful.
- One centered agent composer that expands naturally into a conversation rail.
- Protected recovery controls that remain quiet but always reachable.

### Component implementation

Flect vendors the official Shadcn v4 component source. The protected workspace
uses Shadcn's Radix primitives and the official AI Elements registry for the
conversation, messages, composer, reasoning, and tool activity. The initial
visual baseline is Shadcn's neutral default; product-specific styling is a
later, deliberate layer instead of a parallel component system.

Tailwind v4 compiles only the vendored workspace component sources. It does not
enter the static Astro activation shell, does not replace the Effect workflow
kernel, and does not authorize large registry-wide installs. Add primitives one
at a time, keep them behind the island or feature boundary that needs them, and
measure both the initial protected workspace and the on-demand chunk. A native
host control still wins whenever a WebView primitive fails the platform-native
quality contract.

## 2. Platform-native quality contract

Flect must feel like first-party software on every platform it claims to
support. This is behavioral fidelity, not decoration and not pixel-for-pixel
uniformity. The shared Flect identity remains recognizable while each host
uses the interaction conventions people already trust there.

### Architecture rule

The agent, canonical workspace, history, capability, and recovery contracts are
shared. Window chrome, system menus, keyboard routing, focus, scrolling,
selection, drag and drop, file pickers, notifications, appearance, safe areas,
touch, haptics, and lifecycle behavior belong to platform adapters.

A WebView is acceptable only while it meets the platform contract. If a
protected control cannot match native behavior, latency, accessibility, or
visual integration in the WebView, implement that control in the host and
expose it through a narrow typed boundary. Do not ship a CSS imitation of a
native control that behaves incorrectly.

### Browser contract

- Preserve browser history, URLs, text selection, clipboard, context menus,
  focus navigation, zoom, responsive reflow, and expected keyboard shortcuts.
- Never draw fake desktop title bars, traffic lights, system dialogs, or
  application chrome in the web product.
- Use responsive browser and touch behavior rather than shrinking the desktop
  composition.
- Respect light/dark preference, forced colors, reduced motion, text scaling,
  pointer type, and the browser's back/forward lifecycle.
- Keep scroll containers intentional. Ordinary page and canvas scrolling must
  retain platform momentum, overscroll, and input semantics.

### macOS contract

- Respect the title-bar and traffic-light safe region, window resizing,
  full-screen behavior, app activation, reopen, quit, and state restoration.
- Provide a real menu bar with standard application, File, Edit, View, Window,
  and Help behavior where those actions exist.
- Use macOS shortcut, focus-ring, clipboard, drag-and-drop, open/save panel,
  context-menu, trackpad, inertial-scroll, and text-editing conventions.
- Follow the system appearance and accessibility settings, including light,
  dark, increased contrast, reduced transparency, reduced motion, text size,
  and VoiceOver.
- Use SF typography and platform metrics without making every product canvas
  look like Flect chrome.
- Prefer host-native sheets, menus, permission prompts, and file surfaces when
  the WebView equivalent is observably foreign or less accessible.

### Future mobile contract

iOS and Android are not supported merely because the web UI fits a narrow
viewport. A supported mobile host must prove native back behavior, safe areas,
software-keyboard avoidance, touch targets, gestures, scrolling, sheets,
menus, haptics, share/open flows, lifecycle restoration, and platform
accessibility on real devices.

### Responsiveness and motion gates

- Composer input and ordinary protected-shell interactions have p95 response
  below 50ms and release-gated INP below 100ms.
- Scrolling, selection overlays, resizing, dragging, and direct manipulation
  stay within a 16.7ms frame budget on the 60Hz reference device. Supported
  120Hz paths target 8.3ms.
- No ordinary interaction introduces a main-thread task longer than 50ms.
- Menus, sheets, popovers, focus changes, and navigation acknowledge input in
  the same frame and use the platform's expected motion curve and duration.
- The running canvas never flashes blank, jumps layout, loses focus, or resets
  application state because the agent or compiler is working.
- Reduced-motion mode removes nonessential interpolation without removing
  state feedback.

### Release evidence

Every supported host requires real production-build evidence for cold and warm
launch, input, keyboard/focus, scrolling, direct manipulation, appearance,
reduced motion, accessibility, failure recovery, long-session memory, and
resize or rotation. Screenshot similarity alone is not acceptance evidence.

Reviewers must reject a release for visible hitching, fake platform chrome,
foreign control behavior, theme mismatch, clipped safe areas, nonstandard
keyboard behavior, or a design that only works at the demo viewport.

## 3. Colors

The palette is neutral by default. Color appears only for semantic success,
warning, or failure states.

### Primary

- **Primary** (`oklch(0.922 0 0)` dark, `oklch(0.205 0 0)` light): actions,
  focus, and selected controls using Shadcn's neutral defaults.
- **Primary Hover**: a neighboring neutral tone that preserves contrast without
  introducing a product accent.

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

**The Semantic Color Rule.** Non-neutral color must communicate a named state
and must never be the only carrier of meaning.

## 4. Typography

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

## 5. Elevation

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

## 6. Components

### Buttons

- **Shape:** circular for icon-only controls; 8px for labeled controls.
- **Primary:** Ink fill with Void content, using the neighboring neutral when
  active.
- **Hover / Focus:** 180ms tonal transition and a visible 2px primary focus
  ring with offset.
- **Ghost:** transparent at rest, Raised Surface on hover, never a faint outline
  box.

### Chips

- **Style:** tonal Surface or Raised Surface background with Ink or Muted text.
- **State:** selected chips use neutral contrast plus an explicit icon or label
  change.

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
- **Focus:** Primary contrast appears as a precise inner seam; Prompt Lift
  signals the active surface.
- **Error / Disabled:** errors use Failure Red plus direct recovery copy;
  disabled controls retain readable text and expose their reason.

### Navigation

Navigation stays sparse and uses familiar icon-plus-label controls. Active state
is conveyed by weight, tone, and accessible state, not a bright persistent
sidebar.

### The Agent Composer

The composer is Flect's signature component: one centered work surface that
begins as an invitation, then becomes the stable instrument beside the running
interface. Its input, model source, attachment entry, voice entry, selected
canvas target, tool activity, and submit/cancel state share one visual grammar.

There is one continuous conversation. The user does not choose Edit versus
Run, App versus Shaper, a candidate state, or a review mode before speaking.
The agent infers whether the request changes the interface, uses an approved
capability, answers a question, or repairs a failure. Capability expansion and
destructive outside effects remain explicit confirmations.

A valid local UI change appears directly on the running canvas and creates a
quiet checkpoint. A failed change leaves the last-known-good canvas in place
and gives the same agent actionable diagnostics. Undo is one visible action;
History is progressive disclosure. The protected fallback can restore the
composer and recovery controls, but internal recovery modes are not normal
workspace navigation.

### Adaptive Agent Rail

Flect does not bolt a second chat onto the product. The signature composer is
one mounted instrument whose position reflects the workspace phase:

- a blank workspace centers the composer beneath “What do you need?”;
- the first valid result becomes the running canvas and moves that same
  composer into the right conversation rail;
- selecting an element adds a compact semantic target to the composer without
  creating another inspector workflow;
- agent, build, and capability activity appear as calm bounded status near the
  composer; and
- Undo and History stay reachable without turning the rail into a Git client.

Above 980px, the rail is inline and resizable from 340–520px, with 400px as the
default. From 761–980px it becomes a full-height right sheet. At 760px and
below it becomes a full-width sheet. The sheet traps no one: Escape collapses
it, reopening restores focus to its first enabled control, and the protected
reopen control remains available on the canvas.

The transition uses measured layout motion for at most 220ms. Under
`prefers-reduced-motion: reduce`, layout changes are immediate. A canvas
update, selected target, resized rail, collapse, or breakpoint must never
create a second composer, horizontal page overflow, focus loss, application
state reset, or hidden recovery control.

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
links use underline and neutral contrast as interaction cues, and footnotes
remain subdued.
The complete rendering and trust contract lives in
[`docs/superpowers/specs/2026-07-31-flect-chat-markdown-design.md`](docs/superpowers/specs/2026-07-31-flect-chat-markdown-design.md).

### Activity, Follow, and Diagnostics

Tool use is a compact instrument in the conversation timeline, not a generic assistant
sentence and not a developer-console dump. An expanded row names the action
and shows queued, running, completed, or failed state. Duration stays visible;
bounded commands, output, exit status, preview links, validation paths, and
operation identifiers live in a native disclosure. Ready Mint and Failure Red
support the label but never carry meaning alone.

Completed work is collapsed by default into one quiet turn-level disclosure
such as “Worked for 1.4 s.” The final assistant message remains visible. A
running turn uses the same line-level treatment, and individual commands appear
as borderless rows only after disclosure; command output uses a subtle inset
rule rather than nested cards. Failed work that ends the turn opens for
attention. Raw tool names, repeated completion badges, and one duration column
per command must not dominate the ordinary conversation.

Conversation follow respects the reader. Content follows while the viewport is
within 48px of its bottom. Once the person scrolls away, streaming and tool
updates preserve that position and surface a quiet, keyboard-operable **Jump
to latest** control with an unread count. Following never focuses the timeline
or composer.

Diagnostics is a protected disclosure above the composer. At rest it shows
only local-control state and connected-client count. When opened, it exposes
the explicit enable/revoke action and the latest correlated, redacted
operation evidence. It must remain legible and useful without turning the
ordinary product surface into infrastructure chrome.

## 7. Do's and Don'ts

### Do:

- **Do** keep the person's work and current prompt visually central.
- **Do** use neutral contrast for focus, selection, and active shaping.
- **Do** use known platform affordances with visible keyboard focus.
- **Do** use host-native surfaces when the WebView cannot meet the platform
  contract.
- **Do** test real light/dark, pointer/touch, keyboard, scrolling, and resize
  behavior on every supported host.
- **Do** make runtime failure explain the next action: reconnect or start the
  local runtime.
- **Do** keep protected Undo and recovery reachable independently of user
  interface state.

### Don't:

- **Don't** turn Flect into a fixed widget dashboard.
- **Don't** present the agent as a second chatbot bolted onto a static
  application.
- **Don't** expose internal agent roles, candidate states, Keep/Reject, branch,
  or reset-mode decisions in the ordinary editing flow.
- **Don't** use terminal cosplay, neon gradients, decorative glass panels, or
  loud generative-AI activity chrome.
- **Don't** use radii above 16px on cards, sections, or prompt surfaces.
- **Don't** use controls whose novelty makes ordinary actions harder to
  recognize.
- **Don't** ship the same generic shell unchanged on browser, macOS, and mobile.
- **Don't** trade interaction latency or correct platform behavior for visual
  effects.
- **Don't** pair a decorative 1px border with a broad soft shadow.
