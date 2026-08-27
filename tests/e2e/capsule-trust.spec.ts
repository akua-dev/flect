import { expect, test } from '@playwright/test';
import { Schema } from 'effect';
import { CapsuleTrustDiagnosticResult } from '../../shared/capsule-trust-diagnostic';

test('verifies canonical capsule trust identically in production Chromium', async ({ page }) => {
	await page.goto('/?capsule-trust-diagnostic=1');
	const output = page.getByTestId('capsule-trust-result');
	await expect(output).toHaveAttribute('data-state', 'complete');
	const result = await Schema.decodeUnknownPromise(CapsuleTrustDiagnosticResult)(
		JSON.parse((await output.textContent()) ?? 'null')
	);

	expect(result).toEqual({
		verified: 'verified',
		changed: 'changed-after-signing',
		forked: 'locally-forked',
		permissionAuthorityChanged: false
	});
});
