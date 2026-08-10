import type { ClientDirective } from "astro";

const flectClientDirective: ClientDirective = (load) => {
  let hydration: Promise<void> | undefined;
  const hydrate = () => {
    if (hydration !== undefined) return hydration;
    hydration = load()
      .then((run) => run())
      .catch((error: unknown) => {
        hydration = undefined;
        document.dispatchEvent(
          new CustomEvent("flect:workspace-error", { detail: error }),
        );
      });
    return hydration;
  };

  document.addEventListener("flect:workspace-open", () => void hydrate());
  if (document.documentElement.dataset.flectOpenRequested === "true") {
    queueMicrotask(() => void hydrate());
  }
};

export default flectClientDirective;
