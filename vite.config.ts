import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const browserExecutionHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "node:zlib": fileURLToPath(
        new URL("./src/shell/disabled-node-zlib.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    headers: browserExecutionHeaders,
    proxy: {
      "/api": "http://127.0.0.1:3210",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    headers: browserExecutionHeaders,
    proxy: {
      "/api": "http://127.0.0.1:3210",
    },
  },
});
