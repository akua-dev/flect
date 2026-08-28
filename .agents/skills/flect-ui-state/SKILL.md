---
name: flect-ui-state
description: Use this skill when building or changing any Flect UI part - React components, hooks, workspace state wiring, or reactive bridges between the Effect kernel and rendering. It owns the recommended practices for UI state in this repository, including the Effect Atom bridge that is the standard for new state wiring and the legacy SubscriptionRef-to-React pattern it is replacing.
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
   Everything else is a projection of `FlectWorkspaceController` snapshots, an
   Atom built over an Effect service, or another Effect-owned
   `SubscriptionRef`.
3. **One state authority per concern.** Never mirror controller or atom state
   into a second React state, context, or module singleton. Subscribe and
   project.
4. **Event handlers are adapters.** A handler converts a DOM event into one
   typed controller command, one atom write, or one Effect run through the
   managed runtime, and nothing else. No orchestration, retries, or fan-out in
   components.
5. **No direct platform imports in components.** `@tauri-apps/api/*`, storage,
   and network enter only through named Effect capabilities and Layers.
6. **Budgets are part of the definition of done.** New UI must keep
   `bun run check:bundle` green; large optional surfaces load lazily behind
   the existing dynamic boundaries. `effect/unstable/reactivity` (Atom) is not
   free - if it pushes a chunk over budget, load the atoms module behind the
   same dynamic-`import()` boundary used elsewhere (see
   `src/lib/capsule-staging.ts`'s `loadFrameworkCapsulePackager`), rather than
   raising the limit.
7. **New React state wiring uses the Atom bridge.** Effect v4 ships Atom
   reactivity inside the `effect` package itself
   (`effect/unstable/reactivity`) - see "The Atom bridge" below. This is the
   strict rule for any *new* Effect-to-React state surface in flect's own UI.
   The `SubscriptionRef -> React` pattern below is legacy: existing surfaces
   on it may stay as they are, but do not copy that pattern into new code and
   do not extend it to cover more state.

## The Atom bridge (standard pattern)

**Effect v4 moved Atom into the core library.** There is no
`@effect-atom/atom` or `@effect-atom/atom-react` dependency in this repo, and
none should be added - `effect@4.0.0-beta.102` (the version this repo pins)
ships `Atom`, `AtomRegistry`, `AtomRef`, `AtomHttpApi`, `AtomRpc`,
`AsyncResult`, `Hydration`, and `Reactivity` directly under
`effect/unstable/reactivity`. The upstream
[tim-smart/effect-atom](https://github.com/tim-smart/effect-atom) README
describes the v3 (`@effect-atom/atom-react`) API and is useful for the
concepts (atoms wrap Effects/Streams/services; a registry runs and caches
them; results are exposed as pending/success/failure), but it is not the
API surface - the installed `.d.ts` files under
`node_modules/effect/dist/unstable/reactivity/` are the authority, and they
differ from the v3 README in real ways: no bundled React hooks (flect owns a
small bridge instead, see below), a different `AtomRuntime`/`Atom.runtime`
shape for wiring a `Layer`, and `AtomResultFn`/`AsyncResult` naming that does
not match `Rx`-era v3 docs one-for-one. Read the `.d.ts` files, not the
README, when the two disagree.

**The bridge:** `src/hooks/use-atom.ts` provides the thin, generic
`useAtomValue` / `useAtomSet` / `useAtom` / `useAtomRefresh` hooks over an
`AtomRegistry`, plus `layerFromManagedRuntime`, which adapts any of flect's
existing `ManagedRuntime` instances (see `src/lib/runtime.ts`) into the
`Layer` that `Atom.runtime(layer)` expects. This is how the bridge integrates
with flect's managed-runtime/Layer wiring instead of introducing a second
composition root:

```ts
import { Atom, AsyncResult } from 'effect/unstable/reactivity';
import { layerFromManagedRuntime, useAtomValue, useAtomSet } from '../hooks/use-atom';
import { someRuntime } from '../lib/some-runtime';
import { SomeService } from '../lib/some-service';

const atomRuntime = Atom.runtime(layerFromManagedRuntime(someRuntime));

// A state-read atom over an Effect-backed service.
const thingAtom = atomRuntime.atom(
  Effect.fn('SomeAtoms.thing')(function* () {
    return yield* (yield* SomeService).read;
  })
);

// A command atom - writing to it runs the Effect; its own value is the
// AsyncResult of that call.
const doThingAtom = atomRuntime.fn(
  Effect.fn('SomeAtoms.doThing')(function* (input: Input) {
    return yield* (yield* SomeService).doThing(input);
  })
);

function useThing() {
  const result = useAtomValue(thingAtom); // AsyncResult<Thing, Error>
  const doThing = useAtomSet(doThingAtom);
  return { result, doThing };
}
```

Consumers pattern-match the `AsyncResult<A, E>` explicitly
(`AsyncResult.isInitial` / `isSuccess` / `isFailure`, or `AsyncResult.match`)
instead of expecting a resolved value, throwing, or suspending - that is the
library's result-state philosophy and the bridge does not paper over it.
`AsyncResult`'s `waiting` flag means "still live/refreshing", not
"unresolved" - it stays `true` forever on a `subscriptionRef`-backed atom
that is actively subscribed, so use `AsyncResult.isInitial` for a one-time
"still loading" signal and reserve `AsyncResult.isWaiting` for atoms built
with `.fn` (commands), where it genuinely tracks one in-flight call.

**Pilot migration:** `src/hooks/use-native-update.ts` (consumed by
`src/components/diagnostics-panel.tsx`) is migrated to this pattern end to
end - a `subscriptionRef` atom for the live `NativeUpdateSnapshot` read, `.fn`
command atoms for `check`/`install`/`relaunch` that write their result back
into the shared snapshot atom, and `AsyncResult` states standing in for the
hand-rolled `loading`/`error` `useState` pair the old hook maintained by
hand. `src/hooks/use-atom.test.tsx` covers the bridge itself (jsdom +
`@testing-library/react` + `@effect/vitest`, mirroring
`src/components/ui/item.test.tsx`'s setup); `src/hooks/use-native-update.test.tsx`
covers the migrated surface against a test `NativeUpdate` `Layer`.

## Legacy bridge pattern (SubscriptionRef -> React)

`src/hooks/use-agent-session.ts`, `src/hooks/use-workspace.ts`, and
`src/app.tsx` still use the pre-Atom bridge and are not migrated by the pilot
above - they are large, load-bearing, and heavily tested, and migrating them
is future work, not a rule to imitate. The pattern:

- the kernel exposes `snapshot: Effect<...>` plus `changes: Stream<...>` from a
  `SubscriptionRef`;
- one hook subscribes through the managed runtime, stores the latest snapshot
  with `useState`, and cleans up via fiber interruption on unmount;
- derived controller objects are memoized from the snapshot; and
- commands go back through `controller.dispatch` / typed service methods,
  never by mutating the snapshot.

This is legacy, not deprecated-and-forbidden: it is allowed to keep running
where it already runs, but do not hand-roll a new instance of it, and do not
add more state to the surfaces that already have it. New state on those same
surfaces should be added as an Atom projection alongside the legacy snapshot,
not folded into the `useState`/`Stream.runForEach` subscription.
