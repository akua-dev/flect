import type { ProductOperationDefinition } from "@flect/product";
import { Context, Effect, Layer, Schema } from "effect";
import {
  AuthorizedProductOperation,
  ProductCapabilityBrokerFailure,
  type ProductCapabilityDecisionChoice,
  type ProductCapabilityProjection,
  type ProductCapabilityRequestContext,
  type ProductJson,
  ProductOperationExecution,
  type ProductOperationFailure,
  type ProductOperationInvocation,
  ProductOperationSummary,
} from "../../shared/product-capability";
import { ProductCapabilityBroker } from "./product-capability-broker";
import type { ProductCapabilityDecisionStoreFailure } from "./product-capability-decision-store";
import {
  productOperationFailure,
  productOperationFailureFromBroker,
} from "./product-operation-failure";

export type { ProductOperationDefinition } from "@flect/product";

export interface ProductCapabilityRegistryShape {
  readonly catalog: (
    context: ProductCapabilityRequestContext,
  ) => Effect.Effect<ReadonlyArray<ProductOperationSummary>>;
  readonly permissions: (
    context: ProductCapabilityRequestContext,
  ) => Effect.Effect<ReadonlyArray<ProductCapabilityProjection>>;
  readonly decide: (
    context: ProductCapabilityRequestContext,
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => Effect.Effect<
    ProductCapabilityProjection,
    ProductCapabilityBrokerFailure
  >;
  readonly revoke: (
    decisionId: string,
  ) => Effect.Effect<void, ProductCapabilityBrokerFailure>;
  readonly invoke: (
    context: ProductCapabilityRequestContext,
    invocation: ProductOperationInvocation,
  ) => Effect.Effect<ProductJson, ProductOperationFailure>;
  readonly invokeDetailed: (
    context: ProductCapabilityRequestContext,
    invocation: ProductOperationInvocation,
  ) => Effect.Effect<ProductOperationExecution, ProductOperationFailure>;
  readonly warnings?: Effect.Effect<
    ReadonlyArray<ProductCapabilityDecisionStoreFailure>
  >;
}

export class ProductCapabilityRegistry extends Context.Service<
  ProductCapabilityRegistry,
  ProductCapabilityRegistryShape
>()("flect/ProductCapabilityRegistry") {}

export const makeProductCapabilityRegistryLayer = (options: {
  readonly operations: ReadonlyArray<ProductOperationDefinition>;
}) =>
  Layer.effect(
    ProductCapabilityRegistry,
    Effect.gen(function* () {
      const broker = yield* ProductCapabilityBroker;
      const operations = new Map(
        options.operations.map((operation) => [operation.id, operation]),
      );

      const permissions = Effect.fn(
        "Flect.ProductCapabilityRegistry.permissions",
      )((context: ProductCapabilityRequestContext) => broker.catalog(context));

      const catalog = Effect.fn("Flect.ProductCapabilityRegistry.catalog")(
        function* (context: ProductCapabilityRequestContext) {
          const projections = yield* broker.catalog(context);
          return options.operations.map((operation) => {
            const permission = projections.find(
              (projection) =>
                projection.capabilityId === operation.capabilityId,
            );
            return ProductOperationSummary.make({
              version: 1,
              id: operation.id,
              capabilityId: operation.capabilityId,
              permission,
            });
          });
        },
      );

      const decide = Effect.fn("Flect.ProductCapabilityRegistry.decide")(
        (
          context: ProductCapabilityRequestContext,
          capabilityId: string,
          choice: ProductCapabilityDecisionChoice,
        ) => broker.decide(context, capabilityId, choice),
      );

      const revoke = Effect.fn("Flect.ProductCapabilityRegistry.revoke")(
        (decisionId: string) => broker.revoke(decisionId),
      );

      const invokeDetailed = Effect.fn(
        "Flect.ProductCapabilityRegistry.invokeDetailed",
      )(function* (
        context: ProductCapabilityRequestContext,
        invocation: ProductOperationInvocation,
      ) {
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
              productOperationFailureFromBroker(invocation.operationId, error),
            ),
          );
        const authorization = yield* definition.authorize(invocation.input);
        const authorizedOperation = yield* Schema.decodeUnknownEffect(
          AuthorizedProductOperation,
        )(authorization).pipe(
          Effect.mapError(() =>
            productOperationFailure(invocation.operationId, "invalid-input"),
          ),
        );
        yield* broker
          .validate(reservation, authorizedOperation)
          .pipe(
            Effect.mapError((error) =>
              productOperationFailureFromBroker(invocation.operationId, error),
            ),
          );
        const output = yield* broker
          .withReservation(
            reservation,
            authorizedOperation,
            definition.execute(invocation.input).pipe(
              Effect.flatMap((candidate) =>
                Schema.decodeUnknownEffect(Schema.Json)(candidate),
              ),
              Effect.mapError(() =>
                productOperationFailure(
                  invocation.operationId,
                  "invalid-output",
                ),
              ),
            ),
          )
          .pipe(
            Effect.mapError((error) =>
              Schema.is(ProductCapabilityBrokerFailure)(error)
                ? productOperationFailureFromBroker(
                    invocation.operationId,
                    error,
                  )
                : error,
            ),
          );
        return ProductOperationExecution.make({
          version: 1,
          output,
          reservation,
        });
      });

      const invoke = Effect.fn("Flect.ProductCapabilityRegistry.invoke")(
        (
          context: ProductCapabilityRequestContext,
          invocation: ProductOperationInvocation,
        ) =>
          invokeDetailed(context, invocation).pipe(
            Effect.map((execution) => execution.output),
          ),
      );

      return {
        catalog,
        decide,
        invoke,
        invokeDetailed,
        permissions,
        revoke,
        warnings: broker.warnings,
      };
    }),
  );
