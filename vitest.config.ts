import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
      "scripts/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/media/**/*.test.ts",
    ],
    restoreMocks: true,
  },
});
