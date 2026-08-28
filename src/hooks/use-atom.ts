import { Layer, type ManagedRuntime } from 'effect';
import { type Atom, AtomRegistry } from 'effect/unstable/reactivity';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The thin React bridge between flect's Effect kernel and React rendering,
 * built on Effect's built-in `Atom` reactivity (`effect/unstable/reactivity`).
 *
 * This is the standard UI-state bridge for flect's own UI going forward -
 * see `.agents/skills/flect-ui-state/SKILL.md`. It replaces the hand-rolled
 * `SubscriptionRef` + `useState` + `Stream.runForEach` pattern one bounded
 * surface at a time; existing surfaces on the interim pattern keep working
 * unchanged until they are migrated.
 *
 * Design:
 * - one process-wide `AtomRegistry` (`defaultAtomRegistry`) backs atoms built
 *   from flect's `ManagedRuntime` instances, mirroring the single managed
 *   runtime already wired in `src/lib/runtime.ts`;
 * - `useAtomValue`/`useAtomSet`/`useAtom` are `useSyncExternalStore`
 *   adapters over that registry - no Suspense, no thrown promises;
 * - async atoms (built from an `Effect` or `Stream`) resolve to
 *   `AsyncResult<A, E>` values with explicit `Initial`/`Success`/`Failure`
 *   states (plus a `waiting` flag) that callers pattern-match, matching the
 *   library's result-state philosophy instead of throwing or suspending.
 */

/**
 * The registry that stores flect's Atom state and reactive dependency graph.
 * One instance is enough for the whole app; tests may construct and pass
 * their own registry to keep state isolated between cases.
 */
export const defaultAtomRegistry: AtomRegistry.AtomRegistry = AtomRegistry.make();

/**
 * Adapts a flect `ManagedRuntime` into the `Layer` that `Atom.runtime`
 * expects, so atoms can be built against the exact same Layer-composed
 * services the app's managed runtimes already resolve (see
 * `src/lib/runtime.ts`). The runtime's context is built once and cached by
 * `ManagedRuntime` itself; this only adapts the shape.
 */
export function layerFromManagedRuntime<R, E>(
	runtime: ManagedRuntime.ManagedRuntime<R, E>
): Layer.Layer<R, E> {
	return Layer.effectContext(runtime.contextEffect);
}

/**
 * Reads and subscribes to an atom's current value through a registry.
 *
 * For atoms built from an `Effect` or `Stream` (via `Atom.make`/`.fn`/
 * `.subscriptionRef`), the returned value is an `AsyncResult<A, E>` -
 * pattern-match it (`AsyncResult.isInitial`/`isSuccess`/`isFailure`, or
 * `AsyncResult.match`) instead of expecting a resolved `A`.
 */
export function useAtomValue<A>(
	atom: Atom.Atom<A>,
	registry: AtomRegistry.AtomRegistry = defaultAtomRegistry
): A {
	const subscribe = useCallback(
		(onStoreChange: () => void) => registry.subscribe(atom, onStoreChange),
		[atom, registry]
	);
	const getSnapshot = useCallback(() => registry.get(atom), [atom, registry]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns a stable setter for a writable atom. For command atoms built with
 * `.fn`, the argument is the command's input (or `Atom.Reset` /
 * `Atom.Interrupt`); the atom's value (read with `useAtomValue`) then
 * reports the command's `AsyncResult` state.
 */
export function useAtomSet<R, W>(
	atom: Atom.Writable<R, W>,
	registry: AtomRegistry.AtomRegistry = defaultAtomRegistry
): (value: W) => void {
	return useCallback((value: W) => registry.set(atom, value), [atom, registry]);
}

/** Combines `useAtomValue` and `useAtomSet` for a writable atom. */
export function useAtom<R, W>(
	atom: Atom.Writable<R, W>,
	registry: AtomRegistry.AtomRegistry = defaultAtomRegistry
): readonly [R, (value: W) => void] {
	return [useAtomValue(atom, registry), useAtomSet(atom, registry)] as const;
}

/** Returns a stable callback that forces an atom to recompute. */
export function useAtomRefresh<A>(
	atom: Atom.Atom<A>,
	registry: AtomRegistry.AtomRegistry = defaultAtomRegistry
): () => void {
	return useCallback(() => registry.refresh(atom), [atom, registry]);
}
