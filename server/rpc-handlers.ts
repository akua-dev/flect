import { Effect, Stream } from "effect";
import { validateInterfaceDocument } from "../shared/interface-document";
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
        CloseSession: ({ sessionId }) => runtime.closeSession(sessionId),
        Prompt: ({ sessionId, text }) => runtime.prompt(sessionId, text),
        Shape: ({ sessionId, instruction, document }) =>
          Effect.gen(function* () {
            const validated = yield* validateInterfaceDocument(document);
            return runtime.shape(sessionId, instruction, validated);
          }).pipe(Stream.unwrap),
        Cancel: ({ sessionId, role }) => runtime.cancel(sessionId, role),
        CompleteShellRequest: ({ sessionId, role, requestId, result }) =>
          runtime.completeShellRequest(sessionId, role, requestId, result),
        DiagnoseRecovery: ({ sessionId, reason }) =>
          runtime.diagnoseRecovery(sessionId, reason),
      });
    }),
  );
