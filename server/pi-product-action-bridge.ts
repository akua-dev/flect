import { defineTool } from "@earendil-works/pi-coding-agent";
import { Deferred, Effect, Ref } from "effect";
import { Type } from "typebox";
import { PiOperationFailed } from "../shared/contracts";
import {
  AgentProductActionRequest,
  ProductActionResult,
} from "../shared/product-action";

const productActionFailure = () =>
  PiOperationFailed.make({
    operation: "product_action",
    message: "The model runtime could not complete the request.",
  });

const safeResult = (status: "denied" | "error", message: string) =>
  ProductActionResult.make({
    version: 1,
    status,
    resultJson: JSON.stringify({ message }),
  });

export const makePiProductActionBridge = Effect.fn(
  "Flect.PiProductActionBridge.make",
)(function* (
  capabilityId: string,
  emit: (event: AgentProductActionRequest) => void,
) {
  const pending = yield* Ref.make<
    ReadonlyMap<string, Deferred.Deferred<ProductActionResult>>
  >(new Map());

  const request = Effect.fn("Flect.PiProductActionBridge.request")(function* (
    action: string,
    inputJson: string,
  ) {
    const requestId = `action-${crypto.randomUUID()}`;
    const response = yield* Deferred.make<ProductActionResult>();
    yield* Ref.update(pending, (current) => {
      const next = new Map(current);
      next.set(requestId, response);
      return next;
    });
    emit(
      AgentProductActionRequest.make({
        type: "product_action_request",
        requestId,
        capabilityId,
        action,
        inputJson,
      }),
    );
    return yield* Deferred.await(response).pipe(
      Effect.timeoutOrElse({
        duration: "2 minutes",
        orElse: () =>
          Effect.succeed(
            safeResult("denied", "The product action confirmation timed out."),
          ),
      }),
      Effect.ensuring(
        Ref.update(pending, (current) => {
          const next = new Map(current);
          next.delete(requestId);
          return next;
        }),
      ),
    );
  });

  const complete = Effect.fn("Flect.PiProductActionBridge.complete")(function* (
    requestId: string,
    result: ProductActionResult,
  ) {
    const current = yield* Ref.get(pending);
    const response = current.get(requestId);
    if (response === undefined) {
      return yield* Effect.fail(productActionFailure());
    }
    const accepted = yield* Deferred.succeed(response, result);
    if (!accepted) {
      return yield* Effect.fail(productActionFailure());
    }
  });

  const releasePending = Effect.fn(
    "Flect.PiProductActionBridge.releasePending",
  )((message: string) =>
    Ref.getAndSet(pending, new Map()).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(
          current.values(),
          (response) =>
            Deferred.succeed(response, safeResult("denied", message)),
          { discard: true },
        ),
      ),
    ),
  );

  const cancel = releasePending("The product action was cancelled.");
  const close = releasePending("The product action session closed.");

  const tool = defineTool({
    name: "product_action",
    label: "Product action",
    description:
      "Use the currently granted product through its bounded action API. Call inspect first. State-changing actions pause for explicit user confirmation.",
    parameters: Type.Object(
      {
        action: Type.String({
          minLength: 1,
          maxLength: 80,
          pattern: "^[a-z][a-z0-9_]*$",
          description: "The action identifier exposed by the product.",
        }),
        inputJson: Type.String({
          minLength: 2,
          maxLength: 16_384,
          description: "A JSON object containing the exact action input.",
        }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const result = await Effect.runPromise(
        request(params.action, params.inputJson),
        signal === undefined ? undefined : { signal },
      );
      return {
        content: [{ type: "text", text: result.resultJson }],
        details: { status: result.status },
      };
    },
  });

  return { request, complete, cancel, close, tool };
});
