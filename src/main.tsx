import { Effect } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserRuntime } from "./lib/runtime";
import { WorkspaceControlBridge } from "./lib/workspace-control-bridge";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Flect could not find its application root.");
}

const reactRoot = createRoot(root);
const query = new URLSearchParams(globalThis.location.search);
const bunDiagnosticEnabled =
  import.meta.env.VITE_FLECT_BUN_DIAGNOSTIC === "1" &&
  query.get("bun-diagnostic") === "1";
const diagnosticEnabled =
  import.meta.env.VITE_FLECT_EXECUTION_DIAGNOSTIC === "1" &&
  query.get("execution-diagnostic") === "1";
const gitDiagnosticEnabled =
  import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === "1" &&
  query.get("git-diagnostic") === "1";
const gitTransactionDiagnosticEnabled =
  import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === "1" &&
  query.get("git-transaction-diagnostic") === "1";
const gitShareImportDiagnosticEnabled =
  import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === "1" &&
  query.get("git-share-import-diagnostic") === "1";
const gitShareLifecycleDiagnosticEnabled =
  import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === "1" &&
  query.get("git-share-lifecycle-diagnostic") === "1";
const storageResetDiagnosticEnabled =
  import.meta.env.VITE_FLECT_GIT_DIAGNOSTIC === "1" &&
  query.get("storage-reset-diagnostic") === "1";
const capsuleDiagnosticEnabled =
  import.meta.env.VITE_FLECT_CAPSULE_DIAGNOSTIC === "1" &&
  query.get("capsule-diagnostic") === "1";
const browserBuildDiagnosticEnabled =
  import.meta.env.VITE_FLECT_BUILD_DIAGNOSTIC === "1" &&
  query.get("build-diagnostic") === "1";
const browserPackageDiagnosticEnabled =
  import.meta.env.VITE_FLECT_PACKAGE_DIAGNOSTIC === "1" &&
  query.get("package-diagnostic") === "1";
const productCapabilityDiagnosticEnabled =
  import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC === "1" &&
  query.get("product-capability-diagnostic") === "1";
const referenceProductDiagnosticEnabled =
  import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC === "1" &&
  query.get("reference-product-diagnostic") === "1";
const productAdoptionDiagnosticEnabled =
  import.meta.env.VITE_FLECT_PRODUCT_CAPABILITY_DIAGNOSTIC === "1" &&
  query.get("product-adoption-diagnostic") === "1";

if (productAdoptionDiagnosticEnabled) {
  void import("./capabilities/product-adoption-diagnostic").then(
    ({ ProductAdoptionDiagnosticRoute }) => {
      reactRoot.render(<ProductAdoptionDiagnosticRoute />);
    },
  );
} else if (referenceProductDiagnosticEnabled) {
  void import("./capabilities/reference-product-diagnostic").then(
    ({ ReferenceProductDiagnostic }) => {
      reactRoot.render(<ReferenceProductDiagnostic />);
    },
  );
} else if (productCapabilityDiagnosticEnabled) {
  void import("./capabilities/product-capability-diagnostic").then(
    ({ ProductCapabilityDiagnostic }) => {
      reactRoot.render(<ProductCapabilityDiagnostic />);
    },
  );
} else if (storageResetDiagnosticEnabled) {
  void import("./git/storage-reset-diagnostic").then(
    ({ StorageResetDiagnostic }) => {
      reactRoot.render(<StorageResetDiagnostic />);
    },
  );
} else if (browserPackageDiagnosticEnabled) {
  void import("./build/browser-package-diagnostic").then(
    ({ BrowserPackageDiagnostic }) => {
      reactRoot.render(<BrowserPackageDiagnostic />);
    },
  );
} else if (browserBuildDiagnosticEnabled) {
  void import("./build/browser-build-diagnostic").then(
    ({ BrowserBuildDiagnostic }) => {
      reactRoot.render(<BrowserBuildDiagnostic />);
    },
  );
} else if (capsuleDiagnosticEnabled) {
  void import("./capsule/capsule-frame-diagnostic").then(
    ({ CapsuleFrameDiagnostic }) => {
      reactRoot.render(<CapsuleFrameDiagnostic />);
    },
  );
} else if (gitShareLifecycleDiagnosticEnabled) {
  void import("./git/git-share-lifecycle-diagnostic").then(
    ({ GitShareLifecycleDiagnostic }) => {
      reactRoot.render(<GitShareLifecycleDiagnostic />);
    },
  );
} else if (gitShareImportDiagnosticEnabled) {
  void import("./git/git-share-import-diagnostic").then(
    ({ GitShareImportDiagnostic }) => {
      reactRoot.render(<GitShareImportDiagnostic />);
    },
  );
} else if (gitTransactionDiagnosticEnabled) {
  void import("./git/git-transaction-diagnostic").then(
    ({ GitTransactionDiagnostic }) => {
      reactRoot.render(<GitTransactionDiagnostic />);
    },
  );
} else if (gitDiagnosticEnabled) {
  void import("./git/git-workspace-diagnostic").then(
    ({ GitWorkspaceDiagnostic }) => {
      reactRoot.render(<GitWorkspaceDiagnostic />);
    },
  );
} else if (bunDiagnosticEnabled) {
  void import("./execution/bun-command-diagnostic").then(
    ({ BunCommandDiagnostic }) => {
      reactRoot.render(<BunCommandDiagnostic />);
    },
  );
} else if (diagnosticEnabled) {
  void import("./execution/browser-execution-diagnostic").then(
    ({ BrowserExecutionDiagnostic }) => {
      reactRoot.render(<BrowserExecutionDiagnostic />);
    },
  );
} else {
  browserRuntime.runFork(
    Effect.gen(function* () {
      const bridge = yield* WorkspaceControlBridge;
      yield* bridge.ready;
    }),
  );
  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void browserRuntime.dispose();
  });
}
