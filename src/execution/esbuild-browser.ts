import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";

let initialization: Promise<void> | undefined;
let moduleLoad: Promise<typeof import("esbuild-wasm")> | undefined;

export const loadBrowserEsbuild = async () => {
  moduleLoad ??= import("esbuild-wasm");
  const esbuild = await moduleLoad;
  if (typeof window !== "undefined") {
    initialization ??= esbuild.initialize({
      wasmURL: new URL(esbuildWasmUrl, window.location.href).href,
      worker: true,
    });
    await initialization;
  }
  return esbuild;
};
