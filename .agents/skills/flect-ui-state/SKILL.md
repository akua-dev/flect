---
name: flect-ui-state
description: Use this skill when building or changing any Flect UI part - React components, hooks, workspace state wiring, or reactive bridges between the Effect kernel and rendering. It owns the recommended practices for UI state in this repository, including the current SubscriptionRef-to-React bridge pattern and the adoption plan for Effect Atom.
---

# Flect UI state practices

Flect's UI is a thin rendering layer over an Effect application kernel. These
rules keep it that way.

## Non-negotiable rules

1. **Effect is the architecture.** Every workflow, data access, transport, and
   long-lived state lives behind Effect services and Layers. Follow
   `.agents/skills/effect-ts/SKILL.md` and the repository `AGENTS.md` before
   this skill.
2. **React renders; it does not own application state.** Components may hold
   ephemeral interaction state only (open/closed, focus, in-progress text).
   Everything else is a projection of `FlectWorkspaceController` snapshots or
   another Effect-owned `SubscriptionRef`.
3. **One state authority per concern.** Never mirror controller state into
   React state, contexts, or module singletons. Subscribe and project.
4. **Event handlers are adapters.** A handler converts a DOM event into one
   typed controller command (or one Effect run through the managed runtime)
   and nothing else. No orchestration, retries, or fan-out in components.
5. **No direct platform imports in components.** `@tauri-apps/api/*`, storage,
   and network enter only through named Effect capabilities and Layers.
6. **Budgets are part of the definition of done.** New UI must keep
   `bun run check:bundle` green; large optional surfaces load lazily behind
   the existing dynamic boundaries.

## Current bridge pattern (SubscriptionRef -> React)

Until the Effect Atom adoption below is possible, bridge Effect state into
React exactly the way `src/hooks/use-agent-session.ts` and `src/app.tsx` do:

- the kernel exposes `snapshot: Effect<...>` plus `changes: Stream<...>` from a
  `SubscriptionRef`;
- one hook subscribes through the managed runtime, stores the latest snapshot
  with `useState`, and cleans up via fiber interruption on unmount;
- derived controller objects are memoized from the snapshot; and
- commands go back through `controller.dispatch` / typed service methods,
  never by mutating the snapshot.

Do not hand-roll additional subscription mechanisms, polling, or event
emitters beside this pattern.

## Effect Atom: direction and current blocker

[`@effect-atom/atom` and `@effect-atom/atom-react`](https://github.com/tim-smart/effect-atom)
provide exactly the missing piece between the Effect kernel and React:
reactive atoms that wrap Effects, Streams, and services, with `useAtomValue` /
`useAtomSet` hooks, built-in pending/error result states, and a registry that
composes with Layers at the runtime edge.

**Decision (2026-08-27):** adopt Effect Atom as the standard UI-state bridge
and make it the strict rule for new React state wiring **once it supports the
Effect major that Flect pins**. As of this writing `@effect-atom/atom-react`
0.7.0 peer-depends on `effect ^3.22.1` while Flect pins `effect
4.0.0-beta.102`, so adoption is blocked upstream. Do not add the dependency
while the peer range conflicts.

When the blocker clears:

1. add the exact-pinned packages beside the other pinned Effect packages;
2. build atoms over the existing `FlectWorkspaceController` snapshot stream
   (one atom per bounded projection, not one giant atom);
3. replace the hand-rolled subscription code in `use-agent-session.ts` first,
   behind the same exported controller interface, so components do not churn;
4. keep commands flowing through the controller - atoms are read projections
   plus thin writable adapters, never a second state authority; and
5. update this skill to make Atom the mandatory pattern and retire the manual
   bridge section above.

Until then, treat "should we use Atom here?" as answered: not yet, for the
compatibility reason above, and the manual bridge pattern is the rule.
