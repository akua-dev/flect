import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	desktopBuildCommand,
	type ReleaseTrustEvidence,
	validateReleaseLayout,
	validateReleaseTrustEvidence,
	validateVersionManifest
} from './package-release';

const root = resolve(import.meta.dirname, '..');

const versionFromJson = (path: string) => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return typeof value === 'object' &&
		value !== null &&
		'version' in value &&
		typeof value.version === 'string'
		? value.version
		: undefined;
};

const packageVersion = versionFromJson(resolve(root, 'package.json'));
const tauriVersion = versionFromJson(resolve(root, 'src-tauri/tauri.conf.json'));
const cargoManifest = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoPackageVersion = cargoManifest.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1];

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
	for (const path of temporaryDirectories.splice(0)) {
		await rm(path, { recursive: true, force: true });
	}
});

describe('release packaging', () => {
	const trustEvidence = (overrides: Partial<ReleaseTrustEvidence> = {}): ReleaseTrustEvidence => ({
		mode: 'development',
		reproducibilityVerified: false,
		source: { dirty: true, tag: undefined },
		architectures: {
			privateRuntime: 'arm64',
			publicExecutable: 'arm64'
		},
		signing: {
			gatekeeperAccepted: false,
			hardenedRuntime: true,
			kind: 'adhoc',
			stapled: false,
			teamIdentifier: undefined
		},
		...overrides
	});

	it('keeps every public version on 0.2.0', () => {
		expect(packageVersion).toBe('0.2.0');
		expect(cargoPackageVersion).toBe('0.2.0');
		expect(tauriVersion).toBe('0.2.0');
	});

	it('requests an explicit ad-hoc bundle signature only for development builds', () => {
		expect(desktopBuildCommand('development')).toEqual([process.execPath, 'run', 'build:desktop']);
		expect(desktopBuildCommand('public')).toEqual([
			process.execPath,
			'run',
			'build:desktop:public'
		]);
	});

	it('rejects a public version mismatch', async () => {
		await expect(
			Effect.runPromise(
				validateVersionManifest({
					packageVersion: '0.2.0',
					cargoVersion: '0.0.1',
					tauriVersion: '0.2.0'
				})
			)
		).rejects.toMatchObject({
			message: 'Every public Flect version must be 0.2.0.'
		});
	});

	it('rejects a missing sidecar, app, or DMG', async () => {
		const temporary = await mkdtemp(join(tmpdir(), 'flect-release-test-'));
		temporaryDirectories.push(temporary);
		const layout = {
			sidecar: resolve(temporary, 'flect-runtime'),
			app: resolve(temporary, 'Flect.app'),
			dmg: resolve(temporary, 'Flect.dmg')
		};

		await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
			message: 'The compiled Flect sidecar is missing.'
		});

		await writeFile(layout.sidecar, 'sidecar');
		await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
			message: 'The Flect application bundle is missing.'
		});

		await mkdir(layout.app);
		await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
			message: 'The Flect app does not contain its public executable.'
		});

		const appBinaries = resolve(layout.app, 'Contents', 'MacOS');
		await mkdir(appBinaries, { recursive: true });
		await writeFile(resolve(appBinaries, 'flect'), 'public executable');
		await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
			message: 'The Flect app does not contain its private runtime.'
		});
		await writeFile(resolve(appBinaries, 'flect-runtime'), 'runtime');
		await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
			message: 'The Flect DMG is missing.'
		});

		await writeFile(layout.dmg, 'dmg');
		await expect(Effect.runPromise(validateReleaseLayout(layout))).resolves.toBeUndefined();

		for (const obsolete of ['flect' + 'ctl', 'flect-' + 'mcp']) {
			await writeFile(resolve(appBinaries, obsolete), 'obsolete');
			await expect(Effect.runPromise(validateReleaseLayout(layout))).rejects.toMatchObject({
				message: 'The Flect app still contains an obsolete companion executable.'
			});
			await rm(resolve(appBinaries, obsolete));
		}
	});

	it('accepts honest hardened arm64 development evidence', async () => {
		await expect(
			Effect.runPromise(validateReleaseTrustEvidence(trustEvidence()))
		).resolves.toBeUndefined();
	});

	it('rejects a wrong executable architecture in every trust mode', async () => {
		await expect(
			Effect.runPromise(
				validateReleaseTrustEvidence(
					trustEvidence({
						architectures: {
							privateRuntime: 'arm64',
							publicExecutable: 'x86_64'
						}
					})
				)
			)
		).rejects.toMatchObject({
			message: 'Every shipped Flect executable must be arm64 only.'
		});
	});

	it('fails public release evidence closed at every trust boundary', async () => {
		const publicEvidence = trustEvidence({
			mode: 'public',
			reproducibilityVerified: true,
			source: { dirty: false, tag: 'v0.2.0' },
			signing: {
				gatekeeperAccepted: true,
				hardenedRuntime: true,
				kind: 'developer-id',
				stapled: true,
				teamIdentifier: 'A5H2QPFWV9'
			}
		});

		await expect(
			Effect.runPromise(validateReleaseTrustEvidence(publicEvidence))
		).resolves.toBeUndefined();

		const failures: ReadonlyArray<readonly [ReleaseTrustEvidence, string]> = [
			[
				{ ...publicEvidence, reproducibilityVerified: false },
				'A public Flect release requires independently verified reproducible content.'
			],
			[
				{ ...publicEvidence, source: { dirty: true, tag: 'v0.2.0' } },
				'A public Flect release requires a clean worktree at tag v0.2.0.'
			],
			[
				{
					...publicEvidence,
					signing: { ...publicEvidence.signing, kind: 'apple-development' }
				},
				'A public Flect release requires Developer ID Application signing.'
			],
			[
				{
					...publicEvidence,
					signing: {
						...publicEvidence.signing,
						teamIdentifier: undefined
					}
				},
				'A public Flect release requires a signing Team ID.'
			],
			[
				{
					...publicEvidence,
					signing: {
						...publicEvidence.signing,
						gatekeeperAccepted: false
					}
				},
				'Gatekeeper must accept a public Flect release.'
			],
			[
				{
					...publicEvidence,
					signing: { ...publicEvidence.signing, stapled: false }
				},
				'A public Flect release requires a stapled notarization ticket.'
			]
		];

		for (const [evidence, message] of failures) {
			await expect(Effect.runPromise(validateReleaseTrustEvidence(evidence))).rejects.toMatchObject(
				{ message }
			);
		}
	});

	it('requires hardened runtime in development and public artifacts', async () => {
		await expect(
			Effect.runPromise(
				validateReleaseTrustEvidence(
					trustEvidence({
						signing: {
							...trustEvidence().signing,
							hardenedRuntime: false
						}
					})
				)
			)
		).rejects.toMatchObject({
			message: 'Every Flect macOS artifact requires hardened runtime.'
		});
	});
});
