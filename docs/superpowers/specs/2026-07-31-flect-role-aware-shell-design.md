# Flect role-aware shell design

Date: 2026-07-31

## Status

Approved product direction, written for final repository review before
implementation.

This design supersedes the visible shell behavior in the original MVP design
where a centered App Agent conversation and a separate fixed Shaper utility
panel are the primary interaction. It does not replace the existing trust,
transport, revision, sandbox, or recovery architecture.

## Outcome

Flect opens as a calm, high-quality agent composer inspired by the strongest
interaction patterns in T3 Code. In a blank workspace, that composer belongs to
Shaper and creates the first interface. As soon as shaping begins, the same
visible conversation docks into an adaptive rail on the right while the
interface preview takes over the main canvas.

An installed product experience opens in Run mode with its App Agent. The same
shell component serves both roles, but the current role, authority, history,
and available actions remain explicit. Switching modes changes the underlying
Pi session; it never silently sends a message to a different agent.

The result must feel like one application whose interface is alive, not a
static launcher with a chatbot or editor overlay attached to it.

## Product decisions

### One composer, explicit roles

Flect has one protected, role-aware composer implementation with three visible
states:

- **Edit · Shaper** creates and revises the interface.
- **Run · App Agent** uses the accepted interface and its approved product
  capabilities.
- **Safe mode** exposes the compiled recovery composer and deterministic
  recovery actions without loading customized interface state.

The composer may render in a centered empty state, a docked conversation rail,
or a compact collapsed control. These are layouts of the same protected shell,
not separate chat implementations.

The role label is visible before send. A mode transition is an explicit user
action. Draft text is retained per role and is never submitted during a mode
transition.

### Blank and product starting points

A workspace is considered blank when the active document is the built-in
starter document and no accepted user or product revision establishes an
experience.

Blank workspaces open in Edit mode. The centered composer sends its first
instruction directly to Shaper. It does not create an ordinary App Agent turn
and does not require the user to find a separate “Shape interface” action.

An installed or previously accepted product experience opens in Run mode. Its
App Agent is ready immediately, while Edit mode remains available through a
clear protected control.

Safe mode always opens the compiled protected experience regardless of the
saved layout preference.

### The conversation moves; it is not replaced

The blank Edit composer begins centered in the canvas beneath the invitation
“What should we shape?”. After the first shaping request begins, the shell
transitions to a split workspace:

```text
┌──────────────────────────────────────────┬───────────────────────┐
│                                          │ Edit · Shaper         │
│                                          │                       │
│        generated interface canvas        │ conversation          │
│        or validated preview              │ activity and errors   │
│                                          │                       │
│                                          │ role-aware composer   │
│                                          │ revision decisions    │
└──────────────────────────────────────────┴───────────────────────┘
```

The right rail shows the same Shaper conversation context and retains the
draft, selected model, operation state, and focus. The transition must not
remount the active composer or clear user input merely to achieve the new
layout.

The interface canvas becomes the primary surface. The rail supports the work
rather than competing with it.

### Preview and acceptance

Shaper output remains untrusted until the existing Effect shaping kernel
validates it. A valid candidate appears on the main canvas as a preview.

While a preview awaits a decision, the rail shows:

- a clear “Preview” state;
- **Keep change** and **Reject** actions;
- the active proposal’s attributable summary when available;
- build, validation, or isolation failure information; and
- deterministic rollback and safe-mode access.

The accepted interface is unchanged until **Keep change** succeeds. Rejecting
restores the accepted canvas without leaving Edit mode. Keeping a revision
also leaves the user in Edit mode so follow-up shaping remains coherent.
**Use app** explicitly switches to Run mode and the App Agent.

### Separate visible histories for separate trust domains

App Agent and Shaper continue to use separate Pi sessions and separate
conversation histories. The rail component is shared, but its content is
role-scoped.

When the user switches roles:

- the current role’s draft and scroll position are retained;
- the destination role’s history becomes visible;
- the label and available capabilities update before the next send; and
- an active operation must be stopped or reach a terminal state before the
  transition completes.

