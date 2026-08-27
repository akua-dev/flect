import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { portablePackageManifest } from './portable-package-manifest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('portable package manifest', () => {
	it('keeps runtime dependencies but cannot execute scripts or development tools', async () => {
		const output = await Effect.runPromise(
			portablePackageManifest(
				encoder.encode(
					JSON.stringify({
						name: 'dashboard',
						version: '0.0.0',
						private: true,
						type: 'module',
						scripts: {
							build: 'vite build',
							postinstall: 'node ./download-binary.js'
						},
						dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
						devDependencies: { vite: '8.1.5' }
					})
				)
			)
		);

		expect(JSON.parse(decoder.decode(output))).toEqual({
			name: 'dashboard',
			version: '0.0.0',
			private: true,
			type: 'module',
			dependencies: { react: '19.2.8', 'react-dom': '19.2.8' }
		});
	});

	it('fails closed for non-string dependency specifications', async () => {
		const failure = await Effect.runPromise(
			portablePackageManifest(
				encoder.encode(JSON.stringify({ dependencies: { unsafe: { path: '../host' } } }))
			).pipe(Effect.flip)
		);
		expect(failure.message).toContain('runtime dependencies');
	});
});
