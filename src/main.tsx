import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserRuntime } from "./lib/runtime";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Flect could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void browserRuntime.dispose();
  });
}
