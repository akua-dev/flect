import {
  defineProductIntegration,
  makeProductEventsLayer,
  ProductCapabilityManifest,
  type ProductInferenceOwner,
  type ProductJson,
} from "@flect/product";
import { Effect, Schema } from "effect";
import {
  authorizeOperation,
  decodeOperationInput,
  makeReferenceExperience,
} from "./reference-support";

const PRODUCT_ID = "dev.flect.offline-board";
const LIST = "offline-board.cards.list";
const ADD = "offline-board.cards.add";
const READ = "product.offline-board.cards.read";
const WRITE = "product.offline-board.cards.write";

const manifests = [
  ProductCapabilityManifest.make({
    version: 1,
    id: READ,
    name: "Read board cards",
    description: "Read cards stored inside this local Flect product.",
    operationIds: [LIST],
    resourceIds: ["offline-board.workspace"],
    dataClassIds: ["offline-board.cards"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
  ProductCapabilityManifest.make({
    version: 1,
    id: WRITE,
    name: "Add a board card",
    description: "Add one bounded card to the local board.",
    operationIds: [ADD],
    resourceIds: ["offline-board.workspace"],
    dataClassIds: ["offline-board.cards"],
    confirmationPolicies: ["once", "session", "workspace", "persistent"],
  }),
] as const;

const ListInput = Schema.Struct({});
const AddInput = Schema.Struct({
  title: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
});

export interface OfflineBoardAuthorizationRequest {
  readonly operationId: string;
  readonly input: ProductJson;
}

export interface OfflineBoardOptions {
  readonly inferenceOwner?: ProductInferenceOwner;
  readonly authorize?: (
    request: OfflineBoardAuthorizationRequest,
  ) => Effect.Effect<boolean>;
}

export const makeOfflineBoardProduct = Effect.fn(
  "Flect.Examples.makeOfflineBoardProduct",
)(function* (options: OfflineBoardOptions = {}) {
  const cards: Array<{ readonly id: string; readonly title: string }> = [
    { id: "welcome", title: "Shape this board" },
  ];
  const allowed = (operationId: string, input: ProductJson) =>
    options.authorize?.({ operationId, input }) ?? Effect.succeed(true);
  const experience = yield* makeReferenceExperience({
    id: PRODUCT_ID,
    name: "Offline board",
    revision: "offline-board-v1",
    capabilities: manifests,
    publicInstructions:
      "Use only offline-board.cards.list and offline-board.cards.add. Never request network access or credentials.",
    body: "<p>A local-first board that remains available offline.</p>",
  });
  const integration = yield* defineProductIntegration({
    metadata: {
      version: 1,
      descriptor: {
        version: 1,
        id: PRODUCT_ID,
        name: "Offline board",
        description: "A local board with no network or authentication.",
        integrationVersion: "1.0.0",
        revision: "offline-board-v1",
        productApiVersion: 1,
        connection: "offline",
        authenticationOwner: "none",
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
        provenanceRevision: "offline-board-v1",
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
                ["offline-board.workspace"],
                ["offline-board.cards"],
                allowed(LIST, input),
              ),
            ),
          ),
        execute: (input) =>
          decodeOperationInput(LIST, ListInput, input).pipe(
            Effect.map(() => ({ cards: [...cards] })),
          ),
      },
      {
        id: ADD,
        capabilityId: WRITE,
        authorize: (input) =>
          decodeOperationInput(ADD, AddInput, input).pipe(
            Effect.flatMap(() =>
              authorizeOperation(
                ADD,
                WRITE,
                ["offline-board.workspace"],
                ["offline-board.cards"],
                allowed(ADD, input),
              ),
            ),
          ),
        execute: (input) =>
          decodeOperationInput(ADD, AddInput, input).pipe(
            Effect.flatMap((decoded) =>
              Effect.sync(() => {
                const card = {
                  id: `card-${cards.length + 1}`,
                  title: decoded.title,
                };
                cards.push(card);
                return { card };
              }),
            ),
          ),
      },
    ],
    events: [],
    selectedInferenceOwner: options.inferenceOwner ?? "user",
    loadRecommendedExperience: Effect.succeed(experience.archive),
  });
  return {
    integration,
    events: makeProductEventsLayer({ policies: [], connectors: new Map() }),
  };
});