The UI must never visually imply that one role performed an operation owned by
the other.

## Interaction design

### Empty Edit state

The empty state contains only:

- the Flect wordmark and protected status controls;
- the invitation “What should we shape?”;
- a T3 Code-quality multiline composer;
- compact actions for attachments or capabilities that actually exist;
- an **Edit · Shaper** role control;
- the Pi provider/model picker; and
- send, stop, runtime, and authentication states.

The composer placeholder is “Build, change, or connect anything”.

Unavailable features do not appear as ornamental controls. Voice, attachments,
connections, extensions, and capability controls are shown only when backed by
an implemented action.

### Docked rail

On wide screens, the rail is an inline sibling of the canvas, not a fixed
overlay. Its default width is 400 CSS pixels, resizable within 340–520 pixels,
and persisted as a local protected-shell preference.

The rail contains:

1. a compact header with role, runtime state, mode switch, collapse, and safe
   mode;
2. a scrollable message and activity timeline;
3. proposal, failure, permission, and recovery banners adjacent to the event
   they concern;
4. revision decisions when a preview is active; and
5. the composer anchored at the bottom.

The composer uses T3 Code’s proven structural pattern:

- one rounded input surface;
- a multiline editor above a compact action rail;
- actions and role/model controls grouped on the left;
- send or stop on the right;
- bounded growth and internal scrolling;
- responsive control compaction; and
- complete keyboard and focus behavior.

Flect adapts this structure to `DESIGN.md`. It does not copy T3 Code’s project,
worktree, terminal, coding-mode, or cloud-account controls.

### Run mode

Run mode gives the App Agent the same high-quality rail and composer but removes
authoring-only controls. It presents approved product capabilities and current
context in plain language.

The active interface remains usable when the rail is collapsed. A protected
agent button reopens it. A customizable capsule may render its own agent
surface, but it cannot remove the protected fallback entry.

### Responsive behavior

- At 981 CSS pixels and above, the canvas and inline rail share the window.
- From 761–980 pixels, the rail opens as a right sheet over the canvas and
  retains the same component state.
- At 760 pixels and below, the rail becomes a full-height mobile sheet with
  safe-area insets and a compact header.
- Collapsing the rail returns all available width to the canvas.
- The initial centered composer remains usable at every supported width.

No breakpoint creates a second composer instance or a second application
workflow.

### Motion

The initial composer moves into the rail using a short FLIP-style transform
between measured positions. The transition lasts at most 240 milliseconds and
uses an ease-out curve. Opacity remains stable; the composer does not dissolve
and reappear.

With `prefers-reduced-motion: reduce`, the layout changes immediately without
the transform. Continuous ambient animation is prohibited.

## Visual design

The shell keeps Flect’s “Midnight Drafting Desk” system:

- near-black canvas and tonal surfaces;
- SF system typography;
- restrained 8–16 pixel radii;
- structural hairlines rather than decorative borders;
- elevation only for the focused composer, menus, and responsive sheet; and
- Flect Rose only for focus, selected role, active shaping, and primary
  revision decisions.

The docked rail uses a slightly distinct canvas tone and a single structural
left divider. It is not a floating glass card. The interface preview receives
the largest uninterrupted area and no decorative browser or macOS window
frame.

The result should carry T3 Code’s density, composer confidence, legibility, and
responsive discipline while remaining recognizably Flect.

## Component boundaries

### `RoleAwareShell`

Owns protected layout selection and coordinates canvas, rail, mode controls,
and safe-mode entry. It consumes application state through the existing Effect
runtime and does not own Pi, shaping, or revision logic.

### `AgentRail`

Renders one role-scoped timeline, revision controls, errors, and the shared
composer. It receives a role-specific controller and never decides which Pi
session receives a message.

### `RoleAwareComposer`

Replaces the current generic composer without becoming a business-logic
service. It owns draft input, sizing, menus, focus, and keyboard interaction.
It delegates send, stop, model selection, mode selection, and supported actions
to typed handlers.

