import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "FLECT_CONTROL_STATE_DIR=test-results/control-state FLECT_TEST_MODE=1 bun server/index.ts",
      url: "http://127.0.0.1:3210/api/runtime",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "VITE_FLECT_TEST_MODE=1 VITE_FLECT_BUN_DIAGNOSTIC=1 VITE_FLECT_EXECUTION_DIAGNOSTIC=1 VITE_FLECT_GIT_DIAGNOSTIC=1 VITE_FLECT_CAPSULE_DIAGNOSTIC=1 VITE_FLECT_BUILD_DIAGNOSTIC=1 VITE_FLECT_PACKAGE_DIAGNOSTIC=1 VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC=1 VITE_FLECT_PRIVATE_SHARE_DIAGNOSTIC=1 bun run build && bun run preview -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
