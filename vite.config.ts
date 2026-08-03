import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const browserExecutionHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
  resolve: {
    alias: [
      {
        find: "@flect/product/contracts",
        replacement: fileURLToPath(
          new URL("./packages/product/src/contracts.ts", import.meta.url),
        ),
      },
      {
        find: "@flect/product/host",
        replacement: fileURLToPath(
          new URL("./packages/product/src/host.ts", import.meta.url),
        ),
      },
      {
        find: "@flect/product",
        replacement: fileURLToPath(
          new URL("./packages/product/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: "@shared",
        replacement: fileURLToPath(new URL("./shared", import.meta.url)),
      },
      {
        find: "node:zlib",
        replacement: fileURLToPath(
          new URL("./src/shell/disabled-node-zlib.ts", import.meta.url),
        ),
      },
    ],
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
