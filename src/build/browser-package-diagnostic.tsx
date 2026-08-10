import { Effect, Layer, ManagedRuntime } from "effect";
import { useEffect, useRef, useState } from "react";
import { BrowserPackageRequest } from "../../shared/browser-package";
import { makeBunPackageMutationLayer } from "../execution/bun-package-mutation";
import { fixtureRegistryFetch } from "../execution/fixtures/package-registry";
import { BrowserPackageCacheLive } from "./browser-package-cache";
import {
  BrowserPackageResolver,
  makeBrowserPackageResolverLayer,
} from "./browser-package-resolver";

interface DiagnosticState {
  readonly state: "running" | "ready" | "complete" | "failed";
  readonly cacheHit: boolean;
  readonly registryCalls: number;
  readonly restored: "pending" | "fresh" | "reopened";
  readonly message: string;
}

const initialState: DiagnosticState = {
  state: "running",
  cacheHit: false,
  registryCalls: 0,
  restored: "pending",
  message: "Resolving a browser package graph…",
};
const encoder = new TextEncoder();

export function BrowserPackageDiagnostic() {
  const [state, setState] = useState(initialState);
  const verifyRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const restorationKey = "flect.browser-package-diagnostic.complete";
    const restoreOnly = sessionStorage.getItem(restorationKey) === "1";
    const workspace =
      new URLSearchParams(globalThis.location.search).get("workspace") ??
      "diagnostic";
    let registryAllowed = !restoreOnly;
    let registryCalls = 0;
    const packages = makeBunPackageMutationLayer({
      fetch: (url, init) => {
        registryCalls += 1;
        return registryAllowed
          ? fixtureRegistryFetch(url, init)
          : Promise.reject(
              new Error("The diagnostic registry is deliberately offline."),
            );
      },
      registryBaseUrl: "https://registry.flect.invalid",
    });
    const resolverLayer = makeBrowserPackageResolverLayer({
      registryOrigin: "https://registry.flect.invalid",
    }).pipe(
      Layer.provideMerge(Layer.mergeAll(packages, BrowserPackageCacheLive)),
    );
    const runtime = ManagedRuntime.make(resolverLayer);
    const request = BrowserPackageRequest.make({
      version: 1,
      packageJson: encoder.encode(
        JSON.stringify({
          name: `fixture-${workspace}`.slice(0, 80),
          version: "1.0.0",
          private: true,
          dependencies: { "flect-fixture": "1.0.0" },
        }),
      ),
    });
    let active = true;

    const resolve = () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const resolver = yield* BrowserPackageResolver;
          return yield* resolver.resolve(request);
        }),
      );

    void resolve()
      .then((resolution) => {
        if (!active) {
          return;
        }
        if (restoreOnly) {
          if (!resolution.cacheHit || registryCalls !== 0) {
            throw new Error("The package graph was not restored offline.");
          }
          setState({
            state: "complete",
            cacheHit: true,
            registryCalls,
            restored: "reopened",
            message: `${resolution.packageCount} package restored from OPFS.`,
          });
          return;
        }
        registryAllowed = false;
        setState({
          state: "ready",
          cacheHit: resolution.cacheHit,
          registryCalls,
          restored: "fresh",
          message: `${resolution.packageCount} package cached; ready for offline reuse.`,
        });
        verifyRef.current = () => {
          const callsBefore = registryCalls;
          void resolve()
            .then((cached) => {
              if (!active) {
                return;
              }
              if (!cached.cacheHit || registryCalls !== callsBefore) {
                throw new Error("The cached graph attempted registry access.");
              }
              sessionStorage.setItem(restorationKey, "1");
              setState({
                state: "complete",
                cacheHit: true,
                registryCalls,
                restored: "fresh",
                message: `${cached.packageCount} package reused offline.`,
              });
            })
            .catch((error: unknown) => {
              if (active) {
                setState({
                  state: "failed",
                  cacheHit: false,
                  registryCalls,
                  restored: "pending",
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              }
            });
        };
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            state: "failed",
            cacheHit: false,
            registryCalls,
            restored: "pending",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      active = false;
      verifyRef.current = () => undefined;
      void runtime.dispose();
    };
  }, []);

  return (
    <main>
      <output
        data-testid="browser-package-result"
        data-state={state.state}
        data-cache-hit={String(state.cacheHit)}
        data-registry-calls={String(state.registryCalls)}
        data-restored={state.restored}
      >
        {state.message}
      </output>
      {state.state === "ready" ? (
        <button type="button" onClick={() => verifyRef.current()}>
          Verify cached resolution
        </button>
      ) : null}
    </main>
  );
}
