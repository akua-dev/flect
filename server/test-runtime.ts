import { Effect, Layer, Stream } from "effect";
import {
  GuardianDiagnostic,
  ModelSummary,
  RuntimeStatus,
  TextDelta,
  TurnCompleted,
  TurnStarted,
} from "../shared/contracts";
import {
  type InterfaceDocument,
  InterfaceDocument as InterfaceDocumentSchema,
  validateInterfaceDocument,
} from "../shared/interface-document";
import { FlectRuntime } from "./runtime";

const model = ModelSummary.make({
  provider: "flect-test",
  id: "deterministic",
  name: "Deterministic browser test",
});

const shapedDocument = (_current: InterfaceDocument): InterfaceDocument =>
  InterfaceDocumentSchema.make({
    version: 2,
    name: "Focused workspace",
    root: {
      id: "root",
      type: "stack",
      direction: "column",
      gap: "lg",
      children: [
        {
          id: "headline",
          type: "text",
          text: "Focused workspace",
          style: "headline",
        },
        {
          id: "prompt",
          type: "prompt",
          placeholder: "Ask Flect to shape this workspace",
        },
        {
          id: "secondary-actions",
          type: "stack",
          direction: "row",
          gap: "sm",
          children: [
            {
              id: "shape-interface",
              type: "button",
              label: "Shape interface",
              action: "shape",
            },
          ],
        },
      ],
    },
  });

export const FlectTestRuntimeLive = Layer.succeed(FlectRuntime)({
  status: Effect.succeed(RuntimeStatus.make({ version: 1, status: "ready" })),
  listModels: Effect.succeed([model]),
  createSession: () => Effect.succeed("browser-test-session"),
  closeSession: () => Effect.void,
  prompt: () =>
    Stream.make(
      TurnStarted.make({ type: "turn_started" }),
      TextDelta.make({
        type: "text_delta",
        delta: "Flect’s protected test runtime is ready.",
      }),
      TurnCompleted.make({ type: "turn_completed" }),
    ),
  shape: (_sessionId, _instruction, input) =>
    validateInterfaceDocument(input).pipe(
      Effect.map(shapedDocument),
      Effect.delay("100 millis"),
    ),
  cancel: () => Effect.void,
  diagnoseRecovery: () =>
    Effect.succeed(
      GuardianDiagnostic.make({
        version: 1,
        message: "The protected launcher remains available.",
      }),
    ),
});
