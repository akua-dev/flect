import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserRuntime } from "./lib/runtime";
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

if (bunDiagnosticEnabled) {
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
