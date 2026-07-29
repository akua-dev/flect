import { Effect } from "effect";
import { FlectRpcs } from "../shared/rpc";
import { FlectRuntime } from "./runtime";

export const makeFlectRpcHandlers = () =>
  FlectRpcs.toLayer(
    Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      return FlectRpcs.of({
        GetRuntime: () => runtime.status,
        ListModels: () => runtime.listModels,
        CreateSession: (selection) => runtime.createSession(selection),
        Prompt: ({ sessionId, text }) => runtime.prompt(sessionId, text),
        Shape: ({ sessionId, instruction, document }) =>
          runtime.shape(sessionId, instruction, document),
        Cancel: ({ sessionId }) => runtime.cancel(sessionId),
      });
    }),
  );
