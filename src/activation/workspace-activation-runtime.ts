import { Effect } from "effect";

interface WorkspaceClientModule {
  readonly mountFlect: (root: HTMLElement) => Promise<void>;
}

interface ActivateWorkspaceOptions {
  readonly document: Document;
  readonly root: HTMLElement;
  readonly load?: () => Promise<WorkspaceClientModule>;
  readonly onReady: () => void;
  readonly onError: () => void;
}

const errorFrom = (error: unknown, fallback: string) =>
  error instanceof Error ? error : new Error(fallback);

const waitForAstroIsland = (document: Document) =>
  Effect.callback<void, Error>((resume) => {
    const ready = () => resume(Effect.void);
    const failed = () =>
      resume(Effect.fail(new Error("Flect workspace hydration failed.")));
    document.addEventListener("flect:workspace-ready", ready, { once: true });
    document.addEventListener("flect:workspace-error", failed, { once: true });
    document.documentElement.dataset.flectOpenRequested = "true";
    document.dispatchEvent(new CustomEvent("flect:workspace-open"));
    return Effect.sync(() => {
      document.removeEventListener("flect:workspace-ready", ready);
      document.removeEventListener("flect:workspace-error", failed);
    });
  });

export const activateWorkspace = ({
  document,
  root,
  load,
  onReady,
  onError,
}: ActivateWorkspaceOptions) =>
  Effect.runPromise(
    (load === undefined
      ? waitForAstroIsland(document)
      : Effect.tryPromise({
          try: async () => {
            const { mountFlect } = await load();
            await mountFlect(root);
          },
          catch: (error) =>
            errorFrom(error, "Flect client module failed to load."),
        })
    ).pipe(
      Effect.tap(() => Effect.sync(onReady)),
      Effect.tapError(() => Effect.sync(onError)),
    ),
  );
