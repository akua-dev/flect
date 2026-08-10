import { Effect, Layer, ManagedRuntime } from "effect";
import { useEffect, useState } from "react";
import schedulerProduction from "scheduler/cjs/scheduler.production.js?raw";
import schedulerIndex from "scheduler/index.js?raw";
import reactProduction from "../../node_modules/react/cjs/react.production.js?raw";
import reactJsxProduction from "../../node_modules/react/cjs/react-jsx-runtime.production.js?raw";
import reactIndex from "../../node_modules/react/index.js?raw";
import reactJsxRuntime from "../../node_modules/react/jsx-runtime.js?raw";
import reactDomProduction from "../../node_modules/react-dom/cjs/react-dom.production.js?raw";
import reactDomClientProduction from "../../node_modules/react-dom/cjs/react-dom-client.production.js?raw";
import reactDomClient from "../../node_modules/react-dom/client.js?raw";
import reactDomIndex from "../../node_modules/react-dom/index.js?raw";
import { ProposalBuildRequest } from "../../shared/browser-build";
import { GitWorkspace, GitWorkspaceLive } from "../git/git-workspace";
import { BrowserBuild, BrowserBuildLive } from "./browser-build";
import { BrowserPackageResolver } from "./browser-package-resolver";
import { ProposalBuild, ProposalBuildLive } from "./proposal-build";

interface DiagnosticState {
  readonly state: "running" | "complete" | "failed";
  readonly outputs: string;
  readonly lastGood: "pending" | "retained" | "lost";
  readonly restored: "pending" | "fresh" | "reopened";
  readonly srcDoc: string;
  readonly message: string;
}

