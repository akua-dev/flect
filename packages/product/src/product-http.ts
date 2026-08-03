import { Schema } from "effect";

const Identifier = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.-]*$/),
);
const HeaderName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[A-Za-z0-9-]+$/),
);
const HeaderValue = Schema.String.check(Schema.isMaxLength(4_096));

export class ProductHttpHeader extends Schema.Class<ProductHttpHeader>(
  "ProductHttpHeader",
)({
  name: HeaderName,
  value: HeaderValue,
}) {}

export class ProductHttpPolicy extends Schema.Class<ProductHttpPolicy>(
  "ProductHttpPolicy",
)({
  id: Identifier,
  origin: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(500)),
  pathPrefix: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
    Schema.isPattern(/^\/(?!\/)/),
  ),
  methods: Schema.Array(
    Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
  requestHeaders: Schema.Array(HeaderName).check(Schema.isMaxLength(32)),
  responseHeaders: Schema.Array(HeaderName).check(Schema.isMaxLength(32)),
  requestBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 8 * 1024 * 1024 }),
  ),
  responseBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 8 * 1024 * 1024 }),
  ),
  deadlineMs: Schema.Int.check(
    Schema.isBetween({ minimum: 100, maximum: 60_000 }),
  ),
}) {}

export class ProductHttpRequest extends Schema.Class<ProductHttpRequest>(
  "ProductHttpRequest",
)({
  version: Schema.Literal(1),
  policyId: Identifier,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: Schema.Array(ProductHttpHeader).check(Schema.isMaxLength(32)),
  body: Schema.optionalKey(Schema.Uint8Array),
}) {}

export class ProductHttpResponse extends Schema.Class<ProductHttpResponse>(
  "ProductHttpResponse",
)({
  version: Schema.Literal(1),
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  headers: Schema.Array(ProductHttpHeader).check(Schema.isMaxLength(32)),
  body: Schema.Uint8Array,
}) {}

export class ProductHttpFailure extends Schema.TaggedErrorClass<ProductHttpFailure>()(
  "ProductHttpFailure",
  {
    policyId: Identifier,
    reason: Schema.Literals([
      "invalid-policy",
      "denied",
      "oversized-request",
      "transport",
      "deadline",
      "oversized-response",
    ]),
    message: Schema.Literal("The product request failed safely."),
  },
) {}