### `WorkspaceCanvas`

Renders the accepted or previewed validated `InterfaceDocument`. It has no
direct access to Pi sessions, raw model output, or interface persistence.

### `ShellPreferences`

An Effect service owns protected local preferences such as rail width,
collapsed state, and model favorites. Boundary data uses Effect Schema.
Invalid preference state falls back to documented defaults and cannot affect
safe mode.

### Role controllers

The React shell receives distinct App Agent and Shaper controllers from the
application runtime:

- App Agent exposes its role-scoped messages, model, submit, stop, and
  capability metadata.
- Shaper exposes its role-scoped conversation, request, stop, proposal,
  preview, keep, reject, rollback, validation, build, and isolation state.

Promise-shaped React callbacks remain thin adapters around named Effect
workflows. No new parallel application state machine is introduced in React.

## Data and state flow

### First shape

1. `RoleAwareShell` derives that the workspace is blank.
2. It selects Edit mode regardless of a persisted non-safe preference.
3. The centered composer submits to the Shaper controller.
4. The Shaper operation enters the existing typed runtime stream.
5. The shell enters split layout while preserving the composer instance.
6. Text, tool activity, validation, and terminal state append to the
   role-scoped Shaper timeline.
7. A valid candidate enters the existing proposal and preview flow.
8. The canvas renders the preview and the rail exposes explicit decisions.
9. Keep, reject, or rollback runs through the existing Effect shaping kernel.

### Product experience

1. The kernel restores a valid accepted experience or product capsule.
2. `RoleAwareShell` selects Run mode unless safe mode or an active unresolved
   preview requires Edit mode.
3. The rail displays the App Agent history and capabilities.
4. **Edit interface** explicitly selects Shaper and reveals its separate
   history.

### Mode transitions

Mode selection is a typed Effect workflow that validates whether a role
operation is active. A blocked transition leaves the current mode intact and
announces the required recovery action. Successful selection changes only
protected shell state; it does not mutate the accepted interface document.

## Failure and recovery

- Pi unavailable: the current interface remains usable; the rail explains how
  to authenticate or retry and keeps safe mode and rollback available.
- Shaper failure: the accepted canvas remains unchanged and the rail preserves
  the failed instruction for retry.
- Invalid candidate: no preview replaces the canvas; the validation failure is
  shown in Edit history.
- Preview decision failure: the preview and decision controls remain available
  unless deterministic reconciliation proves the proposal invalid.
- Invalid shell preference: use the default rail width, expanded state, and
  role derived from workspace state.
- Invalid customized interface: fail closed to the compiled safe launcher.
- Broken custom agent surface: the protected fallback rail remains reachable.
- Narrow-screen sheet failure: the protected compact composer remains
  available; layout preference cannot block agent or recovery access.

Guardian remains advisory and separate. It does not own the rail, choose a
role, accept a revision, or mutate preferences.

## Accessibility

The redesign targets WCAG 2.2 AA and preserves native semantics:

- every icon-only control has an accessible name;
- role selection exposes current state and is keyboard operable;
- the rail has a labelled complementary landmark;
- the message timeline uses appropriate log/status semantics without
  over-announcing streaming tokens;
- opening a sheet moves focus inside and closing it restores focus;
- collapsing the rail restores focus to its protected reopen control;
- resizing has keyboard controls and a labelled separator;
- errors are connected to the composer or decision they block;
- disabled actions expose their reason;
- focus is never lost during the centered-to-docked transition;
- Escape dismisses menus and responsive sheets but never silently rejects a
  preview; and
- reduced motion, contrast, zoom, text reflow, and touch target requirements
  are covered in automated and real-browser checks.

## T3 Code adaptation and attribution

T3 Code commit `d19039aeef6942e6eb204856c43b5354c0333e2d` is the
primary local reference. Flect may adapt its composer surface hierarchy,
responsive footer rules, model menu behavior, keyboard traversal, scroll
fades, send/stop states, and position-transition technique.

