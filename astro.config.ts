import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";
import { flectIntegration } from "./src/astro/flect-integration";
import { flectViteConfig } from "./vite.config";

export default defineConfig({
  output: "static",
  integrations: [preact({ compat: true }), flectIntegration()],
  outDir: "./dist",
  build: {
    assets: "assets",
    inlineStylesheets: "never",
  },
  vite: {
    ...flectViteConfig,
    build: {
      ...flectViteConfig.build,
      assetsInlineLimit: 0,
    },
  },
});
