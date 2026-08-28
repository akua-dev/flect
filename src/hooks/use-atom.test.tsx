// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { AsyncResult, Atom, AtomRegistry } from 'effect/unstable/reactivity';
import {
	layerFromManagedRuntime,
	useAtom,
	useAtomRefresh,
	useAtomSet,
	useAtomValue
} from './use-atom';

afterEach(cleanup);

describe('useAtomValue/useAtomSet', () => {
	it('reads a writable atom and re-renders when it is written', async () => {
		const registry = AtomRegistry.make();
		const countAtom = Atom.make(0);

		const { result, unmount } = renderHook(() => ({
			value: useAtomValue(countAtom, registry),
			set: useAtomSet(countAtom, registry)
		}));

		expect(result.current.value).toBe(0);
		act(() => result.current.set(1));
		await waitFor(() => expect(result.current.value).toBe(1));

		unmount();
		registry.dispose();
	});

	it('useAtom combines value and setter for a writable atom', async () => {
		const registry = AtomRegistry.make();
		const labelAtom = Atom.make('idle');

		const { result, unmount } = renderHook(() => useAtom(labelAtom, registry));

		expect(result.current[0]).toBe('idle');
		act(() => result.current[1]('active'));
		await waitFor(() => expect(result.current[0]).toBe('active'));

		unmount();
		registry.dispose();
	});

	it('keeps separate registries isolated', () => {
		const registryA = AtomRegistry.make();
		const registryB = AtomRegistry.make();
		const sharedAtom = Atom.make('a');

		const { result: resultA, unmount: unmountA } = renderHook(() => useAtom(sharedAtom, registryA));
		const { result: resultB, unmount: unmountB } = renderHook(() => useAtom(sharedAtom, registryB));

		act(() => resultA.current[1]('changed-in-a'));

		expect(resultA.current[0]).toBe('changed-in-a');
		expect(resultB.current[0]).toBe('a');

		unmountA();
		unmountB();
		registryA.dispose();
		registryB.dispose();
	});
});

describe('useAtomValue with AsyncResult atoms', () => {
	it('resolves an Effect-backed atom to a Success result, never throwing or suspending', async () => {
		const registry = AtomRegistry.make();
		const greetingAtom = Atom.make(Effect.succeed('hello'));

		const { result, unmount } = renderHook(() => useAtomValue(greetingAtom, registry));

		expect(AsyncResult.isInitial(result.current) || AsyncResult.isSuccess(result.current)).toBe(
			true
		);
		await waitFor(() => expect(AsyncResult.isSuccess(result.current)).toBe(true));
		expect(AsyncResult.isSuccess(result.current) && result.current.value).toBe('hello');

		unmount();
		registry.dispose();
	});

	it('resolves a failing Effect-backed atom to a Failure result', async () => {
		const registry = AtomRegistry.make();
		const failingAtom = Atom.make(Effect.fail('boom'));

		const { result, unmount } = renderHook(() => useAtomValue(failingAtom, registry));

		await waitFor(() => expect(AsyncResult.isFailure(result.current)).toBe(true));

		unmount();
		registry.dispose();
	});

	it('useAtomRefresh reruns an Effect-backed atom on demand', async () => {
		const registry = AtomRegistry.make();
		let calls = 0;
		const countingAtom = Atom.make(
			Effect.sync(() => {
				calls += 1;
				return calls;
			})
		);

		const { result, unmount } = renderHook(() => ({
			value: useAtomValue(countingAtom, registry),
			refresh: useAtomRefresh(countingAtom, registry)
		}));

		await waitFor(() => expect(AsyncResult.isSuccess(result.current.value)).toBe(true));
		const first = AsyncResult.isSuccess(result.current.value) ? result.current.value.value : -1;
		expect(first).toBe(1);

		act(() => result.current.refresh());
		await waitFor(() => {
			const value = result.current.value;
			expect(AsyncResult.isSuccess(value) && value.value).toBe(2);
		});

		unmount();
		registry.dispose();
	});
});

class Greeter extends Context.Service<Greeter, { readonly greet: Effect.Effect<string> }>()(
	'test/Greeter'
) {}

describe('layerFromManagedRuntime', () => {
	it('lets an Atom.runtime read a service from an existing ManagedRuntime', async () => {
		const runtime = ManagedRuntime.make(
			Layer.succeed(Greeter)({ greet: Effect.succeed('Hello from the managed runtime') })
		);
		const registry = AtomRegistry.make();
		const atomRuntime = Atom.runtime(layerFromManagedRuntime(runtime));
		const greetingAtom = atomRuntime.atom(
			Effect.fn('Greeter.greet')(function* () {
				const greeter = yield* Greeter;
				return yield* greeter.greet;
			})
		);

		const { result, unmount } = renderHook(() => useAtomValue(greetingAtom, registry));

		await waitFor(() => expect(AsyncResult.isSuccess(result.current)).toBe(true));
		expect(AsyncResult.isSuccess(result.current) && result.current.value).toBe(
			'Hello from the managed runtime'
		);

		unmount();
		registry.dispose();
		await runtime.dispose();
	});
});
