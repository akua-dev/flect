import { Effect, Option, SubscriptionRef } from 'effect';
import { AsyncResult, Atom } from 'effect/unstable/reactivity';
import { useMemo } from 'react';
import { NativeUpdateProgress, type NativeUpdateSnapshot } from '../../shared/native-update';
import { type NativeUpdateRuntime, nativeUpdateRuntime } from '../lib/native-runtimes';
import { NativeUpdate } from '../lib/native-update';
import { layerFromManagedRuntime, useAtomRefresh, useAtomSet, useAtomValue } from './use-atom';

/**
 * Native update state and command atoms, scoped to one `NativeUpdateRuntime`.
 *
 * `snapshotAtom` is the single state-read atom other atoms and the hook
 * project from - it is seeded from `NativeUpdate.status` and then updated
 * directly by successful commands, mirroring the single-source-of-truth
 * snapshot the hand-rolled hook used to maintain by hand. `checkAtom`,
 * `installAtom`, and `relaunchAtom` are command atoms (`AtomRuntime.fn`):
 * writing to them runs the underlying Effect, and their own value reports
 * that command's `AsyncResult` (pending/success/failure) independent of the
 * shared snapshot.
 */
function makeNativeUpdateAtoms(runtime: NativeUpdateRuntime) {
	const atomRuntime = Atom.runtime(layerFromManagedRuntime(runtime));

	const snapshotAtom = atomRuntime.subscriptionRef(
		Effect.fn('NativeUpdateAtoms.snapshot')(function* () {
			const updates = yield* NativeUpdate;
			const initial = yield* updates.status;
			return yield* SubscriptionRef.make(initial);
		})
	);

	const checkAtom = atomRuntime.fn(
		// biome-ignore lint/suspicious/noConfusingVoidType: `void` is the `Atom.fn` no-argument convention - it lets `useAtomSet` callers write `runCheck()` instead of `runCheck(undefined)`.
		Effect.fn('NativeUpdateAtoms.check')(function* (_: void, get: Atom.FnContext) {
			const updates = yield* NativeUpdate;
			const snapshot = yield* updates.check;
			get.set(snapshotAtom, snapshot);
			return snapshot;
		})
	);

	const installAtom = atomRuntime.fn(
		Effect.fn('NativeUpdateAtoms.install')(function* (token: string, get: Atom.FnContext) {
			const current = get(snapshotAtom);
			if (
				AsyncResult.isSuccess(current) &&
				current.value.state === 'available' &&
				current.value.candidate.token === token
			) {
				const available = current.value;
				const downloading: NativeUpdateSnapshot = {
					version: 1,
					state: 'downloading',
					installedVersion: available.installedVersion,
					candidate: available.candidate,
					progress: NativeUpdateProgress.make({
						downloadedBytes: 0,
						...(available.candidate.contentLength === undefined
							? {}
							: { totalBytes: available.candidate.contentLength })
					})
				};
				get.set(snapshotAtom, downloading);
			}
			const updates = yield* NativeUpdate;
			const snapshot = yield* updates.install(token);
			get.set(snapshotAtom, snapshot);
			return snapshot;
		})
	);

	const relaunchAtom = atomRuntime.fn(
		Effect.fn('NativeUpdateAtoms.relaunch')(function* () {
			const updates = yield* NativeUpdate;
			yield* updates.relaunch;
		})
	);

	return { snapshotAtom, checkAtom, installAtom, relaunchAtom };
}

export interface NativeUpdateController {
	readonly snapshot: NativeUpdateSnapshot | undefined;
	readonly loading: boolean;
	readonly error: string | undefined;
	readonly refresh: () => void;
	readonly check: () => void;
	readonly install: (token: string) => void;
	readonly relaunch: () => void;
}

const refreshFailureMessage = 'Native update state could not be refreshed.';
const commandFailureMessage = 'Flect could not complete the requested update action.';

export function useNativeUpdate(
	runtime: NativeUpdateRuntime = nativeUpdateRuntime
): NativeUpdateController {
	const atoms = useMemo(() => makeNativeUpdateAtoms(runtime), [runtime]);

	const snapshotResult = useAtomValue(atoms.snapshotAtom);
	const checkResult = useAtomValue(atoms.checkAtom);
	const installResult = useAtomValue(atoms.installAtom);
	const relaunchResult = useAtomValue(atoms.relaunchAtom);

	const refresh = useAtomRefresh(atoms.snapshotAtom);
	const runCheck = useAtomSet(atoms.checkAtom);
	const runInstall = useAtomSet(atoms.installAtom);
	const runRelaunch = useAtomSet(atoms.relaunchAtom);

	// `snapshotAtom` is backed by a live `SubscriptionRef` (see
	// `makeNativeUpdateAtoms`), so its `AsyncResult` reports `waiting: true`
	// for as long as it stays subscribed - that flag means "still live", not
	// "still loading". Use `isInitial` for the one-time initial-load signal
	// instead, and reserve `isWaiting` for the command atoms, whose `waiting`
	// flag genuinely tracks an in-flight `check`/`install`/`relaunch` call.
	const loading =
		AsyncResult.isInitial(snapshotResult) ||
		AsyncResult.isWaiting(checkResult) ||
		AsyncResult.isWaiting(installResult) ||
		AsyncResult.isWaiting(relaunchResult);

	// A command failure is a more specific, more recent signal than a stale
	// initial-load failure, so it takes priority once any command has run.
	const error =
		AsyncResult.isFailure(checkResult) ||
		AsyncResult.isFailure(installResult) ||
		AsyncResult.isFailure(relaunchResult)
			? commandFailureMessage
			: AsyncResult.isFailure(snapshotResult)
				? refreshFailureMessage
				: undefined;

	return {
		snapshot: Option.getOrUndefined(AsyncResult.value(snapshotResult)),
		loading,
		error,
		refresh,
		check: () => runCheck(),
		install: (token: string) => runInstall(token),
		relaunch: () => runRelaunch()
	};
}
