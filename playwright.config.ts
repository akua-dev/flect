import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	retries: 0,
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:5173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: [
		{
			command:
				'FLECT_CONTROL_STATE_DIR=test-results/control-state FLECT_TEST_MODE=1 bun server/index.ts',
			url: 'http://127.0.0.1:3210/api/runtime',
			reuseExistingServer: false,
			timeout: 30_000
		},
		{
			command:
				'VITE_FLECT_TEST_MODE=1 VITE_FLECT_BUN_DIAGNOSTIC=1 VITE_FLECT_EXECUTION_DIAGNOSTIC=1 VITE_FLECT_GIT_DIAGNOSTIC=1 VITE_FLECT_CAPSULE_DIAGNOSTIC=1 VITE_FLECT_BUILD_DIAGNOSTIC=1 VITE_FLECT_PACKAGE_DIAGNOSTIC=1 VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC=1 VITE_FLECT_PRIVATE_SHARE_DIAGNOSTIC=1 bun run build && bun run preview -- --host 127.0.0.1 --port 5173',
			url: 'http://127.0.0.1:5173',
			reuseExistingServer: false,
			// This entry runs a full cold production build (build:product,
			// tsc -b, astro build, check:bundle) before the preview server
			// even starts listening, unlike the other webServer entry above.
			// 30s was tight enough that it only ever passed by accident of
			// a warm machine; measured timing out at 30s flat on a cold
			// ubuntu-latest GitHub Actions runner (flect-projection-staging
			// run 33166404614). This is a readiness timeout, not a
			// performance-budget assertion (those live in
			// tests/e2e/performance.spec.ts / shared/performance-budgets.ts
			// and are unaffected), so widening it does not weaken what a
			// green e2e run proves.
			timeout: 180_000
		}
	]
});
