import { Effect } from "effect";

let mounted = false;
let opening: Promise<void> | undefined;

if ("__TAURI_INTERNALS__" in globalThis) {
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      document.addEventListener("flect:start-window-drag", () => {
        void getCurrentWindow().startDragging();
      });
    })
    .catch(() => undefined);
}

const needsWorkspaceImmediately = () => {
  const query = new URLSearchParams(globalThis.location.search);
  return (
    import.meta.env.VITE_FLECT_TEST_MODE === "1" ||
    "__TAURI_INTERNALS__" in globalThis ||
    globalThis.location.protocol === "tauri:" ||
    query.get("safe") === "1" ||
    [...query.keys()].some((key) => key.endsWith("-diagnostic"))
  );
};

const readPrompt = (event: Event) => {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const prompt = Reflect.get(detail, "prompt");
  return typeof prompt === "string" ? prompt.trim() : undefined;
};

const openWorkspace = (root: HTMLElement, prompt?: string) => {
  if (opening !== undefined) return opening;
  const document = root.ownerDocument;
  const shell = document.getElementById("flect-static-shell");
  const status = document.getElementById("flect-activation-status");
  shell?.setAttribute("aria-busy", "true");
  if (status !== null) status.textContent = "Opening your workspace…";
  opening = Effect.runPromise(
    Effect.promise(() => import("./workspace-entry")).pipe(
      Effect.flatMap(({ mountWorkspace }) =>
        Effect.sync(() => mountWorkspace(root, prompt)),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          root.hidden = false;
          if (shell !== null) shell.hidden = true;
        }),
      ),
      Effect.tapError(() =>
        Effect.sync(() => {
          opening = undefined;
          shell?.removeAttribute("aria-busy");
          if (status !== null) {
            status.textContent =
              "The workspace could not open. Your draft is still here; try again.";
            status.setAttribute("role", "alert");
          }
        }),
      ),
    ),
  );
  return opening;
};

export async function mountFlect(root: HTMLElement) {
  if (mounted) return;
  mounted = true;
  const document = root.ownerDocument;
  const status = document.getElementById("flect-activation-status");

  if (needsWorkspaceImmediately()) {
    await openWorkspace(root);
    return;
  }

  document.getElementById("flect-static-shell")?.removeAttribute("aria-busy");
  if (status !== null) status.textContent = "Flect is ready.";
  document.addEventListener("flect:starter-submit", (event) => {
    const prompt = readPrompt(event);
    if (prompt === undefined || prompt.length === 0) return;
    void openWorkspace(root, prompt).catch(() => undefined);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mounted = false;
    opening = undefined;
  });
}
