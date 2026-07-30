import { Context, type Effect } from "effect";
import type {
  BrowserExecutionCapabilities,
  BrowserExecutionFailed,
  JavaScriptExecutionRequest,
  JavaScriptExecutionResult,
  PackageMirrorRequest,
  PackageMirrorResult,
  WasiExecutionRequest,
  WasiExecutionResult,
} from "../../shared/browser-execution";

export interface BrowserExecutionShape {
  readonly probe: Effect.Effect<
    BrowserExecutionCapabilities,
    BrowserExecutionFailed
  >;
  readonly evaluateJavaScript: (
    request: JavaScriptExecutionRequest,
  ) => Effect.Effect<JavaScriptExecutionResult, BrowserExecutionFailed>;
  readonly runWasi: (
    request: WasiExecutionRequest,
  ) => Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>;
  readonly mirrorPackages: (
    request: PackageMirrorRequest,
  ) => Effect.Effect<PackageMirrorResult, BrowserExecutionFailed>;
}

export class BrowserExecution extends Context.Service<
  BrowserExecution,
  BrowserExecutionShape
>()("flect/BrowserExecution") {}
