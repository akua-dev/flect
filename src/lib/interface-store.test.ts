import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { defaultInterfaceDocument, InterfaceDocument } from '../../shared/interface-document';
import {
	consumeLegacyInterfaceDocument,
	InterfaceStorage,
	InterfaceStorageError,
	type InterfaceStorageShape,
	loadInterfaceDocument
} from './interface-store';

const withStorage = <A, E>(
	read: InterfaceStorageShape['read'],
	effect: Effect.Effect<A, E, InterfaceStorage>
) =>
	effect.pipe(
		Effect.provide(
			Layer.succeed(InterfaceStorage)({
				read,
				write: () => Effect.void,
				remove: () => Effect.void
			})
		)
	);

describe('loadInterfaceDocument', () => {
	it.effect('does not read user state in safe mode', () => {
		const read = vi.fn(() => Effect.succeed('must not be read'));
		return withStorage(
			read,
			Effect.gen(function* () {
				const document = yield* loadInterfaceDocument({ safeMode: true });

				expect(document).toBe(defaultInterfaceDocument);
				expect(read).not.toHaveBeenCalled();
			})
		);
	});

	it.effect('falls back when stored state is malformed', () => {
		const read = vi.fn(() => Effect.succeed('{bad json'));
		return withStorage(
			read,
			Effect.gen(function* () {
				const document = yield* loadInterfaceDocument({ safeMode: false });
				expect(document).toBe(defaultInterfaceDocument);
			})
		);
	});

	it.effect('loads valid version-one state from the only supported key', () => {
		const read = vi.fn(() =>
			Effect.succeed(
				JSON.stringify({
					version: 2,
					name: 'Where should we begin?',
					root: {
						id: 'root',
						type: 'stack',
						direction: 'column',
						gap: 'lg',
						children: [
							{
								id: 'headline',
								type: 'text',
								text: 'Where should we begin?',
								style: 'headline'
							},
							{
								id: 'prompt',
								type: 'prompt',
								placeholder: 'Describe an interface'
							}
						]
					}
				})
			)
		);
		return withStorage(
			read,
			Effect.gen(function* () {
				const document = yield* loadInterfaceDocument({ safeMode: false });

				expect(document).toEqual(
					InterfaceDocument.make({
						version: 2,
						name: 'Where should we begin?',
						root: {
							id: 'root',
							type: 'stack',
							direction: 'column',
							gap: 'lg',
							children: [
								{
									id: 'headline',
									type: 'text',
									text: 'Where should we begin?',
									style: 'headline'
								},
								{
									id: 'prompt',
									type: 'prompt',
									placeholder: 'Describe an interface'
								}
							]
						}
					})
				);
				expect(read).toHaveBeenCalledWith('flect.interface.v1');
			})
		);
	});

	it.effect('falls back when storage access itself fails', () => {
		const read = vi.fn(() =>
			Effect.fail(
				new InterfaceStorageError({
					message: 'Interface storage is unavailable.'
				})
			)
		);
		return withStorage(
			read,
			Effect.gen(function* () {
				const document = yield* loadInterfaceDocument({ safeMode: false });
				expect(document).toBe(defaultInterfaceDocument);
			})
		);
	});

	it.effect('does not restore legacy state after migration', () => {
		const read = vi.fn((key: string) =>
			Effect.succeed(key === 'flect.interface.v1.migrated' ? '1' : null)
		);
		return withStorage(
			read,
			Effect.gen(function* () {
				const document = yield* loadInterfaceDocument({ safeMode: false });

				expect(document).toBe(defaultInterfaceDocument);
				expect(read).toHaveBeenCalledWith('flect.interface.v1.migrated');
				expect(read).not.toHaveBeenCalledWith('flect.interface.v1');
			})
		);
	});

	it.effect('marks legacy state consumed after migration', () =>
		Effect.gen(function* () {
			const writes: Array<readonly [string, string]> = [];
			const removed: Array<string> = [];
			yield* consumeLegacyInterfaceDocument().pipe(
				Effect.provide(
					Layer.succeed(InterfaceStorage)({
						read: () => Effect.succeed(null),
						write: (key, value) =>
							Effect.sync(() => {
								writes.push([key, value]);
							}),
						remove: (key) =>
							Effect.sync(() => {
								removed.push(key);
							})
					})
				)
			);

			expect(writes).toEqual([['flect.interface.v1.migrated', '1']]);
			expect(removed).toEqual(['flect.interface.v1']);
		})
	);
});
