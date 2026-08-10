import { Effect } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserRuntime } from "./lib/runtime";
import { WorkspaceControlBridge } from "./lib/workspace-control-bridge";
import stylesUrl from "./styles.css?url";

let mountedRoot: ReturnType<typeof createRoot> | undefined;

const loadFlectStyles = (document: Document) => {
  const existing = document.querySelector<HTMLLinkElement>(
    'link[data-flect-workspace-styles="true"]',
  );
  if (existing !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.dataset.flectWorkspaceStyles = "true";
    link.rel = "stylesheet";
    link.href = stylesUrl;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Flect workspace styles could not be loaded.")),
      { once: true },
    );
    document.head.append(link);
  });
};

export async function mountWorkspace(
  root: HTMLElement,
  initialPrompt?: string,
) {
  if (mountedRoot !== undefined) return;
  await loadFlectStyles(root.ownerDocument);
  const reactRoot = createRoot(root);
  mountedRoot = reactRoot;
  const query = new URLSearchParams(globalThis.location.search);
  const enabled = (environment: string | undefined, parameter: string) =>
    environment === "1" && query.get(parameter) === "1";

  if (
    enabled(
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "product-adoption-diagnostic",
    )
  ) {
    const { ProductAdoptionDiagnosticRoute } = await import(
      "./capabilities/product-adoption-diagnostic"
    );
    reactRoot.render(<ProductAdoptionDiagnosticRoute />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "reference-product-diagnostic",
    )
  ) {
    const { ReferenceProductDiagnostic } = await import(
      "./capabilities/reference-product-diagnostic"
    );
    reactRoot.render(<ReferenceProductDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "product-capability-diagnostic",
    )
  ) {
    const { ProductCapabilityDiagnostic } = await import(
      "./capabilities/product-capability-diagnostic"
    );
    reactRoot.render(<ProductCapabilityDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "storage-reset-diagnostic",
    )
  ) {
    const { StorageResetDiagnostic } = await import(
      "./git/storage-reset-diagnostic"
    );
    reactRoot.render(<StorageResetDiagnostic />);
  } else if (
    enabled(import.meta.env.VITE_FLECT_PACKAGE_DIAGNOSTIC, "package-diagnostic")
  ) {
    const { BrowserPackageDiagnostic } = await import(
      "./build/browser-package-diagnostic"
    );
    reactRoot.render(<BrowserPackageDiagnostic />);
  } else if (
    enabled(import.meta.env.VITE_FLECT_BUILD_DIAGNOSTIC, "build-diagnostic")
  ) {
    const { BrowserBuildDiagnostic } = await import(
      "./build/browser-build-diagnostic"
    );
    reactRoot.render(<BrowserBuildDiagnostic />);
  } else if (
    enabled(import.meta.env.VITE_FLECT_CAPSULE_DIAGNOSTIC, "capsule-diagnostic")
  ) {
    const { CapsuleFrameDiagnostic } = await import(
      "./capsule/capsule-frame-diagnostic"
    );
    reactRoot.render(<CapsuleFrameDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-share-lifecycle-diagnostic",
    )
  ) {
    const { GitShareLifecycleDiagnostic } = await import(
      "./git/git-share-lifecycle-diagnostic"
    );
    reactRoot.render(<GitShareLifecycleDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-share-import-diagnostic",
    )
  ) {
    const { GitShareImportDiagnostic } = await import(
      "./git/git-share-import-diagnostic"
    );
    reactRoot.render(<GitShareImportDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-transaction-diagnostic",
    )
  ) {
    const { GitTransactionDiagnostic } = await import(
      "./git/git-transaction-diagnostic"
    );
    reactRoot.render(<GitTransactionDiagnostic />);
  } else if (
    enabled(import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC, "git-diagnostic")
  ) {
    const { GitWorkspaceDiagnostic } = await import(
      "./git/git-workspace-diagnostic"
    );
    reactRoot.render(<GitWorkspaceDiagnostic />);
  } else if (
    enabled(import.meta.env.VITE_FLECT_BUN_DIAGNOSTIC, "bun-diagnostic")
  ) {
    const { BunCommandDiagnostic } = await import(
      "./execution/bun-command-diagnostic"
    );
    reactRoot.render(<BunCommandDiagnostic />);
  } else if (
    enabled(
      import.meta.env.VITE_FLECT_EXECUTION_DIAGNOSTIC,
      "execution-diagnostic",
    )
  ) {
    const { BrowserExecutionDiagnostic } = await import(
      "./execution/browser-execution-diagnostic"
    );
    reactRoot.render(<BrowserExecutionDiagnostic />);
  } else {
    browserRuntime.runFork(
      Effect.gen(function* () {
        const bridge = yield* WorkspaceControlBridge;
        yield* bridge.ready;
      }),
    );
    reactRoot.render(
      <StrictMode>
        <App {...(initialPrompt === undefined ? {} : { initialPrompt })} />
      </StrictMode>,
    );
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mountedRoot?.unmount();
    mountedRoot = undefined;
    void browserRuntime.dispose();
  });
}
