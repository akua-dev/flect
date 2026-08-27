// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	NativeUpdateCandidate,
	NativeUpdateProgress,
	NativeUpdateSnapshot
} from '../../shared/native-update';
import { type NativeUpdateClient, useNativeUpdate } from './use-native-update';

afterEach(cleanup);

const candidate = NativeUpdateCandidate.make({
	version: '0.2.1',
	token: 'candidate-token-0001',
	notes: 'A focused update.',
	target: 'darwin-aarch64',
	contentLength: 2048
});

describe('useNativeUpdate', () => {
	it('projects explicit browser unavailability', async () => {
		const unavailable = NativeUpdateSnapshot.make({
			version: 1,
			state: 'unavailable',
			installedVersion: '0.2.0',
			reason: 'browser'
		});
		const client: NativeUpdateClient = {
			status: async () => unavailable,
			check: async () => unavailable,
			install: async () => unavailable,
			relaunch: async () => undefined
		};

		const { result } = renderHook(() => useNativeUpdate(client));
		await waitFor(() => expect(result.current.snapshot).toEqual(unavailable));

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeUndefined();
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
		const client: NativeUpdateClient = {
			status: vi.fn(async () => current),
			check: vi.fn(async () => available),
			install: vi.fn(async () => ready),
			relaunch: vi.fn(async () => undefined)
		};

		const { result } = renderHook(() => useNativeUpdate(client));
		await waitFor(() => expect(result.current.snapshot).toEqual(current));
		await act(() => result.current.check());
		expect(result.current.snapshot).toEqual(available);
		await act(() => result.current.install(candidate.token));
		expect(result.current.snapshot).toEqual(ready);
		await act(() => result.current.relaunch());

		expect(client.install).toHaveBeenCalledWith('candidate-token-0001');
		expect(client.relaunch).toHaveBeenCalledOnce();
	});

	it('uses fixed redacted failure copy', async () => {
		const client: NativeUpdateClient = {
			status: async () => {
				throw new Error('private key material must not escape');
			},
			check: async () => {
				throw new Error('https://private.example/token');
			},
			install: async () => {
				throw new Error('signature bytes');
			},
			relaunch: async () => {
				throw new Error('internal path');
			}
		};

		const { result } = renderHook(() => useNativeUpdate(client));
		await waitFor(() =>
			expect(result.current.error).toBe('Native update state could not be refreshed.')
		);
		await act(() => result.current.check());

		expect(result.current.error).toBe('Flect could not complete the requested update action.');
		expect(result.current.error).not.toContain('private');
		expect(result.current.error).not.toContain('token');
	});
});
