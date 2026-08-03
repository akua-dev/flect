import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@flect/product": fileURLToPath(
        new URL("./packages/product/src/index.ts", import.meta.url),
      ),
      "@flect/product/contracts": fileURLToPath(
        new URL("./packages/product/src/contracts.ts", import.meta.url),
      ),
      "@flect/product/host": fileURLToPath(
        new URL("./packages/product/src/host.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: [
      "cli/**/*.test.ts",
      "examples/**/*.test.ts",
      "packages/**/*.test.ts",
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
      "scripts/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/fixtures/**/*.test.ts",
      "tests/media/**/*.test.ts",
    ],
    restoreMocks: true,
  },
});
