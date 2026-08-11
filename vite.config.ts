import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

const browserBundleAnalysis = {
  name: "flect-browser-bundle-analysis",
  generateBundle(
    _options: unknown,
    bundle: Readonly<
      Record<
        string,
        {
          readonly type: string;
          readonly modules?: Readonly<
            Record<string, { readonly renderedLength: number }>
          >;
        }
      >
    >,
  ) {
    if (process.env.FLECT_ANALYZE_BROWSER_BUNDLE !== "1") return;
    for (const [fileName, value] of Object.entries(bundle)) {
      if (value.type !== "chunk" || value.modules === undefined) continue;
      if (!/\/(icons|workspace-entry|Schema)\./.test(fileName)) continue;
      console.log(
        JSON.stringify({
          type: "flect-browser-chunk",
          fileName,
          modules: Object.entries(value.modules)
            .map(([id, module]) => ({ id, bytes: module.renderedLength }))
            .sort((left, right) => right.bytes - left.bytes),
        }),
      );
    }
  },
};

const immutablePreviewAssets = {
  name: "flect-immutable-preview-assets",
  configurePreviewServer(server: {
    readonly middlewares: {
      use: (
        middleware: (
          request: { readonly url?: string },
          response: { setHeader: (name: string, value: string) => void },
          next: () => void,
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith("/assets/") === true) {
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      }
      next();
    });
  },
};

export const browserExecutionHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export const flectViteConfig = {
  envPrefix: ["PUBLIC_", "VITE_"],
  plugins: [
    react(),
    tailwindcss(),
    browserBundleAnalysis,
    immutablePreviewAssets,
  ],
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
} satisfies UserConfig;

export default defineConfig(flectViteConfig);
