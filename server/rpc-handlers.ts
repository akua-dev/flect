import { Effect, Stream } from "effect";
import { ControlTransportFailed } from "../shared/control-channel";
import { validateInterfaceDocument } from "../shared/interface-document";
import { FlectRpcs } from "../shared/rpc";
import { AgentIntegration } from "../src/lib/agent-integration";
import { FlectControlBroker } from "./control-broker";
import { FlectRuntime } from "./runtime";

const controlFailure = () =>
  ControlTransportFailed.make({
    message: "The local control transport is unavailable.",
  });

export const makeFlectRpcHandlers = () =>
  FlectRpcs.toLayer(
    Effect.gen(function* () {
      const runtime = yield* FlectRuntime;
      const control = yield* FlectControlBroker;
      const integrations = yield* AgentIntegration;
      const mapControl = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.mapError(controlFailure));
      return FlectRpcs.of({
        GetRuntime: () => runtime.status,
        ListModels: () => runtime.listModels,
        ListProviderAuth: () => runtime.providerAuth,
        LoginProvider: (request) => runtime.loginProvider(request),
        ReplyProviderAuthSelection: (reply) => runtime.replyProviderAuth(reply),
        CancelProviderAuth: (reference) =>
          runtime.cancelProviderAuth(reference),
        RefreshProviderAuth: () => runtime.refreshProviderAuth,
        LogoutProvider: ({ providerId }) => runtime.logoutProvider(providerId),
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
        ControlEnable: ({ snapshot }) => mapControl(control.enable(snapshot)),
        ControlDisable: () =>
          control.disable.pipe(Effect.asVoid, Effect.mapError(controlFailure)),
        ControlPublishSnapshot: ({ snapshot }) =>
          mapControl(control.publishSnapshot(snapshot)),
        ControlPublishEvent: ({ event }) =>
          mapControl(control.publishEvent(event)),
        ControlNextCommand: ({ workspaceId }) =>
          mapControl(control.nextCommand(workspaceId)),
        ControlComplete: ({ completion }) =>
          mapControl(control.complete(completion)),
        SetupAgentStatus: () => integrations.statusAll,
        SetupAgentInstall: ({ host }) => integrations.install(host),
        SetupAgentRemove: ({ host }) => integrations.remove(host),
      });
    }),
  );
