export const isNativeHost = (
  location:
    | Pick<Location, "hostname" | "protocol">
    | undefined = globalThis.location,
) =>
  Reflect.get(globalThis, "isTauri") === true ||
  "__TAURI_INTERNALS__" in globalThis ||
  location?.protocol === "tauri:" ||
  location?.hostname === "tauri.localhost";
