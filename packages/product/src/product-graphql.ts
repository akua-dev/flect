import { Schema } from "effect";
import {
  ProductAdapterJson,
  ProductAdapterPolicyId,
} from "./product-adapter.js";
import { ProductOperationId } from "./product-capability.js";

const ProductGraphqlOperationName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[_A-Za-z][_0-9A-Za-z]*$/),
);

const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const ByteLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 8 * 1024 * 1024 }),
);
const DeadlineMillis = Schema.Int.check(
  Schema.isBetween({ minimum: 100, maximum: 60_000 }),
);

const isHttpsEndpoint = (value: string) => {
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.search === "" &&
      endpoint.hash === "" &&
      endpoint.href === value
    );
  } catch {
    return false;
  }
};

const ProductHttpsEndpoint = Schema.String.check(
  Schema.isMinLength(9),
  Schema.isMaxLength(2_048),
  Schema.makeFilter(isHttpsEndpoint, {
    expected: "an exact HTTPS endpoint without credentials, query, or fragment",
  }),
);

export class ProductGraphqlPolicy extends Schema.Class<ProductGraphqlPolicy>(
  "ProductGraphqlPolicy",
)({
  version: Schema.Literal(1),
  id: ProductAdapterPolicyId,
  endpoint: ProductHttpsEndpoint,
  operationId: ProductOperationId,
  operationName: ProductGraphqlOperationName,
  operationType: Schema.Literals(["query", "mutation"]),
  documentSha256: Sha256,
  requestBytes: ByteLimit,
  responseBytes: ByteLimit,
  deadlineMs: DeadlineMillis,
}) {}

export class ProductGraphqlRequest extends Schema.Class<ProductGraphqlRequest>(
  "ProductGraphqlRequest",
)({
  version: Schema.Literal(1),
  policyId: ProductAdapterPolicyId,
  variables: ProductAdapterJson,
}) {}

export class ProductGraphqlPublicError extends Schema.Class<ProductGraphqlPublicError>(
  "ProductGraphqlPublicError",
)({
  code: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
    Schema.isPattern(/^[A-Za-z0-9._:-]+$/),
  ),
  message: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
}) {}

export class ProductGraphqlResponse extends Schema.Class<ProductGraphqlResponse>(
  "ProductGraphqlResponse",
)(
  Schema.Struct({
    version: Schema.Literal(1),
    data: Schema.optionalKey(ProductAdapterJson),
    errors: Schema.optionalKey(
      Schema.Array(ProductGraphqlPublicError).check(Schema.isMaxLength(32)),
    ),
  }).check(
    Schema.makeFilter(
      (response) =>
        response.data !== undefined || (response.errors?.length ?? 0) > 0,
      { expected: "GraphQL data or at least one public error" },
    ),
  ),
) {}

export class ProductGraphqlFailure extends Schema.TaggedErrorClass<ProductGraphqlFailure>()(
  "ProductGraphqlFailure",
  {
    policyId: ProductAdapterPolicyId,
    reason: Schema.Literals([
      "invalid-policy",
      "denied",
      "invalid-variables",
      "transport",
      "deadline",
      "oversized-response",
      "invalid-response",
      "product-denied",
    ]),
    message: Schema.Literal("The product GraphQL operation failed safely."),
  },
) {}