const initialState: DiagnosticState = {
  state: "running",
  outputs: "",
  lastGood: "pending",
  restored: "pending",
  srcDoc: "",
  message: "Building a React TSX and CSS fixture…",
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const file = (path: string, contents: string) => ({
  path,
  contents: encoder.encode(contents),
});

const packageManifest = (
  name: string,
  exports: Readonly<Record<string, string>>,
) =>
  JSON.stringify({
    name,
    version: "19.2.8",
    main: "index.js",
    exports,
  });

const sources = [
  file(
    "src/main.tsx",
    `import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const App = () => {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {count === 0 ? "Flect build ready" : \`Built \${count}\`}
    </button>
  );
};

createRoot(document.getElementById("app")!).render(<App />);`,
  ),
  file(
    "src/styles.css",
    `:root { color-scheme: light; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f8fb; }
button { border: 0; border-radius: 999px; background: rgb(20, 86, 230); color: white; padding: 14px 22px; font: inherit; }`,
  ),
  file(
    "node_modules/react/package.json",
    packageManifest("react", {
      ".": "./index.js",
      "./jsx-runtime": "./jsx-runtime.js",
    }),
  ),
  file("node_modules/react/index.js", reactIndex),
  file("node_modules/react/jsx-runtime.js", reactJsxRuntime),
  file("node_modules/react/cjs/react.production.js", reactProduction),
  file(
    "node_modules/react/cjs/react-jsx-runtime.production.js",
    reactJsxProduction,
  ),
  file(
    "node_modules/react-dom/package.json",
    packageManifest("react-dom", {
      ".": "./index.js",
      "./client": "./client.js",
    }),
  ),
  file("node_modules/react-dom/index.js", reactDomIndex),
  file("node_modules/react-dom/client.js", reactDomClient),
  file(
    "node_modules/react-dom/cjs/react-dom.production.js",
    reactDomProduction,
  ),
  file(
    "node_modules/react-dom/cjs/react-dom-client.production.js",
    reactDomClientProduction,
  ),
  file(
    "node_modules/scheduler/package.json",
    packageManifest("scheduler", { ".": "./index.js" }),
  ),
  file("node_modules/scheduler/index.js", schedulerIndex),
  file(
    "node_modules/scheduler/cjs/scheduler.production.js",
    schedulerProduction,
  ),
];

const toSrcDoc = (
  outputs: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  const css = outputs
    .filter((output) => output.path.endsWith(".css"))
    .map((output) => decoder.decode(output.contents))
    .join("\n");
  const javascript = outputs
    .filter((output) => output.path.endsWith(".js"))
    .map((output) => decoder.decode(output.contents))
    .join("\n")
    .replaceAll("</script", "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>${css}</style></head><body><div id="app"></div><script>${javascript}</script></body></html>`;
};

export function BrowserBuildDiagnostic() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const packageResolver = Layer.succeed(BrowserPackageResolver)({
      resolve: () =>
        Effect.die(
          new Error("The fixed build diagnostic has no package request."),
        ),
    });
    const dependencies = Layer.mergeAll(
      GitWorkspaceLive,
      BrowserBuildLive,
      packageResolver,
    );
    const runtime = ManagedRuntime.make(
      ProposalBuildLive.pipe(Layer.provideMerge(dependencies)),
    );
    const restorationKey = "flect.browser-build-diagnostic.complete";
    const restoreOnly = sessionStorage.getItem(restorationKey) === "1";
    const workspaceId =
      new URLSearchParams(globalThis.location.search).get("workspace") ??
      "build-diagnostic";
    let active = true;
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const build = yield* BrowserBuild;
          if (restoreOnly) {
            const restored = yield* build.lastSuccessful;
            if (restored === undefined) {
              return yield* Effect.fail(
                new Error(
                  "The last successful browser build was not restored.",
                ),
              );
            }
            return {
              artifact: restored,
              retained: "retained" as const,
              restored: "reopened" as const,
            };
          }
          const git = yield* GitWorkspace;
          const proposalBuild = yield* ProposalBuild;
          yield* git.open({ workspaceId, reset: true });
          const accepted = yield* git.checkpoint({
            branch: "flect/accepted",
            files: [file("flect.json", '{"diagnostic":true}\n')],
            removals: [],
            message: "Initialize browser build diagnostic",
          });
          yield* git.moveRef({
            branch: "flect/last-known-good",
            targetCommit: accepted.commit,
            guards: [{ branch: "flect/accepted", commit: accepted.commit }],
          });
          const proposal = yield* git.checkpoint({
            branch: "flect/proposal/build-diagnostic",
            baseCommit: accepted.commit,
            files: sources.map((source) => ({
              path: `project/${source.path}`,
              contents: source.contents,
            })),
            removals: [],
            guards: [
              { branch: "flect/accepted", commit: accepted.commit },
              {
                branch: "flect/last-known-good",
                commit: accepted.commit,
              },
            ],
            message: "Add React browser build fixture",
          });
          const request = ProposalBuildRequest.make({
            proposalBranch: proposal.branch,
            proposalCommit: proposal.commit,
            acceptedCommit: accepted.commit,
            lastKnownGoodCommit: accepted.commit,
            entrypoint: "src/main.tsx",
          });
          const artifact = yield* proposalBuild.compile(request);
          const broken = yield* git.checkpoint({
            branch: proposal.branch,
            expectedCommit: proposal.commit,
            files: [
              {
                path: "project/src/main.tsx",
                contents: encoder.encode("export const = broken"),
              },
            ],
            removals: [],
            guards: [
              { branch: "flect/accepted", commit: accepted.commit },
              {
                branch: "flect/last-known-good",
                commit: accepted.commit,
              },
            ],
            message: "Add deliberately broken source",
          });
          const failure = yield* proposalBuild
            .compile(
              ProposalBuildRequest.make({
                ...request,
                proposalCommit: broken.commit,
              }),
            )
            .pipe(Effect.flip);
          const retained = yield* build.lastSuccessful;
          if (failure.reason !== "build") {
            return yield* Effect.fail(failure);
          }
          return {
            artifact,
            retained:
              retained?.artifactDigest === artifact.artifactDigest
                ? ("retained" as const)
                : ("lost" as const),
            restored: "fresh" as const,
          };
        }),
      )
      .then(({ artifact, retained, restored }) => {
        if (!active) {
          return;
        }
        sessionStorage.setItem(restorationKey, "1");
        setState({
          state: "complete",
          outputs: artifact.outputs.map((output) => output.path).join(", "),
          lastGood: retained,
          restored,
          srcDoc: toSrcDoc(artifact.outputs),
          message: "Restricted browser build passed.",
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setState({
          state: "failed",
          outputs: "",
          lastGood: "lost",
          restored: "pending",
          srcDoc: "",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
      void runtime.dispose();
    };
  }, []);

  return (
    <main>
      <output
        data-testid="browser-build-result"
        data-state={state.state}
        data-last-good={state.lastGood}
        data-restored={state.restored}
        data-cross-origin-isolated={String(globalThis.crossOriginIsolated)}
      >
        {state.message} {state.outputs}
      </output>
      {state.srcDoc.length === 0 ? null : (
        <iframe
          title="Restricted browser build preview"
          data-testid="browser-build-preview"
          sandbox="allow-scripts"
          srcDoc={state.srcDoc}
        />
      )}
    </main>
  );
}
