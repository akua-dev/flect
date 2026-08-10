import {
  defineProductIntegration,
  makeProductEventsLayer,
  makeProductGraphqlLayer,
  makeProductOperationFailure,
  ProductCapabilityManifest,
  type ProductEventConnector,
  ProductEventPolicy,
  ProductEventRequest,
  ProductEventSequence,
  ProductGraphql,
  ProductGraphqlPolicy,
  ProductGraphqlRequest,
  type ProductInferenceOwner,
  type ProductJson,
} from "@flect/product";
import { Effect, Schema } from "effect";
import {
  authorizeOperation,
  decodeOperationInput,
  makeReferenceExperience,
} from "./reference-support";

const PRODUCT_ID = "dev.flect.browser-projects";
const LIST = "browser-projects.list";
const WATCH = "browser-projects.watch";
const READ = "product.browser-projects.read";
const EVENTS = "product.browser-projects.events";
const GRAPHQL_POLICY = "browser-projects.graphql.v1";
const EVENT_POLICY = "browser-projects.events.v1";
const DOCUMENT =
  "query BrowserProjects($workspaceId: ID!) { projects(workspaceId: $workspaceId) { id name } }";

const manifests = [
  ProductCapabilityManifest.make({
    version: 1,
    id: READ,
    name: "Read browser projects",
    description: "Read bounded project summaries from one fixed GraphQL query.",
    operationIds: [LIST],
    resourceIds: ["browser-projects.reference"],
    dataClassIds: ["browser-projects.summary"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
  ProductCapabilityManifest.make({
    version: 1,
    id: EVENTS,
    name: "Watch browser projects",
    description: "Receive bounded ordered project events.",
    operationIds: [WATCH],
    resourceIds: ["browser-projects.reference"],
    dataClassIds: ["browser-projects.event"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
] as const;

const ListInput = Schema.Struct({ workspaceId: Schema.Literal("reference") });
const WatchInput = Schema.Struct({
  workspaceId: Schema.Literal("reference"),
  resumeAfter: Schema.optionalKey(ProductEventSequence),
});

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface BrowserProjectsAuthorizationRequest {
  readonly operationId: string;
  readonly input: ProductJson;
}

export interface BrowserProjectsOptions {
  readonly fetch: Fetch;
  readonly eventConnector: ProductEventConnector;
  readonly inferenceOwner?: ProductInferenceOwner;
  readonly authorize?: (
    request: BrowserProjectsAuthorizationRequest,
  ) => Effect.Effect<boolean>;
}

const digest = (value: string) =>
  Effect.promise(async () => {
    const result = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(result), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  });

export const makeBrowserProjectsProduct = Effect.fn(
  "Flect.Examples.makeBrowserProjectsProduct",
)(function* (options: BrowserProjectsOptions) {
  const graphqlPolicy = ProductGraphqlPolicy.make({
    version: 1,
    id: GRAPHQL_POLICY,
    endpoint: "https://products.flect.test/graphql",
    operationId: LIST,
    operationName: "BrowserProjects",
    operationType: "query",
    documentSha256: yield* digest(DOCUMENT),
    requestBytes: 16 * 1024,
    responseBytes: 64 * 1024,
    deadlineMs: 5_000,
  });
  const eventPolicy = ProductEventPolicy.make({
    version: 1,
    id: EVENT_POLICY,
    operationId: WATCH,
    bufferCapacity: 8,
    eventBytes: 16 * 1024,
    reconnectAttempts: 1,
    reconnectDelayMs: 100,
    sequenceResume: true,
  });
  const graphql = yield* ProductGraphql.pipe(
    Effect.provide(
      makeProductGraphqlLayer({
        registrations: [{ policy: graphqlPolicy, document: DOCUMENT }],
        fetch: options.fetch,
      }),
    ),
  );
  const allowed = (operationId: string, input: ProductJson) =>
    options.authorize?.({ operationId, input }) ?? Effect.succeed(true);
  const experience = yield* makeReferenceExperience({
    id: PRODUCT_ID,
    name: "Browser projects",
    revision: "browser-projects-v1",
    capabilities: manifests,
    publicInstructions:
      "Use only browser-projects.list and browser-projects.watch. Never construct a URL, document, cookie, or credential.",
    body: "<p>Projects from a fixed browser-direct product connection.</p>",
  });
  const integration = yield* defineProductIntegration({
    metadata: {
      version: 1,
      descriptor: {
        version: 1,
        id: PRODUCT_ID,
        name: "Browser projects",
        description: "A same-origin-session browser-direct product.",
        integrationVersion: "1.0.0",
        revision: "browser-projects-v1",
        productApiVersion: 1,
        connection: "browser-direct",
        authenticationOwner: "product",
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          platforms: ["browser", "macos"],
        },
        inference: {
          allowedOwners: ["user", "product"],
          defaultOwner: "user",
        },
      },
      experience: {
        version: 1,
        capsuleId: PRODUCT_ID,
        capsuleVersion: "1.0.0",
        archiveSha256: experience.archiveSha256,
        provenanceRevision: "browser-projects-v1",
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
                ["browser-projects.reference"],
                ["browser-projects.summary"],
                allowed(LIST, input),
              ),
            ),
          ),
        execute: (input) =>
          decodeOperationInput(LIST, ListInput, input).pipe(
            Effect.flatMap((variables) =>
              graphql.invoke(
                ProductGraphqlRequest.make({
                  version: 1,
                  policyId: GRAPHQL_POLICY,
                  variables,
                }),
              ),
            ),
            Effect.mapError(() =>
              makeProductOperationFailure(LIST, "request-failed"),
            ),
            Effect.flatMap((response) =>
              response.data === undefined
                ? Effect.fail(
                    makeProductOperationFailure(LIST, "invalid-output"),
                  )
                : Effect.succeed(response.data),
            ),
          ),
      },
    ],
    events: [
      {
        id: WATCH,
        capabilityId: EVENTS,
        policyId: EVENT_POLICY,
        authorize: (input) =>
          decodeOperationInput(WATCH, WatchInput, input).pipe(
            Effect.flatMap(() =>
              authorizeOperation(
                WATCH,
                EVENTS,
                ["browser-projects.reference"],
                ["browser-projects.event"],
                allowed(WATCH, input),
              ),
            ),
          ),
        request: (input) =>
          decodeOperationInput(WATCH, WatchInput, input).pipe(
            Effect.map((decoded) =>
              ProductEventRequest.make({
                version: 1,
                policyId: EVENT_POLICY,
                input: { workspaceId: decoded.workspaceId },
                ...(decoded.resumeAfter === undefined
                  ? {}
                  : { resumeAfter: decoded.resumeAfter }),
              }),
            ),
          ),
      },
    ],
    selectedInferenceOwner: options.inferenceOwner ?? "user",
    loadRecommendedExperience: Effect.succeed(experience.archive),
  });
  return {
    integration,
    events: makeProductEventsLayer({
      policies: [eventPolicy],
      connectors: new Map([[eventPolicy.id, options.eventConnector]]),
    }),
  };
});
