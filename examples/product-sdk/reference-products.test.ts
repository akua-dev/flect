import { assert, describe, it } from "@effect/vitest";
import {
  createProductConnectionRecord,
  decodeCapsule,
  detachProduct,
  evaluateProductAdoption,
  PrivateShareSources,
  ProductCapabilityAllowChoice,
  ProductCapabilityRequestContext,
  ProductEvent,
  ProductHostFacts,
  type ProductIntegration,
  type ProductJson,
  ProductOperationInvocation,
  ProductUserState,
} from "@flect/product";
import { Effect, Layer, Result, Stream } from "effect";
import { ProductCapabilityBroker } from "../../src/capabilities/product-capability-broker";
import { ProductCapabilityDecisionStore } from "../../src/capabilities/product-capability-decision-store";
import { ProductCapabilityRegistry } from "../../src/capabilities/product-capability-registry";
import { ProductEventRegistry } from "../../src/capabilities/product-event-registry";
import { makeProductIntegrationRuntimeLayer } from "../../src/capabilities/product-integration";
import {
  makeBrokeredIncidentsProduct,
  type ProductBrokerRequest,
} from "./brokered-incidents";
import { makeBrowserProjectsProduct } from "./browser-projects";
import { makeOfflineBoardProduct } from "./offline-board";
import { makePrivateSharingReference } from "./private-sharing";

const decisionStore = Layer.succeed(ProductCapabilityDecisionStore)({
  load: () => Effect.succeed({ decisions: [] }),
  save: () => Effect.void,
});

const contextFor = (integration: ProductIntegration) =>
  ProductCapabilityRequestContext.make({
    version: 1,
    scopeId: integration.metadata.descriptor.id,
    workspaceId: "workspace-product-sdk",
    requestDigest:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    revision: integration.metadata.descriptor.revision,
    capabilities: integration.metadata.capabilities.map((manifest) => ({
      capabilityId: manifest.id,
      required: true,
    })),
  });

const grantAll = (integration: ProductIntegration) =>
  Effect.gen(function* () {
    const broker = yield* ProductCapabilityBroker;
    const context = contextFor(integration);
    for (const capability of integration.metadata.capabilities) {
      yield* broker.decide(
        context,
        capability.id,
        ProductCapabilityAllowChoice.make({
          type: "allow",
          confirmationPolicy: "session",
        }),
      );
    }
    return context;
  });

const host = ProductHostFacts.make({
  version: 1,
  flectVersion: "0.2.0",
  platform: "browser",
  online: true,
  productSessionAvailable: true,
  brokerAvailable: true,
  nativeAuthenticationAvailable: false,
});

const userStateFor = (integration: ProductIntegration) =>
  ProductUserState.make({
    version: 1,
    productId: integration.metadata.descriptor.id,
    forkRevision: "refs/heads/user/personal",
    exportedSnapshotDigest:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decisionIds: [],
    selectedInferenceOwner: integration.selectedInferenceOwner,
  });

