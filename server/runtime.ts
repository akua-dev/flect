import { Context, type Effect, type Stream } from "effect";
import type {
  FlectEvent,
  FlectRuntimeError,
  ModelSummary,
  RuntimeStatus,
  SessionSelection,
} from "../shared/contracts";
import type { InterfaceDocument } from "../shared/interface-document";

export interface FlectRuntimeShape {
  readonly status: Effect.Effect<RuntimeStatus>;
  readonly listModels: Effect.Effect<
    ReadonlyArray<ModelSummary>,
    FlectRuntimeError
  >;
  readonly createSession: (
    selection: SessionSelection,
  ) => Effect.Effect<string, FlectRuntimeError>;
  readonly prompt: (
    sessionId: string,
    text: string,
  ) => Stream.Stream<FlectEvent, FlectRuntimeError>;
  readonly shape: (
    sessionId: string,
    instruction: string,
    document: InterfaceDocument,
  ) => Effect.Effect<InterfaceDocument, FlectRuntimeError>;
  readonly cancel: (
    sessionId: string,
  ) => Effect.Effect<void, FlectRuntimeError>;
}

export class FlectRuntime extends Context.Service<
  FlectRuntime,
  FlectRuntimeShape
>()("flect/server/FlectRuntime") {}
