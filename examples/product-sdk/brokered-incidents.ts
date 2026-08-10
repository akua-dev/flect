import {
  defineProductIntegration,
  makeProductEventsLayer,
  makeProductOperationFailure,
  ProductCapabilityManifest,
  type ProductInferenceOwner,
  type ProductJson,
  ProductOperationFailure,
} from "@flect/product";
import { Cause, Effect, Schema } from "effect";
import {
  authorizeOperation,
  decodeOperationInput,
  makeReferenceExperience,
} from "./reference-support";

const PRODUCT_ID = "dev.flect.brokered-incidents";
const LIST = "brokered-incidents.list";
const ACKNOWLEDGE = "brokered-incidents.acknowledge";
const READ = "product.brokered-incidents.read";
const WRITE = "product.brokered-incidents.write";

const manifests = [
  ProductCapabilityManifest.make({
    version: 1,
    id: READ,
    name: "Read incidents",
    description:
      "Read bounded incidents through the configured product broker.",
    operationIds: [LIST],
    resourceIds: ["brokered-incidents.workspace"],
    dataClassIds: ["brokered-incidents.summary"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
  ProductCapabilityManifest.make({
    version: 1,
    id: WRITE,
    name: "Acknowledge an incident",
    description: "Acknowledge one incident through a named broker operation.",
    operationIds: [ACKNOWLEDGE],
    resourceIds: ["brokered-incidents.inc-1"],
    dataClassIds: ["brokered-incidents.status"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
] as const;

const ListInput = Schema.Struct({});
const AcknowledgeInput = Schema.Struct({
  incidentId: Schema.Literal("inc-1"),
});

export interface ProductBrokerRequest {
  readonly operationId: typeof LIST | typeof ACKNOWLEDGE;
  readonly input: ProductJson;
}

export interface BrokeredIncidentsOptions {
  readonly broker: (
    request: ProductBrokerRequest,
  ) => Effect.Effect<ProductJson, ProductOperationFailure>;
  readonly inferenceOwner?: ProductInferenceOwner;
  readonly authorize?: (
    request: ProductBrokerRequest,
  ) => Effect.Effect<boolean>;
}

export const makeBrokeredIncidentsProduct = Effect.fn(
  "Flect.Examples.makeBrokeredIncidentsProduct",
)(function* (options: BrokeredIncidentsOptions) {
  const allowed = (request: ProductBrokerRequest) =>
    options.authorize?.(request) ?? Effect.succeed(true);
  const broker = (request: ProductBrokerRequest) =>
    options.broker(request).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
        const failures = cause.reasons.filter(Cause.isFailReason);
        const error = failures[0]?.error;
        return failures.length === cause.reasons.length &&
          Schema.is(ProductOperationFailure)(error)
          ? Effect.fail(error)
          : Effect.fail(
              makeProductOperationFailure(
                request.operationId,
                "request-failed",
              ),
            );
      }),
    );
  const experience = yield* makeReferenceExperience({
    id: PRODUCT_ID,
    name: "Brokered incidents",
    revision: "brokered-incidents-v1",
    capabilities: manifests,
    publicInstructions:
      "Use only brokered-incidents.list and brokered-incidents.acknowledge. Never ask for broker endpoints, headers, tokens, or credentials.",
    body: "<p>Incidents through an explicitly configured authenticated broker.</p>",
  });
  const integration = yield* defineProductIntegration({
    metadata: {
      version: 1,
      descriptor: {
        version: 1,
        id: PRODUCT_ID,
        name: "Brokered incidents",
        description: "An authenticated named-operation broker integration.",
        integrationVersion: "1.0.0",
        revision: "brokered-incidents-v1",
        productApiVersion: 1,
        connection: "brokered",
        authenticationOwner: "host",
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          platforms: ["browser", "macos"],
        },
        inference: {
          allowedOwners: ["user", "product"],
          defaultOwner: "product",
        },
      },
      experience: {
        version: 1,
        capsuleId: PRODUCT_ID,
        capsuleVersion: "1.0.0",
        archiveSha256: experience.archiveSha256,
        provenanceRevision: "brokered-incidents-v1",
        appExtensionIds: experience.appExtensionIds,
        shaperExtensionIds: experience.shaperExtensionIds,
      },
      capabilities: manifests,
      migrations: [],
    },
    operations: [
      {
        id: LIST,
        capabilityId: READ,
        authorize: (input) =>
          decodeOperationInput(LIST, ListInput, input).pipe(
            Effect.flatMap(() =>
              authorizeOperation(
                LIST,
                READ,
                ["brokered-incidents.workspace"],
                ["brokered-incidents.summary"],
                allowed({ operationId: LIST, input }),
              ),
            ),
          ),
        execute: (input) =>
          decodeOperationInput(LIST, ListInput, input).pipe(
            Effect.flatMap(() => broker({ operationId: LIST, input })),
          ),
      },
      {
        id: ACKNOWLEDGE,
        capabilityId: WRITE,
        authorize: (input) =>
          decodeOperationInput(ACKNOWLEDGE, AcknowledgeInput, input).pipe(
            Effect.flatMap(() =>
              authorizeOperation(
                ACKNOWLEDGE,
                WRITE,
                ["brokered-incidents.inc-1"],
                ["brokered-incidents.status"],
                allowed({ operationId: ACKNOWLEDGE, input }),
              ),
            ),
          ),
        execute: (input) =>
          decodeOperationInput(ACKNOWLEDGE, AcknowledgeInput, input).pipe(
            Effect.flatMap(() => broker({ operationId: ACKNOWLEDGE, input })),
          ),
      },
    ],
    events: [],
    selectedInferenceOwner: options.inferenceOwner ?? "product",
    loadRecommendedExperience: Effect.succeed(experience.archive),
  });
  return {
    integration,
    events: makeProductEventsLayer({ policies: [], connectors: new Map() }),
  };
});
