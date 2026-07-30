import { Effect } from "effect";
import { useEffect, useState } from "react";
import {
  JavaScriptExecutionRequest,
  PackageMirrorRequest,
  WasiExecutionRequest,
} from "../../shared/browser-execution";
import { NOOP_WASI_MODULE } from "./fixtures/noop-wasi";
import { RiftyJavaScriptExecution } from "./rifty-js-runtime";
import { RiftyPackageMirror } from "./rifty-package-mirror";
import { RiftyWasiExecution } from "./rifty-wasi-runtime";
import { executionRuntime } from "./runtime";

interface DiagnosticState {
  readonly status: "running" | "passed" | "failed";
  readonly javascript: string;
  readonly capabilities: string;
  readonly wasi: string;
  readonly packages: string;
  readonly release: string;
}

const initialState: DiagnosticState = {
  status: "running",
  javascript: "",
  capabilities: "",
  wasi: "",
  packages: "",
  release: "pending",
};

export function BrowserExecutionDiagnostic() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let active = true;
    void executionRuntime
      .runPromise(
        Effect.gen(function* () {
          const javascript = yield* RiftyJavaScriptExecution;
          const wasi = yield* RiftyWasiExecution;
          const packages = yield* RiftyPackageMirror;

          const javascriptResult = yield* javascript.evaluate(
            JavaScriptExecutionRequest.make({
              version: 1,
              source: "40 + 2",
            }),
          );
          const capabilitiesResult = yield* javascript.evaluate(
            JavaScriptExecutionRequest.make({
              version: 1,
              source: `const attempt = async action => {
  try {
    await action();
    return "escaped";
  } catch {
    return "blocked";
  }
};
Promise.all([
  attempt(() => fetch("https://example.invalid/")),
  attempt(() => globalThis.localStorage.getItem("flect")),
  attempt(() => globalThis.sessionStorage.getItem("flect")),
  attempt(() => globalThis.indexedDB.open("flect")),
  attempt(() => globalThis.caches.open("flect")),
  attempt(() => globalThis.navigator.storage.getDirectory()),
  attempt(() => new WebSocket("wss://example.invalid/")),
  attempt(() => new EventSource("https://example.invalid/")),
  attempt(() => new Worker("data:text/javascript,void 0")),
  attempt(() => importScripts("https://example.invalid/worker.js")),
  attempt(() => globalThis.showOpenFilePicker())
]).then(values => console.log(values.join(",")));`,
            }),
          );
          const wasiResult = yield* wasi.run(
            WasiExecutionRequest.make({
              version: 1,
              module: NOOP_WASI_MODULE,
              args: ["flect-diagnostic"],
              env: {},
            }),
          );
          const packageResult = yield* packages.install(
            PackageMirrorRequest.make({
              version: 1,
              name: "flect-diagnostic",
              packageVersion: "1.0.0",
              dependencies: {
                "flect-fixture": "1.0.0",
              },
            }),
          );

          return {
            javascript: javascriptResult.stdout.trim(),
            capabilities: capabilitiesResult.stdout.trim(),
            wasi: String(wasiResult.exitCode),
            packages: String(packageResult.packageCount),
          };
        }),
      )
      .then((result) => {
        if (active) {
          setState({
            status: "passed",
            ...result,
            release: "disposed",
          });
        }
      })
      .catch(() => {
        if (active) {
          setState({
            status: "failed",
            javascript: "",
            capabilities: "",
            wasi: "",
            packages: "",
            release: "disposed",
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      data-testid="execution-diagnostic"
      data-status={state.status}
      aria-label="Browser execution diagnostic"
    >
      <output data-testid="execution-js">{state.javascript}</output>
      <output data-testid="execution-capabilities">{state.capabilities}</output>
      <output data-testid="execution-wasi">{state.wasi}</output>
      <output data-testid="execution-packages">{state.packages}</output>
      <output data-testid="execution-release">{state.release}</output>
    </main>
  );
}
