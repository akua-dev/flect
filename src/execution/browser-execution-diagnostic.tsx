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
  readonly wasi: string;
  readonly packages: string;
  readonly release: string;
}

const initialState: DiagnosticState = {
  status: "running",
  javascript: "",
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
      <output data-testid="execution-wasi">{state.wasi}</output>
      <output data-testid="execution-packages">{state.packages}</output>
      <output data-testid="execution-release">{state.release}</output>
    </main>
  );
}
