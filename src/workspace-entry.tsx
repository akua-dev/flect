import { Effect, Fiber } from "effect";
import {
  type ComponentType,
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserRuntime } from "./lib/runtime";
import { WorkspaceControlBridge } from "./lib/workspace-control-bridge";
import workspaceStylesUrl from "./styles.css?url";

const diagnostic = (
  load: () => Promise<Record<string, unknown>>,
  name: string,
) =>
  lazy(async () => {
    const module = await load();
    return { default: Reflect.get(module, name) as ComponentType };
  });

const ProductAdoptionDiagnosticRoute = diagnostic(
  () => import("./capabilities/product-adoption-diagnostic"),
  "ProductAdoptionDiagnosticRoute",
);
const ReferenceProductDiagnostic = diagnostic(
  () => import("./capabilities/reference-product-diagnostic"),
  "ReferenceProductDiagnostic",
);
const ProductCapabilityDiagnostic = diagnostic(
  () => import("./capabilities/product-capability-diagnostic"),
  "ProductCapabilityDiagnostic",
);
const StorageResetDiagnostic = diagnostic(
  () => import("./git/storage-reset-diagnostic"),
  "StorageResetDiagnostic",
);
const BrowserPackageDiagnostic = diagnostic(
  () => import("./build/browser-package-diagnostic"),
  "BrowserPackageDiagnostic",
);
const BrowserBuildDiagnostic = diagnostic(
  () => import("./build/browser-build-diagnostic"),
  "BrowserBuildDiagnostic",
);
const CapsuleFrameDiagnostic = diagnostic(
  () => import("./capsule/capsule-frame-diagnostic"),
  "CapsuleFrameDiagnostic",
);
const CapsuleTrustDiagnostic = diagnostic(
  () => import("./capsule/capsule-trust-diagnostic"),
  "CapsuleTrustDiagnostic",
);
const GitShareLifecycleDiagnostic = diagnostic(
  () => import("./git/git-share-lifecycle-diagnostic"),
  "GitShareLifecycleDiagnostic",
);
const GitShareImportDiagnostic = diagnostic(
  () => import("./git/git-share-import-diagnostic"),
  "GitShareImportDiagnostic",
);
const GitTransactionDiagnostic = diagnostic(
  () => import("./git/git-transaction-diagnostic"),
  "GitTransactionDiagnostic",
);
const GitWorkspaceDiagnostic = diagnostic(
  () => import("./git/git-workspace-diagnostic"),
  "GitWorkspaceDiagnostic",
);
const BunCommandDiagnostic = diagnostic(
  () => import("./execution/bun-command-diagnostic"),
  "BunCommandDiagnostic",
);
const BrowserExecutionDiagnostic = diagnostic(
  () => import("./execution/browser-execution-diagnostic"),
  "BrowserExecutionDiagnostic",
);

const enabled = (
  query: URLSearchParams,
  environment: string | undefined,
  parameter: string,
) => environment === "1" && query.get(parameter) === "1";

const selectDiagnostic = (
  query: URLSearchParams,
): ComponentType | undefined => {
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "product-adoption-diagnostic",
    )
  )
    return ProductAdoptionDiagnosticRoute;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "reference-product-diagnostic",
    )
  )
    return ReferenceProductDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC,
      "product-capability-diagnostic",
    )
  )
    return ProductCapabilityDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "storage-reset-diagnostic",
    )
  )
    return StorageResetDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_PACKAGE_DIAGNOSTIC,
      "package-diagnostic",
    )
  )
    return BrowserPackageDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_BUILD_DIAGNOSTIC,
      "build-diagnostic",
    )
  )
    return BrowserBuildDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_CAPSULE_DIAGNOSTIC,
      "capsule-diagnostic",
    )
  )
    return CapsuleFrameDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_CAPSULE_DIAGNOSTIC,
      "capsule-trust-diagnostic",
    )
  )
    return CapsuleTrustDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-share-lifecycle-diagnostic",
    )
  )
    return GitShareLifecycleDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-share-import-diagnostic",
    )
  )
    return GitShareImportDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC,
      "git-transaction-diagnostic",
    )
  )
    return GitTransactionDiagnostic;
  if (
    enabled(query, import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC, "git-diagnostic")
  )
    return GitWorkspaceDiagnostic;
  if (
    enabled(query, import.meta.env.VITE_FLECT_BUN_DIAGNOSTIC, "bun-diagnostic")
  )
    return BunCommandDiagnostic;
  if (
    enabled(
      query,
      import.meta.env.VITE_FLECT_EXECUTION_DIAGNOSTIC,
      "execution-diagnostic",
    )
  )
    return BrowserExecutionDiagnostic;
  return undefined;
};

const readInitialPrompt = () => {
  if (typeof document === "undefined") return undefined;
  const root = document.getElementById("root");
  const prompt = root?.dataset.flectInitialPrompt?.trim();
  if (root !== null) delete root.dataset.flectInitialPrompt;
  return prompt === undefined || prompt.length === 0 ? undefined : prompt;
};

function ApplicationWorkspace({
  initialPrompt,
}: {
  readonly initialPrompt?: string;
}) {
  useEffect(() => {
    const fiber = browserRuntime.runFork(
      Effect.gen(function* () {
        const bridge = yield* WorkspaceControlBridge;
        yield* bridge.ready;
      }),
    );
    return () => {
      browserRuntime.runFork(Fiber.interrupt(fiber));
    };
  }, []);
  return (
    <StrictMode>
      <App {...(initialPrompt === undefined ? {} : { initialPrompt })} />
    </StrictMode>
  );
}

export default function FlectWorkspaceIsland() {
  const [hydrated, setHydrated] = useState(false);
  const [initialPrompt] = useState(readInitialPrompt);
  const Diagnostic = useMemo(
    () =>
      typeof location === "undefined"
        ? undefined
        : selectDiagnostic(new URLSearchParams(location.search)),
    [],
  );
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return <span aria-hidden="true" data-flect-island-placeholder />;
  }

  return (
    <>
      <link
        data-flect-workspace-styles
        href={workspaceStylesUrl}
        precedence="flect-workspace"
        rel="stylesheet"
      />
      {Diagnostic === undefined ? (
        <ApplicationWorkspace
          {...(initialPrompt === undefined ? {} : { initialPrompt })}
        />
      ) : (
        <Suspense fallback={<p role="status">Opening diagnostic</p>}>
          <Diagnostic />
        </Suspense>
      )}
    </>
  );
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;

export const mountWorkspace = (root: HTMLElement, initialPrompt?: string) => {
  if (mountedRoot !== undefined) return;
  if (initialPrompt !== undefined)
    root.dataset.flectInitialPrompt = initialPrompt;
  mountedRoot = createRoot(root);
  mountedRoot.render(<FlectWorkspaceIsland />);
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mountedRoot?.unmount();
    mountedRoot = undefined;
    void browserRuntime.dispose();
  });
}
