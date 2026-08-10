import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  ProductGraphqlFailure,
  ProductGraphqlPolicy,
  ProductGraphqlRequest,
} from "../../shared/product-graphql";
import {
  makeProductGraphqlLayer,
  ProductGraphql,
  type ProductGraphqlRegistration,
} from "./product-graphql";

const document =
  "query ProjectsList($limit: Int!) { projects(limit: $limit) { id } }";

const sha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  });

const registration = Effect.gen(function* () {
  const documentSha256 = yield* sha256(document);
  return {
    policy: ProductGraphqlPolicy.make({
      version: 1,
      id: "reference.graphql.projects",
      endpoint: "https://api.example.test/graphql",
      operationId: "projects.list",
      operationName: "ProjectsList",
      operationType: "query",
      documentSha256,
      requestBytes: 4_096,
      responseBytes: 1_024,
      deadlineMs: 100,
    }),
    document,
  } satisfies ProductGraphqlRegistration;
});

const request = (policyId = "reference.graphql.projects") =>
  ProductGraphqlRequest.make({
    version: 1,
    policyId,
    variables: { limit: 20 },
  });

describe("ProductGraphql", () => {
  it.effect(
    "uses only the registered endpoint and document while injecting credentials privately",
    () =>
      Effect.gen(function* () {
        const registered = yield* registration;
        let observed: Request | undefined;
        const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          observed = new Request(input, init);
          return Promise.resolve(
            new Response('{"data":{"projects":[{"id":"one"}]}}', {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        });
        const layer = makeProductGraphqlLayer({
          registrations: [registered],
          fetch,
          credentialHeaders: () =>
            Effect.succeed([
              { name: "authorization", value: "Bearer host-secret" },
            ]),
        });
        const response = yield* Effect.gen(function* () {
          return yield* (yield* ProductGraphql).invoke(request());
        }).pipe(Effect.provide(layer));

        assert.strictEqual(observed?.url, registered.policy.endpoint);
        assert.strictEqual(
          observed?.headers.get("authorization"),
          "Bearer host-secret",
        );
        const observedBody = yield* Effect.promise(() =>
          observed === undefined ? Promise.resolve("") : observed.text(),
        );
        assert.deepStrictEqual(JSON.parse(observedBody), {
          operationName: "ProjectsList",
          query: document,
          variables: { limit: 20 },
        });
        assert.deepStrictEqual(response.data, {
          projects: [{ id: "one" }],
        });
        assert.notInclude(JSON.stringify(response), "host-secret");
        assert.notInclude(JSON.stringify(response), document);
      }),
  );

  it.effect("rejects unknown policy before transport", () =>
    Effect.gen(function* () {
      const registered = yield* registration;
      const fetch = vi.fn(() => Promise.resolve(new Response("never")));
      const layer = makeProductGraphqlLayer({
        registrations: [registered],
        fetch,
      });
      const error = yield* Effect.gen(function* () {
        return yield* (yield* ProductGraphql).invoke(request("unknown.policy"));
      }).pipe(Effect.provide(layer), Effect.flip);

      assert.strictEqual(error.reason, "invalid-policy");
      assert.strictEqual(fetch.mock.calls.length, 0);
    }),
  );

  it.effect("rejects a document that does not match registered policy", () =>
    Effect.gen(function* () {
      const registered = yield* registration;
      const layer = makeProductGraphqlLayer({
        registrations: [{ ...registered, document: `${document} changed` }],
      });
      const error = yield* ProductGraphql.pipe(
        Effect.provide(layer),
        Effect.flip,
      );

      assert.strictEqual(error.reason, "invalid-policy");
      assert.isTrue(Schema.is(ProductGraphqlFailure)(error));
    }),
  );

  it.effect("bounds variables and response bytes", () =>
    Effect.gen(function* () {
      const registered = yield* registration;
      const fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: "x".repeat(2_000) })),
        ),
      );
      const layer = makeProductGraphqlLayer({
        registrations: [registered],
        fetch,
      });
      const adapter = yield* ProductGraphql.pipe(Effect.provide(layer));
      const variablesError = yield* adapter
        .invoke(
          ProductGraphqlRequest.make({
            version: 1,
            policyId: registered.policy.id,
            variables: { value: "x".repeat(4_096) },
          }),
        )
        .pipe(Effect.flip);
      assert.strictEqual(variablesError.reason, "invalid-variables");
      assert.strictEqual(fetch.mock.calls.length, 0);

      const responseError = yield* adapter.invoke(request()).pipe(Effect.flip);
      assert.strictEqual(responseError.reason, "oversized-response");
    }),
  );

  it.effect("sanitizes product and transport failure detail", () =>
    Effect.gen(function* () {
      const registered = yield* registration;
      const graphqlLayer = makeProductGraphqlLayer({
        registrations: [registered],
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                errors: [
                  {
                    message: "postgres password=private",
                    extensions: { token: "host-secret" },
                  },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            ),
          ),
      });
      const productError = yield* Effect.gen(function* () {
        return yield* (yield* ProductGraphql).invoke(request());
      }).pipe(Effect.provide(graphqlLayer), Effect.flip);

      assert.strictEqual(productError.reason, "product-denied");
      assert.strictEqual(
        productError.message,
        "The product GraphQL operation failed safely.",
      );
      assert.notInclude(JSON.stringify(productError), "postgres");
      assert.notInclude(JSON.stringify(productError), "host-secret");

      const transportLayer = makeProductGraphqlLayer({
        registrations: [registered],
        fetch: () => Promise.reject(new Error("Bearer transport-secret")),
      });
      const transportError = yield* Effect.gen(function* () {
        return yield* (yield* ProductGraphql).invoke(request());
      }).pipe(Effect.provide(transportLayer), Effect.flip);
      assert.strictEqual(transportError.reason, "transport");
      assert.notInclude(JSON.stringify(transportError), "transport-secret");
    }),
  );

  it.effect("sanitizes private credential resolver defects", () =>
    Effect.gen(function* () {
      const registered = yield* registration;
      const layer = makeProductGraphqlLayer({
        registrations: [registered],
        credentialHeaders: () =>
          Effect.die(new Error("vault host-secret must never escape")),
      });
      const error = yield* Effect.gen(function* () {
        return yield* (yield* ProductGraphql).invoke(request());
      }).pipe(Effect.provide(layer), Effect.flip);

      assert.strictEqual(error.reason, "transport");
      assert.notInclude(JSON.stringify(error), "vault");
      assert.notInclude(JSON.stringify(error), "host-secret");
    }),
  );
});