describe("@flect/product reference adopters", () => {
  it.effect(
    "keeps authorization inputs invariant across inference owners",
    () =>
      Effect.gen(function* () {
        const requests: Array<string> = [];
        const record =
          (product: string) =>
          (request: {
            readonly operationId: string;
            readonly input: ProductJson;
          }) => {
            requests.push(`${product}:${JSON.stringify(request)}`);
            return Effect.succeed(true);
          };
        const connector = { open: () => Effect.void };
        const browserFetch = async () =>
          new Response('{"data":{}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        const cases = [
          {
            input: {},
            factory: (owner: "user" | "product") =>
              makeOfflineBoardProduct({
                inferenceOwner: owner,
                authorize: record("offline"),
              }),
          },
          {
            input: { workspaceId: "reference" },
            factory: (owner: "user" | "product") =>
              makeBrowserProjectsProduct({
                inferenceOwner: owner,
                fetch: browserFetch,
                eventConnector: connector,
                authorize: record("browser"),
              }),
          },
          {
            input: {},
            factory: (owner: "user" | "product") =>
              makeBrokeredIncidentsProduct({
                inferenceOwner: owner,
                broker: () => Effect.succeed({ incidents: [] }),
                authorize: record("broker"),
              }),
          },
        ] as const;

        for (const candidate of cases) {
          const user = yield* candidate.factory("user");
          const product = yield* candidate.factory("product");
          yield* user.integration.operations[0]?.authorize(candidate.input);
          yield* product.integration.operations[0]?.authorize(candidate.input);
        }

        assert.deepStrictEqual(requests, [
          'offline:{"operationId":"offline-board.cards.list","input":{}}',
          'offline:{"operationId":"offline-board.cards.list","input":{}}',
          'browser:{"operationId":"browser-projects.list","input":{"workspaceId":"reference"}}',
          'browser:{"operationId":"browser-projects.list","input":{"workspaceId":"reference"}}',
          'broker:{"operationId":"brokered-incidents.list","input":{}}',
          'broker:{"operationId":"brokered-incidents.list","input":{}}',
        ]);
      }),
  );

  it.effect(
    "runs and personalizes the offline board without network or auth",
    () =>
      Effect.gen(function* () {
        const reference = yield* makeOfflineBoardProduct();
        const runtime = makeProductIntegrationRuntimeLayer(reference).pipe(
          Layer.provide(decisionStore),
        );
        const outputs = yield* Effect.gen(function* () {
          const context = yield* grantAll(reference.integration);
          const registry = yield* ProductCapabilityRegistry;
          const before = yield* registry.invoke(
            context,
            ProductOperationInvocation.make({
              version: 1,
              operationId: "offline-board.cards.list",
              input: {},
            }),
          );
          yield* registry.invoke(
            context,
            ProductOperationInvocation.make({
              version: 1,
              operationId: "offline-board.cards.add",
              input: { title: "Ship Flect" },
            }),
          );
          const after = yield* registry.invoke(
            context,
            ProductOperationInvocation.make({
              version: 1,
              operationId: "offline-board.cards.list",
              input: {},
            }),
          );
          return { before, after };
        }).pipe(Effect.provide(runtime));
        const capsule =
          yield* reference.integration.loadRecommendedExperience.pipe(
            Effect.flatMap(decodeCapsule),
          );
        const state = userStateFor(reference.integration);
        const detached = yield* detachProduct({
          integration: reference.integration,
          host,
          connection: createProductConnectionRecord(reference.integration),
          userState: state,
        });

        assert.deepStrictEqual(outputs.before, {
          cards: [{ id: "welcome", title: "Shape this board" }],
        });
        assert.deepStrictEqual(outputs.after, {
          cards: [
            { id: "welcome", title: "Shape this board" },
            { id: "card-2", title: "Ship Flect" },
          ],
        });
        assert.include(capsule.manifest.extensions?.[0]?.roles ?? [], "app");
        assert.include(capsule.manifest.extensions?.[0]?.roles ?? [], "shaper");
        assert.strictEqual(detached.connection, undefined);
        assert.strictEqual(detached.userState.forkRevision, state.forkRevision);
        assert.strictEqual(
          detached.userState.exportedSnapshotDigest,
          state.exportedSnapshotDigest,
        );
      }),
  );

  it.effect("runs fixed browser GraphQL and ordered cancellable events", () =>
    Effect.gen(function* () {
      const urls: Array<string> = [];
      let cancelled = false;
      const reference = yield* makeBrowserProjectsProduct({
        fetch: async (input) => {
          urls.push(input.toString());
          return new Response(
            JSON.stringify({
              data: { projects: [{ id: "alpha", name: "Alpha" }] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        eventConnector: {
          open: ({ signal, emit }) =>
            Effect.gen(function* () {
              signal.addEventListener("abort", () => {
                cancelled = true;
              });
              yield* emit(
                ProductEvent.make({
                  version: 1,
                  policyId: "browser-projects.events.v1",
                  sequence: "1",
                  payload: { id: "alpha", status: "active" },
                }),
              );
              yield* emit(
                ProductEvent.make({
                  version: 1,
                  policyId: "browser-projects.events.v1",
                  sequence: "2",
                  payload: { id: "alpha", status: "done" },
                }),
              );
            }),
        },
      });
      const runtime = makeProductIntegrationRuntimeLayer(reference).pipe(
        Layer.provide(decisionStore),
      );
      const result = yield* Effect.gen(function* () {
        const context = yield* grantAll(reference.integration);
        const registry = yield* ProductCapabilityRegistry;
        const events = yield* ProductEventRegistry;
        const projects = yield* registry.invoke(
          context,
          ProductOperationInvocation.make({
            version: 1,
            operationId: "browser-projects.list",
            input: { workspaceId: "reference" },
          }),
        );
        const received = yield* events
          .subscribe(
            context,
            ProductOperationInvocation.make({
              version: 1,
              operationId: "browser-projects.watch",
              input: { workspaceId: "reference" },
            }),
          )
          .pipe(Stream.runCollect);
        return { projects, received: [...received] };
      }).pipe(Effect.provide(runtime));
      const offline = yield* evaluateProductAdoption({
        integration: reference.integration,
        host: ProductHostFacts.make({ ...host, online: false }),
        connection: createProductConnectionRecord(reference.integration),
        userState: userStateFor(reference.integration),
        detached: false,
      });

      assert.deepStrictEqual(result.projects, {
        projects: [{ id: "alpha", name: "Alpha" }],
      });
      assert.deepStrictEqual(
        result.received.map((event) => event.sequence),
        ["1", "2"],
      );
      assert.deepStrictEqual(urls, ["https://products.flect.test/graphql"]);
      assert.isTrue(cancelled);
      assert.deepStrictEqual(
        offline.diagnostics.map((entry) => entry.reason),
        ["offline"],
      );
      assert.strictEqual(
        offline.connection?.archiveSha256,
        reference.integration.metadata.experience.archiveSha256,
      );
      assert.strictEqual(
        offline.userState.forkRevision,
        "refs/heads/user/personal",
      );
    }),
  );

  it.effect(
    "keeps broker credentials private and product denial before callback",
    () =>
      Effect.gen(function* () {
        const secret = "broker-private-secret";
        const requests: Array<ProductBrokerRequest> = [];
        const logs: Array<string> = [];
        const reference = yield* makeBrokeredIncidentsProduct({
          inferenceOwner: "product",
          broker: (request) =>
            Effect.sync((): ProductJson => {
              const credentialAvailableOnlyInsideBroker = secret.length > 0;
              assert.isTrue(credentialAvailableOnlyInsideBroker);
              requests.push(request);
              logs.push(JSON.stringify(request));
              return request.operationId === "brokered-incidents.list"
                ? { incidents: [{ id: "inc-1", status: "open" }] }
                : { incident: { id: "inc-1", status: "acknowledged" } };
            }),
          authorize: ({ operationId }) =>
            Effect.succeed(operationId !== "brokered-incidents.acknowledge"),
        });
        const runtime = makeProductIntegrationRuntimeLayer(reference).pipe(
          Layer.provide(decisionStore),
        );
        const result = yield* Effect.gen(function* () {
          const context = yield* grantAll(reference.integration);
          const registry = yield* ProductCapabilityRegistry;
          const listed = yield* registry.invoke(
            context,
            ProductOperationInvocation.make({
              version: 1,
              operationId: "brokered-incidents.list",
              input: {},
            }),
          );
          const denied = yield* registry
            .invoke(
              context,
              ProductOperationInvocation.make({
                version: 1,
                operationId: "brokered-incidents.acknowledge",
                input: { incidentId: "inc-1" },
              }),
            )
            .pipe(Effect.result);
          return { listed, denied };
        }).pipe(Effect.provide(runtime));
        const archive = yield* reference.integration.loadRecommendedExperience;
        const snapshot = yield* evaluateProductAdoption({
          integration: reference.integration,
          host,
          connection: undefined,
          userState: userStateFor(reference.integration),
          detached: false,
        });
        const publicSurface = JSON.stringify({
          metadata: reference.integration.metadata,
          output: result.listed,
          diagnostics: snapshot.diagnostics,
          logs,
          capsule: new TextDecoder().decode(archive),
        });
        const defecting = yield* makeBrokeredIncidentsProduct({
          broker: () => Effect.die(new Error(secret)),
        });
        const defect = yield* defecting.integration.operations[0]
          ?.execute({})
          .pipe(Effect.result);

        assert.isTrue(Result.isFailure(result.denied));
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(
          reference.integration.selectedInferenceOwner,
          "product",
        );
        assert.notInclude(publicSurface, secret);
        assert.isTrue(Result.isFailure(defect));
        if (Result.isFailure(defect)) {
          assert.strictEqual(defect.failure.reason, "request-failed");
          assert.notInclude(JSON.stringify(defect.failure), secret);
        }
      }),
  );

  it.effect(
    "keeps private-share credentials inside the trusted transport closure",
    () =>
      Effect.gen(function* () {
        const credential = "private-sharing-reference-secret";
        const archive = new Uint8Array([1, 2, 3, 4]);
        const transportObservations: Array<string> = [];
        const reference = makePrivateSharingReference({
          credential,
          load: ({ authorization, reference: requestedReference }) =>
            Effect.sync(() => {
              assert.strictEqual(authorization, `Bearer ${credential}`);
              transportObservations.push(requestedReference);
              return archive;
            }),
        });
        const opened = yield* Effect.gen(function* () {
          const sources = yield* PrivateShareSources;
          return {
            available: yield* sources.list,
            archive: yield* sources.open(reference.source),
          };
        }).pipe(Effect.provide(reference.layer));
        const publicSurface = JSON.stringify({
          source: reference.source,
          available: opened.available,
          archive: [...opened.archive],
          diagnostics: [],
          logs: transportObservations,
        });

        assert.deepStrictEqual(transportObservations, ["team/weather/1.0.0"]);
        assert.deepStrictEqual(opened.archive, archive);
        assert.notInclude(publicSurface, credential);

        const defecting = makePrivateSharingReference({
          credential,
          load: () => Effect.die(new Error(credential)),
        });
        const failure = yield* Effect.gen(function* () {
          const sources = yield* PrivateShareSources;
          return yield* sources.open(defecting.source).pipe(Effect.result);
        }).pipe(Effect.provide(defecting.layer));
        assert.isTrue(Result.isFailure(failure));
        if (Result.isFailure(failure)) {
          assert.strictEqual(failure.failure.reason, "adapter");
          assert.notInclude(JSON.stringify(failure.failure), credential);
        }
      }),
  );
});
