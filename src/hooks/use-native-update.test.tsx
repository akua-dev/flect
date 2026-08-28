// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import {
	NativeUpdateCandidate,
	NativeUpdateError,
	NativeUpdateProgress,
	NativeUpdateSnapshot
} from '../../shared/native-update';
import type { NativeUpdateRuntime } from '../lib/native-runtimes';
import { NativeUpdate, type NativeUpdateShape } from '../lib/native-update';
import { useNativeUpdate } from './use-native-update';

afterEach(cleanup);

const candidate = NativeUpdateCandidate.make({
	version: '0.2.1',
	token: 'candidate-token-0001',
	notes: 'A focused update.',
	target: 'darwin-aarch64',
	contentLength: 2048
});

function fakeRuntime(shape: NativeUpdateShape): NativeUpdateRuntime {
	return ManagedRuntime.make(Layer.succeed(NativeUpdate)(shape));
}

describe('useNativeUpdate', () => {
	it('projects explicit browser unavailability', async () => {
		const unavailable = NativeUpdateSnapshot.make({
			version: 1,
			state: 'unavailable',
			installedVersion: '0.2.0',
			reason: 'browser'
		});
		const runtime = fakeRuntime({
			status: Effect.succeed(unavailable),
			check: Effect.succeed(unavailable),
			install: () => Effect.succeed(unavailable),
			relaunch: Effect.void
		});

		const { result, unmount } = renderHook(() => useNativeUpdate(runtime));
		await waitFor(() => expect(result.current.snapshot).toEqual(unavailable));

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeUndefined();
		unmount();
		await runtime.dispose();
	});

	it('serializes check, install, and relaunch transitions', async () => {
		const current = NativeUpdateSnapshot.make({
			version: 1,
			state: 'current',
			installedVersion: '0.2.0',
			checkedAtMillis: 1
		});
		const available = NativeUpdateSnapshot.make({
			version: 1,
			state: 'available',
			installedVersion: '0.2.0',
			candidate
		});
		const ready = NativeUpdateSnapshot.make({
			version: 1,
			state: 'ready-to-relaunch',
			installedVersion: '0.2.0',
			candidate,
			progress: NativeUpdateProgress.make({
				downloadedBytes: 2048,
				totalBytes: 2048
			})
		});
		let relaunched = false;
		const runtime = fakeRuntime({
			status: Effect.succeed(current),
			check: Effect.succeed(available),
			install: (token) =>
				token === candidate.token ? Effect.succeed(ready) : Effect.succeed(current),
			relaunch: Effect.sync(() => {
				relaunched = true;
			})
		});

		const { result, unmount } = renderHook(() => useNativeUpdate(runtime));
		await waitFor(() => expect(result.current.snapshot).toEqual(current));

		act(() => result.current.check());
		await waitFor(() => expect(result.current.snapshot).toEqual(available));

		act(() => result.current.install(candidate.token));
		await waitFor(() => expect(result.current.snapshot).toEqual(ready));

		act(() => result.current.relaunch());
		await waitFor(() => expect(relaunched).toBe(true));

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeUndefined();
		unmount();
		await runtime.dispose();
	});

	it('shows a downloading transition immediately after starting an install', async () => {
		const available = NativeUpdateSnapshot.make({
			version: 1,
			state: 'available',
			installedVersion: '0.2.0',
			candidate
		});
		const ready = NativeUpdateSnapshot.make({
			version: 1,
			state: 'ready-to-relaunch',
			installedVersion: '0.2.0',
			candidate,
			progress: NativeUpdateProgress.make({ downloadedBytes: 2048, totalBytes: 2048 })
		});
		let releaseInstall: (() => void) | undefined;
		const runtime = fakeRuntime({
			status: Effect.succeed(available),
			check: Effect.succeed(available),
			install: () =>
				Effect.callback<NativeUpdateSnapshot>((resume) => {
					releaseInstall = () => resume(Effect.succeed(ready));
				}),
			relaunch: Effect.void
		});

		const { result, unmount } = renderHook(() => useNativeUpdate(runtime));
		await waitFor(() => expect(result.current.snapshot).toEqual(available));

		act(() => result.current.install(candidate.token));
		await waitFor(() =>
			expect(result.current.snapshot).toEqual(
				NativeUpdateSnapshot.make({
					version: 1,
					state: 'downloading',
					installedVersion: '0.2.0',
					candidate,
					progress: NativeUpdateProgress.make({ downloadedBytes: 0, totalBytes: 2048 })
				})
			)
		);
		expect(result.current.loading).toBe(true);

		releaseInstall?.();
		await waitFor(() => expect(result.current.snapshot).toEqual(ready));

		unmount();
		await runtime.dispose();
	});

	it('surfaces fixed redacted failure copy on refresh and command failures', async () => {
		const secretFailure = () =>
			NativeUpdateError.make({
				reason: 'invalid-manifest',
				message: 'private key material must not escape'
			});
		const runtime = fakeRuntime({
			status: Effect.fail(secretFailure()),
			check: Effect.fail(secretFailure()),
			install: () => Effect.fail(secretFailure()),
			relaunch: Effect.fail(secretFailure())
		});

		const { result, unmount } = renderHook(() => useNativeUpdate(runtime));
		await waitFor(() =>
			expect(result.current.error).toBe('Native update state could not be refreshed.')
		);

		act(() => result.current.check());
		await waitFor(() =>
			expect(result.current.error).toBe('Flect could not complete the requested update action.')
		);
		expect(result.current.error).not.toContain('private');
		expect(result.current.error).not.toContain('key');

		unmount();
		await runtime.dispose();
	});
});
