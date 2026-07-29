import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  FlectEvent,
  ModelSummary,
  SessionSelection,
} from "../shared/contracts";
import type { FlectRuntime } from "./runtime";

type PiModel = {
  provider: string;
  id: string;
  name: string;
};

export type PiEvent = {
  type?: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

type PiSession = {
  sessionId: string;
  subscribe(listener: (event: PiEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
};

type PiModelRuntime = {
  getAvailable(): Promise<readonly PiModel[]>;
};

type PiSessionOptions = {
  modelRuntime: unknown;
  model: unknown;
  noTools: "all";
  sessionManager: unknown;
  settingsManager: unknown;
  resourceLoader: unknown;
};

export interface PiSdk {
  createModelRuntime(): Promise<PiModelRuntime>;
  createSession(options: PiSessionOptions): Promise<{ session: PiSession }>;
  createSessionManager(): unknown;
  createSettingsManager(): unknown;
  createResourceLoader(settingsManager: unknown): Promise<unknown>;
}

const defaultPiSdk: PiSdk = {
  createModelRuntime: () => ModelRuntime.create(),
  createSession: async (options) => {
    const result = await createAgentSession(
      options as Parameters<typeof createAgentSession>[0],
    );
    return { session: result.session };
  },
  createSessionManager: () => SessionManager.inMemory(),
  createSettingsManager: () => SettingsManager.inMemory(),
  createResourceLoader: async (settingsManager) => {
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      settingsManager: settingsManager as SettingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt:
        "You are the local agent behind Flect, an interface that takes the user's shape. Respond clearly and help the user think through, build, or change interfaces. You have no tools in this protected session.",
    });
    await loader.reload();
    return loader;
  },
};

type SessionRecord = {
  session: PiSession;
  cancelled: boolean;
};

const PUBLIC_TURN_ERROR = "The model could not complete this turn.";

export async function createPiRuntime(
  sdk: PiSdk = defaultPiSdk,
): Promise<FlectRuntime> {
  const modelRuntime = await sdk.createModelRuntime();
  const sessions = new Map<string, SessionRecord>();

  async function availableModels(): Promise<readonly PiModel[]> {
    return modelRuntime.getAvailable();
  }

  return {
    async status() {
      return { version: 1, status: "ready" };
    },

    async listModels(): Promise<ModelSummary[]> {
      return (await availableModels()).map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
      }));
    },

    async createSession(selection?: SessionSelection): Promise<string> {
      const models = await availableModels();
      const model = selection?.model
        ? models.find(
            (candidate) =>
              candidate.provider === selection.model?.provider &&
              candidate.id === selection.model.id,
          )
        : models[0];

      if (!model) {
        throw new Error("No authenticated model is available");
      }

      const settingsManager = sdk.createSettingsManager();
      const { session } = await sdk.createSession({
        modelRuntime,
        model,
        noTools: "all",
        sessionManager: sdk.createSessionManager(),
        settingsManager,
        resourceLoader: await sdk.createResourceLoader(settingsManager),
      });

      sessions.set(session.sessionId, { session, cancelled: false });
      return session.sessionId;
    },

    async prompt(
      sessionId: string,
      text: string,
      emit: (event: FlectEvent) => void,
    ): Promise<void> {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error("Session not found");
      }

      record.cancelled = false;
      emit({ type: "turn_started" });
      const unsubscribe = record.session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta" &&
          typeof event.assistantMessageEvent.delta === "string"
        ) {
          emit({
            type: "text_delta",
            delta: event.assistantMessageEvent.delta,
          });
        }
      });

      try {
        await record.session.prompt(text);
        emit(
          record.cancelled ? { type: "cancelled" } : { type: "turn_completed" },
        );
      } catch {
        emit(
          record.cancelled
            ? { type: "cancelled" }
            : { type: "error", message: PUBLIC_TURN_ERROR },
        );
      } finally {
        unsubscribe();
      }
    },

    async cancel(sessionId: string): Promise<void> {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error("Session not found");
      }

      record.cancelled = true;
      await record.session.abort();
    },
  };
}
