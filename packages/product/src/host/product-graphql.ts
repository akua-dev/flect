import { Context, Effect, Layer, Schema, type SchemaAST } from "effect";
import {
  ProductGraphqlFailure,
  ProductGraphqlPolicy,
  ProductGraphqlRequest,
  ProductGraphqlResponse,
} from "../product-graphql.js";
import type { ProductHttpHeader } from "../product-http.js";
import { ProductHttpPolicy, ProductHttpRequest } from "../product-http.js";
import { makeProductHttpLayer, ProductHttp } from "./product-http.js";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const MAX_DOCUMENT_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ProductGraphqlRegistration {
  readonly policy: ProductGraphqlPolicy;
  readonly document: string;
}

export interface ProductGraphqlShape {
  readonly invoke: (
    request: ProductGraphqlRequest,
  ) => Effect.Effect<ProductGraphqlResponse, ProductGraphqlFailure>;
}

export class ProductGraphql extends Context.Service<
  ProductGraphql,
  ProductGraphqlShape
>()("flect/ProductGraphql") {}

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const failure = (policyId: string, reason: ProductGraphqlFailure["reason"]) =>
  ProductGraphqlFailure.make({
    policyId,
    reason,
    message: "The product GraphQL operation failed safely.",
  });

const digest = (document: string, policyId: string) =>
  Effect.tryPromise({
    try: async () => {
      const value = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(document),
      );
      return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    catch: () => failure(policyId, "invalid-policy"),
  });

const documentMatchesOperation = (
  document: string,
  policy: ProductGraphqlPolicy,
) => {
  const operationName = policy.operationName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(`\\b${policy.operationType}\\s+${operationName}\\b`).test(
    document,
  );
};

const httpPolicy = (
  policy: ProductGraphqlPolicy,
): ProductHttpPolicy | undefined => {
  try {
    const endpoint = new URL(policy.endpoint);
    return ProductHttpPolicy.make({
      id: policy.id,
      origin: endpoint.origin,
      pathPrefix: endpoint.pathname,
      methods: ["POST"],
      requestHeaders: ["accept", "content-type"],
      responseHeaders: ["content-type"],
      requestBytes: policy.requestBytes,
      responseBytes: policy.responseBytes,
      deadlineMs: policy.deadlineMs,
    });
  } catch {
    return undefined;
  }
};

const mappedHttpFailure = (
  policyId: string,
  reason:
    | "invalid-policy"
    | "denied"
    | "oversized-request"
    | "transport"
    | "deadline"
    | "oversized-response",
) => {
  switch (reason) {
    case "invalid-policy":
      return failure(policyId, "invalid-policy");
    case "denied":
      return failure(policyId, "denied");
    case "oversized-request":
      return failure(policyId, "invalid-variables");
    case "transport":
      return failure(policyId, "transport");
    case "deadline":
      return failure(policyId, "deadline");
    case "oversized-response":
      return failure(policyId, "oversized-response");
  }
};

const isJsonObject = (
  value: typeof Schema.Json.Type,
): value is Readonly<Record<string, typeof Schema.Json.Type>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeResponse = (policyId: string, status: number, body: Uint8Array) =>
  Effect.gen(function* () {
    if (status < 200 || status >= 300) {
      return yield* Effect.fail(failure(policyId, "product-denied"));
    }
    const text = yield* Effect.try({
      try: () => decoder.decode(body),
      catch: () => failure(policyId, "invalid-response"),
    });
    const json = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Json),
      strict,
    )(text).pipe(Effect.mapError(() => failure(policyId, "invalid-response")));
    if (!isJsonObject(json)) {
      return yield* Effect.fail(failure(policyId, "invalid-response"));
    }
    const errors = json.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return yield* Effect.fail(failure(policyId, "product-denied"));
    }
    if (!("data" in json)) {
      return yield* Effect.fail(failure(policyId, "invalid-response"));
    }
    return yield* Schema.decodeUnknownEffect(
      ProductGraphqlResponse,
      strict,
    )({
      version: 1,
      data: json.data,
    }).pipe(Effect.mapError(() => failure(policyId, "invalid-response")));
  });

export const makeProductGraphqlLayer = (options: {
  readonly registrations: ReadonlyArray<ProductGraphqlRegistration>;
  readonly fetch?: Fetch;
  readonly credentialHeaders?: (
    policyId: string,
  ) => Effect.Effect<ReadonlyArray<ProductHttpHeader>>;
}) => {
  const policies = options.registrations.flatMap((registration) => {
    const policy = httpPolicy(registration.policy);
    return policy === undefined ? [] : [policy];
  });
  const httpLayer = makeProductHttpLayer({
    policies,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.credentialHeaders === undefined
      ? {}
      : { credentialHeaders: options.credentialHeaders }),
  });

  const graphqlLayer = Layer.effect(
    ProductGraphql,
    Effect.gen(function* () {
      const http = yield* ProductHttp;
      const registrations = new Map<string, ProductGraphqlRegistration>();
      for (const candidate of options.registrations) {
        const policy = yield* Schema.decodeUnknownEffect(
          ProductGraphqlPolicy,
          strict,
        )(candidate.policy).pipe(
          Effect.mapError(() => failure(candidate.policy.id, "invalid-policy")),
        );
        if (
          registrations.has(policy.id) ||
          encoder.encode(candidate.document).byteLength > MAX_DOCUMENT_BYTES ||
          !documentMatchesOperation(candidate.document, policy) ||
          (yield* digest(candidate.document, policy.id)) !==
            policy.documentSha256
        ) {
          return yield* Effect.fail(failure(policy.id, "invalid-policy"));
        }
        registrations.set(policy.id, { policy, document: candidate.document });
      }

      const invoke = Effect.fn("Flect.ProductGraphql.invoke")(function* (
        candidate: ProductGraphqlRequest,
      ) {
        const request = yield* Schema.decodeUnknownEffect(
          ProductGraphqlRequest,
          strict,
        )(candidate).pipe(
          Effect.mapError(() =>
            failure(candidate.policyId, "invalid-variables"),
          ),
        );
        const registration = registrations.get(request.policyId);
        if (registration === undefined) {
          return yield* Effect.fail(
            failure(request.policyId, "invalid-policy"),
          );
        }
        const encoded = yield* Effect.try({
          try: () =>
            encoder.encode(
              JSON.stringify({
                operationName: registration.policy.operationName,
                query: registration.document,
                variables: request.variables,
              }),
            ),
          catch: () => failure(request.policyId, "invalid-variables"),
        });
        if (encoded.byteLength > registration.policy.requestBytes) {
          return yield* Effect.fail(
            failure(request.policyId, "invalid-variables"),
          );
        }
        const endpoint = new URL(registration.policy.endpoint);
        const response = yield* http
          .invoke(
            ProductHttpRequest.make({
              version: 1,
              policyId: registration.policy.id,
              path: `${endpoint.pathname}${endpoint.search}`,
              method: "POST",
              headers: [
                {
                  name: "accept",
                  value: "application/graphql-response+json, application/json",
                },
                { name: "content-type", value: "application/json" },
              ],
              body: encoded,
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              mappedHttpFailure(request.policyId, error.reason),
            ),
          );
        return yield* decodeResponse(
          request.policyId,
          response.status,
          response.body,
        );
      });

      return { invoke };
    }),
  );

  return graphqlLayer.pipe(Layer.provide(httpLayer));
};