Copied or substantially adapted source must retain the applicable T3 Code
copyright and MIT license notice in Flect’s third-party notices and, where
appropriate, in source comments. Flect must not imply that T3 Code endorses
Flect.

The following T3 Code concepts remain out of scope for this shell:

- repository and project sidebars;
- branches, worktrees, commits, and changed-file controls;
- terminal and file mentions;
- coding-agent interaction modes;
- cloud connection and account UI; and
- plans, review comments, and approval workflows without matching Flect
  capabilities.

## Testing

### Component and Effect tests

Tests must prove observable behavior:

- blank workspaces route the centered composer to Shaper;
- product experiences route the rail to App Agent;
- the first shape transitions to the inline rail without losing draft, focus,
  selected model, or composer identity;
- mode changes reveal separate role histories and never cross-submit;
- active operations block unsafe role transitions;
- preview decisions use the existing shaping kernel;
- rail collapse, reopen, width persistence, and invalid preference recovery;
- model menus, send, stop, disabled, busy, retry, and authentication states;
- keyboard traversal, focus restoration, accessible names, and reduced motion;
  and
- responsive inline, sheet, and mobile layouts.

Every new behavior follows red-green-refactor with the smallest relevant test.

### Real Chromium

Production Chromium tests cover:

1. blank launch;
2. a real streamed Shaper request through the browser transport;
3. centered-to-right-rail transition;
4. validated preview on the canvas;
5. keep, reject, and rollback;
6. explicit switch to App Agent;
7. a real App Agent turn with its separate history;
8. model selection and stop;
9. rail collapse and responsive sheet behavior;
10. safe-mode recovery; and
11. keyboard-only completion of the primary flow.

Screenshots are captured at the empty Edit state, preview state, accepted Run
state, and narrow sheet state. Tests assert rendered state and interaction,
not source text.

### Packaged macOS

The release build must be installed and exercised as the Tauri application,
not only through Vite. Native verification proves:

- the compiled sidecar starts;
- Pi provider/model state appears;
- Shaper and App Agent turns use private RPC;
- the adaptive shell renders and responds at normal and narrow window sizes;
- safe mode remains reachable;
- the app restarts into the correct role for blank and accepted workspaces;
  and
- the installed application stays running after the primary smoke flow.

## Documentation and media

Implementation updates:

- `DESIGN.md` to make the adaptive canvas and rail normative;
- `ARCHITECTURE.md` only after the behavior exists;
- `README.md` to describe the actual first-run and Run/Edit interaction;
- screenshots for empty Edit, active preview, and accepted Run states;
- the short demo video to show the composer moving right while the generated
  UI appears; and
- release notes and third-party notices for the T3 Code adaptation.

Generated media must come from the verified production build and must not
expose prompts, credentials, provider payloads, or private paths.

## Non-goals

This redesign does not:

- introduce arbitrary generated React execution;
- implement `.flect` capsules, OPFS Git, or product capability adapters that
  are still future work;
- merge Guardian, Shaper, and App Agent trust domains;
- grant new shell, filesystem, network, credential, or native authority;
- port T3 Code’s project-management or coding-specific UI; or
- make the customizable rail responsible for protected recovery.

## Acceptance

The redesign is complete only when:

- a blank installed Flect app accepts a shaping instruction in the initial
  composer with no separate Shaper-opening step;
- that same visible composer docks right while the validated UI appears on the
  main canvas;
- preview, keep, reject, rollback, mode, model, send, stop, error, and recovery
  states are complete and accessible;
- accepted product experiences open in Run mode and Edit mode remains explicit;
- App Agent and Shaper histories and authority remain visibly separate;
- the old fixed Shaper overlay is removed from the primary flow;
- responsive inline, sheet, collapsed, and reduced-motion behavior is verified;
- Effect remains the application and UI-shaping architecture;
- current unit, integration, Chromium, Rust, and native release gates pass;
- screenshots, demo media, docs, attribution, and release packaging reflect the
  new shell;
- the verified result is committed and pushed to `akua-dev/flect` `main`; and
- the resulting macOS app is installed and open locally.
