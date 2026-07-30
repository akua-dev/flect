import { Layer, ManagedRuntime } from "effect";
import { fixtureRegistryFetch } from "./fixtures/package-registry";
import {
  type RiftyJavaScriptExecution,
  RiftyJavaScriptLive,
} from "./rifty-js-runtime";
import {
  makeRiftyPackageMirrorLayer,
  type RiftyPackageMirror,
} from "./rifty-package-mirror";
import { type RiftyWasiExecution, RiftyWasiLive } from "./rifty-wasi-runtime";

const RiftyPackageMirrorLive = makeRiftyPackageMirrorLayer({
  fetch: fixtureRegistryFetch,
});

const BrowserExecutionDiagnosticLive = Layer.mergeAll(
  RiftyJavaScriptLive,
  RiftyWasiLive,
  RiftyPackageMirrorLive,
);

export type BrowserExecutionDiagnosticServices =
  | RiftyJavaScriptExecution
  | RiftyWasiExecution
  | RiftyPackageMirror;

export const executionRuntime: ManagedRuntime.ManagedRuntime<
  BrowserExecutionDiagnosticServices,
  never
> = ManagedRuntime.make(BrowserExecutionDiagnosticLive);
