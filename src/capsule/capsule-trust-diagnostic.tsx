import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import {
	type CapsuleSource,
	decodeCapsule,
	encodeCapsule
} from '../../packages/product/src/capsule';
import {
	evaluateCapsuleTrustPolicy,
	forkCapsule,
	signCapsule,
	verifyCapsuleSignatures
} from '../../packages/product/src/capsule-trust';
import { CapsuleTrustDiagnosticResult } from '../../shared/capsule-trust-diagnostic';

const source = (): CapsuleSource => ({
	manifest: {
		formatVersion: 1,
		id: 'dev.akua.browser-signed',
		name: 'Browser signed',
		version: '1.0.0',
		entrypoints: [{ id: 'main', path: 'index.html' }],
		capabilities: [{ id: 'product:read', required: true }],
		compatibility: {
			flect: '>=0.2.0 <1.0.0',
			schemaVersion: 1,
			platforms: ['browser', 'macos']
		},
		provenance: {
			publisher: 'Browser fixture',
			source: 'local-diagnostic',
			revision: 'v1',
			builder: 'flect-diagnostic'
		},
		signatures: []
	},
	files: [
		{
			path: 'index.html',
			contents: new TextEncoder().encode('<main>Signed</main>')
		}
	]
});

const runDiagnostic = Effect.fn('CapsuleTrust.diagnostic')(function* () {
	const pair = yield* Effect.promise(() =>
		crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
	);
	const archive = yield* encodeCapsule(source());
	const signed = yield* signCapsule(archive, {
		keyId: 'browser:fixture',
		privateKey: pair.privateKey,
		signedAt: '2026-08-10T12:00:00.000Z'
	});
	const verified = yield* verifyCapsuleSignatures(signed, [
		{
			keyId: 'browser:fixture',
			publicKey: pair.publicKey,
			status: 'active'
		}
	]);
	const decoded = yield* decodeCapsule(signed);
	const { files: _files, ...manifest } = decoded.manifest;
	const changedArchive = yield* encodeCapsule({
		manifest: { ...manifest, name: 'Changed' },
		files: decoded.files
	});
	const changed = yield* verifyCapsuleSignatures(changedArchive, [
		{
			keyId: 'browser:fixture',
			publicKey: pair.publicKey,
			status: 'active'
		}
	]);
	const forkedArchive = yield* forkCapsule(signed, { revision: 'fork-2' });
	const forked = yield* verifyCapsuleSignatures(forkedArchive, []);
	const policy = evaluateCapsuleTrustPolicy(verified, {
		mode: 'require-verified'
	});
	if (
		verified.status !== 'verified' ||
		changed.status !== 'changed-after-signing' ||
		forked.status !== 'locally-forked'
	) {
		return yield* Effect.fail(new Error('Capsule trust diagnostic failed.'));
	}
	return CapsuleTrustDiagnosticResult.make({
		verified: verified.status,
		changed: changed.status,
		forked: forked.status,
		permissionAuthorityChanged: policy.permissionAuthorityChanged
	});
});

export function CapsuleTrustDiagnostic() {
	const [result, setResult] = useState<CapsuleTrustDiagnosticResult | 'failed'>();
	useEffect(() => {
		const controller = new AbortController();
		void Effect.runPromise(runDiagnostic(), { signal: controller.signal }).then(setResult, () =>
			setResult('failed')
		);
		return () => controller.abort();
	}, []);
	return (
		<main>
			<h1>Capsule trust diagnostic</h1>
			<pre
				data-state={result === undefined ? 'running' : result === 'failed' ? 'failed' : 'complete'}
				data-testid='capsule-trust-result'
			>
				{result === undefined ? 'running' : result === 'failed' ? 'failed' : JSON.stringify(result)}
			</pre>
		</main>
	);
}
