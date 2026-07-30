import { Deferred, Effect, Layer, Ref, Stream } from "effect";
import type { BunCommandResult } from "../shared/bun-command";
import {
  AgentShellRequest,
  GuardianDiagnostic,
  ModelSummary,
  RuntimeStatus,
  ShapeCompleted,
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

export const FlectTestRuntimeLive = Layer.effect(
  FlectRuntime,
  Effect.gen(function* () {
    const pending = yield* Ref.make<
      ReadonlyMap<string, Deferred.Deferred<BunCommandResult>>
    >(new Map());

    return {
      status: Effect.succeed(
        RuntimeStatus.make({ version: 1, status: "ready" }),
      ),
      listModels: Effect.succeed([model]),
      createSession: () => Effect.succeed("browser-test-session"),
      closeSession: () => Effect.void,
      prompt: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const requestId = `shell-${crypto.randomUUID()}`;
            const response = yield* Deferred.make<BunCommandResult>();
            yield* Ref.update(pending, (current) => {
              const next = new Map(current);
              next.set(requestId, response);
              return next;
            });
            return Stream.make(
              TurnStarted.make({ type: "turn_started" }),
              AgentShellRequest.make({
                type: "shell_request",
                requestId,
                command: "bun run src/index.ts",
              }),
            ).pipe(
              Stream.concat(
                Stream.fromEffect(Deferred.await(response)).pipe(
                  Stream.map((result) =>
                    TextDelta.make({
                      type: "text_delta",
                      delta: `Flect’s protected test runtime is ready. Browser sandbox returned: ${result.stdout.trim()}`,
                    }),
                  ),
                ),
              ),
              Stream.concat(
                Stream.succeed(TurnCompleted.make({ type: "turn_completed" })),
              ),
            );
          }),
        ),
      shape: (_sessionId, _instruction, input) =>
        Stream.fromEffect(validateInterfaceDocument(input)).pipe(
          Stream.map((document) =>
            ShapeCompleted.make({
              type: "shape_completed",
              document: shapedDocument(document),
            }),
          ),
          Stream.mapEffect((event) => Effect.succeed(event).pipe(Effect.delay("100 millis"))),
        ),
      cancel: () => Effect.void,
      completeShellRequest: (_sessionId, requestId, result) =>
        Ref.modify(pending, (current) => {
          const response = current.get(requestId);
          if (response === undefined) {
            return [undefined, current];
          }
          const next = new Map(current);
          next.delete(requestId);
          return [response, next];
        }).pipe(
          Effect.flatMap((response) =>
            response === undefined
              ? Effect.void
              : Deferred.succeed(response, result).pipe(Effect.asVoid),
          ),
        ),
      diagnoseRecovery: () =>
        Effect.succeed(
          GuardianDiagnostic.make({
            version: 1,
            message: "The protected launcher remains available.",
          }),
        ),
    };
  }),
);
