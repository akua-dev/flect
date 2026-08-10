export interface FlectClientModule {
  readonly mountFlect: (root: HTMLElement) => Promise<void>;
}

export interface FlectActivationOptions {
  readonly document?: Document;
  readonly location?: Pick<Location, "href" | "hostname" | "protocol">;
  readonly testMode?: boolean;
  readonly desktop?: boolean;
  readonly load?: () => Promise<FlectClientModule>;
}

const diagnosticParameters = [
  "bun-diagnostic",
  "execution-diagnostic",
  "git-diagnostic",
  "git-transaction-diagnostic",
  "git-share-import-diagnostic",
  "git-share-lifecycle-diagnostic",
  "storage-reset-diagnostic",
  "capsule-diagnostic",
  "build-diagnostic",
  "package-diagnostic",
  "product-capability-diagnostic",
  "reference-product-diagnostic",
  "product-adoption-diagnostic",
] as const;

export const isFlectDesktop = (
  location: Pick<Location, "hostname" | "protocol"> = globalThis.location,
) =>
  "__TAURI_INTERNALS__" in globalThis ||
  location.protocol === "tauri:" ||
  location.hostname === "tauri.localhost";

export const shouldActivateFlectImmediately = ({
  href,
  testMode,
  desktop,
}: {
  readonly href: string;
  readonly testMode: boolean;
  readonly desktop: boolean;
}) => {
  const url = new URL(href);
  if (url.searchParams.get("view") === "1") return false;
  if (desktop || url.searchParams.get("safe") === "1") return true;
  if (testMode) return true;
  return diagnosticParameters.some(
    (parameter) => url.searchParams.get(parameter) === "1",
  );
};

const platformName = () => {
  const platform = globalThis.navigator?.platform.toLowerCase() ?? "";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "browser";
};

export const installFlectActivation = (
  options: FlectActivationOptions = {},
) => {
  const document = options.document ?? globalThis.document;
  const location = options.location ?? globalThis.location;
  const load = options.load ?? (() => import("../main"));
  const root = document.getElementById("root");
  const shell = document.getElementById("flect-static-shell");
  const status = document.getElementById("flect-activation-status");
  if (root === null || shell === null) {
    throw new Error("Flect could not find its activation shell.");
  }

  document.documentElement.dataset.platform = platformName();
  let activation: Promise<void> | undefined;
  const activate = () => {
    if (activation !== undefined) return activation;
    shell.setAttribute("aria-busy", "true");
    if (status !== null) status.textContent = "Opening Flect…";
    activation = load()
      .then(async ({ mountFlect }) => {
        await mountFlect(root);
        if (!root.hidden) shell.hidden = true;
        shell.removeAttribute("aria-busy");
        document.documentElement.dataset.flectState = "active";
      })
      .catch((error: unknown) => {
        activation = undefined;
        root.hidden = true;
        shell.removeAttribute("aria-busy");
        document.documentElement.dataset.flectState = "error";
        if (status !== null) {
          status.textContent =
            "Flect could not open. Your current view is still safe; try again.";
          status.setAttribute("role", "alert");
        }
        throw error;
      });
    return activation;
  };

  const activateSafely = () => {
    void activate().catch(() => undefined);
  };
  const activateFromTarget = (target: EventTarget | null) => {
    if (
      target instanceof Element &&
      target.closest("[data-flect-activate]") !== null
    ) {
      activateSafely();
    }
  };
  document.addEventListener("focusin", (event) =>
    activateFromTarget(event.target),
  );
  document.addEventListener("pointerdown", (event) =>
    activateFromTarget(event.target),
  );
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (
      !(form instanceof HTMLFormElement) ||
      !form.hasAttribute("data-flect-starter")
    ) {
      return;
    }
    event.preventDefault();
    const data = new FormData(form);
    const prompt = data.get("prompt");
    if (typeof prompt !== "string" || prompt.trim().length === 0) return;
    void activate()
      .then(() => {
        document.dispatchEvent(
          new CustomEvent("flect:starter-submit", {
            detail: { prompt: prompt.trim() },
          }),
        );
      })
      .catch(() => undefined);
  });
  document.addEventListener("keydown", (event) => {
    const shortcut =
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") ||
      (event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement));
    if (!shortcut) return;
    event.preventDefault();
    activateSafely();
  });
  document.addEventListener("flect:activate", activateSafely);

  const immediate = shouldActivateFlectImmediately({
    href: location.href,
    testMode: options.testMode ?? import.meta.env.VITE_FLECT_TEST_MODE === "1",
    desktop: options.desktop ?? isFlectDesktop(location),
  });
  if (immediate) queueMicrotask(activateSafely);

  return { activate, immediate };
};
