import type { ProductEventDefinition } from "@flect/product";
import { Context, Effect, Layer, Schema, type SchemaAST, Stream } from "effect";
import {
  AuthorizedProductOperation,
  type ProductCapabilityRequestContext,
  type ProductOperationFailure,
  type ProductOperationInvocation,
} from "../../shared/product-capability";
import {
  type ProductEvent,
  type ProductEventFailure,
  ProductEventRequest,
} from "../../shared/product-events";
import { ProductCapabilityBroker } from "./product-capability-broker";
import { ProductEvents } from "./product-events";
import {
  productOperationFailure,
  productOperationFailureFromBroker,
} from "./product-operation-failure";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const RESERVATION_INSPECTION_INTERVAL = 100;

export type { ProductEventDefinition } from "@flect/product";

export interface ProductEventRegistryShape {
  readonly subscribe: (
    context: ProductCapabilityRequestContext,
    invocation: ProductOperationInvocation,
  ) => Stream.Stream<ProductEvent, ProductOperationFailure>;
}

export class ProductEventRegistry extends Context.Service<
  ProductEventRegistry,
  ProductEventRegistryShape
>()("flect/ProductEventRegistry") {}

const eventFailure = (operationId: string, error: ProductEventFailure) => {
  switch (error.reason) {
    case "denied":
      return productOperationFailure(operationId, "denied");
    case "revoked":
      return productOperationFailure(operationId, "revoked");
    case "invalid-policy":
      return productOperationFailure(operationId, "unavailable");
    case "invalid-event":
    case "overflow":
    case "sequence-violation":
    case "transport":
    case "reconnect-exhausted":
      return productOperationFailure(operationId, "request-failed");
  }
};

export const makeProductEventRegistryLayer = (options: {
  readonly operations: ReadonlyArray<ProductEventDefinition>;
}) =>
  Layer.effect(
    ProductEventRegistry,
    Effect.gen(function* () {
      const broker = yield* ProductCapabilityBroker;
      const events = yield* ProductEvents;
      const operations = new Map(
        options.operations.map((operation) => [operation.id, operation]),
      );
      if (operations.size !== options.operations.length) {
        const duplicate = options.operations[0]?.id ?? "events.invalid";
        return yield* Effect.fail(productOperationFailure(duplicate, "denied"));
      }

      const subscribe = (
        context: ProductCapabilityRequestContext,
        invocation: ProductOperationInvocation,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const definition = operations.get(invocation.operationId);
            if (definition === undefined) {
              return yield* Effect.fail(
                productOperationFailure(invocation.operationId, "denied"),
              );
            }
            const reservation = yield* broker
              .reserve(
                context,
                AuthorizedProductOperation.make({
                  version: 1,
                  capabilityId: definition.capabilityId,
                  operationId: definition.id,
                  resourceIds: [],
                  dataClassIds: [],
                }),
              )
              .pipe(
                Effect.mapError((error) =>
                  productOperationFailureFromBroker(
                    invocation.operationId,
                    error,
                  ),
                ),
              );
            const authorization = yield* definition.authorize(invocation.input);
            const authorizedOperation = yield* Schema.decodeUnknownEffect(
              AuthorizedProductOperation,
              strict,
            )(authorization).pipe(
              Effect.mapError(() =>
                productOperationFailure(
                  invocation.operationId,
                  "invalid-input",
                ),
              ),
            );
            yield* broker
              .validate(reservation, authorizedOperation)
              .pipe(
                Effect.mapError((error) =>
                  productOperationFailureFromBroker(
                    invocation.operationId,
                    error,
                  ),
                ),
              );
            const candidateRequest = yield* definition.request(
              invocation.input,
            );
            const request = yield* Schema.decodeUnknownEffect(
              ProductEventRequest,
              strict,
            )(candidateRequest).pipe(
              Effect.mapError(() =>
                productOperationFailure(
                  invocation.operationId,
                  "invalid-input",
                ),
              ),
            );
            if (request.policyId !== definition.policyId) {
              return yield* Effect.fail(
                productOperationFailure(invocation.operationId, "denied"),
              );
            }
            const inspect = Effect.forever(
              Effect.sleep(RESERVATION_INSPECTION_INTERVAL).pipe(
                Effect.andThen(broker.inspectReservation(reservation)),
                Effect.mapError((error) =>
                  productOperationFailureFromBroker(
                    invocation.operationId,
                    error,
                  ),
                ),
              ),
            );
            return events.subscribe(request).pipe(
              Stream.mapError((error) =>
                eventFailure(invocation.operationId, error),
              ),
              Stream.interruptWhen(inspect),
            );
          }),
        );

      return { subscribe };
    }),
  );
