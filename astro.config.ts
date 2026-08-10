import { defineConfig } from "astro/config";
import { flectViteConfig } from "./vite.config";

export default defineConfig({
  output: "static",
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
