import type {
  FlectEvent,
  ModelSummary,
  RuntimeStatus,
  SessionSelection,
} from "../shared/contracts";

export interface FlectRuntime {
  status(): Promise<RuntimeStatus>;
  listModels(): Promise<ModelSummary[]>;
  createSession(selection?: SessionSelection): Promise<string>;
  prompt(
    sessionId: string,
    text: string,
    emit: (event: FlectEvent) => void,
  ): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}
