# ADR 0005: Conversationally authored web apps accept as local revisions

- **Status:** Accepted and implemented
- **Date:** 2026-08-27

## Context

Flect had two disjoint canvas paths:

1. Conversational shaping produced only the closed declarative
   `InterfaceDocument` node set, rendered by the trusted React renderer inside
   the shell DOM. The result inherited shell tokens, the shell background, a
   980 px centered column, and dark-mode inversion. A request such as "make me
   a landing page website" could not produce something that looked like a
   website.
2. Compiled web apps (imported projects and installed capsules) rendered in a
   true isolated browsing context: an opaque-origin `allow-scripts` iframe
   with a deny-by-default CSP, its own light `color-scheme`, and a bounded
   typed message bridge. This path was reachable only through user-initiated
   import, and always ended in an explicit Activate/Discard candidate.

The desktop host is a WebView and the browser host is a browser: a real
browser engine is always present. Using it as the app surface means authored
experiences get real HTML and CSS semantics, user-agent defaults, their own
viewport and visual ground, and no shell style bleed, without reinventing any
of that inside the shell document.

## Decision

Shaper gains a second terminal proposal path. In one turn it may author
complete self-contained web source under `/workspace/project` in its
disposable sandbox and finish with the reserved, Shaper-only
`flect app validate` and `flect app propose` commands. The reserved command
packages the sandbox directory through the same bounded pre-capsule adapter
used by project import (path validation, secret/ignore rules, 255-file and
32 MiB limits, single root `index.html`, capability findings), then latches
the archive on the active turn exactly like a declarative proposal.

The controller stages the authored archive through the existing capsule
pipeline: manifest review, guarded `flect/authoring` source checkpoint,
`ProposalBuild`/`BrowserBuild` compilation for framework entrypoints, and the
compiled capsule presentation. It then finishes with **automatic local
acceptance** instead of an Activate/Discard candidate.

A conversationally authored app is classified as a local edit because:

- its authorship trust domain is identical to a declarative proposal (the
  user's own Shaper session responding to the user's request);
- its runtime confinement is strictly stronger than the declarative
  renderer's: it executes only inside the opaque-origin iframe with a
  network-denying CSP and no host authority, while declarative nodes render in
  the trusted shell DOM;
- it can carry no authority: the packaging adapter derives the manifest, and
  a review with blocked activation (for example a required `web:remote-network`
  finding) falls back to the explicit candidate ceremony instead of
  auto-accepting; and
- FQ-04.3 and FQ-06.1 require valid local UI edits to activate automatically
  without candidate ceremony, while FQ-06.3 reserves explicit decisions for
  imported shared artifacts, authority changes, and publication.

Undo, history, last-known-good rollback, and safe mode are unchanged: the
acceptance is one guarded Git transition whose commit carries the authored
source under `project/`, and the previous accepted presentation becomes
last-known-good.

## Consequences

- "Make me a landing page website" produces a real website in a true browser
  context, iterable in the same conversation, with no Keep/Reject ceremony.
- External artifacts keep their ceremony: import, share, and URL install still
  create explicit candidates; nothing in this path can grant authority.
- The Shaper generation timeout rose from 60 s to 180 s so real pages can be
  authored in one turn.
- The framework-capsule packager loads on demand so the staging pipeline does
  not grow the protected pre-tool workspace budget.
- The declarative node set remains the right tool for shell-native tool UIs
  and remains the fallback document for compiled apps in recovery.
- Static authored apps accept through a direct local transition (guarded
  authoring checkpoint plus `applyLocalRevision`), so no transient candidate
  state ever becomes visible. Framework-source authored apps still pass
  through the guarded proposal build before automatic acceptance, so their
  build progress remains visible; the transient preview state they publish is
  a known cosmetic limitation.
- The Shaper conversation currently reports "Change complete" when the turn's
  proposal latches, slightly before the controller finishes acceptance; a
  staging failure after that message surfaces only as a failed operation.
  Tightening that sequencing is follow-up work.
